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
                box.innerHTML = '<h1 class="card-heading">Render</h1>' +
                    '<span class="sub">Open a saved project to set up a render.</span>';
                $("btn-rq-add").disabled = true;
                return;
            }
            var main = project.mainComp;
            if (!main) {
                box.innerHTML = '<h1 class="card-heading">Render</h1>' +
                    '<span class="sub">No "Main" comp found in this project.</span>';
                $("btn-rq-add").disabled = true;
                return;
            }
            $("btn-rq-add").disabled = false;
            var r = T.buildRenderName(project.name, main.width, main.height);
            var revision = (r.parsed && r.parsed.revision) ? r.parsed.revision : "R1";
            var isPng = r.type === "sunrise" || r.type === "default";
            var folder = "Render_" + revision + "/" + (isPng ? "PNG_Sequence" : "MP4");
            box.innerHTML =
                '<h1 class="card-heading">' + core.escapeHtml(main.name) + " · " + main.width + " × " + main.height + "</h1>" +
                '<span class="sub">' + (isPng ? "PNG sequence with alpha" : "H.264 MP4") + " · " +
                    main.duration.toFixed(1) + "s</span>" +
                '<span class="mono" title="' + core.escapeHtml(folder + "/" + r.name) + '">' +
                    core.escapeHtml(folder + "/" + r.name) + "</span>";
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
                .then(function (res) {
                    // AE kept a different format than this unit needs (usually
                    // a missing output-module template). Never send that on to
                    // Media Encoder as if it were right.
                    if (res && res.formatOk === false) {
                        var want = res.expected === "png" ? "PNG Sequence with Alpha" : "H.264";
                        toast("Queued in the wrong format — check the Render Queue", true);
                        return ui.alert("The Main comp was added to the Render Queue, but After Effects set its " +
                            "output to ." + res.actual + " instead of " +
                            (res.expected === "png" ? "a PNG sequence with alpha" : "H.264 MP4") + ".\n\n" +
                            "After Effects has no usable output module template for it on this machine. " +
                            "Create one named \"" + want + "\" (Edit → Templates → Output Module…), remove " +
                            "the queued item, and add it again — or set the format by hand in the Render Queue.",
                            "Wrong Render Format");
                    }
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
        }

        $("pr-preset").addEventListener("change", function () {
            if (this.value === "package") {
                $("pr-webm").checked = $("pr-mov").checked = $("pr-html").checked = $("pr-zip").checked = true;
            } else if (this.value === "video") {
                $("pr-webm").checked = $("pr-mov").checked = true;
                $("pr-html").checked = $("pr-zip").checked = false;
            }
            PR_TOGGLES.forEach(function (pair) {
                core.setSetting(pair[1], $(pair[0]).checked ? "true" : "false");
            });
        });

        /** Fill the conversion ring to pct (0-100). r=40, so 2πr ≈ 251.3. */
        function setRing(pct) {
            var value = Math.max(0, Math.min(100, Number(pct) || 0));
            var ring = $("pr-ring");
            if (ring && ring.style) ring.style.strokeDasharray = (value / 100 * 251.3).toFixed(1) + " 251.3";
        }

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

            // Only DOOH WebMs are encoded to a size: dooh_target_mb (default
            // 6.8). Everything else is constant quality (CRF 20), same as the
            // ScriptUI tool, so no size target applies to it. This used to
            // compute a target_size_mb / Expandable-capped figure for the
            // non-DOOH case as well, which BHPost never read.
            var prType = main ? T.getTemplateType(main.width, main.height) : "default";
            var prIsDOOH = !!(parsed && parsed.isDOOH) || prType.indexOf("dooh") !== -1;
            var prTargetMB = prIsDOOH ? (parseFloat(core.S.dooh_target_mb) || 6.8) : null;

            var clobber = global.BHPost.existingOutputs(prSeq.folder, options.zip ? prSeq : null);
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
                    // the encodes that report progress, in the order they run
                    var prSteps = [];
                    if (options.webm) prSteps.push("WebM");
                    if (options.mov) prSteps.push("MOV");
                    if (options.zip) prSteps.push("ZIP");
                    setRing(0);
                    $("pr-pct").textContent = "0%";
                    $("pr-step").textContent = prSteps[0] || "HTML";
                    $("pr-count").textContent = prSteps.length ? "0 of " + prSteps.length + " done" : "";

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
                        setRing(pct);
                        var at = prSteps.indexOf(step);
                        if (at !== -1) {
                            $("pr-count").textContent = at + " of " + prSteps.length + " done";
                        }
                        core.announce(step);   // step changes only — announce() drops repeats
                    }, prLog).then(function (res) {
                        var warns = res.warnings || [];
                        setRing(100);
                        $("pr-pct").textContent = "100%";
                        $("pr-step").textContent = "Done";
                        $("pr-count").textContent = "";
                        $("pr-summary").classList.toggle("warn", warns.length > 0);
                        prLog("Conversion complete.", "ok");
                        if (!warns.length) toast("✓ Conversion complete");
                        $("pr-summary").textContent = res.outputs.length + " delivery file" +
                            (res.outputs.length === 1 ? "" : "s") + " ready" +
                            (warns.length ? " — WARNING: " + warns.join("; ") : "");
                        if (warns.length) toast("Converted with a warning — check the log", true);
                        $("pr-summary").classList.remove("hidden");
                        if (res.outputs.length) {
                            core.revealFile(res.outputs[0]);
                            var btn = $("btn-pr-show");
                            btn.classList.remove("hidden");
                            btn.onclick = function () { core.revealFile(res.outputs[0]); };
                        }
                    }, function (err) {
                        var c = err.message === "CANCELLED";
                        $("pr-step").textContent = c ? "Cancelled" : "Failed";
                        $("pr-count").textContent = "";
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

        var collectRunning = false;
        var collectCancelled = false;

        $("btn-collect-cancel").addEventListener("click", function () {
            if (!collectRunning) return;
            collectCancelled = true;
            this.disabled = true;
            $("collect-status").textContent = "Cancelling…";
        });

        /**
         * Collect in slices: the host copies for a moment, reports how far it
         * got, and is asked again. One long call froze After Effects with no
         * progress, and the only way out was to wait for it. Between slices
         * the status line moves and Cancel is honoured — the host then closes
         * the half-relinked copy and reopens the original.
         */
        function runCollect(project, destAep, footageFolder, status) {
            collectRunning = true;
            collectCancelled = false;
            core.busy(true);
            $("btn-collect").disabled = true;
            var cancelBtn = $("btn-collect-cancel");
            cancelBtn.disabled = false;
            cancelBtn.classList.remove("hidden");
            status.textContent = "Saving a copy to collect…";

            function step(total) {
                if (collectCancelled) {
                    return host("collectAbort").then(function (res) {
                        var e = new Error("CANCELLED");
                        e.projectChanged = !!(res && res.projectChanged);
                        e.reopened = e.projectChanged || !res || res.reopened !== false;
                        throw e;
                    });
                }
                return host("collectStep", 250).then(function (p) {
                    status.textContent = "Collecting… " + p.done + " / " + p.total + " item(s)";
                    core.announce("Collecting " + p.done + " of " + p.total);
                    // A Cancel pressed during the last slice still counts:
                    // step() sees it and aborts instead of finishing.
                    return (p.finished && !collectCancelled) ? host("collectFinish") : step(total);
                });
            }

            return host("collectBegin", destAep, footageFolder).then(function (info) {
                status.textContent = "Collecting… 0 / " + info.total + " item(s)";
                return step(info.total);
            }).then(function (res) {
                status.textContent = "✓ Collected " + res.assets + " asset(s)" +
                    (res.missing ? " — " + res.missing + " missing" : "") +
                    (res.failed ? " — " + res.failed + " could not be copied" : "") +
                    (res.missing || res.failed ? " (see _Pack_Report.txt)" : "") + ".";
                toast(res.failed ? "Collected, but " + res.failed + " item(s) could not be copied" : "✓ Project collected",
                      !!res.failed);
                core.revealFile(destAep);
                // The host reopens the original afterwards. If it could
                // not, AE is still on the collected copy — say so, or
                // the next edits and renders go into the collect folder.
                if (res.reopened === false) {
                    status.textContent += " After Effects is still on the collected copy.";
                    return stillOnCopy("The project was collected, but your original project could not be reopened.",
                                       destAep, project.path);
                }
            }, function (e) {
                if (e.message === "CANCELLED") {
                    status.textContent = "Collect cancelled. Files already copied are still in the collect folder." +
                        (e.projectChanged ? " The project now open in After Effects was left as it is." : "");
                    toast("Collect cancelled", true);
                    if (e.reopened === false) {
                        return stillOnCopy("Collect was cancelled, but your original project could not be reopened.",
                                           destAep, project.path);
                    }
                    return;
                }
                status.textContent = "";
                // A failure the host reported has already put AE back on the
                // original. One it did not — a call that timed out, a bad
                // reply — leaves AE on the copy with the collect still
                // pending, so always ask the host to back out. With nothing
                // pending this is a no-op.
                return host("collectAbort").then(function (res) {
                    if (res && res.reopened === false && !res.projectChanged) {
                        return stillOnCopy("Collect failed:\n" + e.message, destAep, project.path);
                    }
                    return ui.alert("Collect failed:\n" + e.message);
                }, function () {
                    return ui.alert("Collect failed:\n" + e.message +
                        "\n\nAfter Effects did not confirm that it went back to your original project. " +
                        "It may still be showing the collected COPY:\n" + destAep +
                        "\n\nCheck which project is open before you keep working. Your original is:\n" +
                        project.path, "Check the Open Project");
                });
            }).then(function () {
                collectRunning = false;
                core.busy(false);
                $("btn-collect").disabled = false;
                cancelBtn.classList.add("hidden");
                core.refreshProject();
            });
        }

        function stillOnCopy(lead, destAep, originalPath) {
            return ui.alert(lead + "\n\nAfter Effects is now showing the collected COPY:\n" + destAep +
                "\n\nReopen the original before you keep working:\n" + originalPath,
                "Now Editing the Copy");
        }

        $("btn-collect").addEventListener("click", function () {
            if (collectRunning) return;
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
                    var destAep = pathMod.join(destFolder, project.name + ".aep");
                    if (pathMod.resolve(destAep).toLowerCase() === pathMod.resolve(project.path).toLowerCase()) {
                        status.textContent = "";
                        return ui.alert("That destination would save the collected copy over the project " +
                            "you have open:\n" + project.path + "\n\nChoose a different destination folder.");
                    }
                    try { fsMod.mkdirSync(footageFolder, { recursive: true }); }
                    catch (mkErr) {
                        status.textContent = "";
                        return ui.alert("Could not create the collect folder:\n" + mkErr.message);
                    }

                    return runCollect(project, destAep, footageFolder, status);
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
