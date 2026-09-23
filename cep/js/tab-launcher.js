/*
    BHLauncher — the Launcher tab (project status, recents, new project from
    template) and the Templates tab that feeds its dropdown.

    Both live here because they are two views of one list: editing a template
    has to re-render the picker and the destination preview immediately.
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

        // ---------------- project status ----------------

        function renderProject(project) {
            var box = $("project-info");
            var hasSavedProject = !!(project && project.path);
            $("btn-save").disabled = !hasSavedProject;
            $("btn-reveal").disabled = !hasSavedProject;
            $("btn-collect").disabled = !hasSavedProject;
            $("project-card").classList.toggle("is-success", hasSavedProject);
            if (!project || !project.path) {
                box.innerHTML = '<div class="muted">No saved project open.</div>';
                return;
            }
            var main = project.mainComp;
            box.innerHTML =
                '<div class="name">' + core.escapeHtml(project.name) +
                    (project.dirty ? '<span class="badge dirty">UNSAVED</span>' : "") + '</div>' +
                '<div class="meta">' +
                    (main ? core.escapeHtml(main.name) + " — " + main.width + "×" + main.height +
                            " @ " + main.fps.toFixed(2) + "fps, " + main.duration.toFixed(1) + "s"
                          : "No Main comp found") +
                '</div>' +
                '<div class="meta">' + project.numComps + ' comps, ' +
                    project.numFootage + ' footage items</div>';
        }

        core.onProject(renderProject);

        // ---------------- recent files (shared "recent_files" setting) ----------------

        // The script stores recents as [{path, ts}]; it also tolerates legacy
        // plain strings. Read both shapes, always write objects.
        function loadRecents() {
            try {
                var raw = JSON.parse(core.S.recent_files || "[]");
                return raw.map(function (r) {
                    return typeof r === "string" ? { path: r, ts: 0 } : r;
                }).filter(function (r) { return r && r.path; });
            } catch (e) { return []; }
        }

        function addRecent(p) {
            var list = loadRecents().filter(function (r) {
                return !core.samePath(r.path, p);
            });
            list.unshift({ path: p, ts: Date.now() });
            core.setSetting("recent_files", JSON.stringify(list.slice(0, 10)));
            renderRecents();
        }

        function renderRecents() {
            var ul = $("recent-list");
            var list = loadRecents();
            $("recents-card").classList.toggle("hidden", !list.length);
            if (!list.length) {
                ul.innerHTML = '<li class="muted">Nothing yet — projects you open appear here.</li>';
                return;
            }
            ul.innerHTML = "";
            list.forEach(function (r) {
                var li = document.createElement("li");
                var base = r.path.split(/[\\/]/).pop();
                li.innerHTML = core.escapeHtml(base) + '<span class="path">' + core.escapeHtml(r.path) + "</span>";
                li.tabIndex = 0;
                li.setAttribute("role", "button");
                li.title = r.path;
                li.addEventListener("click", function () { openProject(r.path); });
                li.addEventListener("keydown", function (event) {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openProject(r.path);
                    }
                });
                ul.appendChild(li);
            });
        }

        function openProject(p) {
            core.guardUnsaved("Open project: " + p.split(/[\\/]/).pop()).then(function (go) {
                if (!go) return;
                host("openProject", p, true)
                    .then(function () { addRecent(p); core.refreshProject(); })
                    .catch(function (e) { ui.alert("Could not open project:\n" + e.message); });
            });
        }

        $("btn-open").addEventListener("click", function () {
            var files = core.pickFiles(false, "Open After Effects Project", ["aep"]);
            if (files) openProject(files[0]);
        });

        $("btn-save").addEventListener("click", function () {
            host("saveProject").then(core.refreshProject).catch(function (e) { ui.alert(e.message); });
        });

        $("btn-reveal").addEventListener("click", function () {
            var project = core.project();
            if (project) core.revealInOS(project.folder);
        });

        // ---------------- new project from template ----------------

        function selectedTemplate() {
            var idx = parseInt($("np-template").value, 10);
            return core.templates()[idx] || null;
        }

        function renderTemplateSelect() {
            var sel = $("np-template");
            sel.innerHTML = "";
            core.templates().forEach(function (t, i) {
                var opt = document.createElement("option");
                opt.value = i;
                opt.textContent = t.name + (T.fileExists(t.path) ? "" : "  [file missing]");
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
            var summary = $("template-summary");
            summary.classList.toggle("hidden", !v.t);
            $("project-options-summary").textContent = v.year + " · " + v.quarter + " · " + v.version + " / " + v.revision;
            if (!v.t) { box.textContent = "—"; return; }
            $("template-summary-spec").textContent = v.t.width + " × " + v.t.height +
                "  ·  " + v.t.fps + " fps  ·  " + v.t.duration + " s";
            var ratio = Math.max(0.08, Number(v.t.width) / Number(v.t.height) || 1);
            var shapeW = Math.max(4, Math.min(28, 18 * ratio));
            var shapeH = Math.max(4, Math.min(19, 28 / ratio));
            $("template-shape").style.transform = "scale(" + (shapeW / 20) + "," + (shapeH / 20) + ")";
            var err = T.validate(v.brand || "Brand", v.campaign);
            var name = T.buildFilename(v.brand || "Brand", v.campaign, v.quarter,
                v.t.width + "x" + v.t.height, v.version, v.revision, T.isDOOHTemplate(v.t.name));
            box.textContent = err || name;
            box.className = "preview-line" + (err ? " invalid" : "");
            var base = core.baseWorkFolder();
            var projectName = T.buildProjectFolderName(v.brand || "Brand", v.campaign);
            var size = T.getTemplateFolderName(v.t.width, v.t.height) + "_" + v.t.width + "x" + v.t.height;
            var destination = base ? pathMod.join(base, v.year, v.quarter, projectName, size,
                v.version, "AE_File", name) : "Choose a base work folder in Settings.";
            $("np-destination").textContent = destination;
            $("np-destination").title = destination;
        }

        ["np-brand", "np-campaign", "np-version", "np-revision"].forEach(function (id) {
            $(id).addEventListener("input", updatePreview);
        });
        ["np-template", "np-year", "np-quarter"].forEach(function (id) {
            $(id).addEventListener("change", updatePreview);
        });
        $("np-template").addEventListener("pointerdown", function () {
            if (core.reduceMotion && core.reduceMotion.matches) return;
            $("template-summary").classList.add("pointer-change");
        });
        $("np-template").addEventListener("change", function () {
            setTimeout(function () { $("template-summary").classList.remove("pointer-change"); }, 230);
        });

        // Animate this occasional disclosure only for pointer input. Keyboard
        // toggles remain instant for people who use the panel repeatedly.
        (function () {
            var details = document.querySelector(".project-options");
            var summary = details.querySelector("summary");
            summary.addEventListener("pointerdown", function () {
                if (core.reduceMotion && core.reduceMotion.matches) return;
                details.classList.add("pointer-toggle");
            });
            details.addEventListener("toggle", function () {
                if (!details.classList.contains("pointer-toggle")) return;
                if (details.open && details.animate) {
                    details.querySelector(".project-version-row").animate([
                        { opacity: 0, transform: "translateY(-6px)" },
                        { opacity: 1, transform: "translateY(0)" }
                    ], { duration: 210, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
                }
                setTimeout(function () { details.classList.remove("pointer-toggle"); }, 230);
            });
        })();

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
                folders = T.createProjectStructure(core.baseWorkFolder(), v.year, v.quarter,
                    projectName, size, v.revision, templateType, v.version);
            } catch (e) { ui.alert(e.message); return; }

            var savePath = pathMod.join(folders.aeFolder, filename);

            Promise.resolve(
                T.fileExists(savePath)
                    ? ui.confirm("File already exists:\n" + filename + "\n\nOverwrite?", "Overwrite?")
                    : true
            ).then(function (proceed) {
                if (!proceed) return;
                return core.guardUnsaved("Create project: " + filename).then(function (go) {
                    if (!go) return;
                    return host("createFromTemplate", v.t.path, savePath, true).then(function (res) {
                        addRecent(savePath);
                        core.refreshProject();
                        toast("✓ Created " + filename);
                        // Partial _GlobalAssets imports used to look like success —
                        // surface exactly which files did not come in.
                        var ga = res && res.globalAssets;
                        if (ga && ((ga.failed && ga.failed.length) || ga.error)) {
                            var detail = (ga.failed && ga.failed.length)
                                ? ga.failed.map(function (n) { return "• " + n; }).join("\n")
                                : String(ga.error);
                            ui.alert("Project created, but some global assets failed to import" +
                                     (ga.imported ? " (" + ga.imported + " imported OK)" : "") + ":\n\n" +
                                     detail + "\n\nImport them manually from the _GlobalAssets folder.",
                                     "Global Assets Warning");
                        }
                    }).catch(function (e) {
                        ui.alert("Failed to open template (BH-2004):\n" + e.message);
                    });
                });
            });
        });

        // ---------------- templates tab ----------------

        var tplEditIndex = -1; // -1 = adding

        function renderTemplateList() {
            var templates = core.templates();
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
                        "<span>" + core.escapeHtml(T.getTemplateLabel(t)) +
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

        // One subscription keeps every view of the template list in step.
        core.onTemplates(renderTemplateList);

        $("tpl-list").addEventListener("click", function (ev) {
            var btn = ev.target.closest("button[data-act]");
            if (!btn) return;
            var i = parseInt(btn.dataset.i, 10);
            var templates = core.templates();
            if (btn.dataset.act === "del") {
                ui.confirm('Delete template "' + templates[i].name + '"?\n(The .aep file is not deleted.)', "Delete Template")
                    .then(function (yes) {
                        if (!yes) return;
                        templates.splice(i, 1);
                        core.setTemplates(templates, true);
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
            var files = core.pickFiles(false, "Select template .aep", ["aep"]);
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
            var templates = core.templates();
            if (tplEditIndex >= 0) templates[tplEditIndex] = t;
            else templates.push(t);
            core.setTemplates(templates, true);
            $("tpl-form-card").classList.add("hidden");
            toast("✓ Template saved");
        });

        $("btn-tpl-generate").addEventListener("click", function () {
            var templates = core.templates();
            var missing = templates.filter(function (t) { return !T.fileExists(t.path); });
            if (!missing.length) { ui.alert("All template files exist — nothing to generate."); return; }

            core.guardUnsaved("Generate " + missing.length + " template file(s) — this closes the current project")
                .then(function (go) {
                    if (!go) return;
                    var folder = core.templatesFolder();
                    core.node.fs.mkdirSync(folder, { recursive: true });
                    core.busy(true);

                    return missing.reduce(function (chain, t) {
                        return chain.then(function () {
                            return host("generateTemplate", t.name, t.width, t.height, t.fps, t.duration, folder)
                                .then(function (res) { t.path = res.path; })
                                .catch(function (e) { ui.alert('Failed to generate "' + t.name + '" (BH-1003):\n' + e.message); });
                        });
                    }, Promise.resolve()).then(function () {
                        core.busy(false);
                        core.setTemplates(templates, true);
                        core.refreshProject();
                        toast("✓ Templates generated");
                    }, function (e) { core.busy(false); throw e; });
                });
        });

        /** Adopt template .aep files that already exist in the templates folder
            (fresh installs start with empty paths; the files may already be there
            from the ScriptUI launcher or a shared folder). */
        function adoptExistingTemplateFiles() {
            var changed = false;
            core.templates().forEach(function (t) {
                if (T.fileExists(t.path)) return;
                var expected = pathMod.join(core.templatesFolder(),
                    t.name.replace(/\s+/g, "_") + "_" + t.width + "x" + t.height + ".aep");
                if (T.fileExists(expected)) { t.path = expected; changed = true; }
            });
            if (changed) core.saveTemplates();
        }

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

        return {
            populateYears: populateYears,
            adoptExistingTemplateFiles: adoptExistingTemplateFiles,
            renderRecents: renderRecents,
            renderTemplateList: renderTemplateList,
            updatePreview: updatePreview
        };
    }

    global.BHLauncher = { init: init };
})(window);
