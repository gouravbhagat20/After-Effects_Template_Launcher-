/*
    BigHappy Launcher — CEP host bridge (ExtendScript)

    Loaded by the CEP panel (ScriptPath in manifest.xml). Exposes a small
    JSON-in/JSON-out API under the BH namespace. Everything that does NOT
    need the After Effects DOM (filesystem, ffmpeg, networking) lives in
    the panel's Node.js side, not here.

    Every public function returns a JSON string:
      { ok: true,  data: ... }
      { ok: false, error: "message" }
*/

var BH = (function () {

    // ---------- minimal JSON stringify (ExtendScript has no JSON) ----------

    function esc(s) {
        return String(s)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\n/g, "\\n")
            .replace(/\r/g, "\\r")
            .replace(/\t/g, "\\t")
            .replace(/[\u0000-\u001f]/g, "");
    }

    function stringify(v) {
        if (v === null || v === undefined) return "null";
        var t = typeof v;
        if (t === "number") return isFinite(v) ? String(v) : "null";
        if (t === "boolean") return String(v);
        if (t === "string") return '"' + esc(v) + '"';
        if (v instanceof Array) {
            var out = [];
            for (var i = 0; i < v.length; i++) out.push(stringify(v[i]));
            return "[" + out.join(",") + "]";
        }
        if (t === "object") {
            var props = [];
            for (var k in v) {
                if (v.hasOwnProperty(k)) props.push('"' + esc(k) + '":' + stringify(v[k]));
            }
            return "{" + props.join(",") + "}";
        }
        return "null";
    }

    function ok(data) { return stringify({ ok: true, data: data }); }
    function fail(msg) { return stringify({ ok: false, error: String(msg) }); }

    // ---------- helpers ----------

    function findMainComp() {
        var proj = app.project;
        if (!proj) return null;
        var candidates = [];
        for (var i = 1; i <= proj.numItems; i++) {
            var item = proj.item(i);
            if (item instanceof CompItem && /^main$/i.test(item.name)) candidates.push(item);
        }
        if (candidates.length > 0) return candidates[0];
        // Fallback: any comp named like "Main*"
        for (var j = 1; j <= proj.numItems; j++) {
            var it = proj.item(j);
            if (it instanceof CompItem && /main/i.test(it.name)) return it;
        }
        return null;
    }

    function isProjectDirty() {
        try { return app.project.dirty === true; }        // AE 17.5+
        catch (e) { return app.project.file === null && app.project.numItems > 0; }
    }

    // ---------- public API ----------

    var api = {};

    api.ping = function () {
        return ok({ app: app.appName || "AfterFX", version: app.version });
    };

    /** Snapshot of the open project for the panel's status area. */
    api.getProjectInfo = function () {
        try {
            var proj = app.project;
            if (!proj) return ok({ open: false });

            var main = findMainComp();
            var comps = 0, footage = 0;
            for (var i = 1; i <= proj.numItems; i++) {
                var it = proj.item(i);
                if (it instanceof CompItem) comps++;
                else if (it instanceof FootageItem) footage++;
            }

            return ok({
                open: true,
                name: proj.file ? decodeURI(proj.file.name).replace(/\.aep$/i, "") : null,
                path: proj.file ? proj.file.fsName : null,
                folder: proj.file ? proj.file.parent.fsName : null,
                dirty: isProjectDirty(),
                numComps: comps,
                numFootage: footage,
                mainComp: main ? {
                    name: main.name,
                    width: main.width,
                    height: main.height,
                    duration: main.duration,
                    fps: main.frameRate
                } : null
            });
        } catch (e) { return fail(e); }
    };

    /**
     * Open a project. The panel asks the user about unsaved changes BEFORE
     * calling this (its dialogs are nicer); force=true skips the guard here.
     */
    api.openProject = function (path, force) {
        try {
            var f = new File(path);
            if (!f.exists) return fail("File not found: " + path);
            if (!force && app.project && app.project.numItems > 0 && isProjectDirty()) {
                return fail("UNSAVED_CHANGES");
            }
            app.open(f);
            return ok({ opened: f.fsName });
        } catch (e) { return fail(e); }
    };

    /** Save the current project (in place). */
    api.saveProject = function () {
        try {
            if (!app.project || !app.project.file) return fail("No saved project open.");
            app.project.save();
            return ok({ saved: app.project.file.fsName });
        } catch (e) { return fail(e); }
    };

    /** Save the current project to a new path (Save As). */
    api.saveProjectAs = function (path) {
        try {
            if (!app.project) return fail("No project open.");
            app.project.save(new File(path));
            return ok({ saved: app.project.file.fsName });
        } catch (e) { return fail(e); }
    };

    /**
     * List footage items that reference a file inside the given folder —
     * used by the optimizer so Node knows which files AE holds locks on.
     */
    api.getFootageIn = function (folderPath) {
        try {
            var out = [];
            var proj = app.project;
            if (!proj) return ok(out);
            var norm = String(folderPath).toLowerCase();
            for (var i = 1; i <= proj.numItems; i++) {
                var it = proj.item(i);
                if (it instanceof FootageItem && it.file &&
                    it.file.fsName.toLowerCase().indexOf(norm) === 0) {
                    out.push({ index: i, name: it.name, path: it.file.fsName });
                }
            }
            return ok(out);
        } catch (e) { return fail(e); }
    };

    /**
     * Release AE's lock on a file (point footage + render-queue output
     * modules at a temp placeholder) so ffmpeg/Node can replace it.
     * Returns tokens: { items: [projItemIndex], oms: [{rq, om}] } —
     * pass them back to restoreFileLock() afterwards so BOTH footage and
     * render-queue output modules get restored.
     */
    api.releaseFileLock = function (path) {
        try {
            var tokens = { items: [], oms: [] };
            var proj = app.project;
            if (!proj) return ok(tokens);
            var target = new File(path);
            var stamp = String(new Date().getTime());

            var rq = proj.renderQueue;
            for (var i = 1; i <= rq.numItems; i++) {
                for (var j = 1; j <= rq.item(i).numOutputModules; j++) {
                    var om = rq.item(i).outputModule(j);
                    if (om.file && om.file.fsName === target.fsName) {
                        om.file = new File(Folder.temp.fsName + "/bh_lock_" + stamp + "_" + i + "_" + j + ".mp4");
                        tokens.oms.push({ rq: i, om: j });
                    }
                }
            }
            for (var k = 1; k <= proj.numItems; k++) {
                var it = proj.item(k);
                if (it instanceof FootageItem && it.file && it.file.fsName === target.fsName) {
                    it.replace(new File(Folder.temp.fsName + "/bh_place_" + stamp + "_" + k + ".mp4"));
                    tokens.items.push(k);
                }
            }
            return ok(tokens);
        } catch (e) { return fail(e); }
    };

    /** Restore everything released by releaseFileLock to the given path. */
    api.restoreFileLock = function (tokens, path) {
        try {
            var f = new File(path);
            var done = 0;
            var items = (tokens && tokens.items) || [];
            var oms = (tokens && tokens.oms) || [];
            for (var i = 0; i < items.length; i++) {
                try {
                    var it = app.project.item(items[i]);
                    if (it instanceof FootageItem) { it.replace(f); done++; }
                } catch (e) { }
            }
            for (var j = 0; j < oms.length; j++) {
                try {
                    app.project.renderQueue.item(oms[j].rq).outputModule(oms[j].om).file = f;
                    done++;
                } catch (e) { }
            }
            return ok({ restored: done });
        } catch (e) { return fail(e); }
    };

    // ---------- render queue ----------

    /**
     * Add the Main comp to the Render Queue with template-specific output
     * settings — exact port of the ScriptUI addToRenderQueue.
     * outputPath has no extension (the output module appends it).
     */
    api.addMainToRenderQueue = function (outputPath, templateType) {
        try {
            var comp = findMainComp();
            if (!comp) return fail("Main composition not found (BH-3001).");

            var rqItem = app.project.renderQueue.items.add(comp);
            var om = rqItem.outputModule(1);
            var isPng = !(templateType === "interscroller" || String(templateType).indexOf("dooh") !== -1);

            try {
                om.applyTemplate(isPng ? "PNG Sequence with Alpha" : "H.264");
            } catch (templateErr) {
                try {
                    om.applyTemplate(isPng ? "PNG Sequence" : "H.264 - Match Render Settings - 15 Mbps");
                } catch (fallbackErr) { }
            }

            if (templateType === "sunrise") {
                try {
                    var pngSettings = {
                        "Format": "PNG Sequence",
                        "Video Output": {
                            "Channels": "RGB + Alpha",
                            "Depth": "Millions of Colors+",
                            "Color": "Straight (Unmatted)"
                        }
                    };
                    try { om.setSettings(pngSettings); }
                    catch (e1) {
                        pngSettings["Video Output"]["Color"] = "Straight";
                        om.setSettings(pngSettings);
                    }
                } catch (e) { }
            } else if (!isPng) {
                try {
                    om.setSettings({
                        "Format": "H.264",
                        "Video Output": {
                            "Format Options": { "Profile": "High", "Level": "5.1", "Target Bitrate (Mbps)": 15 }
                        }
                    });
                } catch (e) {
                    try { om.setSettings({ "Format": "QuickTime" }); } catch (err2) { }
                }
            }

            om.file = new File(outputPath);
            return ok({ comp: comp.name, canAME: canQueueInAME() });
        } catch (e) { return fail(e); }
    };

    function canQueueInAME() {
        try { return typeof app.project.renderQueue.queueInAME === "function"; }
        catch (e) { return false; }
    }

    /** Send the queue to Adobe Media Encoder and start rendering. */
    api.queueToAME = function () {
        try {
            if (!canQueueInAME()) return fail("Adobe Media Encoder not available (BH-3003).");
            app.project.renderQueue.queueInAME(true);
            return ok(true);
        } catch (e) { return fail(e); }
    };

    // ---------- collect ----------

    /** List missing footage files (pre-flight before collecting). */
    api.preFlightCheck = function () {
        try {
            var missing = [];
            var items = app.project.items;
            for (var i = 1; i <= items.length; i++) {
                var item = items[i];
                if (item instanceof FootageItem && item.file && !item.file.exists) {
                    missing.push(item.name + " → " + item.file.fsName);
                }
            }
            return ok(missing);
        } catch (e) { return fail(e); }
    };

    /**
     * Collect: save original untouched, Save As a copy at destAepPath, copy
     * all linked footage into footageFolderPath (relinking the COPY), save,
     * and write _Pack_Report.txt. Port of the script's local collect path —
     * the original project on disk is never modified.
     */
    api.collectProject = function (destAepPath, footageFolderPath) {
        try {
            if (!app.project || !app.project.file) return fail("No saved project open (BH-2003).");

            app.project.save();                          // original, unmodified
            app.project.save(new File(destAepPath));     // now working on the copy

            var footageFolder = new Folder(footageFolderPath);
            if (!footageFolder.exists) footageFolder.create();

            var missing = [];
            var items = app.project.items;
            for (var m = 1; m <= items.length; m++) {
                var it = items[m];
                if (it instanceof FootageItem && it.file && !it.file.exists) {
                    missing.push(it.name + " → " + it.file.fsName);
                }
            }

            var count = collectAssetsInto(footageFolder);
            app.project.save();                          // persist relinks in the copy

            generatePackReport(new File(destAepPath).parent, missing);

            return ok({ assets: count, missing: missing.length });
        } catch (e) { return fail(e); }
    };

    /** Port of collectAssets (no palette UI — the panel shows progress). */
    function collectAssetsInto(footageFolder) {
        var count = 0;
        var items = app.project.items;
        for (var i = 1; i <= items.length; i++) {
            var item = items[i];
            if (!item || !(item instanceof FootageItem) || !item.file) continue;
            if (!item.mainSource || item.mainSource instanceof SolidSource) continue;
            var sourceFile = item.file;
            if (!sourceFile.exists) continue;

            var destName = decodeURI(sourceFile.name);
            var destFile = new File(footageFolder.fsName + "/" + destName);

            var isSequence = false;
            if (!item.mainSource.isStill) {
                var ext = sourceFile.name.split(".").pop().toLowerCase();
                if (/^(png|jpg|jpeg|tif|tiff|tga|exr|psd)$/i.test(ext)) isSequence = true;
            }

            if (isSequence) {
                var seqFolder = sourceFile.parent;
                if (!seqFolder || !seqFolder.exists) continue;
                var namePart = decodeURI(sourceFile.name).replace(/\.[^\.]+$/, "");
                var match = namePart.match(/^(.*?)(\d+)$/);
                var found = false;
                if (match) {
                    var lowerPrefix = match[1].toLowerCase();
                    var lowerExt = sourceFile.name.split(".").pop().toLowerCase();
                    var seqFiles = seqFolder.getFiles(function (f) {
                        if (f instanceof Folder) return false;
                        var fName = decodeURI(f.name).toLowerCase();
                        return fName.indexOf(lowerPrefix) === 0 && fName.indexOf("." + lowerExt) !== -1;
                    });
                    if (seqFiles && seqFiles.length > 0) {
                        found = true;
                        var allCopied = true;
                        for (var s = 0; s < seqFiles.length; s++) {
                            var df = new File(footageFolder.fsName + "/" + decodeURI(seqFiles[s].name));
                            if (!df.exists && !seqFiles[s].copy(df.fsName)) allCopied = false;
                        }
                        if (allCopied) {
                            destFile = new File(footageFolder.fsName + "/" + destName);
                            var replaced = false;
                            try {
                                if (typeof item.replaceWithSequence === "function") {
                                    item.replaceWithSequence(destFile, false);
                                    replaced = true;
                                }
                            } catch (errSeq) { }
                            if (!replaced) item.replace(destFile);
                            count++;
                        }
                    }
                }
                if (!found) {
                    if (!destFile.exists) sourceFile.copy(destFile.fsName);
                    item.replace(destFile);
                    count++;
                }
            } else {
                // single file — dedupe name collisions
                var dupIdx = 1;
                var parts = destName.split(".");
                var fileExt = parts.pop();
                var base = parts.join(".");
                while (destFile.exists) {
                    destFile = new File(footageFolder.fsName + "/" + base + "_" + dupIdx + "." + fileExt);
                    dupIdx++;
                }
                sourceFile.copy(destFile.fsName);
                item.replace(destFile);
                count++;
            }
        }
        return count;
    }

    function generatePackReport(destFolder, missingList) {
        try {
            var report = "=== PACK REPORT ===\n";
            report += "Generated: " + new Date().toLocaleString() + "\n";
            report += "Project: " + (app.project.file ? decodeURI(app.project.file.name) : "Untitled") + "\n\n";

            report += "--- MISSING FILES (" + missingList.length + ") ---\n";
            report += missingList.length === 0 ? "(None - All files found!)\n" : "";
            for (var i = 0; i < missingList.length; i++) report += "• " + missingList[i] + "\n";

            var fonts = getFontsUsed();
            report += "\n--- FONTS USED (" + fonts.length + ") ---\n";
            report += fonts.length === 0 ? "(No text layers found)\n" : "";
            for (var j = 0; j < fonts.length; j++) report += "• " + fonts[j] + "\n";

            var effects = getEffectsUsed();
            report += "\n--- EFFECTS/PLUGINS (" + effects.length + ") ---\n";
            report += effects.length === 0 ? "(No effects applied)\n" : "";
            for (var k = 0; k < effects.length; k++) report += "• " + effects[k] + "\n";

            var reportFile = new File(destFolder.fsName + "/_Pack_Report.txt");
            reportFile.encoding = "UTF-8";
            reportFile.open("w");
            reportFile.write(report);
            reportFile.close();
            return true;
        } catch (e) { return false; }
    }

    function getFontsUsed() {
        var fonts = {};
        try {
            for (var i = 1; i <= app.project.numItems; i++) {
                var it = app.project.item(i);
                if (!(it instanceof CompItem)) continue;
                for (var L = 1; L <= it.numLayers; L++) {
                    var layer = it.layer(L);
                    try {
                        if (layer.property("Source Text")) {
                            var doc = layer.property("Source Text").value;
                            if (doc && doc.font) fonts[doc.font] = true;
                        }
                    } catch (e) { }
                }
            }
        } catch (e) { }
        var out = [];
        for (var f in fonts) if (fonts.hasOwnProperty(f)) out.push(f);
        return out;
    }

    function getEffectsUsed() {
        var fx = {};
        try {
            for (var i = 1; i <= app.project.numItems; i++) {
                var it = app.project.item(i);
                if (!(it instanceof CompItem)) continue;
                for (var L = 1; L <= it.numLayers; L++) {
                    try {
                        var effects = it.layer(L).property("ADBE Effect Parade");
                        if (!effects) continue;
                        for (var e2 = 1; e2 <= effects.numProperties; e2++) {
                            fx[effects.property(e2).name] = true;
                        }
                    } catch (e) { }
                }
            }
        } catch (e) { }
        var out = [];
        for (var k in fx) if (fx.hasOwnProperty(k)) out.push(k);
        return out;
    }

    // ---------- settings shared with BigHappyLauncher_Templates.jsx ----------

    var SETTINGS_SECTION = "BigHappyLauncher";

    /** Read a setting from the SAME store the ScriptUI version uses. */
    api.getSetting = function (key, defaultVal) {
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, key)) {
                return ok(app.settings.getSetting(SETTINGS_SECTION, key));
            }
        } catch (e) { }
        return ok(defaultVal === undefined ? null : defaultVal);
    };

    api.setSetting = function (key, value) {
        try {
            app.settings.saveSetting(SETTINGS_SECTION, key, String(value));
            return ok(true);
        } catch (e) { return fail(e); }
    };

    // ---------- templates ----------

    /**
     * Create a new project from a template — exact port of the ScriptUI
     * create flow: open template, Save As into the project structure,
     * open Main in the viewer, import _GlobalAssets.
     * The panel handles the unsaved-changes guard and passes force=true.
     */
    api.createFromTemplate = function (templatePath, savePath, force) {
        try {
            var t = new File(templatePath);
            if (!t.exists) return fail("Template file not found: " + templatePath);
            if (!force && app.project && app.project.numItems > 0 && isProjectDirty()) {
                return fail("UNSAVED_CHANGES");
            }

            app.open(t);
            app.project.save(new File(savePath));

            var mainComp = findMainComp();
            if (mainComp) mainComp.openInViewer();

            importGlobalAssets();

            return ok({ saved: app.project.file.fsName });
        } catch (e) { return fail(e); }
    };

    /**
     * Generate a placeholder template .aep — exact port of the ScriptUI
     * generateTemplateFile: Screens/png/Image/Comps bins, a Main comp, and
     * two red centered text layers. Closes the current project WITHOUT
     * saving — the panel runs its unsaved-changes guard first.
     */
    api.generateTemplate = function (name, width, height, fps, duration, folderPath) {
        var undoOpen = false;
        try {
            // Strip path separators / traversal so the name can't escape folderPath
            name = String(name).replace(/[<>:"\/\\|?*]/g, "").replace(/\.\./g, "").replace(/^\s+|\s+$/g, "");
            if (!name) name = "Template";

            if (app.project) app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
            app.newProject();
            app.beginUndoGroup("Generate Template: " + name);
            undoOpen = true;

            app.project.items.addFolder("Screens");
            app.project.items.addFolder("png");
            app.project.items.addFolder("Image");
            var compsFolder = app.project.items.addFolder("Comps");

            var mainComp = app.project.items.addComp("Main", width, height, 1, duration, fps);
            mainComp.parentFolder = compsFolder;

            addCenteredText(mainComp, name, width / 2, height / 2 - 35);
            addCenteredText(mainComp, width + "x" + height + " | " + fps + "fps | " + duration + "s",
                width / 2, height / 2 + 35);

            var fileName = name.replace(/\s+/g, "_") + "_" + width + "x" + height + ".aep";
            var filePath = folderPath + "/" + fileName;

            app.endUndoGroup();
            undoOpen = false;
            app.project.save(new File(filePath));
            app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);

            return ok({ path: new File(filePath).fsName });
        } catch (e) {
            if (undoOpen) { try { app.endUndoGroup(); } catch (e2) { } }
            return fail(e);
        }
    };

    function addCenteredText(comp, text, x, y) {
        var layer = comp.layers.addText(text);
        try {
            var prop = layer.property("Source Text");
            var doc = prop.value;
            doc.fontSize = 55;
            doc.tracking = -10;
            doc.justification = ParagraphJustification.CENTER_JUSTIFY;
            doc.fillColor = [1, 0, 0];
            prop.setValue(doc);
        } catch (e) { }
        layer.property("Position").setValue([x, y]);
    }

    /** Port of importGlobalAssets: pull templatesFolder/_GlobalAssets into a 00_Global_Assets bin. */
    function importGlobalAssets() {
        try {
            var templatesFolder = null;
            if (app.settings.haveSetting(SETTINGS_SECTION, "templates_folder")) {
                templatesFolder = app.settings.getSetting(SETTINGS_SECTION, "templates_folder");
            } else {
                templatesFolder = Folder.myDocuments.fsName + "/BH_Templates";
            }
            var folder = new Folder(templatesFolder + "/_GlobalAssets");
            if (!folder.exists) return;

            var files = folder.getFiles();
            if (!files || files.length === 0) return;

            var binName = "00_Global_Assets";
            var bin = null;
            for (var i = 1; i <= app.project.numItems; i++) {
                var item = app.project.item(i);
                if (item instanceof FolderItem && item.name === binName) { bin = item; break; }
            }
            if (!bin) bin = app.project.items.addFolder(binName);

            for (var f = 0; f < files.length; f++) {
                var fileObj = files[f];
                if (!(fileObj instanceof File) || fileObj.name.indexOf(".") === 0) continue;
                try {
                    var io = new ImportOptions(fileObj);
                    if (io.canImportAs(ImportAsType.FOOTAGE)) {
                        app.project.importFile(io).parentFolder = bin;
                    }
                } catch (impErr) { }
            }
        } catch (e) { }
    }

    return api;
})();
