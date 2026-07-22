/*
    BHFFmpeg — async ffmpeg engine for the BigHappy Launcher panel.

    Runs ffmpeg/ffprobe as Node child processes (no shell scripts, no
    quoting problems, identical code on Windows and macOS). Provides:

      detect()                       -> Promise<string|null>  ffmpeg path
      probe(file)                    -> Promise<info>         duration/size/streams
      optimize(file, opts, onProg)   -> Promise<result>       two-pass size-targeted
      cancel()                       -> kills the running encode

    Size targeting is REAL: two-pass -b:v from the target, output verified,
    re-encoded at a lower bitrate if it still exceeds the cap.
    Replacement is a backup-swap: original -> .bak, output -> original,
    delete .bak — the source can never be lost mid-swap.
*/
(function (global) {
    "use strict";

    var nodeRequire = (global.cep_node && global.cep_node.require) || global.require;
    var cp = nodeRequire("child_process");
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var os = nodeRequire("os");
    var crypto = nodeRequire("crypto");

    var IS_WIN = os.platform() === "win32";
    var NULL_DEV = IS_WIN ? "NUL" : "/dev/null";

    var current = null;       // running ChildProcess
    var cancelled = false;

    // ---------------- detection ----------------

    var COMMON_PATHS = IS_WIN ? [
        "C:\\ffmpeg\\bin\\ffmpeg.exe",
        path.join(process.env.LOCALAPPDATA || "", "ffmpeg", "bin", "ffmpeg.exe"),
        path.join(process.env.ProgramFiles || "C:\\Program Files", "ffmpeg", "bin", "ffmpeg.exe")
    ] : [
        "/opt/homebrew/bin/ffmpeg",   // Apple Silicon Homebrew
        "/usr/local/bin/ffmpeg",      // Intel Homebrew / manual
        "/usr/bin/ffmpeg"
    ];

    function runOnce(exe, args) {
        return new Promise(function (resolve) {
            try {
                cp.execFile(exe, args, { timeout: 10000 }, function (err, stdout, stderr) {
                    resolve(err ? null : String(stdout || stderr));
                });
            } catch (e) { resolve(null); }
        });
    }

    /** Find a working ffmpeg: saved path -> PATH -> common install locations. */
    function detect(savedPath) {
        var candidates = [];
        if (savedPath) candidates.push(savedPath);
        candidates.push("ffmpeg"); // PATH (works when AE inherited a full env)
        candidates = candidates.concat(COMMON_PATHS);

        return candidates.reduce(function (chain, cand) {
            return chain.then(function (found) {
                if (found) return found;
                if (cand !== "ffmpeg" && !fs.existsSync(cand)) return null;
                return runOnce(cand, ["-version"]).then(function (out) {
                    return (out && out.indexOf("ffmpeg version") !== -1) ? cand : null;
                });
            });
        }, Promise.resolve(null));
    }

    function ffprobeFor(ffmpegPath) {
        if (!ffmpegPath || ffmpegPath === "ffmpeg") return "ffprobe";
        var probe = path.join(path.dirname(ffmpegPath), IS_WIN ? "ffprobe.exe" : "ffprobe");
        return fs.existsSync(probe) ? probe : "ffprobe";
    }

    // ---------------- probing ----------------

    /** Duration, size, resolution via ffprobe JSON. */
    function probe(ffmpegPath, file) {
        var args = ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", file];
        return runOnce(ffprobeFor(ffmpegPath), args).then(function (out) {
            if (!out) throw new Error("ffprobe failed for " + file);
            var info = JSON.parse(out);
            var v = (info.streams || []).filter(function (s) { return s.codec_type === "video"; })[0] || {};
            return {
                path: file,
                sizeMB: fs.statSync(file).size / (1024 * 1024),
                duration: parseFloat((info.format || {}).duration) || 0,
                width: v.width || 0,
                height: v.height || 0
            };
        });
    }

    // ---------------- encoding ----------------

    function spawnFFmpeg(exe, args, durationSec, onProgress) {
        return new Promise(function (resolve, reject) {
            var proc = cp.spawn(exe, args, { windowsHide: true });
            current = proc;
            var errTail = "";

            // -progress pipe:1 emits key=value lines on stdout
            proc.stdout.on("data", function (chunk) {
                var m = /out_time_us=(\d+)/.exec(String(chunk));
                if (m && durationSec > 0 && onProgress) {
                    var pct = Math.min(100, (parseInt(m[1], 10) / 1e6) / durationSec * 100);
                    onProgress(pct);
                }
            });
            proc.stderr.on("data", function (chunk) {
                errTail = (errTail + String(chunk)).slice(-4000);
            });
            proc.on("error", function (err) { current = null; reject(err); });
            proc.on("close", function (code) {
                current = null;
                if (cancelled) reject(new Error("CANCELLED"));
                else if (code === 0) resolve();
                else reject(new Error("ffmpeg exited " + code + ":\n" + errTail.split("\n").slice(-6).join("\n")));
            });
        });
    }

    function twoPass(exe, input, output, videoKbps, durationSec, passLogBase, onProgress) {
        var common = [
            "-y", "-i", input,
            "-c:v", "libx264", "-preset", "slow", "-profile:v", "high",
            "-b:v", videoKbps + "k",
            // 1.5x maxrate: a tight cap (1.1x) starved busy frames and blurred
            // detailed elements; two-pass -b:v keeps the total size on target.
            "-maxrate", Math.floor(videoKbps * 1.5) + "k",
            "-bufsize", (videoKbps * 3) + "k",
            "-x264-params", "aq-mode=3",
            "-pix_fmt", "yuv420p", "-an",
            "-passlogfile", passLogBase,
            "-progress", "pipe:1", "-v", "error"
        ];
        var pass1 = common.concat(["-pass", "1", "-f", "mp4", NULL_DEV]);
        var pass2 = common.concat(["-pass", "2", "-movflags", "+faststart", output]);

        // pass 1 = 0-50 % of the bar, pass 2 = 50-100 %
        return spawnFFmpeg(exe, pass1, durationSec, function (p) { onProgress(p / 2); })
            .then(function () {
                if (cancelled) throw new Error("CANCELLED");
                return spawnFFmpeg(exe, pass2, durationSec, function (p) { onProgress(50 + p / 2); });
            });
    }

    /**
     * original -> .bak, optimized -> original name, delete .bak.
     * Never clobbers an existing .bak (it may be a recovery backup from a
     * previous failed run) — picks a unique suffix instead.
     */
    function backupSwap(originalPath, optimizedPath) {
        var bak = originalPath + ".bak";
        var n = 1;
        while (fs.existsSync(bak)) bak = originalPath + ".bak" + (n++);
        fs.renameSync(originalPath, bak);
        try {
            fs.renameSync(optimizedPath, originalPath);
        } catch (e) {
            fs.renameSync(bak, originalPath); // roll back
            throw e;
        }
        // The swap already succeeded — a failed .bak cleanup must not make
        // the whole optimization report as failed. The stray .bak is
        // deliberately never clobbered (see above), only left behind.
        try { fs.unlinkSync(bak); } catch (e) { }
    }

    /**
     * Optimize one MP4 under a hard size cap.
     * opts: { ffmpegPath, targetMB, replaceOriginal }
     * onProgress(pct 0-100)
     * Resolves { path, before, after, met, attempts, replaced }.
     */
    function optimize(file, opts, onProgress) {
        cancelled = false;
        var exe = opts.ffmpegPath;
        var targetMB = opts.targetMB;
        var tmpOut = path.join(path.dirname(file),
            path.basename(file, ".mp4") + "_Optimized.mp4");
        var passLog = path.join(os.tmpdir(), "bh_pass_" + Date.now());

        return probe(exe, file).then(function (info) {
            if (info.sizeMB <= targetMB) {
                return { path: file, before: info.sizeMB, after: info.sizeMB, met: true, attempts: 0, replaced: false, skipped: true };
            }
            var duration = Math.max(info.duration, 0.5);
            // 6% container/muxing overhead margin, no audio (-an)
            var kbps = Math.floor((targetMB * 8192 * 0.94) / duration);
            if (kbps < 300) kbps = 300;

            var attempt = 0;
            function encodeOnce() {
                attempt++;
                return twoPass(exe, file, tmpOut, kbps, duration, passLog, onProgress)
                    .then(function () {
                        var outMB = fs.statSync(tmpOut).size / (1024 * 1024);
                        if (outMB > targetMB && attempt < 3) {
                            // Still over the cap — retry at a proportionally lower bitrate
                            kbps = Math.floor(kbps * (targetMB / outMB) * 0.97);
                            return encodeOnce();
                        }
                        return outMB;
                    });
            }

            return encodeOnce().then(function (outMB) {
                var met = outMB <= targetMB;
                var replaced = false;
                // HARD CAP: never replace the original with an over-target file —
                // keep it as _Optimized.mp4 for inspection instead.
                if (opts.replaceOriginal && met) {
                    backupSwap(file, tmpOut);
                    replaced = true;
                }
                return {
                    path: file, before: info.sizeMB, after: outMB,
                    met: met, attempts: attempt, replaced: replaced,
                    output: replaced ? file : tmpOut
                };
            });
        }).then(cleanupPassLogs(passLog), function (err) {
            cleanupPassLogs(passLog)();
            if (fs.existsSync(tmpOut)) { try { fs.unlinkSync(tmpOut); } catch (e) { } }
            throw err;
        });

        function cleanupPassLogs(base) {
            return function (result) {
                [base + "-0.log", base + "-0.log.mbtree"].forEach(function (f) {
                    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { }
                });
                return result;
            };
        }
    }

    function cancel() {
        cancelled = true;
        if (current) {
            try { current.kill("SIGKILL"); } catch (e) { }
        }
    }

    // ---------------- installation ----------------

    function sha256File(p) {
        return new Promise(function (resolve, reject) {
            var hash = crypto.createHash("sha256");
            var stream = fs.createReadStream(p);
            stream.on("data", function (d) { hash.update(d); });
            stream.on("end", function () { resolve(hash.digest("hex")); });
            stream.on("error", reject);
        });
    }

    function run(exe, args, onLog) {
        return new Promise(function (resolve, reject) {
            var proc = cp.spawn(exe, args, { windowsHide: true });
            var tail = "";
            function onData(chunk) {
                tail = (tail + String(chunk)).slice(-2000);
                if (onLog) {
                    String(chunk).split("\n").forEach(function (l) {
                        if (l.replace(/\s/g, "")) onLog(l.trim());
                    });
                }
            }
            proc.stdout.on("data", onData);
            proc.stderr.on("data", onData);
            proc.on("error", reject);
            proc.on("close", function (code) {
                code === 0 ? resolve() : reject(new Error(exe + " exited " + code + ":\n" + tail.split("\n").slice(-4).join("\n")));
            });
        });
    }

    /**
     * Install ffmpeg for the current user.
     * Mac: Homebrew (must be present). Windows: download the gyan.dev
     * essentials build and extract into %LOCALAPPDATA%\ffmpeg.
     * onLog(line) receives progress lines. Resolves the ffmpeg path.
     */
    function install(onLog) {
        onLog = onLog || function () { };
        if (!IS_WIN) {
            var brew = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"].filter(fs.existsSync)[0];
            if (!brew) {
                return Promise.reject(new Error(
                    "Homebrew is not installed, so ffmpeg can't be installed automatically.\n" +
                    "Install Homebrew from https://brew.sh then click Install again."));
            }
            onLog("Installing ffmpeg via Homebrew (this can take a few minutes)…");
            return run(brew, ["install", "ffmpeg"], onLog).then(function () {
                return detect(null).then(function (found) {
                    if (!found) throw new Error("brew finished but ffmpeg was not found.");
                    return found;
                });
            });
        }

        // Windows: curl (bundled since Win10 1803) + tar (bsdtar, Win10 17063+)
        var destDir = path.join(process.env.LOCALAPPDATA || os.homedir(), "ffmpeg");
        var zipPath = path.join(os.tmpdir(), "ffmpeg-release-essentials.zip");
        var url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

        onLog("Downloading ffmpeg (~90 MB)…");
        return run("curl", ["-L", "--fail", "--max-time", "600", "-o", zipPath, url], onLog)
            .then(function () {
                var sizeMB = fs.statSync(zipPath).size / (1024 * 1024);
                if (sizeMB < 20) throw new Error("Download too small (" + sizeMB.toFixed(1) + " MB) — probably failed.");
                // Verify against the publisher's SHA-256 before extracting/running
                onLog("Verifying checksum…");
                var shaPath = zipPath + ".sha256";
                return run("curl", ["-L", "--fail", "--max-time", "60", "-o", shaPath, url + ".sha256"], onLog)
                    .then(function () { return sha256File(zipPath); })
                    .then(function (actual) {
                        var expected = (fs.readFileSync(shaPath, "utf8").match(/[a-f0-9]{64}/i) || [""])[0];
                        try { fs.unlinkSync(shaPath); } catch (e) { }
                        if (!expected) throw new Error("Could not read published SHA-256.");
                        if (expected.toLowerCase() !== actual.toLowerCase()) {
                            fs.unlinkSync(zipPath);
                            throw new Error("Checksum mismatch — download discarded.\nExpected " + expected + "\nGot      " + actual);
                        }
                    });
            })
            .then(function () {
                onLog("Extracting…");
                fs.mkdirSync(destDir, { recursive: true });
                return run("tar", ["-xf", zipPath, "-C", destDir, "--strip-components", "1"], onLog);
            })
            .then(function () {
                try { fs.unlinkSync(zipPath); } catch (e) { }
                var exe = path.join(destDir, "bin", "ffmpeg.exe");
                if (!fs.existsSync(exe)) throw new Error("Extraction finished but ffmpeg.exe not found in " + destDir);
                return runOnce(exe, ["-version"]).then(function (out) {
                    if (!out || out.indexOf("ffmpeg version") === -1) throw new Error("Installed ffmpeg failed to run.");
                    onLog("Installed: " + exe);
                    return exe;
                });
            });
    }

    global.BHFFmpeg = {
        detect: detect,
        probe: probe,
        optimize: optimize,
        cancel: cancel,
        install: install,
        isWin: IS_WIN
    };
})(window);
