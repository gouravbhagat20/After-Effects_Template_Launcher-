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
