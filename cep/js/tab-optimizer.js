/*
    BHOptimizer — the Optimize tab: queue MP4s, size-cap them with ffmpeg,
    and put After Effects' links back afterwards.

    The lock dance is the delicate part. AE holds an open handle on any footage
    it references, so the file cannot be replaced underneath it (hard failure on
    Windows). Each file is therefore released, encoded, then relinked — and a
    breadcrumb is written across that window so an interrupted run can be
    repaired at the next boot rather than stranding the footage.
*/
(function (global) {
    "use strict";

    function init(core) {
        var $ = core.$;
        var ui = core.ui;
        var host = core.host;
        var toast = core.toast;

        var optFiles = [];
        var optRunning = false;
        var optCancelled = false;   // batch-level: survives between files (BHFFmpeg
                                    // resets its own flag on every optimize() call)

        function renderOptFiles(statusByPath) {
            var ul = $("opt-file-list");
            ul.innerHTML = "";
            // (empty queue needs no placeholder — the dropzone above is the empty state)
            optFiles.forEach(function (f) {
                var li = document.createElement("li");
                var status = (statusByPath && statusByPath[f.path]) || "";
                li.innerHTML = "<span>" + core.escapeHtml(f.path.split(/[\\/]/).pop()) + "</span>" +
                    '<span class="size ' + (status.indexOf("✓") === 0 ? "done" : status.indexOf("✗") === 0 ? "fail" : "") + '">' +
                    core.escapeHtml(status || f.sizeMB.toFixed(1) + " MB") + "</span>";
                ul.appendChild(li);
            });
            $("btn-optimize").disabled = optRunning || optFiles.length === 0;
        }

        function optLog(msg, cls) {
            var log = $("opt-log");
            var line = document.createElement("div");
            if (cls) line.className = cls;
            line.textContent = msg;
            log.appendChild(line);
            log.scrollTop = log.scrollHeight;
        }

        /** Clear the previous batch's progress, log, and result button. */
        function resetOptProgress() {
            $("opt-progress").classList.add("hidden");
            $("opt-log").innerHTML = "";
            core.setProgress("opt-bar-file", 0);
            core.setProgress("opt-bar-all", 0);
            $("opt-pct").textContent = "0%";
            $("opt-current-file").textContent = "—";
            $("opt-overall-txt").textContent = "0 / 0";
            $("btn-show-output").classList.add("hidden");
            $("opt-summary").classList.add("hidden");
        }

        function updateDropLabel() {
            $("opt-drop-label").textContent = optFiles.length
                ? optFiles.length + " file" + (optFiles.length > 1 ? "s" : "") + " queued — drop or click to replace"
                : "Drop MP4s here — or click to browse";
        }

        /** Probe and queue a set of MP4 paths (from the picker or drag & drop). */
        function queueOptFiles(paths) {
            if (optRunning || !paths || !paths.length) return;
            // A drop can carry the same file more than once (an alias alongside
            // its target, or a path repeated by the OS). Queuing it twice means
            // optimizing it twice, and the second pass would run against a file
            // the first pass already replaced.
            var unique = core.dedupePaths(paths);
            var dropped = paths.length - unique.length;
            var zone = $("btn-pick-files");
            zone.classList.add("loading");
            core.busy(true);
            core.getFFmpegOrExplain().then(function (exe) {
                return Promise.all(unique.map(function (f) { return global.BHFFmpeg.probe(exe, f); }));
            }).then(function (infos) {
                if (dropped) {
                    toast("Skipped " + dropped + " duplicate file" + (dropped > 1 ? "s" : ""));
                }
                optFiles = infos;
                resetOptProgress();   // new batch — drop the previous run's results
                renderOptFiles();
                updateDropLabel();
            }).catch(function (e) {
                if (e.message !== "no ffmpeg") ui.alert("Could not read files:\n" + e.message);
            }).then(function () {
                zone.classList.remove("loading");
                core.busy(false);
            });
        }

        $("btn-pick-files").addEventListener("click", function () {
            var files = core.pickFiles(true, "Select MP4(s) to optimize", ["mp4"]);
            if (files) queueOptFiles(files);
        });
        $("btn-pick-files").addEventListener("keydown", function (ev) {
            if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); this.click(); }
        });

        // drag & drop from Finder/Explorer
        (function () {
            var zone = $("btn-pick-files");
            ["dragover", "dragenter"].forEach(function (evName) {
                zone.addEventListener(evName, function (ev) {
                    ev.preventDefault();
                    zone.classList.add("drag");
                });
            });
            ["dragleave", "dragend"].forEach(function (evName) {
                zone.addEventListener(evName, function () { zone.classList.remove("drag"); });
            });
            zone.addEventListener("drop", function (ev) {
                ev.preventDefault();
                zone.classList.remove("drag");
                var paths = Array.prototype.slice.call(ev.dataTransfer.files)
                    .map(function (f) { return f.path; })
                    .filter(function (p) { return p && /\.mp4$/i.test(p); });
                if (!paths.length) { toast("Only MP4 files can be optimized", true); return; }
                queueOptFiles(paths);
            });
            // block accidental drops elsewhere from navigating the panel
            document.addEventListener("dragover", function (ev) { ev.preventDefault(); });
            document.addEventListener("drop", function (ev) { ev.preventDefault(); });
        })();

        $("btn-optimize").addEventListener("click", function () {
            if (optRunning || !optFiles.length) return;
            var targetMB = parseFloat($("opt-target").value) || 6.8;

            /** Per-unit delivery caps (shared helper — see BHCalc.unitTargetMB):
                Expandable (750x1334) is capped at 3.8 MB; a manually lowered
                field still wins. */
            function targetForFile(f) {
                return global.BHCalc.unitTargetMB(f.width, f.height, targetMB);
            }

            core.getFFmpegOrExplain().then(function (exe) {
                optRunning = true;
                optCancelled = false;
                core.busy(true);
                $("btn-optimize").classList.add("loading");
                $("btn-optimize").disabled = true;
                $("btn-cancel").disabled = false;
                $("opt-progress").classList.remove("hidden");
                $("opt-log").innerHTML = "";
                $("btn-show-output").classList.add("hidden");

                var statuses = {};
                var done = 0;
                var outputs = [];   // final file paths (replaced originals or _Optimized copies)
                var totalBefore = 0;
                var totalAfter = 0;
                var successful = 0;
                var failed = 0;

                /** Restore AE's footage/render-queue links; awaited before moving on. */
                function restore(tokens, filePath) {
                    if (!tokens || (!tokens.items.length && !tokens.oms.length)) {
                        core.clearPendingRelink();
                        return Promise.resolve();
                    }
                    return host("restoreFileLock", tokens, filePath).then(function (res) {
                        core.clearPendingRelink();   // the round trip closed cleanly
                        // per-item failures leave BH_RELINK_* placeholders behind —
                        // name them so the user can relink manually
                        if (res && res.failed && res.failed.length) {
                            optLog("Warning: " + res.failed.length + " item(s) could not be relinked to " +
                                   filePath.split(/[\\/]/).pop() + " in AE — relink manually: " +
                                   res.failed.join(", "), "err");
                        }
                    }, function (e) {
                        // The record stays behind on purpose — the boot sweep
                        // retries this relink next time the panel opens.
                        optLog("Warning: could not relink " + filePath.split(/[\\/]/).pop() +
                               " in AE — relink manually. (" + e.message + ")", "err");
                    });
                }

                return optFiles.reduce(function (chain, f) {
                    return chain.then(function () {
                        if (optCancelled) throw new Error("CANCELLED");
                        $("opt-current-file").textContent = f.path.split(/[\\/]/).pop();
                        core.setProgress("opt-bar-file", 0);
                        $("opt-pct").textContent = "0%";
                        core.announce("Optimizing file " + (done + 1) + " of " + optFiles.length +
                                      ": " + f.path.split(/[\\/]/).pop());

                        var fileTarget = targetForFile(f);
                        if (fileTarget !== targetMB) {
                            optLog(f.path.split(/[\\/]/).pop() + ": Expandable unit — targeting " +
                                fileTarget + " MB (under-4 delivery cap)");
                        }
                        // Record the swap BEFORE releasing, so that a crash between
                        // release and restore still leaves a trail the boot sweep
                        // can follow back (see core.recoverStrandedFootage).
                        core.markPendingRelink(f.path, null);
                        return host("releaseFileLock", f.path)
                            .catch(function () { return { items: [], oms: [] }; })
                            .then(function (tokens) {
                                // Upgrade the record with the tokens now that we
                                // have them: they carry the original item names.
                                core.markPendingRelink(f.path, tokens);
                                if (tokens.failed && tokens.failed.length) {
                                    optLog("Warning: AE could not release its lock on " +
                                           tokens.failed.length + " item(s): " + tokens.failed.join(", ") +
                                           " — replacing the file may fail on Windows.", "err");
                                }
                                return global.BHFFmpeg.optimize(f.path,
                                    { ffmpegPath: exe, targetMB: fileTarget, replaceOriginal: true },
                                    function (pct) {
                                        core.setProgress("opt-bar-file", pct);
                                        $("opt-pct").textContent = Math.round(pct) + "%";
                                    }
                                ).then(function (res) {
                                    return restore(tokens, f.path).then(function () {
                                        var short = f.path.split(/[\\/]/).pop();
                                        if (!res.skipped) outputs.push(res.output);
                                        if (res.skipped) {
                                            totalBefore += res.before;
                                            totalAfter += res.after;
                                            successful++;
                                            statuses[f.path] = "✓ already " + res.before.toFixed(1) + " MB";
                                            optLog(short + ": already under target, skipped", "ok");
                                        } else if (res.met) {
                                            totalBefore += res.before;
                                            totalAfter += res.after;
                                            successful++;
                                            statuses[f.path] = "✓ " + res.after.toFixed(1) + " MB";
                                            optLog(short + ": " + res.before.toFixed(1) + " → " +
                                                res.after.toFixed(1) + " MB (" + res.attempts + " encode" +
                                                (res.attempts > 1 ? "s" : "") + ")", "ok");
                                        } else {
                                            totalBefore += res.before;
                                            totalAfter += res.after;
                                            failed++;
                                            statuses[f.path] = "✗ over target (" + res.after.toFixed(1) + " MB)";
                                            optLog(short + ": best result " + res.after.toFixed(1) +
                                                " MB still exceeds " + fileTarget + " MB — original kept, output saved as " +
                                                res.output.split(/[\\/]/).pop(), "err");
                                        }
                                    });
                                }, function (err) {
                                    return restore(tokens, f.path).then(function () {
                                        if (err.message === "CANCELLED") throw err;
                                        failed++;
                                        statuses[f.path] = "✗ failed";
                                        optLog(f.path.split(/[\\/]/).pop() + ": " + err.message, "err");
                                    });
                                });
                            })
                            .then(function () {
                                done++;
                                // File finished (encoded, skipped, or failed) — complete its bar
                                core.setProgress("opt-bar-file", 100);
                                $("opt-pct").textContent = "100%";
                                $("opt-overall-txt").textContent = done + " / " + optFiles.length;
                                core.setProgress("opt-bar-all", done / optFiles.length * 100);
                                renderOptFiles(statuses);
                            });
                    });
                }, Promise.resolve()).then(function () {
                    optLog("Batch complete.", "ok");
                    toast("✓ Optimization complete");
                    var saved = Math.max(0, totalBefore - totalAfter);
                    $("opt-summary").textContent = successful + " complete" +
                        (failed ? " · " + failed + " failed" : "") +
                        (saved > 0.05 ? " · " + saved.toFixed(1) + " MB saved" : "");
                    $("opt-summary").classList.remove("hidden");
                }, function (err) {
                    var cancelledRun = err.message === "CANCELLED";
                    optLog(cancelledRun ? "Cancelled — remaining files skipped." : err.message, "err");
                    toast(cancelledRun ? "Batch cancelled" : "Optimization failed", true);
                }).then(function () {
                    core.busy(false);
                    $("btn-optimize").classList.remove("loading");
                    // Reveal the result and keep a button around for later
                    if (outputs.length) {
                        core.revealFile(outputs[0]);
                        var btn = $("btn-show-output");
                        btn.textContent = global.BHFFmpeg.isWin ? "Show in Explorer" : "Show in Finder";
                        btn.classList.remove("hidden");
                        btn.onclick = function () { core.revealFile(outputs[0]); };
                    }
                    optRunning = false;
                    // Clear the queue — results stay in the log; next run starts fresh
                    optFiles = [];
                    renderOptFiles();
                    updateDropLabel();
                    $("opt-current-file").textContent = "—";
                    $("btn-cancel").disabled = true;
                    core.refreshProject();
                });
            }).catch(function () { /* no ffmpeg — already alerted */ });
        });

        $("btn-cancel").addEventListener("click", function () {
            optCancelled = true;   // stops the batch before the next file starts
            global.BHFFmpeg.cancel();     // kills the currently running encode immediately
        });

        $("opt-target").addEventListener("change", function () {
            var v = parseFloat(this.value);
            if (v > 0) core.setSetting("dooh_target_mb", String(v));
        });

        function applySettings() {
            // DOOH target is shared with the ScriptUI version (dooh_target_mb)
            $("opt-target").value = parseFloat(core.S.dooh_target_mb) || 6.8;
        }

        return { applySettings: applySettings };
    }

    global.BHOptimizer = { init: init };
})(window);
