/*
    BHRender — the Render tab: queueing the Main comp, the Sunrise post-render
    conversion, and Collect Project.

    All three follow the open project, so each renders from core.onProject
    rather than holding its own copy.
*/
(function (global) {
    "use strict";

    function init(core) {
        var $ = core.$;
        var T = core.T;
        var ui = core.ui;
        var host = core.host;
        var toast = core.toast;
        var pathMod = core.node.path;
        var fsMod = core.node.fs;

        // ---------------- render queue ----------------

        function renderRQInfo(project) {
            var box = $("rq-info");
            if (!box) return;
            if (!project || !project.path) {
                box.innerHTML = '<div class="empty-state">Open a saved project to set up a render.</div>';
                $("btn-rq-add").disabled = true;
                return;
            }
            var main = project.mainComp;
            if (!main) {
                box.innerHTML = '<div class="empty-state">No "Main" comp found in this project.</div>';
                $("btn-rq-add").disabled = true;
                return;
            }
            $("btn-rq-add").disabled = false;
            var r = T.buildRenderName(project.name, main.width, main.height);
            var revision = (r.parsed && r.parsed.revision) ? r.parsed.revision : "R1";
            var isPng = r.type === "sunrise" || r.type === "default";
            box.innerHTML =
                '<div class="spec-list">' +
                    '<div class="spec-row"><span>Comp</span><b>' + core.escapeHtml(main.name) + " · " + main.width + "×" + main.height + " · " + main.duration.toFixed(1) + 's</b></div>' +
                    '<div class="spec-row"><span>Format</span><b>' + (isPng ? "PNG Sequence + Alpha" : "H.264 (MP4)") + '</b></div>' +
                    '<div class="spec-row"><span>Folder</span><b>Render_' + core.escapeHtml(revision) + '/' + (isPng ? 'PNG_Sequence' : 'MP4') + '</b></div>' +
                    '<div class="spec-row"><span>Output</span><b class="mono">' + core.escapeHtml(r.name) + '</b></div>' +
                '</div>';
        }

        /** Keep project-specific tools relevant without blocking standalone use. */
        function updateContextualTools(project) {
            var main = project && project.mainComp;
            var type = main ? T.getTemplateType(main.width, main.height) : null;
            var incompatible = !!main && type !== "sunrise" && type !== "default";
            $("pr-card").classList.toggle("context-hidden", incompatible);
        }

        core.onProject(function (project) {
            renderRQInfo(project);
            updateContextualTools(project);
        });

        $("btn-rq-add").addEventListener("click", function () {
            var project = core.project();
            if (!project || !project.path) { ui.alert("No project currently open. (BH-2003)"); return; }
            var main = project.mainComp;
            if (!main) { ui.alert("Main composition not found. (BH-3001)"); return; }

            var r = T.buildRenderName(project.name, main.width, main.height);
            var revision = (r.parsed && r.parsed.revision) ? r.parsed.revision : "R1";
            // Route output by format: PNG sequence -> Render_R#/PNG_Sequence, else MP4
            var rIsPng = r.type === "sunrise" || r.type === "default";
            var renderFolder = pathMod.join(project.folder, "Render_" + revision, rIsPng ? "PNG_Sequence" : "MP4");
            try { fsMod.mkdirSync(renderFolder, { recursive: true }); }
            catch (e) { ui.alert("Could not create render folder:\n" + e.message); return; }

            host("addMainToRenderQueue", pathMod.join(renderFolder, r.name), r.type)
                .then(function () {
                    if ($("rq-ame").checked) {
                        return host("queueToAME").then(function () {
                            toast("✓ Sent to Media Encoder");
                        }, function (e) {
                            ui.alert(e.message + "\n\nItem remains in the AE Render Queue.");
                        });
                    }
                    toast("✓ Added to render queue");
                })
                .catch(function (e) { ui.alert("Failed to add to Render Queue (BH-3002):\n" + e.message); });
        });

        // ---------------- sunrise post-render ----------------

        var prSeq = null;
        var prRunning = false;

        function setPRSeq(folder) {
            prSeq = folder ? global.BHPost.detectPNGSequence(folder) : null;
            if (prSeq) {
                $("pr-seq").textContent = "Sequence: " + prSeq.prefix + " [" + prSeq.count +
                    " frames] — " + folder;
            } else {
                $("pr-seq").textContent = folder
                    ? "No PNG sequence found in: " + folder
                    : "No sequence selected.";
            }
            $("btn-pr-convert").disabled = !prSeq || prRunning;
        }

        $("btn-pr-folder").addEventListener("click", function () {
            var folder = core.pickFolder("Select folder containing the rendered PNG sequence");
            if (folder) setPRSeq(folder);
        });

        $("btn-pr-auto").addEventListener("click", function () {
            var project = core.project();
            if (!project || !project.folder) { ui.alert("Open a saved project first."); return; }
            var parsed = T.parseProjectName(project.name || "");
            var rev = parsed && parsed.revision ? parsed.revision : "R1";
            // Prefer Render_R#/PNG_Sequence, fall back to the Render_R# root
            // (projects created before the subfolder layout).
            var guessRoot = pathMod.join(project.folder, "Render_" + rev);
            var guess = pathMod.join(guessRoot, "PNG_Sequence");
            if (!fsMod.existsSync(guess)) guess = guessRoot;
            if (!fsMod.existsSync(guess)) {
                ui.alert("Expected render folder not found:\n" + guessRoot + "\n\nUse \"Choose Render Folder…\" instead.");
                return;
            }
            setPRSeq(guess);
        });

        // checkbox state shared with the script's post_render_* settings
        var PR_TOGGLES = [["pr-webm", "post_render_webm"], ["pr-mov", "post_render_mov"],
                          ["pr-html", "post_render_html"], ["pr-zip", "post_render_zip"]];

        PR_TOGGLES.forEach(function (pair) {
            $(pair[0]).addEventListener("change", function () {
                core.setSetting(pair[1], this.checked ? "true" : "false");
                syncDeliveryPreset();
            });
        });

        function syncDeliveryPreset() {
            var all = $("pr-webm").checked && $("pr-mov").checked && $("pr-html").checked && $("pr-zip").checked;
            var videos = $("pr-webm").checked && $("pr-mov").checked && !$("pr-html").checked && !$("pr-zip").checked;
            $("pr-preset").value = all ? "package" : videos ? "video" : "custom";
            $("pr-formats").classList.toggle("hidden", $("pr-preset").value !== "custom");
        }

        $("pr-preset").addEventListener("change", function () {
            if (this.value === "package") {
                $("pr-webm").checked = $("pr-mov").checked = $("pr-html").checked = $("pr-zip").checked = true;
            } else if (this.value === "video") {
                $("pr-webm").checked = $("pr-mov").checked = true;
                $("pr-html").checked = $("pr-zip").checked = false;
            }
            $("pr-formats").classList.toggle("hidden", this.value !== "custom");
            PR_TOGGLES.forEach(function (pair) {
                core.setSetting(pair[1], $(pair[0]).checked ? "true" : "false");
            });
        });

        function prLog(msg, cls) {
            var log = $("pr-log");
            var line = document.createElement("div");
            if (cls) line.className = cls;
            line.textContent = msg;
            log.appendChild(line);
            log.scrollTop = log.scrollHeight;
        }

        $("btn-pr-convert").addEventListener("click", function () {
            if (!prSeq || prRunning) return;
            var options = {
                webm: $("pr-webm").checked, mov: $("pr-mov").checked,
                html: $("pr-html").checked, zip: $("pr-zip").checked
            };
            if (!options.webm && !options.mov && !options.html && !options.zip) {
                ui.alert("Select at least one output format."); return;
            }
            var project = core.project();
            var main = project && project.mainComp;
            var parsed = T.parseProjectName((project && project.name) || "");

            // Size target parity with the ScriptUI tool and the optimizer's
            // per-unit caps: DOOH renders get dooh_target_mb (default 6.8),
            // everything else target_size_mb (default 2.5), and Expandable units
            // (750x1334) are additionally capped at 3.8 (BHCalc.unitTargetMB).
            var prType = main ? T.getTemplateType(main.width, main.height) : "default";
            var prIsDOOH = !!(parsed && parsed.isDOOH) || prType.indexOf("dooh") !== -1;
            var prBaseTarget = prIsDOOH
                ? (parseFloat(core.S.dooh_target_mb) || 6.8)
                : (parseFloat(core.S.target_size_mb) || 2.5);
            var prTargetMB = global.BHCalc.unitTargetMB(main ? main.width : 0, main ? main.height : 0, prBaseTarget);

            var clobber = global.BHPost.existingOutputs(prSeq.folder);
            Promise.resolve(
                clobber.length
                    ? ui.confirm("Output files already exist in this folder:\n" +
                          clobber.map(function (p) { return "• " + pathMod.basename(p); }).join("\n") +
                          "\n\nOverwrite?", "Overwrite?")
                    : true
            ).then(function (go) {
                if (!go) return;
                return core.getFFmpegOrExplain().then(function (exe) {
                    prRunning = true;
                    core.busy(true);
                    $("btn-pr-convert").disabled = true;
                    $("btn-pr-convert").classList.add("loading");
                    $("btn-pr-cancel").disabled = false;
                    $("pr-progress").classList.remove("hidden");
                    $("pr-log").innerHTML = "";
                    $("btn-pr-show").classList.add("hidden");
                    $("pr-summary").classList.add("hidden");

                    return global.BHPost.convert({
                        ffmpegPath: exe,
                        seq: prSeq,
                        fps: main ? main.fps : 24,
                        width: main ? main.width : 750,
                        height: main ? main.height : 300,
                        title: (project && project.name) || "Animation",
                        isDOOH: prIsDOOH,
                        targetMB: prTargetMB,
                        webm: options.webm, mov: options.mov, html: options.html, zip: options.zip
                    }, function (step, pct) {
                        $("pr-step").textContent = step;
                        $("pr-pct").textContent = Math.round(pct) + "%";
                        core.setProgress("pr-bar", pct);
                        core.announce(step);   // step changes only — announce() drops repeats
                    }, prLog).then(function (res) {
                        prLog("Conversion complete.", "ok");
                        toast("✓ Conversion complete");
                        $("pr-summary").textContent = res.outputs.length + " delivery file" +
                            (res.outputs.length === 1 ? "" : "s") + " ready";
                        $("pr-summary").classList.remove("hidden");
                        if (res.outputs.length) {
                            core.revealFile(res.outputs[0]);
                            var btn = $("btn-pr-show");
                            btn.classList.remove("hidden");
                            btn.onclick = function () { core.revealFile(res.outputs[0]); };
                        }
                    }, function (err) {
                        var c = err.message === "CANCELLED";
                        prLog(c ? "Cancelled." : err.message, "err");
                        toast(c ? "Conversion cancelled" : "Conversion failed", true);
                    }).then(function () {
                        prRunning = false;
                        core.busy(false);
                        $("btn-pr-convert").classList.remove("loading");
                        $("btn-pr-convert").disabled = !prSeq;
                        $("btn-pr-cancel").disabled = true;
                    });
                }).catch(function () { /* no ffmpeg — already alerted */ });
            });
        });

        $("btn-pr-cancel").addEventListener("click", function () {
            global.BHPost.cancel();
        });

        // ---------------- collect ----------------

        $("btn-collect").addEventListener("click", function () {
            var project = core.project();
            if (!project || !project.path) { ui.alert("No saved project open. (BH-2003)"); return; }
            var status = $("collect-status");

            status.textContent = "Running pre-flight check…";
            host("preFlightCheck").then(function (missing) {
                var proceed = Promise.resolve(true);
                if (missing.length) {
                    var preview = missing.slice(0, 5).join("\n");
                    if (missing.length > 5) preview += "\n… and " + (missing.length - 5) + " more.";
                    proceed = ui.confirm("⚠ " + missing.length + " file(s) are MISSING:\n\n" + preview +
                        "\n\nContinue anyway?", "Pre-Flight Warning");
                }
                return proceed.then(function (go) {
                    if (!go) { status.textContent = ""; return; }

                    var destRoot = core.pickFolder("Select destination folder for the collected project");
                    if (!destRoot) { status.textContent = ""; return; }

                    // Standardized collect folder name (same rebuild as the script)
                    var collectName = project.name;
                    var parsed = T.parseProjectName(project.name);
                    if (parsed) {
                        collectName = T.buildFilename(parsed.brand, parsed.campaign, parsed.quarter || "QX",
                            parsed.size, parsed.version, parsed.revision, !!parsed.isDOOH)
                            .replace(/\.aep$/i, "");
                    }

                    var destFolder = pathMod.join(destRoot, collectName);
                    var footageFolder = pathMod.join(destFolder, "(Footage)");
                    fsMod.mkdirSync(footageFolder, { recursive: true });
                    var destAep = pathMod.join(destFolder, project.name + ".aep");

                    status.textContent = "Collecting… (AE may be busy for a moment)";
                    core.busy(true);
                    return host("collectProject", destAep, footageFolder).then(function (res) {
                        core.busy(false);
                        status.textContent = "✓ Collected " + res.assets + " asset(s)" +
                            (res.missing ? " — " + res.missing + " missing (see _Pack_Report.txt)" : "") + ".";
                        toast("✓ Project collected");
                        core.revealFile(destAep);
                        core.refreshProject();
                    }, function (e) {
                        core.busy(false);
                        status.textContent = "";
                        ui.alert("Collect failed:\n" + e.message);
                    });
                });
            }).catch(function (e) {
                status.textContent = "";
                ui.alert("Pre-flight check failed:\n" + e.message);
            });
        });

        // ---------------- boot-time state ----------------

        function applySettings() {
            $("rq-ame").checked = core.S.ame_enabled === "true";
            $("pr-webm").checked = core.S.post_render_webm !== "false";
            $("pr-mov").checked = core.S.post_render_mov !== "false";
            $("pr-html").checked = core.S.post_render_html !== "false";
            $("pr-zip").checked = core.S.post_render_zip !== "false";
            syncDeliveryPreset();
        }

        $("rq-ame").addEventListener("change", function () {
            core.setSetting("ame_enabled", this.checked ? "true" : "false");
        });

        return { applySettings: applySettings };
    }

    global.BHRender = { init: init };
})(window);
