/*
    BigHappy Launcher — panel logic.
    Talks to After Effects via the BH.* ExtendScript API (jsx/host.jsx)
    and runs all filesystem/ffmpeg work in Node (js/ffmpeg.js, js/templates.js).

    All persistent settings live in AE preferences (section "BigHappyLauncher"),
    the SAME store the ScriptUI version uses — templates, base folder, ffmpeg
    path, and recents stay in sync between both tools.
*/
(function () {
    "use strict";

    var cs = new CSInterface();
    var nodeRequire = (window.cep_node && window.cep_node.require) || window.require;
    var cp = nodeRequire("child_process");
    var pathMod = nodeRequire("path");
    var T = window.BHTemplates;

    // ---------------- host bridge ----------------

    function host(fn) {
        var args = Array.prototype.slice.call(arguments, 1)
            .map(function (a) { return JSON.stringify(a); })
            .join(",");
        var script = "BH." + fn + "(" + args + ")";
        return new Promise(function (resolve, reject) {
            cs.evalScript(script, function (res) {
                if (res === "EvalScript error.") {
                    return reject(new Error("Host error running " + fn));
                }
                try {
                    var parsed = JSON.parse(res);
                    parsed.ok ? resolve(parsed.data) : reject(new Error(parsed.error));
                } catch (e) {
                    reject(new Error("Bad host response from " + fn + ": " + res));
                }
            });
        });
    }

    // ---------------- AE-shared settings (same keys as the script) ----------------

    var S = {};   // in-memory cache, loaded at boot

    function loadSettings() {
        var keys = ["templates_data", "templates_folder", "base_work_folder",
                    "ffmpeg_path", "recent_files"];
        return Promise.all(keys.map(function (k) { return host("getSetting", k, null); }))
            .then(function (vals) {
                keys.forEach(function (k, i) { S[k] = vals[i]; });
            });
    }

    function setSetting(key, value) {
        S[key] = value === null ? null : String(value);
        return host("setSetting", key, value === null ? "" : String(value));
    }

    function baseWorkFolder() { return S.base_work_folder || ""; }
    function templatesFolder() { return S.templates_folder || T.defaultTemplatesFolder(); }

    function loadTemplates() {
        if (S.templates_data) {
            try {
                var arr = JSON.parse(S.templates_data);
                if (arr && arr.length) return arr;
            } catch (e) { }
        }
        return T.DEFAULT_TEMPLATES.map(function (t) {
            return { name: t.name, width: t.width, height: t.height, fps: t.fps, duration: t.duration, path: t.path };
        });
    }

    function saveTemplates(templates) {
        return setSetting("templates_data", JSON.stringify(templates));
    }

    // ---------------- tiny helpers ----------------

    function $(id) { return document.getElementById(id); }

    function setPill(state, text) {
        var pill = $("ae-status");
        pill.textContent = text;
        pill.className = "pill " + (state === "ok" ? "pill-ok" : state === "err" ? "pill-err" : "pill-dim");
    }

    function escapeHtml(s) {
        var div = document.createElement("div");
        div.textContent = String(s);
        return div.innerHTML;
    }

    function pickFiles(multi, title, exts) {
        var res = window.cep.fs.showOpenDialogEx(multi, false, title, null, exts);
        return (res && res.err === 0 && res.data && res.data.length) ? res.data : null;
    }

    function revealInOS(folderPath) {
        if (!folderPath) return;
        if (BHFFmpeg.isWin) cp.spawn("explorer", [folderPath], { detached: true });
        else cp.spawn("open", [folderPath], { detached: true });
    }

    var ui = window.BHDialog;

    /** Unsaved-changes guard: resolves true to proceed (saving first if asked). */
    function guardUnsaved(actionLabel) {
        return host("getProjectInfo").then(function (info) {
            if (!info || !info.open || !info.dirty) return true;
            return ui.confirm("The current project has UNSAVED changes.\n\nAbout to: " + actionLabel +
                              "\n\nSave the current project first?", "Unsaved Changes")
                .then(function (doSave) {
                    if (doSave && info.path) {
                        return host("saveProject").then(function () { return true; });
                    }
                    if (doSave && !info.path) {
                        return ui.alert("The current project has never been saved — save it manually in AE first, or discard.")
                            .then(function () {
                                return ui.confirm("Continue WITHOUT saving?\n\nUnsaved changes will be LOST.", "Discard Changes?");
                            });
                    }
                    return ui.confirm("Continue WITHOUT saving?\n\nUnsaved changes will be LOST.", "Discard Changes?");
                });
        }).catch(function () { return true; });
    }

    // ---------------- tabs ----------------

    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (tab) {
        tab.addEventListener("click", function () {
            document.querySelector(".tab.active").classList.remove("active");
            document.querySelector(".tab-page.active").classList.remove("active");
            tab.classList.add("active");
            $("tab-" + tab.dataset.tab).classList.add("active");
        });
    });

    // ---------------- launcher: project status ----------------

    var currentProject = null;

    function renderProject(info) {
        currentProject = info && info.open ? info : null;
        var box = $("project-info");
        if (!currentProject || !currentProject.path) {
            box.innerHTML = '<div class="muted">No saved project open.</div>';
            return;
        }
        var main = currentProject.mainComp;
        box.innerHTML =
            '<div class="name">' + escapeHtml(currentProject.name) +
                (currentProject.dirty ? '<span class="badge dirty">UNSAVED</span>' : "") + '</div>' +
            '<div class="meta">' +
                (main ? escapeHtml(main.name) + " — " + main.width + "×" + main.height +
                        " @ " + main.fps.toFixed(2) + "fps, " + main.duration.toFixed(1) + "s"
                      : "No Main comp found") +
            '</div>' +
            '<div class="meta">' + currentProject.numComps + ' comps, ' +
                currentProject.numFootage + ' footage items</div>';
    }

    function refreshProject() {
        return host("getProjectInfo").then(renderProject).catch(function () {
            renderProject(null);
        });
    }

    // ---------------- launcher: recent files (shared "recent_files" setting) ----------------

    // The script stores recents as [{path, ts}]; it also tolerates legacy
    // plain strings. Read both shapes, always write objects.
    function loadRecents() {
        try {
            var raw = JSON.parse(S.recent_files || "[]");
            return raw.map(function (r) {
                return typeof r === "string" ? { path: r, ts: 0 } : r;
            }).filter(function (r) { return r && r.path; });
        } catch (e) { return []; }
    }

    function addRecent(p) {
        var list = loadRecents().filter(function (r) {
            return r.path.toLowerCase() !== p.toLowerCase();
        });
        list.unshift({ path: p, ts: Date.now() });
        setSetting("recent_files", JSON.stringify(list.slice(0, 10)));
        renderRecents();
    }

    function renderRecents() {
        var ul = $("recent-list");
        var list = loadRecents();
        if (!list.length) {
            ul.innerHTML = '<li class="muted">Nothing yet — projects you open appear here.</li>';
            return;
        }
        ul.innerHTML = "";
        list.forEach(function (r) {
            var li = document.createElement("li");
            var base = r.path.split(/[\\/]/).pop();
            li.innerHTML = escapeHtml(base) + '<span class="path">' + escapeHtml(r.path) + "</span>";
            li.addEventListener("click", function () { openProject(r.path); });
            ul.appendChild(li);
        });
    }

    function openProject(p) {
        guardUnsaved("Open project: " + p.split(/[\\/]/).pop()).then(function (go) {
            if (!go) return;
            host("openProject", p, true)
                .then(function () { addRecent(p); refreshProject(); })
                .catch(function (e) { ui.alert("Could not open project:\n" + e.message); });
        });
    }

    $("btn-open").addEventListener("click", function () {
        var files = pickFiles(false, "Open After Effects Project", ["aep"]);
        if (files) openProject(files[0]);
    });

    $("btn-save").addEventListener("click", function () {
        host("saveProject").then(refreshProject).catch(function (e) { ui.alert(e.message); });
    });

    $("btn-reveal").addEventListener("click", function () {
        if (currentProject) revealInOS(currentProject.folder);
    });

    // ---------------- launcher: new project from template ----------------

    var templates = [];

    function selectedTemplate() {
        var idx = parseInt($("np-template").value, 10);
        return templates[idx] || null;
    }

    function renderTemplateSelect() {
        var sel = $("np-template");
        sel.innerHTML = "";
        templates.forEach(function (t, i) {
            var opt = document.createElement("option");
            opt.value = i;
            opt.textContent = T.getTemplateLabel(t) + (T.fileExists(t.path) ? "" : "  [file missing]");
            sel.appendChild(opt);
        });
    }

    function npValues() {
        var t = selectedTemplate();
        return {
            t: t,
            brand: T.sanitizeName($("np-brand").value),
            campaign: T.sanitizeName($("np-campaign").value) || "",
            year: $("np-year").value,
            quarter: $("np-quarter").value,
            version: "V" + (parseInt($("np-version").value, 10) || 1),
            revision: "R" + (parseInt($("np-revision").value, 10) || 1)
        };
    }

    function updatePreview() {
        var v = npValues();
        var box = $("np-preview");
        if (!v.t) { box.textContent = "—"; return; }
        var err = T.validate(v.brand || "Brand", v.campaign);
        var name = T.buildFilename(v.brand || "Brand", v.campaign, v.quarter,
            v.t.width + "x" + v.t.height, v.version, v.revision, T.isDOOHTemplate(v.t.name));
        box.textContent = err || name;
        box.className = "preview-line" + (err ? " invalid" : "");
    }

    ["np-brand", "np-campaign", "np-version", "np-revision"].forEach(function (id) {
        $(id).addEventListener("input", updatePreview);
    });
    ["np-template", "np-year", "np-quarter"].forEach(function (id) {
        $(id).addEventListener("change", updatePreview);
    });

    $("btn-create").addEventListener("click", function () {
        var v = npValues();
        if (!v.t) { ui.alert("No templates available. (BH-1004)"); return; }
        if (!T.fileExists(v.t.path)) {
            ui.alert("Template file not found (BH-1001):\n" + (v.t.path || "(no file)") +
                  "\n\nUse Templates > Generate Missing Files.");
            return;
        }
        var err = T.validate(v.brand, v.campaign);
        if (err) { ui.alert(err); return; }

        var projectName = T.buildProjectFolderName(v.brand, v.campaign);
        var filename = T.buildFilename(v.brand, v.campaign, v.quarter,
            v.t.width + "x" + v.t.height, v.version, v.revision, T.isDOOHTemplate(v.t.name));
        var templateType = T.getTemplateType(v.t.width, v.t.height);
        var size = T.getTemplateFolderName(v.t.width, v.t.height) + "_" + v.t.width + "x" + v.t.height;

        var folders;
        try {
            folders = T.createProjectStructure(baseWorkFolder(), v.year, v.quarter,
                projectName, size, v.revision, templateType, v.version);
        } catch (e) { ui.alert(e.message); return; }

        var savePath = pathMod.join(folders.aeFolder, filename);

        Promise.resolve(
            T.fileExists(savePath)
                ? ui.confirm("File already exists:\n" + filename + "\n\nOverwrite?", "Overwrite?")
                : true
        ).then(function (proceed) {
            if (!proceed) return;
            return guardUnsaved("Create project: " + filename).then(function (go) {
                if (!go) return;
                return host("createFromTemplate", v.t.path, savePath, true).then(function () {
                    addRecent(savePath);
                    refreshProject();
                    ui.alert("Project Created!\n\nFile: " + filename + "\n\nLocation:\n" + folders.aeFolder, "Success");
                }).catch(function (e) {
                    ui.alert("Failed to open template (BH-2004):\n" + e.message);
                });
            });
        });
    });

    // ---------------- templates tab ----------------

    var tplEditIndex = -1; // -1 = adding

    function renderTemplateList() {
        var ul = $("tpl-list");
        ul.innerHTML = "";
        templates.forEach(function (t, i) {
            var li = document.createElement("li");
            var missing = !T.fileExists(t.path);
            li.innerHTML =
                "<span>" + escapeHtml(T.getTemplateLabel(t)) +
                    (missing ? '<span class="tpl-missing">FILE MISSING</span>' : "") + "</span>" +
                '<span class="tpl-actions">' +
                    '<button class="link" data-act="edit" data-i="' + i + '">edit</button>' +
                    '<button class="link danger" data-act="del" data-i="' + i + '">delete</button>' +
                "</span>";
            ul.appendChild(li);
        });
        renderTemplateSelect();
        updatePreview();
    }

    $("tpl-list").addEventListener("click", function (ev) {
        var btn = ev.target.closest("button[data-act]");
        if (!btn) return;
        var i = parseInt(btn.dataset.i, 10);
        if (btn.dataset.act === "del") {
            ui.confirm('Delete template "' + templates[i].name + '"?\n(The .aep file is not deleted.)', "Delete Template")
                .then(function (yes) {
                    if (!yes) return;
                    templates.splice(i, 1);
                    saveTemplates(templates);
                    renderTemplateList();
                });
        } else {
            tplEditIndex = i;
            var t = templates[i];
            $("tpl-form-title").textContent = "Edit Template";
            $("tpl-name").value = t.name;
            $("tpl-width").value = t.width;
            $("tpl-height").value = t.height;
            $("tpl-fps").value = t.fps;
            $("tpl-duration").value = t.duration;
            $("tpl-path").value = t.path || "";
            $("tpl-form-card").classList.remove("hidden");
        }
    });

    $("btn-tpl-add").addEventListener("click", function () {
        tplEditIndex = -1;
        $("tpl-form-title").textContent = "Add Template";
        ["tpl-name", "tpl-path"].forEach(function (id) { $(id).value = ""; });
        $("tpl-width").value = 1920; $("tpl-height").value = 1080;
        $("tpl-fps").value = 24; $("tpl-duration").value = 15;
        $("tpl-form-card").classList.remove("hidden");
    });

    $("btn-tpl-cancel").addEventListener("click", function () {
        $("tpl-form-card").classList.add("hidden");
    });

    $("btn-tpl-browse").addEventListener("click", function () {
        var files = pickFiles(false, "Select template .aep", ["aep"]);
        if (files) $("tpl-path").value = files[0];
    });

    $("btn-tpl-save").addEventListener("click", function () {
        // Strip filesystem-illegal chars and traversal — the name becomes a filename
        var name = $("tpl-name").value
            .replace(/[<>:"\/\\|?*]/g, "").replace(/\.\./g, "").replace(/^\s+|\s+$/g, "");
        if (!name) { ui.alert("Template name is required. (BH-4002)"); return; }
        var t = {
            name: name,
            width: Math.min(8192, Math.max(1, parseInt($("tpl-width").value, 10) || 1920)),
            height: Math.min(8192, Math.max(1, parseInt($("tpl-height").value, 10) || 1080)),
            fps: Math.min(120, Math.max(1, parseFloat($("tpl-fps").value) || 24)),
            duration: Math.min(3600, Math.max(0.1, parseFloat($("tpl-duration").value) || 15)),
            path: $("tpl-path").value.replace(/^\s+|\s+$/g, "")
        };
        if (tplEditIndex >= 0) templates[tplEditIndex] = t;
        else templates.push(t);
        saveTemplates(templates);
        $("tpl-form-card").classList.add("hidden");
        renderTemplateList();
    });

    $("btn-tpl-generate").addEventListener("click", function () {
        var missing = templates.filter(function (t) { return !T.fileExists(t.path); });
        if (!missing.length) { ui.alert("All template files exist — nothing to generate."); return; }

        guardUnsaved("Generate " + missing.length + " template file(s) — this closes the current project")
            .then(function (go) {
                if (!go) return;
                var folder = templatesFolder();
                nodeRequire("fs").mkdirSync(folder, { recursive: true });

                return missing.reduce(function (chain, t) {
                    return chain.then(function () {
                        return host("generateTemplate", t.name, t.width, t.height, t.fps, t.duration, folder)
                            .then(function (res) { t.path = res.path; })
                            .catch(function (e) { ui.alert('Failed to generate "' + t.name + '" (BH-1003):\n' + e.message); });
                    });
                }, Promise.resolve()).then(function () {
                    saveTemplates(templates);
                    renderTemplateList();
                    refreshProject();
                    ui.alert("Template generation finished.\n\nFolder:\n" + folder, "Templates");
                });
            });
    });

    // ---------------- optimizer ----------------

    var optFiles = [];
    var optRunning = false;
    var optCancelled = false;   // batch-level: survives between files (BHFFmpeg
                                // resets its own flag on every optimize() call)

    function renderOptFiles(statusByPath) {
        var ul = $("opt-file-list");
        ul.innerHTML = "";
        optFiles.forEach(function (f) {
            var li = document.createElement("li");
            var status = (statusByPath && statusByPath[f.path]) || "";
            li.innerHTML = "<span>" + escapeHtml(f.path.split(/[\\/]/).pop()) + "</span>" +
                '<span class="size ' + (status.indexOf("✓") === 0 ? "done" : status.indexOf("✗") === 0 ? "fail" : "") + '">' +
                escapeHtml(status || f.sizeMB.toFixed(1) + " MB") + "</span>";
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

    /** Install ffmpeg with progress in the Settings status line; resolves the path. */
    function installFFmpegFlow() {
        var status = $("ffmpeg-status");
        return BHFFmpeg.install(function (line) {
            status.textContent = line.length > 90 ? line.slice(0, 90) + "…" : line;
        }).then(function (exePath) {
            setSetting("ffmpeg_path", exePath);
            $("set-ffmpeg").value = exePath;
            status.textContent = "✓ Installed: " + exePath;
            return exePath;
        }, function (err) {
            status.textContent = "✗ Install failed.";
            ui.alert("FFmpeg install failed:\n\n" + err.message);
            throw new Error("no ffmpeg");
        });
    }

    function getFFmpegOrExplain() {
        return BHFFmpeg.detect(S.ffmpeg_path || null).then(function (found) {
            if (found) {
                if (found !== "ffmpeg" && found !== S.ffmpeg_path) setSetting("ffmpeg_path", found);
                return found;
            }
            return ui.confirm("FFmpeg is required but was not found on this computer.\n\n" +
                              "Install it automatically now?" +
                              (BHFFmpeg.isWin ? "\n(Downloads ~90 MB)" : "\n(Uses Homebrew — takes a few minutes)"),
                              "Install FFmpeg?")
                .then(function (yes) {
                    if (!yes) throw new Error("no ffmpeg");
                    return installFFmpegFlow();
                });
        });
    }

    $("btn-pick-files").addEventListener("click", function () {
        var files = pickFiles(true, "Select MP4(s) to optimize", ["mp4"]);
        if (!files) return;
        getFFmpegOrExplain().then(function (exe) {
            return Promise.all(files.map(function (f) { return BHFFmpeg.probe(exe, f); }));
        }).then(function (infos) {
            optFiles = infos;
            renderOptFiles();
        }).catch(function (e) {
            if (e.message !== "no ffmpeg") ui.alert("Could not read files:\n" + e.message);
        });
    });

    $("btn-optimize").addEventListener("click", function () {
        if (optRunning || !optFiles.length) return;
        var targetMB = parseFloat($("opt-target").value) || 7;

        getFFmpegOrExplain().then(function (exe) {
            optRunning = true;
            optCancelled = false;
            $("btn-optimize").disabled = true;
            $("btn-cancel").disabled = false;
            $("opt-progress").classList.remove("hidden");
            $("opt-log").innerHTML = "";

            var statuses = {};
            var done = 0;

            /** Restore AE's footage/render-queue links; awaited before moving on. */
            function restore(tokens, filePath) {
                if (!tokens || (!tokens.items.length && !tokens.oms.length)) return Promise.resolve();
                return host("restoreFileLock", tokens, filePath).catch(function (e) {
                    optLog("Warning: could not relink " + filePath.split(/[\\/]/).pop() +
                           " in AE — relink manually. (" + e.message + ")", "err");
                });
            }

            return optFiles.reduce(function (chain, f) {
                return chain.then(function () {
                    if (optCancelled) throw new Error("CANCELLED");
                    $("opt-current-file").textContent = f.path.split(/[\\/]/).pop();

                    return host("releaseFileLock", f.path)
                        .catch(function () { return { items: [], oms: [] }; })
                        .then(function (tokens) {
                            return BHFFmpeg.optimize(f.path,
                                { ffmpegPath: exe, targetMB: targetMB, replaceOriginal: true },
                                function (pct) {
                                    $("opt-bar-file").style.width = pct + "%";
                                    $("opt-pct").textContent = Math.round(pct) + "%";
                                }
                            ).then(function (res) {
                                return restore(tokens, f.path).then(function () {
                                    var short = f.path.split(/[\\/]/).pop();
                                    if (res.skipped) {
                                        statuses[f.path] = "✓ already " + res.before.toFixed(1) + " MB";
                                        optLog(short + ": already under target, skipped", "ok");
                                    } else if (res.met) {
                                        statuses[f.path] = "✓ " + res.after.toFixed(1) + " MB";
                                        optLog(short + ": " + res.before.toFixed(1) + " → " +
                                            res.after.toFixed(1) + " MB (" + res.attempts + " encode" +
                                            (res.attempts > 1 ? "s" : "") + ")", "ok");
                                    } else {
                                        statuses[f.path] = "✗ over target (" + res.after.toFixed(1) + " MB)";
                                        optLog(short + ": best result " + res.after.toFixed(1) +
                                            " MB still exceeds " + targetMB + " MB — original kept, output saved as " +
                                            res.output.split(/[\\/]/).pop(), "err");
                                    }
                                });
                            }, function (err) {
                                return restore(tokens, f.path).then(function () {
                                    if (err.message === "CANCELLED") throw err;
                                    statuses[f.path] = "✗ failed";
                                    optLog(f.path.split(/[\\/]/).pop() + ": " + err.message, "err");
                                });
                            });
                        })
                        .then(function () {
                            done++;
                            $("opt-overall-txt").textContent = done + " / " + optFiles.length;
                            $("opt-bar-all").style.width = (done / optFiles.length * 100) + "%";
                            renderOptFiles(statuses);
                        });
                });
            }, Promise.resolve()).then(function () {
                optLog("Batch complete.", "ok");
            }, function (err) {
                optLog(err.message === "CANCELLED" ? "Cancelled — remaining files skipped." : err.message, "err");
            }).then(function () {
                optRunning = false;
                $("btn-optimize").disabled = optFiles.length === 0;
                $("btn-cancel").disabled = true;
                refreshProject();
            });
        }).catch(function () { /* no ffmpeg — already alerted */ });
    });

    $("btn-cancel").addEventListener("click", function () {
        optCancelled = true;   // stops the batch before the next file starts
        BHFFmpeg.cancel();     // kills the currently running encode immediately
    });

    // ---------------- settings ----------------

    function bindSetting(inputId, key) {
        $(inputId).addEventListener("change", function () {
            setSetting(key, this.value || "");
        });
    }
    bindSetting("set-ffmpeg", "ffmpeg_path");
    bindSetting("set-basefolder", "base_work_folder");
    bindSetting("set-tplfolder", "templates_folder");

    $("btn-detect-ffmpeg").addEventListener("click", function () {
        $("ffmpeg-status").textContent = "Detecting…";
        BHFFmpeg.detect(S.ffmpeg_path || null).then(function (found) {
            if (found) {
                if (found !== "ffmpeg") { setSetting("ffmpeg_path", found); $("set-ffmpeg").value = found; }
                $("ffmpeg-status").textContent = "✓ Found: " + (found === "ffmpeg" ? "ffmpeg (on PATH)" : found);
                return;
            }
            $("ffmpeg-status").textContent = "✗ Not found.";
            return ui.confirm("FFmpeg was not found on this computer.\n\nInstall it automatically now?" +
                              (BHFFmpeg.isWin ? "\n(Downloads ~90 MB)" : "\n(Uses Homebrew — takes a few minutes)"),
                              "Install FFmpeg?")
                .then(function (yes) {
                    if (yes) return installFFmpegFlow().catch(function () { });
                    $("ffmpeg-status").textContent = "✗ Not found — install ffmpeg or enter its path above.";
                });
        });
    });

    // ---------------- boot ----------------

    function populateYears() {
        var sel = $("np-year");
        var now = new Date().getFullYear();
        for (var y = now - 1; y <= now + 2; y++) {
            var opt = document.createElement("option");
            opt.value = opt.textContent = y;
            if (y === now) opt.selected = true;
            sel.appendChild(opt);
        }
        $("np-quarter").selectedIndex = Math.floor(new Date().getMonth() / 3);
    }

    host("ping").then(function (info) {
        setPill("ok", "AE " + info.version);
    }).catch(function () {
        setPill("err", "host offline");
    });

    populateYears();

    /** Adopt template .aep files that already exist in the templates folder
        (fresh installs start with empty paths; the files may already be there
        from the ScriptUI launcher or a shared folder). */
    function adoptExistingTemplateFiles() {
        var changed = false;
        templates.forEach(function (t) {
            if (T.fileExists(t.path)) return;
            var expected = pathMod.join(templatesFolder(),
                t.name.replace(/\s+/g, "_") + "_" + t.width + "x" + t.height + ".aep");
            if (T.fileExists(expected)) { t.path = expected; changed = true; }
        });
        if (changed) saveTemplates(templates);
    }

    loadSettings().then(function () {
        templates = loadTemplates();
        adoptExistingTemplateFiles();
        renderTemplateList();     // also fills the New Project dropdown + preview
        renderRecents();
        $("set-ffmpeg").value = S.ffmpeg_path || "";
        $("set-basefolder").value = S.base_work_folder || "";
        $("set-tplfolder").value = S.templates_folder || "";
        $("set-tplfolder").placeholder = T.defaultTemplatesFolder();
    });

    refreshProject();
    setInterval(refreshProject, 4000); // keep the status card in sync
})();
