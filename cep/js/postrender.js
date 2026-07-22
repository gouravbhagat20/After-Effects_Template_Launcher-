/*
    BHPost — Sunrise post-render pipeline (PNG sequence → WebM / MOV / HTML / ZIP).
    Node port of the ScriptUI runConversion: same codecs, flags, fallback chain,
    and output names (output.webm / output.mov / index.html / <Name>_Optimized.zip),
    but async with real progress and no generated shell scripts.
*/
(function (global) {
    "use strict";

    var nodeRequire = (global.cep_node && global.cep_node.require) || global.require;
    var cp = nodeRequire("child_process");
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var os = nodeRequire("os");

    var IS_WIN = os.platform() === "win32";
    var NULL_DEV = IS_WIN ? "NUL" : "/dev/null";

    var current = null;
    var cancelled = false;

    // ---------------- detection ----------------

    /** Find a PNG sequence in a folder. Numeric-aware sort (fixes mixed padding). */
    function detectPNGSequence(folder) {
        var files;
        try {
            files = fs.readdirSync(folder).filter(function (f) { return /\.png$/i.test(f); });
        } catch (e) { return null; }
        if (!files.length) return null;

        files.sort(function (a, b) {
            var na = (a.match(/(\d+)\.png$/i) || [0, 0])[1];
            var nb = (b.match(/(\d+)\.png$/i) || [0, 0])[1];
            return parseInt(na, 10) - parseInt(nb, 10) || a.localeCompare(b);
        });

        var match = files[0].match(/^(.*?)(\d+)(\.png)$/i);
        if (!match) return null;

        return {
            folder: folder,
            prefix: match[1],
            padding: match[2].length,
            start: parseInt(match[2], 10),
            count: files.length
        };
    }

    // ---------------- helpers ----------------

    function spawnFF(exe, args, totalSec, onProgress) {
        return new Promise(function (resolve, reject) {
            var proc = cp.spawn(exe, args, { windowsHide: true });
            current = proc;
            var errTail = "";
            proc.stdout.on("data", function (chunk) {
                var m = /out_time_us=(\d+)/.exec(String(chunk));
                if (m && totalSec > 0 && onProgress) {
                    onProgress(Math.min(100, (parseInt(m[1], 10) / 1e6) / totalSec * 100));
                }
            });
            proc.stderr.on("data", function (chunk) { errTail = (errTail + String(chunk)).slice(-4000); });
            proc.on("error", function (err) { current = null; reject(err); });
            proc.on("close", function (code) {
                current = null;
                if (cancelled) reject(new Error("CANCELLED"));
                else if (code === 0) resolve();
                else reject(new Error("ffmpeg exited " + code + ":\n" + errTail.split("\n").slice(-5).join("\n")));
            });
        });
    }

    function inputArgs(seq, fps) {
        var pattern = path.join(seq.folder, seq.prefix + "%0" + seq.padding + "d.png");
        return ["-framerate", fps, "-start_number", seq.start, "-i", pattern].map(String);
    }

    function okFile(p) {
        try { return fs.statSync(p).size > 0; } catch (e) { return false; }
    }

    // ---------------- steps ----------------

    /** WebM: two-pass VP9 with alpha. DOOH gets a bitrate target, else CRF 20. */
    function makeWebM(exe, seq, fps, durationSec, isDOOH, targetMB, outWebM, onProgress, onLog) {
        var passLog = path.join(os.tmpdir(), "bh_vp9_" + Date.now());
        var rate;
        if (isDOOH) {
            var kbps = Math.floor((targetMB * 8192) / Math.max(durationSec, 1)) - 128;
            if (kbps < 1000) kbps = 1000;
            // 1.4x maxrate: maxrate == average starved busy frames and blurred
            // detail; two-pass -b:v still holds the total size on target.
            rate = ["-b:v", kbps + "k", "-maxrate", Math.floor(kbps * 1.4) + "k", "-bufsize", (kbps * 3) + "k"];
            onLog("WebM: enforcing " + targetMB + " MB DOOH target (" + kbps + " kbps)");
        } else {
            rate = ["-b:v", "0", "-crf", "20"];
        }
        var common = inputArgs(seq, fps).concat(
            ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p"], rate,
            ["-row-mt", "1", "-passlogfile", passLog, "-an", "-progress", "pipe:1", "-v", "error", "-y"]);
        var pass1 = common.concat(["-speed", "4", "-quality", "good", "-pass", "1", "-f", "null", NULL_DEV]);
        var pass2 = common.concat(["-speed", "0", "-quality", "best", "-pass", "2", outWebM]);

        return spawnFF(exe, pass1, durationSec, function (p) { onProgress(p / 2); })
            .then(function () { return spawnFF(exe, pass2, durationSec, function (p) { onProgress(50 + p / 2); }); })
            .then(function () {
                try { fs.unlinkSync(passLog + "-0.log"); } catch (e) { }
                if (!okFile(outWebM)) throw new Error("WebM output missing/empty.");
                onLog("WebM: SUCCESS (" + (fs.statSync(outWebM).size / 1048576).toFixed(2) + " MB)");
            });
    }

    /** MOV fallback chain: HEVC alpha → ProRes 4444 alpha → H.264 (no alpha). */
    function makeMOV(exe, seq, fps, durationSec, outMov, onProgress, onLog) {
        var base = inputArgs(seq, fps);
        var tail = ["-progress", "pipe:1", "-v", "error", "-y", outMov];
        var attempts = [
            { label: "HEVC (alpha)", args: base.concat(["-c:v", "libx265", "-pix_fmt", "yuva444p10le", "-x265-params", "alpha=1", "-crf", "24", "-preset", "slow", "-tag:v", "hvc1"], tail) },
            { label: "ProRes 4444 (alpha)", args: base.concat(["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-vendor", "apl0"], tail) },
            { label: "H.264 (no alpha)", args: base.concat(["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow"], tail) }
        ];
        function tryAt(i) {
            if (i >= attempts.length) throw new Error("All MOV codecs failed.");
            return spawnFF(exe, attempts[i].args, durationSec, onProgress).then(function () {
                if (!okFile(outMov)) throw new Error("empty");
                onLog("MOV: SUCCESS via " + attempts[i].label);
            }, function (err) {
                if (err.message === "CANCELLED") throw err;
                onLog("MOV: " + attempts[i].label + " failed, trying next…");
                return tryAt(i + 1);
            });
        }
        return tryAt(0);
    }

    /** index.html — identical Mediabunny player the script generates. */
    function makeHTML(outHtml, title, width, height) {
        var html = '<!DOCTYPE html>\n<html>\n  <head>\n    <meta charset="UTF-8" />\n' +
            '    <title>' + title + ' - Big Happy</title>\n' +
            '    <script src="https://cdn.bighappy.co/libs/mediabunny/v1.25.0/mediabunny.min.cjs"><\/script>\n' +
            '    <style>\n      html, body { margin: 0; padding: 0; }\n    </style>\n  </head>\n  <body>\n' +
            '    <div id="animation_container">\n      <canvas id="webmCanvas" width="' + width + '" height="' + height + '"></canvas>\n    </div>\n' +
            '    <script>\n      const { Input, BlobSource, WEBM, VideoSampleSink } = Mediabunny;\n' +
            '      const videoUrl = "./output.webm";\n\n' +
            '      (async function playWithMediabunny(url) {\n' +
            '        const canvas = document.getElementById("webmCanvas");\n        if (!canvas) return;\n        if (!url) return;\n\n' +
            '        const ctx = canvas.getContext("2d", { alpha: true });\n        if (!ctx) return;\n\n' +
            '        try {\n          const resp = await fetch(url);\n' +
            '          if (!resp.ok) throw new Error("File not found or blocked: " + resp.statusText);\n' +
            '          const blob = await resp.blob();\n\n          while (true) {\n' +
            '            const input = new Input({\n              source: new BlobSource(blob),\n              formats: [WEBM],\n            });\n\n' +
            '            const videoTrack = await input.getPrimaryVideoTrack();\n            if (!videoTrack) break;\n\n' +
            '            const decodable = await videoTrack.canDecode();\n            if (!decodable) break;\n\n' +
            '            const sink = new VideoSampleSink(videoTrack);\n            let firstTimestamp = null;\n            let startWallClock = null;\n\n' +
            '            for await (const sample of sink.samples()) {\n              try {\n' +
            '                if (firstTimestamp === null) {\n                  firstTimestamp = sample.timestamp;\n                  startWallClock = performance.now();\n                }\n' +
            '                const targetTime = startWallClock + (sample.timestamp - firstTimestamp) * 1000;\n' +
            '                const delay = targetTime - performance.now();\n' +
            '                if (delay > 0) await new Promise((r) => setTimeout(r, delay));\n\n' +
            '                ctx.clearRect(0, 0, canvas.width, canvas.height);\n' +
            '                sample.drawWithFit(ctx, { fit: "cover" });\n              } finally {\n                sample.close();\n              }\n            }\n          }\n' +
            '        } catch (e) {\n          console.error(e);\n' +
            '          if (e.name === "TypeError" && window.location.protocol === "file:") {\n' +
            '            alert("SECURITY ERROR:\\n\\nBrowsers block loading external video files (output.webm) when opening HTML directly from your hard drive.\\n\\nSOLUTION:\\n1. Upload to a server\\n2. Or use a local server (VS Code Live Server)\\n3. Or use Firefox (it is less strict)");\n' +
            '          } else {\n             alert("Playback Error: " + e.message);\n          }\n        }\n      })(videoUrl);\n    <\/script>\n  </body>\n</html>';
        fs.writeFileSync(outHtml, html, "utf8");
    }

    /** ZIP the delivery files (mac: zip -j, win: PowerShell Compress-Archive). */
    function makeZIP(files, zipPath, onLog) {
        var existing = files.filter(okFile);
        if (!existing.length) return Promise.reject(new Error("Nothing to zip."));
        try { fs.unlinkSync(zipPath); } catch (e) { }

        return new Promise(function (resolve, reject) {
            var proc;
            if (IS_WIN) {
                var ps = existing.map(function (f) { return "'" + f.replace(/'/g, "''") + "'"; }).join(",");
                proc = cp.spawn("powershell", ["-NoProfile", "-Command",
                    "Compress-Archive -LiteralPath " + ps + " -DestinationPath '" + zipPath.replace(/'/g, "''") + "' -Force"],
                    { windowsHide: true });
            } else {
                proc = cp.spawn("zip", ["-j", "-X", zipPath].concat(existing));
            }
            var errTail = "";
            proc.stderr.on("data", function (c) { errTail += String(c); });
            proc.on("error", reject);
            proc.on("close", function (code) {
                if (code === 0 && okFile(zipPath)) {
                    onLog("ZIP: SUCCESS (" + path.basename(zipPath) + ")");
                    resolve();
                } else reject(new Error("zip failed: " + errTail.slice(-300)));
            });
        });
    }

    // ---------------- orchestrator ----------------

    /**
     * Run the full conversion.
     * opts: { ffmpegPath, seq, fps, width, height, title, isDOOH, targetMB,
     *         webm, mov, html, zip }
     * onProgress(stepLabel, pct), onLog(line).
     * Resolves { outputs: [paths] }.
     */
    function convert(opts, onProgress, onLog) {
        cancelled = false;
        var outDir = opts.seq.folder;
        var outWebM = path.join(outDir, "output.webm");
        var outMov = path.join(outDir, "output.mov");
        var outHtml = path.join(outDir, "index.html");
        var zipPath = path.join(outDir, opts.seq.prefix.replace(/_+$/, "") + "_Optimized.zip");
        var durationSec = opts.seq.count / opts.fps;
        var outputs = [];

        var chain = Promise.resolve();

        if (opts.html) {
            chain = chain.then(function () {
                makeHTML(outHtml, opts.title || "Animation", opts.width, opts.height);
                outputs.push(outHtml);
                onLog("HTML: written (index.html)");
            });
        }
        if (opts.webm) {
            chain = chain.then(function () {
                if (cancelled) throw new Error("CANCELLED");
                return makeWebM(opts.ffmpegPath, opts.seq, opts.fps, durationSec,
                    !!opts.isDOOH, opts.targetMB || 6.8, outWebM,
                    function (p) { onProgress("WebM", p); }, onLog)
                    .then(function () { outputs.push(outWebM); });
            });
        }
        if (opts.mov) {
            chain = chain.then(function () {
                if (cancelled) throw new Error("CANCELLED");
                return makeMOV(opts.ffmpegPath, opts.seq, opts.fps, durationSec, outMov,
                    function (p) { onProgress("MOV", p); }, onLog)
                    .then(function () { outputs.push(outMov); });
            });
        }
        if (opts.zip) {
            chain = chain.then(function () {
                if (cancelled) throw new Error("CANCELLED");
                onProgress("ZIP", 50);
                return makeZIP(outputs.slice(), zipPath, onLog)
                    .then(function () { outputs.push(zipPath); onProgress("ZIP", 100); });
            });
        }

        return chain.then(function () { return { outputs: outputs }; });
    }

    function cancel() {
        cancelled = true;
        if (current) { try { current.kill("SIGKILL"); } catch (e) { } }
    }

    /** Existing outputs that a new run would overwrite. */
    function existingOutputs(folder) {
        return ["output.webm", "output.mov", "index.html"]
            .map(function (f) { return path.join(folder, f); })
            .filter(function (p) { return fs.existsSync(p); });
    }

    global.BHPost = {
        detectPNGSequence: detectPNGSequence,
        convert: convert,
        cancel: cancel,
        existingOutputs: existingOutputs
    };
})(window);
