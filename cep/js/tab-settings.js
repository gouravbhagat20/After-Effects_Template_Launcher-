/*
    BHSettings — the Settings tab: folder/ffmpeg preferences and the
    diagnostics report people paste into a bug report.
*/
(function (global) {
    "use strict";

    function init(core) {
        var $ = core.$;
        var ui = core.ui;
        var cs = core.cs;
        var host = core.host;
        var toast = core.toast;
        var pathMod = core.node.path;
        var fsMod = core.node.fs;
        var osMod = core.node.os;
        var cp = core.node.cp;

        // ---------------- preference fields ----------------

        function bindSetting(inputId, key) {
            $(inputId).addEventListener("change", function () {
                core.setSetting(key, this.value || "");
                toast("✓ Saved");
            });
        }
        bindSetting("set-ffmpeg", "ffmpeg_path");
        bindSetting("set-basefolder", "base_work_folder");
        bindSetting("set-tplfolder", "templates_folder");
        bindSetting("set-nasroot", "nas_root");

        function bindBrowse(btnId, inputId, key, title) {
            $(btnId).addEventListener("click", function () {
                var folder = core.pickFolder(title);
                if (!folder) return;
                $(inputId).value = folder;
                core.setSetting(key, folder);
                toast("✓ Saved");
            });
        }
        bindBrowse("btn-browse-base", "set-basefolder", "base_work_folder", "Select base work folder");
        bindBrowse("btn-browse-tpl", "set-tplfolder", "templates_folder", "Select templates folder");
        bindBrowse("btn-browse-nas", "set-nasroot", "nas_root", "Select NAS folder");

        $("btn-detect-ffmpeg").addEventListener("click", function () {
            $("ffmpeg-status").textContent = "Detecting…";
            global.BHFFmpeg.detect(core.S.ffmpeg_path || null).then(function (found) {
                if (found) {
                    if (found !== "ffmpeg") { core.setSetting("ffmpeg_path", found); $("set-ffmpeg").value = found; }
                    $("ffmpeg-status").textContent = "✓ Found: " + (found === "ffmpeg" ? "ffmpeg (on PATH)" : found);
                    return;
                }
                $("ffmpeg-status").textContent = "✗ Not found.";
                return ui.confirm("FFmpeg was not found on this computer.\n\nInstall it automatically now?" +
                                  (global.BHFFmpeg.isWin ? "\n(Downloads ~90 MB)" : "\n(Uses Homebrew — takes a few minutes)"),
                                  "Install FFmpeg?")
                    .then(function (yes) {
                        if (yes) return core.installFFmpegFlow().catch(function () { });
                        $("ffmpeg-status").textContent = "✗ Not found — install ffmpeg or enter its path above.";
                    });
            });
        });

        // ---------------- diagnostics ----------------

        var lastDiagReport = "";

        function checkFolder(p) {
            if (!p) return "not set";
            if (!fsMod.existsSync(p)) return p + "  [MISSING]";
            var probe = pathMod.join(p, ".bh_write_test");
            try {
                fsMod.writeFileSync(probe, "x");
                return p + "  [ok, writable]";
            } catch (e) {
                return p + "  [exists, NOT writable]";
            } finally {
                // always clean the probe file up, even if something above threw
                try { fsMod.unlinkSync(probe); } catch (e2) { }
            }
        }

        function buildDiagReport() {
            var templates = core.templates();
            var lines = [];
            lines.push("=== BigHappy Launcher Diagnostics ===");
            lines.push("Generated: " + new Date().toString());
            lines.push("");
            lines.push("Panel version:  " + core.version);
            try {
                var env = cs.getHostEnvironment();
                lines.push("Host app:       " + env.appName + " " + env.appVersion);
                lines.push("CEP API:        " + (env.apiVersion || "n/a"));
            } catch (e) { lines.push("Host app:       (unavailable: " + e.message + ")"); }
            lines.push("OS:             " + osMod.platform() + " " + osMod.release() + " (" + osMod.arch() + ")");
            lines.push("Node:           " + process.version);
            var chrome = (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1];
            lines.push("Chromium:       " + (chrome || "unknown"));
            lines.push("");
            lines.push("Base folder:    " + checkFolder(core.S.base_work_folder));
            lines.push("Templates dir:  " + checkFolder(core.templatesFolder()));
            lines.push("NAS folder:     " + checkFolder(core.S.nas_root));
            var missing = templates.filter(function (t) { return !core.T.fileExists(t.path); }).length;
            lines.push("Templates:      " + templates.length + " configured, " + missing + " missing file(s)");
            lines.push("FFmpeg path:    " + (core.S.ffmpeg_path || "(auto-detect)"));

            return host("ping").then(function (info) {
                lines.splice(4, 0, "AE (host):      " + info.app + " " + info.version);
            }).catch(function () {
                lines.splice(4, 0, "AE (host):      NOT RESPONDING");
            }).then(function () {
                return global.BHFFmpeg.detect(core.S.ffmpeg_path || null);
            }).then(function (found) {
                if (!found) { lines.push("FFmpeg:         NOT FOUND"); return; }
                return new Promise(function (resolve) {
                    cp.execFile(found, ["-version"], { timeout: 8000 }, function (err, stdout) {
                        lines.push("FFmpeg:         " + (err ? "found but failed to run"
                            : String(stdout).split("\n")[0] + " @ " + found));
                        resolve();
                    });
                });
            }).then(function () {
                lastDiagReport = lines.join("\n");
                return lastDiagReport;
            });
        }

        function refreshDiag() {
            $("diag-body").textContent = "Gathering…";
            buildDiagReport().then(function (report) {
                $("diag-body").textContent = report;
            });
        }

        $("btn-diag-refresh").addEventListener("click", refreshDiag);

        $("btn-diag-copy").addEventListener("click", function () {
            var doCopy = function () {
                var ta = document.createElement("textarea");
                ta.value = lastDiagReport;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand("copy");
                document.body.removeChild(ta);
                toast("✓ Report copied to clipboard");
            };
            lastDiagReport ? doCopy() : buildDiagReport().then(function (r) {
                $("diag-body").textContent = r; doCopy();
            });
        });

        $("btn-diag-save").addEventListener("click", function () {
            var doSave = function () {
                var res = global.cep.fs.showSaveDialogEx("Save diagnostics report", null, ["txt"],
                    "BigHappy_Diagnostics.txt");
                if (!res || res.err !== 0 || !res.data) return;
                try {
                    fsMod.writeFileSync(res.data, lastDiagReport, "utf8");
                    toast("✓ Report saved");
                    core.revealFile(res.data);
                } catch (e) { ui.alert("Could not save report:\n" + e.message); }
            };
            lastDiagReport ? doSave() : buildDiagReport().then(function (r) {
                $("diag-body").textContent = r; doSave();
            });
        });

        // ---------------- boot-time state ----------------

        function applySettings() {
            $("set-ffmpeg").value = core.S.ffmpeg_path || "";
            $("set-basefolder").value = core.S.base_work_folder || "";
            $("set-tplfolder").value = core.S.templates_folder || "";
            $("set-nasroot").value = core.S.nas_root || "";
            $("set-tplfolder").placeholder = core.T.defaultTemplatesFolder();
        }

        $("about-text").innerHTML = "BigHappy Launcher CEP v" + core.version +
            " — panel UI with async ffmpeg.<br>The classic ScriptUI version remains available as BigHappyLauncher_Templates.jsx.";

        return { applySettings: applySettings, buildDiagReport: buildDiagReport };
    }

    global.BHSettings = { init: init };
})(window);
