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
    var fsMod = nodeRequire("fs");
    var osMod = nodeRequire("os");
    var T = window.BHTemplates;

    var BH_VERSION = "0.2.0";   // keep in sync with CSXS/manifest.xml
    var REPO_URL = "https://github.com/gouravbhagat20/After-Effects_Template_Launcher-";
    var CHANGELOG = {
        "0.2.0": [
            "New Render tab: Render Queue with template-specific output modules, Collect Project with pack report",
            "Diagnostics section in Settings with copyable troubleshooting report",
            "Update notifications when a newer version is on GitHub",
            "Signed .zxp installer for easy team installs",
            "UI polish: icons, tooltips, theme adaptation, animations"
        ]
    };

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
                    "ffmpeg_path", "recent_files", "ame_enabled", "dooh_target_mb",
                    "post_render_webm", "post_render_mov", "post_render_html", "post_render_zip"];
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

    function pickFolder(title) {
        var res = window.cep.fs.showOpenDialogEx(false, true, title, null, []);
        return (res && res.err === 0 && res.data && res.data.length) ? res.data[0] : null;
    }

    function revealInOS(folderPath) {
        if (!folderPath) return;
        if (BHFFmpeg.isWin) cp.spawn("explorer", [folderPath], { detached: true });
        else cp.spawn("open", [folderPath], { detached: true });
    }

    /** Reveal a specific file selected in Finder/Explorer. */
    function revealFile(filePath) {
        if (!filePath) return;
        if (BHFFmpeg.isWin) cp.spawn("explorer", ["/select," + filePath], { detached: true });
        else cp.spawn("open", ["-R", filePath], { detached: true });
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

    // ---------------- theme (follows AE's appearance) ----------------

    function applyTheme() {
        try {
            var skin = cs.getHostEnvironment().appSkinInfo;
            var c = skin.panelBackgroundColor.color;
            document.body.classList.toggle("light", c.red > 128);
        } catch (e) { /* keep dark default */ }
    }
    applyTheme();
    try { cs.addEventListener(CSInterface.THEME_COLOR_CHANGED_EVENT, applyTheme); } catch (e) { }

    // ---------------- activity indicator (real background work only) ----------------

    var busyCount = 0;
    function busy(on) {
        busyCount = Math.max(0, busyCount + (on ? 1 : -1));
        $("activity").classList.toggle("hidden", busyCount === 0);
    }

    // ---------------- toast ----------------

    var toastEl = document.createElement("div");
    toastEl.className = "bh-toast";
    document.body.appendChild(toastEl);
    var toastTimer = null;

    function toast(msg, isError) {
        toastEl.textContent = msg;
        toastEl.classList.toggle("err", !!isError);
        toastEl.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2600);
    }

    function setProgress(id, pct) {
        var value = Math.max(0, Math.min(100, Number(pct) || 0));
        $(id).style.transform = "scaleX(" + (value / 100) + ")";
    }

    // ---------------- tabs (sliding thumb) ----------------

    var tabsBar = document.querySelector(".tabs");
    var tabThumb = document.createElement("div");
    tabThumb.className = "tab-thumb";
    tabsBar.insertBefore(tabThumb, tabsBar.firstChild);

    function moveThumb(tab, immediate) {
        if (immediate) tabThumb.classList.add("is-static");
        tabThumb.style.width = tab.offsetWidth + "px";
        tabThumb.style.transform = "translateX(" + tab.offsetLeft + "px)";
        if (immediate) requestAnimationFrame(function () { tabThumb.classList.remove("is-static"); });
    }

    var activeTabAnimation = null;
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");

    function animateTabPage(page, event) {
        // Keyboard navigation should respond instantly; pointer changes get one
        // small, interruptible transition for continuity.
        if (!page.animate || (event && event.detail === 0) || (reduceMotion && reduceMotion.matches)) return;
        if (activeTabAnimation) activeTabAnimation.cancel();
        var animation = page.animate([
            { opacity: 0, transform: "translateY(4px)" },
            { opacity: 1, transform: "translateY(0)" }
        ], {
            duration: 160,
            easing: "cubic-bezier(0.23, 1, 0.32, 1)"
        });
        activeTabAnimation = animation;
        animation.onfinish = function () {
            if (activeTabAnimation === animation) activeTabAnimation = null;
        };
        animation.oncancel = function () {
            if (activeTabAnimation === animation) activeTabAnimation = null;
        };
    }

    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (tab) {
        tab.addEventListener("click", function (event) {
            var previousTab = document.querySelector(".tab.active");
            var previousPage = document.querySelector(".tab-page.active");
            previousTab.classList.remove("active");
            previousTab.setAttribute("aria-selected", "false");
            previousTab.setAttribute("tabindex", "-1");
            previousPage.classList.remove("active");
            tab.classList.add("active");
            tab.setAttribute("aria-selected", "true");
            tab.setAttribute("tabindex", "0");
            var page = $("tab-" + tab.dataset.tab);
            page.classList.add("active");
            moveThumb(tab, event.detail === 0);
            animateTabPage(page, event);
        });
    });
    tabsBar.addEventListener("keydown", function (event) {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
        var tabs = Array.prototype.slice.call(tabsBar.querySelectorAll(".tab"));
        var current = tabs.indexOf(document.activeElement);
        if (current < 0) current = tabs.indexOf(document.querySelector(".tab.active"));
        var next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
            (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault();
        tabs[next].focus();
        tabs[next].click();
    });
    window.addEventListener("resize", function () {
        moveThumb(document.querySelector(".tab.active"), true);
    });
    // position after first layout
    requestAnimationFrame(function () { moveThumb(document.querySelector(".tab.active"), true); });

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
        return host("getProjectInfo").then(function (info) {
            renderProject(info);
            renderRQInfo();
        }).catch(function () {
            renderProject(null);
            renderRQInfo();
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
                    toast("✓ Created " + filename);
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
        if (!templates.length) {
            ul.innerHTML = '<li class="empty-state">No templates yet — click "Add" to create one.</li>';
        }
        templates.forEach(function (t, i) {
            var li = document.createElement("li");
            var missing = !T.fileExists(t.path);
            // miniature aspect-ratio preview (max 26px on the long edge)
            var scale = 26 / Math.max(t.width, t.height);
            var tw = Math.max(8, Math.round(t.width * scale));
            var th = Math.max(8, Math.round(t.height * scale));
            li.innerHTML =
                '<span class="tpl-info">' +
                    '<span class="tpl-thumb" style="width:' + tw + 'px;height:' + th + 'px"></span>' +
                    "<span>" + escapeHtml(T.getTemplateLabel(t)) +
                        (missing ? '<span class="tpl-missing">FILE MISSING</span>' : "") + "</span>" +
                "</span>" +
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
            $("tpl-form-title").textContent = "Edit template";
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
        $("tpl-form-title").textContent = "Add template";
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
        toast("✓ Template saved");
    });

    $("btn-tpl-generate").addEventListener("click", function () {
        var missing = templates.filter(function (t) { return !T.fileExists(t.path); });
        if (!missing.length) { ui.alert("All template files exist — nothing to generate."); return; }

        guardUnsaved("Generate " + missing.length + " template file(s) — this closes the current project")
            .then(function (go) {
                if (!go) return;
                var folder = templatesFolder();
                nodeRequire("fs").mkdirSync(folder, { recursive: true });
                busy(true);

                return missing.reduce(function (chain, t) {
                    return chain.then(function () {
                        return host("generateTemplate", t.name, t.width, t.height, t.fps, t.duration, folder)
                            .then(function (res) { t.path = res.path; })
                            .catch(function (e) { ui.alert('Failed to generate "' + t.name + '" (BH-1003):\n' + e.message); });
                    });
                }, Promise.resolve()).then(function () {
                    busy(false);
                    saveTemplates(templates);
                    renderTemplateList();
                    refreshProject();
                    toast("✓ Templates generated");
                }, function (e) { busy(false); throw e; });
            });
    });

    // ---------------- render tab: render queue ----------------

    function renderRQInfo() {
        var box = $("rq-info");
        if (!box) return;
        if (!currentProject || !currentProject.path) {
            box.innerHTML = '<div class="empty-state">Open a saved project to set up a render.</div>';
            $("btn-rq-add").disabled = true;
            return;
        }
        var main = currentProject.mainComp;
        if (!main) {
            box.innerHTML = '<div class="empty-state">No "Main" comp found in this project.</div>';
            $("btn-rq-add").disabled = true;
            return;
        }
        $("btn-rq-add").disabled = false;
        var r = T.buildRenderName(currentProject.name, main.width, main.height);
        var revision = (r.parsed && r.parsed.revision) ? r.parsed.revision : "R1";
        var isPng = r.type === "sunrise" || r.type === "default";
        box.innerHTML =
            '<div class="spec-list">' +
                '<div class="spec-row"><span>Comp</span><b>' + escapeHtml(main.name) + " · " + main.width + "×" + main.height + " · " + main.duration.toFixed(1) + 's</b></div>' +
                '<div class="spec-row"><span>Format</span><b>' + (isPng ? "PNG Sequence + Alpha" : "H.264 (MP4)") + '</b></div>' +
                '<div class="spec-row"><span>Folder</span><b>Render_' + escapeHtml(revision) + '</b></div>' +
                '<div class="spec-row"><span>Output</span><b class="mono">' + escapeHtml(r.name) + '</b></div>' +
            '</div>';
    }

    $("btn-rq-add").addEventListener("click", function () {
        if (!currentProject || !currentProject.path) { ui.alert("No project currently open. (BH-2003)"); return; }
        var main = currentProject.mainComp;
        if (!main) { ui.alert("Main composition not found. (BH-3001)"); return; }

        var r = T.buildRenderName(currentProject.name, main.width, main.height);
        var revision = (r.parsed && r.parsed.revision) ? r.parsed.revision : "R1";
        var renderFolder = pathMod.join(currentProject.folder, "Render_" + revision);
        try { fsMod.mkdirSync(renderFolder, { recursive: true }); }
        catch (e) { ui.alert("Could not create render folder:\n" + e.message); return; }

        host("addMainToRenderQueue", pathMod.join(renderFolder, r.name), r.type)
            .then(function (res) {
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

    // ---------------- render tab: sunrise post-render ----------------

    var prSeq = null;
    var prRunning = false;

    function setPRSeq(folder) {
        prSeq = folder ? BHPost.detectPNGSequence(folder) : null;
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
        var folder = pickFolder("Select folder containing the rendered PNG sequence");
        if (folder) setPRSeq(folder);
    });

    $("btn-pr-auto").addEventListener("click", function () {
        if (!currentProject || !currentProject.folder) { ui.alert("Open a saved project first."); return; }
        var parsed = T.parseProjectName(currentProject.name || "");
        var rev = parsed && parsed.revision ? parsed.revision : "R1";
        var guess = pathMod.join(currentProject.folder, "Render_" + rev);
        if (!fsMod.existsSync(guess)) {
            ui.alert("Expected render folder not found:\n" + guess + "\n\nUse \"Choose Render Folder…\" instead.");
            return;
        }
        setPRSeq(guess);
    });

    // checkbox state shared with the script's post_render_* settings
    [["pr-webm", "post_render_webm"], ["pr-mov", "post_render_mov"],
     ["pr-html", "post_render_html"], ["pr-zip", "post_render_zip"]].forEach(function (pair) {
        $(pair[0]).addEventListener("change", function () {
            setSetting(pair[1], this.checked ? "true" : "false");
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
        var main = currentProject && currentProject.mainComp;
        var parsed = T.parseProjectName((currentProject && currentProject.name) || "");

        var clobber = BHPost.existingOutputs(prSeq.folder);
        Promise.resolve(
            clobber.length
                ? ui.confirm("Output files already exist in this folder:\n" +
                      clobber.map(function (p) { return "• " + pathMod.basename(p); }).join("\n") +
                      "\n\nOverwrite?", "Overwrite?")
                : true
        ).then(function (go) {
            if (!go) return;
            return getFFmpegOrExplain().then(function (exe) {
                prRunning = true;
                busy(true);
                $("btn-pr-convert").disabled = true;
                $("btn-pr-convert").classList.add("loading");
                $("btn-pr-cancel").disabled = false;
                $("pr-progress").classList.remove("hidden");
                $("pr-log").innerHTML = "";
                $("btn-pr-show").classList.add("hidden");

                return BHPost.convert({
                    ffmpegPath: exe,
                    seq: prSeq,
                    fps: main ? main.fps : 24,
                    width: main ? main.width : 750,
                    height: main ? main.height : 300,
                    title: (currentProject && currentProject.name) || "Animation",
                    isDOOH: !!(parsed && parsed.isDOOH),
                    targetMB: parseFloat(S.dooh_target_mb) || 6.8,
                    webm: options.webm, mov: options.mov, html: options.html, zip: options.zip
                }, function (step, pct) {
                    $("pr-step").textContent = step;
                    $("pr-pct").textContent = Math.round(pct) + "%";
                    setProgress("pr-bar", pct);
                }, prLog).then(function (res) {
                    prLog("Conversion complete.", "ok");
                    toast("✓ Conversion complete");
                    if (res.outputs.length) {
                        revealFile(res.outputs[0]);
                        var btn = $("btn-pr-show");
                        btn.classList.remove("hidden");
                        btn.onclick = function () { revealFile(res.outputs[0]); };
                    }
                }, function (err) {
                    var c = err.message === "CANCELLED";
                    prLog(c ? "Cancelled." : err.message, "err");
                    toast(c ? "Conversion cancelled" : "Conversion failed", true);
                }).then(function () {
                    prRunning = false;
                    busy(false);
                    $("btn-pr-convert").classList.remove("loading");
                    $("btn-pr-convert").disabled = !prSeq;
                    $("btn-pr-cancel").disabled = true;
                });
            }).catch(function () { /* no ffmpeg — already alerted */ });
        });
    });

    $("btn-pr-cancel").addEventListener("click", function () {
        BHPost.cancel();
    });

    // ---------------- render tab: collect ----------------

    $("btn-collect").addEventListener("click", function () {
        if (!currentProject || !currentProject.path) { ui.alert("No saved project open. (BH-2003)"); return; }
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

                var destRoot = pickFolder("Select destination folder for the collected project");
                if (!destRoot) { status.textContent = ""; return; }

                // Standardized collect folder name (same rebuild as the script)
                var collectName = currentProject.name;
                var parsed = T.parseProjectName(currentProject.name);
                if (parsed) {
                    collectName = T.buildFilename(parsed.brand, parsed.campaign, parsed.quarter || "QX",
                        parsed.size, parsed.version, parsed.revision, !!parsed.isDOOH)
                        .replace(/\.aep$/i, "");
                }

                var destFolder = pathMod.join(destRoot, collectName);
                var footageFolder = pathMod.join(destFolder, "(Footage)");
                fsMod.mkdirSync(footageFolder, { recursive: true });
                var destAep = pathMod.join(destFolder, currentProject.name + ".aep");

                status.textContent = "Collecting… (AE may be busy for a moment)";
                busy(true);
                return host("collectProject", destAep, footageFolder).then(function (res) {
                    busy(false);
                    status.textContent = "✓ Collected " + res.assets + " asset(s)" +
                        (res.missing ? " — " + res.missing + " missing (see _Pack_Report.txt)" : "") + ".";
                    toast("✓ Project collected");
                    revealFile(destAep);
                    refreshProject();
                }, function (e) {
                    busy(false);
                    status.textContent = "";
                    ui.alert("Collect failed:\n" + e.message);
                });
            });
        }).catch(function (e) {
            status.textContent = "";
            ui.alert("Pre-flight check failed:\n" + e.message);
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
        // (empty queue needs no placeholder — the dropzone above is the empty state)
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
        busy(true);
        return BHFFmpeg.install(function (line) {
            status.textContent = line.length > 90 ? line.slice(0, 90) + "…" : line;
        }).then(function (exePath) {
            busy(false);
            setSetting("ffmpeg_path", exePath);
            $("set-ffmpeg").value = exePath;
            status.textContent = "✓ Installed: " + exePath;
            toast("✓ FFmpeg installed");
            return exePath;
        }, function (err) {
            busy(false);
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

    /** Clear the previous batch's progress, log, and result button. */
    function resetOptProgress() {
        $("opt-progress").classList.add("hidden");
        $("opt-log").innerHTML = "";
        setProgress("opt-bar-file", 0);
        setProgress("opt-bar-all", 0);
        $("opt-pct").textContent = "0%";
        $("opt-current-file").textContent = "—";
        $("opt-overall-txt").textContent = "0 / 0";
        $("btn-show-output").classList.add("hidden");
    }

    function updateDropLabel() {
        $("opt-drop-label").textContent = optFiles.length
            ? optFiles.length + " file" + (optFiles.length > 1 ? "s" : "") + " queued — drop or click to replace"
            : "Drop MP4s here — or click to browse";
    }

    /** Probe and queue a set of MP4 paths (from the picker or drag & drop). */
    function queueOptFiles(paths) {
        if (optRunning || !paths || !paths.length) return;
        var zone = $("btn-pick-files");
        zone.classList.add("loading");
        busy(true);
        getFFmpegOrExplain().then(function (exe) {
            return Promise.all(paths.map(function (f) { return BHFFmpeg.probe(exe, f); }));
        }).then(function (infos) {
            optFiles = infos;
            resetOptProgress();   // new batch — drop the previous run's results
            renderOptFiles();
            updateDropLabel();
        }).catch(function (e) {
            if (e.message !== "no ffmpeg") ui.alert("Could not read files:\n" + e.message);
        }).then(function () {
            zone.classList.remove("loading");
            busy(false);
        });
    }

    $("btn-pick-files").addEventListener("click", function () {
        var files = pickFiles(true, "Select MP4(s) to optimize", ["mp4"]);
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
        var targetMB = parseFloat($("opt-target").value) || 7;

        getFFmpegOrExplain().then(function (exe) {
            optRunning = true;
            optCancelled = false;
            busy(true);
            $("btn-optimize").classList.add("loading");
            $("btn-optimize").disabled = true;
            $("btn-cancel").disabled = false;
            $("opt-progress").classList.remove("hidden");
            $("opt-log").innerHTML = "";
            $("btn-show-output").classList.add("hidden");

            var statuses = {};
            var done = 0;
            var outputs = [];   // final file paths (replaced originals or _Optimized copies)

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
                    setProgress("opt-bar-file", 0);
                    $("opt-pct").textContent = "0%";

                    return host("releaseFileLock", f.path)
                        .catch(function () { return { items: [], oms: [] }; })
                        .then(function (tokens) {
                            return BHFFmpeg.optimize(f.path,
                                { ffmpegPath: exe, targetMB: targetMB, replaceOriginal: true },
                                function (pct) {
                                    setProgress("opt-bar-file", pct);
                                    $("opt-pct").textContent = Math.round(pct) + "%";
                                }
                            ).then(function (res) {
                                return restore(tokens, f.path).then(function () {
                                    var short = f.path.split(/[\\/]/).pop();
                                    if (!res.skipped) outputs.push(res.output);
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
                            // File finished (encoded, skipped, or failed) — complete its bar
                            setProgress("opt-bar-file", 100);
                            $("opt-pct").textContent = "100%";
                            $("opt-overall-txt").textContent = done + " / " + optFiles.length;
                            setProgress("opt-bar-all", done / optFiles.length * 100);
                            renderOptFiles(statuses);
                        });
                });
            }, Promise.resolve()).then(function () {
                optLog("Batch complete.", "ok");
                toast("✓ Optimization complete");
            }, function (err) {
                var cancelledRun = err.message === "CANCELLED";
                optLog(cancelledRun ? "Cancelled — remaining files skipped." : err.message, "err");
                toast(cancelledRun ? "Batch cancelled" : "Optimization failed", true);
            }).then(function () {
                busy(false);
                $("btn-optimize").classList.remove("loading");
                // Reveal the result and keep a button around for later
                if (outputs.length) {
                    revealFile(outputs[0]);
                    var btn = $("btn-show-output");
                    btn.textContent = BHFFmpeg.isWin ? "Show in Explorer" : "Show in Finder";
                    btn.classList.remove("hidden");
                    btn.onclick = function () { revealFile(outputs[0]); };
                }
                optRunning = false;
                // Clear the queue — results stay in the log; next run starts fresh
                optFiles = [];
                renderOptFiles();
                updateDropLabel();
                $("opt-current-file").textContent = "—";
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
            toast("✓ Saved");
        });
    }
    bindSetting("set-ffmpeg", "ffmpeg_path");
    bindSetting("set-basefolder", "base_work_folder");
    bindSetting("set-tplfolder", "templates_folder");

    function bindBrowse(btnId, inputId, key, title) {
        $(btnId).addEventListener("click", function () {
            var folder = pickFolder(title);
            if (!folder) return;
            $(inputId).value = folder;
            setSetting(key, folder);
            toast("✓ Saved");
        });
    }
    bindBrowse("btn-browse-base", "set-basefolder", "base_work_folder", "Select base work folder");
    bindBrowse("btn-browse-tpl", "set-tplfolder", "templates_folder", "Select templates folder");

    // collapsible settings sections (state remembered per section)
    Array.prototype.forEach.call(document.querySelectorAll(".card.collapsible"), function (card) {
        var section = card.dataset.section;
        var title = card.querySelector(".card-title");
        var saved = localStorage.getItem("bh.collapse." + section);
        if (saved === "1") card.classList.add("collapsed");
        else if (saved === "0") card.classList.remove("collapsed");
        title.setAttribute("role", "button");
        title.setAttribute("tabindex", "0");
        title.setAttribute("aria-expanded", card.classList.contains("collapsed") ? "false" : "true");
        title.addEventListener("click", function (event) {
            var instant = event.detail === 0;
            if (instant) card.classList.add("is-static");
            var collapsed = card.classList.toggle("collapsed");
            title.setAttribute("aria-expanded", collapsed ? "false" : "true");
            localStorage.setItem("bh.collapse." + section, collapsed ? "1" : "0");
            if (instant) requestAnimationFrame(function () { card.classList.remove("is-static"); });
        });
        title.addEventListener("keydown", function (event) {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            title.click();
        });
    });

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

    // ---------------- diagnostics ----------------

    var lastDiagReport = "";

    function checkFolder(p) {
        if (!p) return "not set";
        if (!fsMod.existsSync(p)) return p + "  [MISSING]";
        try {
            var probe = pathMod.join(p, ".bh_write_test");
            fsMod.writeFileSync(probe, "x");
            fsMod.unlinkSync(probe);
            return p + "  [ok, writable]";
        } catch (e) { return p + "  [exists, NOT writable]"; }
    }

    function buildDiagReport() {
        var lines = [];
        lines.push("=== BigHappy Launcher Diagnostics ===");
        lines.push("Generated: " + new Date().toString());
        lines.push("");
        lines.push("Panel version:  " + BH_VERSION);
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
        lines.push("Base folder:    " + checkFolder(S.base_work_folder));
        lines.push("Templates dir:  " + checkFolder(templatesFolder()));
        var missing = templates.filter(function (t) { return !T.fileExists(t.path); }).length;
        lines.push("Templates:      " + templates.length + " configured, " + missing + " missing file(s)");
        lines.push("FFmpeg path:    " + (S.ffmpeg_path || "(auto-detect)"));

        return host("ping").then(function (info) {
            lines.splice(4, 0, "AE (host):      " + info.app + " " + info.version);
        }).catch(function () {
            lines.splice(4, 0, "AE (host):      NOT RESPONDING");
        }).then(function () {
            return BHFFmpeg.detect(S.ffmpeg_path || null);
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
            var res = window.cep.fs.showSaveDialogEx("Save diagnostics report", null, ["txt"],
                "BigHappy_Diagnostics.txt");
            if (!res || res.err !== 0 || !res.data) return;
            try {
                fsMod.writeFileSync(res.data, lastDiagReport, "utf8");
                toast("✓ Report saved");
                revealFile(res.data);
            } catch (e) { ui.alert("Could not save report:\n" + e.message); }
        };
        lastDiagReport ? doSave() : buildDiagReport().then(function (r) {
            $("diag-body").textContent = r; doSave();
        });
    });

    // ---------------- update check & what's-new ----------------

    function versionNewer(remote, local) {
        var a = String(remote).split(".").map(Number);
        var b = String(local).split(".").map(Number);
        for (var i = 0; i < Math.max(a.length, b.length); i++) {
            var d = (a[i] || 0) - (b[i] || 0);
            if (d !== 0) return d > 0;
        }
        return false;
    }

    /** Dev installs are symlinked/copied from the git repo — never self-overwrite those. */
    function isDevInstall(extPath) {
        try {
            if (fsMod.existsSync(pathMod.join(extPath, "..", ".git"))) return true;   // extPath = repo/cep
            if (fsMod.lstatSync(extPath).isSymbolicLink()) return true;
        } catch (e) { }
        return false;
    }

    /** Download the new signed package and extract it over this install. */
    function performAutoUpdate(remoteVersion) {
        var extPath = cs.getExtensionPath();
        if (isDevInstall(extPath)) {
            ui.alert("This is a development install (linked to the git repo).\n\n" +
                     "Update with git pull instead of the auto-updater.");
            return;
        }

        var zxpUrl = "https://raw.githubusercontent.com/gouravbhagat20/After-Effects_Template_Launcher-/main/dist/BigHappyLauncher_v" +
            remoteVersion + ".zxp";
        var tmpZip = pathMod.join(osMod.tmpdir(), "bh_update_" + remoteVersion + ".zip");

        busy(true);
        toast("Downloading v" + remoteVersion + "…");
        fetch(zxpUrl)
            .then(function (r) {
                if (!r.ok) throw new Error("Download failed (" + r.status + "). The release file may not be published yet.");
                return r.arrayBuffer();
            })
            .then(function (buf) {
                var B = (window.cep_node && window.cep_node.Buffer) || window.Buffer;
                var data = B.from(buf);
                // sanity: real zip (PK header) and plausible size
                if (data.length < 10 * 1024 || data[0] !== 0x50 || data[1] !== 0x4b) {
                    throw new Error("Downloaded file is not a valid package.");
                }
                fsMod.writeFileSync(tmpZip, data);
                return new Promise(function (resolve, reject) {
                    var proc = BHFFmpeg.isWin
                        ? cp.spawn("tar", ["-xf", tmpZip, "-C", extPath], { windowsHide: true })
                        : cp.spawn("unzip", ["-o", tmpZip, "-d", extPath]);
                    var errTail = "";
                    proc.stderr.on("data", function (c) { errTail += String(c); });
                    proc.on("error", reject);
                    proc.on("close", function (code) {
                        code === 0 ? resolve() : reject(new Error("Extract failed: " + errTail.slice(-300)));
                    });
                });
            })
            .then(function () {
                // confirm the new manifest actually landed
                var manifest = fsMod.readFileSync(pathMod.join(extPath, "CSXS", "manifest.xml"), "utf8");
                var m = manifest.match(/ExtensionBundleVersion="([\d.]+)"/);
                if (!m || m[1] !== remoteVersion) throw new Error("Update extracted but version verification failed.");
                try { fsMod.unlinkSync(tmpZip); } catch (e) { }
                busy(false);
                $("update-pill").classList.add("hidden");
                return ui.alert("Updated to v" + remoteVersion + "!\n\n" +
                    "Restart After Effects to finish — the new version loads on next launch.", "Update Installed");
            })
            .catch(function (err) {
                busy(false);
                ui.alert("Auto-update failed:\n" + err.message +
                    "\n\nYou can update manually — the panel will open the GitHub page.").then(function () {
                    cp.spawn(BHFFmpeg.isWin ? "explorer" : "open", [REPO_URL], { detached: true });
                });
            });
    }

    /**
     * @param {boolean} [force] - true for the manual Settings button: bypass
     *   the throttle and report every outcome (up to date / offline).
     *   Falsy for the silent boot/periodic check, which throttles network
     *   calls to one per 6 hours and pops the install dialog by itself the
     *   first time each new version is seen (the pill stays for later).
     */
    function checkForUpdate(force) {
        if (!force) {
            var last = parseInt(localStorage.getItem("bh.updateCheckTs") || "0", 10);
            if (Date.now() - last < 6 * 60 * 60 * 1000) return;
        }
        localStorage.setItem("bh.updateCheckTs", String(Date.now()));

        // cache-bust: raw branch URLs sit behind a ~5-min CDN cache
        fetch("https://raw.githubusercontent.com/gouravbhagat20/After-Effects_Template_Launcher-/main/cep/CSXS/manifest.xml" +
              "?t=" + Date.now())
            .then(function (r) { return r.ok ? r.text() : null; })
            .then(function (xml) {
                if (!xml) {
                    if (force) ui.alert("Could not reach GitHub to check for updates.\n\nCheck your internet connection and try again.");
                    return;
                }
                var m = xml.match(/ExtensionBundleVersion="([\d.]+)"/);
                if (m && versionNewer(m[1], BH_VERSION)) {
                    var pill = $("update-pill");
                    pill.textContent = "v" + m[1] + " available";
                    pill.classList.remove("hidden");
                    pill.onclick = function () {
                        ui.confirm("Version " + m[1] + " is available (you have " + BH_VERSION + ").\n\n" +
                                   "Download and install it now?\nAfter Effects must be restarted afterwards.",
                                   "Update Available")
                            .then(function (yes) { if (yes) performAutoUpdate(m[1]); });
                    };
                    // NOTIFY: open the install dialog automatically, but only
                    // once per version — declining leaves the pill as reminder
                    if (force || localStorage.getItem("bh.notifiedVersion") !== m[1]) {
                        localStorage.setItem("bh.notifiedVersion", m[1]);
                        pill.onclick();
                    }
                } else if (force) {
                    ui.alert("You are up to date.\n\nInstalled: v" + BH_VERSION +
                             (m ? "\nLatest on GitHub: v" + m[1] : ""), "No Update Available");
                }
            })
            .catch(function () {
                if (force) ui.alert("Could not reach GitHub to check for updates.\n\nCheck your internet connection and try again.");
            });
    }

    function showWhatsNew() {
        var seen = localStorage.getItem("bh.lastVersion");
        localStorage.setItem("bh.lastVersion", BH_VERSION);
        if (!seen || seen === BH_VERSION) return;   // fresh install or unchanged
        var notes = CHANGELOG[BH_VERSION];
        if (!notes) return;
        ui.alert("Updated to v" + BH_VERSION + "\n\n" +
            notes.map(function (n) { return "• " + n; }).join("\n"),
            "What's New");
    }

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

        // render tab state (shared with the script's settings)
        $("rq-ame").checked = S.ame_enabled === "true";
        $("pr-webm").checked = S.post_render_webm !== "false";
        $("pr-mov").checked = S.post_render_mov !== "false";
        $("pr-html").checked = S.post_render_html !== "false";
        $("pr-zip").checked = S.post_render_zip !== "false";

        showWhatsNew();
        checkForUpdate();
    });

    $("about-text").innerHTML = "BigHappy Launcher CEP v" + BH_VERSION +
        " — panel UI with async ffmpeg.<br>The classic ScriptUI version remains available as BigHappyLauncher_Templates.jsx.";

    $("rq-ame").addEventListener("change", function () {
        setSetting("ame_enabled", this.checked ? "true" : "false");
    });

    $("btn-check-update").addEventListener("click", function () {
        checkForUpdate(true);
    });

    refreshProject();
    setInterval(refreshProject, 4000); // keep the status card in sync

    // Panels stay open for days — re-check for updates while running, not
    // just at boot. Hourly tick; the 6h throttle limits actual network calls.
    setInterval(function () { checkForUpdate(); }, 60 * 60 * 1000);
})();
