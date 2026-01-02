/*
================================================================================
  BigHappyLauncher_Templates.jsx
  After Effects ScriptUI Panel - Auto-Generated Templates
  
  Features:
  - Minimalist UI
  - Auto-generate template .aep files
  - Template Protection (Save As)
  - Smart naming by template type
  - Render queue automation
================================================================================
*/

(function (thisObj) {

    // =========================================================================
    // CONFIG & STORAGE
    // =========================================================================

    var SETTINGS_SECTION = "BigHappyLauncher";
    var TEMPLATES_KEY = "templates_data";
    var TEMPLATES_FOLDER_KEY = "templates_folder";
    var DEFAULT_SAVE_FOLDER_KEY = "default_save_folder";

    var DEFAULT_TEMPLATES = [
        { name: "Sunrise", width: 750, height: 300, fps: 24, duration: 15, path: "" },
        { name: "InterScroller", width: 880, height: 1912, fps: 24, duration: 15, path: "" },
        { name: "DOOH Horizontal", width: 1920, height: 1080, fps: 29.97, duration: 15, path: "" },
        { name: "DOOH Vertical", width: 1080, height: 1920, fps: 29.97, duration: 15, path: "" }
    ];

    // =========================================================================
    // SETTINGS HELPERS
    // =========================================================================

    function getSetting(key, defaultVal) {
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, key)) {
                return app.settings.getSetting(SETTINGS_SECTION, key);
            }
        } catch (e) { }
        return defaultVal;
    }

    function setSetting(key, value) {
        try { app.settings.saveSetting(SETTINGS_SECTION, key, value); } catch (e) { }
    }

    function loadTemplates() {
        try {
            var data = getSetting(TEMPLATES_KEY, null);
            if (data) {
                var templates = eval("(" + data + ")");
                if (templates && templates.length > 0) return templates;
            }
        } catch (e) { }
        return DEFAULT_TEMPLATES.slice();
    }

    function saveTemplates(templates) {
        setSetting(TEMPLATES_KEY, jsonStringify(templates));
    }

    function getTemplatesFolder() {
        return getSetting(TEMPLATES_FOLDER_KEY, Folder.myDocuments.fsName + "/BH_Templates");
    }

    function getDefaultSaveFolder() {
        return getSetting(DEFAULT_SAVE_FOLDER_KEY, Folder.myDocuments.fsName);
    }

    // =========================================================================
    // UTILITY FUNCTIONS
    // =========================================================================

    function jsonStringify(obj) {
        if (obj === null) return "null";
        if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
        if (typeof obj === "string") return '"' + obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
        if (obj instanceof Array) {
            var arr = [];
            for (var i = 0; i < obj.length; i++) arr.push(jsonStringify(obj[i]));
            return "[" + arr.join(",") + "]";
        }
        if (typeof obj === "object") {
            var pairs = [];
            for (var k in obj) if (obj.hasOwnProperty(k)) pairs.push('"' + k + '":' + jsonStringify(obj[k]));
            return "{" + pairs.join(",") + "}";
        }
        return String(obj);
    }

    function sanitizeName(name) {
        var result = "", invalid = "<>:\"/\\|?*";
        for (var i = 0; i < name.length; i++) {
            var c = name.charAt(i);
            if (invalid.indexOf(c) === -1 && name.charCodeAt(i) >= 32) {
                result += (c === " ") ? "_" : c;
            }
        }
        return result;
    }

    function getDateString() {
        var d = new Date();
        var pad = function (n) { return n < 10 ? "0" + n : String(n); };
        return pad(d.getMonth() + 1) + pad(d.getDate()) + d.getFullYear();
    }

    function fileExists(path) { return path && new File(path).exists; }
    function getParentFolder(path) { var f = new File(path); return f.parent ? f.parent.fsName : ""; }
    function isSameFolder(p1, p2) { return getParentFolder(p1).toLowerCase() === getParentFolder(p2).toLowerCase(); }
    function getTemplateLabel(t) { return t.name + " (" + t.width + "x" + t.height + " | " + t.fps + "fps)"; }

    // Template type detection by dimensions
    function getTemplateType(width, height) {
        if (width === 750 && height === 300) return "sunrise";
        if (width === 880 && height === 1912) return "interscroller";
        if ((width === 1920 && height === 1080) || (width === 1080 && height === 1920)) return "dooh";
        return "default";
    }

    function isDOOHTemplate(name) {
        return name.toLowerCase().indexOf("dooh") !== -1;
    }

    // Find Main comp in project
    function findMainComp() {
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === "Main") return item;
        }
        return null;
    }

    // Parse project name into parts
    function parseProjectName(projectName) {
        var parts = projectName.split("_");

        // DOOH format: DOOH_Campaign_Size_V#_R#
        if (parts[0] && parts[0].toUpperCase() === "DOOH" && parts.length >= 5) {
            return {
                prefix: parts.slice(0, parts.length - 2).join("_"),
                campaign: parts[1],
                version: parts[parts.length - 2],
                revision: parts[parts.length - 1]
            };
        }

        // Standard format: Brand_Campaign_Q#_Size_V#_R#
        if (parts.length >= 6) {
            return { brand: parts[0], campaign: parts[1], version: parts[4], revision: parts[5] };
        }

        // Fallback
        if (parts.length >= 4) {
            return { prefix: parts.slice(0, parts.length - 2).join("_") };
        }
        return null;
    }

    // =========================================================================
    // TEMPLATE GENERATION
    // =========================================================================

    function generateTemplateFile(template, folderPath) {
        try {
            if (app.project) app.project.close(CloseOptions.PROMPT_TO_SAVE_CHANGES);
            app.newProject();

            app.project.items.addFolder("Screens");
            app.project.items.addFolder("png");
            app.project.items.addFolder("Image");
            var compsFolder = app.project.items.addFolder("Comps");

            var mainComp = app.project.items.addComp("Main", template.width, template.height, 1, template.duration, template.fps);
            mainComp.parentFolder = compsFolder;

            var infoText = template.name + "\n" + template.width + "x" + template.height + " | " + template.fps + "fps | " + template.duration + "s";
            var textLayer = mainComp.layers.addText(infoText);
            var textProp = textLayer.property("Source Text");
            var textDoc = textProp.value;
            textDoc.justification = ParagraphJustification.CENTER_JUSTIFY;
            textProp.setValue(textDoc);

            textLayer.property("Position").setValue([template.width / 2, template.height / 2]);

            var fileName = template.name.replace(/\s+/g, "_") + "_" + template.width + "x" + template.height + ".aep";
            var filePath = folderPath + "/" + fileName;
            app.project.save(new File(filePath));
            app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);

            return filePath;
        } catch (e) { return null; }
    }

    function ensureTemplatesExist(templates, folderPath) {
        var folder = new Folder(folderPath);
        if (!folder.exists) folder.create();

        var generated = [];
        for (var i = 0; i < templates.length; i++) {
            var t = templates[i];
            if (t.path && new File(t.path).exists) continue;

            var expectedName = t.name.replace(/\s+/g, "_") + "_" + t.width + "x" + t.height + ".aep";
            var expectedPath = folderPath + "/" + expectedName;

            if (new File(expectedPath).exists) {
                templates[i].path = expectedPath;
                generated.push(t.name);
                continue;
            }

            var newPath = generateTemplateFile(t, folderPath);
            if (newPath) {
                templates[i].path = newPath;
                generated.push(t.name);
            }
        }
        if (generated.length > 0) saveTemplates(templates);
        return { templates: templates, generated: generated };
    }

    // =========================================================================
    // DIALOGS
    // =========================================================================

    function showTemplateDialog(template, isNew) {
        var dlg = new Window("dialog", isNew ? "Add Template" : "Edit Template");
        dlg.orientation = "column";
        dlg.alignChildren = ["fill", "top"];
        dlg.spacing = 10;
        dlg.margins = 20;

        var nameGrp = dlg.add("group");
        nameGrp.add("statictext", undefined, "Name:");
        var nameInput = nameGrp.add("edittext", undefined, template.name || "");
        nameInput.characters = 20;

        var dimGrp = dlg.add("group");
        dimGrp.add("statictext", undefined, "Width:");
        var widthInput = dimGrp.add("edittext", undefined, String(template.width || 1920));
        widthInput.characters = 6;
        dimGrp.add("statictext", undefined, "Height:");
        var heightInput = dimGrp.add("edittext", undefined, String(template.height || 1080));
        heightInput.characters = 6;

        var fpsGrp = dlg.add("group");
        fpsGrp.add("statictext", undefined, "FPS:");
        var fpsInput = fpsGrp.add("edittext", undefined, String(template.fps || 24));
        fpsInput.characters = 8;
        fpsGrp.add("statictext", undefined, "Duration:");
        var durInput = fpsGrp.add("edittext", undefined, String(template.duration || 15));
        durInput.characters = 6;

        var btnGrp = dlg.add("group");
        btnGrp.alignment = ["center", "top"];
        btnGrp.add("button", undefined, "OK", { name: "ok" });
        btnGrp.add("button", undefined, "Cancel", { name: "cancel" });

        var result = null;
        dlg.findElement("ok").onClick = function () {
            var name = nameInput.text.replace(/^\s+|\s+$/g, "");
            if (!name) { alert("Enter a name."); return; }
            result = {
                name: name,
                width: parseInt(widthInput.text) || 1920,
                height: parseInt(heightInput.text) || 1080,
                fps: parseFloat(fpsInput.text) || 24,
                duration: parseFloat(durInput.text) || 15,
                path: template.path || ""
            };
            dlg.close();
        };
        dlg.show();
        return result;
    }

    // =========================================================================
    // BUILD UI
    // =========================================================================

    function buildUI(thisObj) {
        var templates = loadTemplates();
        var templatesFolder = getTemplatesFolder();

        var panel = (thisObj instanceof Panel) ? thisObj : new Window("palette", "Big Happy Launcher", undefined, { resizeable: true });
        panel.orientation = "column";
        panel.alignChildren = ["fill", "top"];
        panel.spacing = 10;
        panel.margins = 15;

        // Title
        var title = panel.add("statictext", undefined, "BIG HAPPY LAUNCHER");
        title.alignment = ["center", "top"];
        try { title.graphics.font = ScriptUI.newFont("Arial", "BOLD", 14); } catch (e) { }

        // Main inputs container
        var mainGrp = panel.add("group");
        mainGrp.orientation = "column";
        mainGrp.alignChildren = ["fill", "top"];
        mainGrp.spacing = 5;

        function addRow(parent, label, defaultVal) {
            var g = parent.add("group");
            g.orientation = "row";
            g.alignChildren = ["left", "center"];
            var lbl = g.add("statictext", undefined, label);
            lbl.preferredSize.width = 65;
            var inp = g.add("edittext", undefined, defaultVal);
            inp.alignment = ["fill", "center"];
            return inp;
        }

        // Template dropdown
        var tmplGrp = mainGrp.add("group");
        tmplGrp.orientation = "row";
        tmplGrp.alignChildren = ["left", "center"];
        var tmplLbl = tmplGrp.add("statictext", undefined, "Template:");
        tmplLbl.preferredSize.width = 65;
        var templateDropdown = tmplGrp.add("dropdownlist", undefined, []);
        templateDropdown.alignment = ["fill", "center"];
        templateDropdown.preferredSize.height = 25;

        function refreshDropdown() {
            templateDropdown.removeAll();
            for (var i = 0; i < templates.length; i++) {
                templateDropdown.add("item", getTemplateLabel(templates[i]));
            }
            if (templates.length > 0) templateDropdown.selection = 0;
        }
        refreshDropdown();

        var brandInput = addRow(mainGrp, "Brand:", "");
        var campaignInput = addRow(mainGrp, "Campaign:", "");

        // Details row 1: Quarter
        var qRow = mainGrp.add("group");
        qRow.orientation = "row";
        qRow.alignChildren = ["left", "center"];
        var qLbl = qRow.add("statictext", undefined, "Quarter:");
        qLbl.preferredSize.width = 65;
        var quarterDropdown = qRow.add("dropdownlist", undefined, ["Q1", "Q2", "Q3", "Q4"]);
        quarterDropdown.selection = 0;
        quarterDropdown.preferredSize.width = 70;

        // Details row 2: Version & Revision
        var vrRow = mainGrp.add("group");
        vrRow.orientation = "row";
        vrRow.alignChildren = ["left", "center"];
        var verLbl = vrRow.add("statictext", undefined, "Version:");
        verLbl.preferredSize.width = 65;
        var versionInput = vrRow.add("edittext", undefined, "1");
        versionInput.preferredSize.width = 50;
        var revLbl = vrRow.add("statictext", undefined, "Revision:");
        revLbl.preferredSize.width = 60;
        var revisionInput = vrRow.add("edittext", undefined, "1");
        revisionInput.preferredSize.width = 50;

        // Divider
        var div = panel.add("panel", [0, 0, 100, 1]);
        div.alignment = ["fill", "top"];

        // Preview
        var previewText = panel.add("statictext", undefined, "Filename: ...");
        previewText.alignment = ["center", "top"];
        try { previewText.graphics.foregroundColor = previewText.graphics.newPen(previewText.graphics.PenType.SOLID_COLOR, [0.4, 0.7, 1], 1); } catch (e) { }

        // Main button
        var btnGroup = panel.add("group");
        btnGroup.orientation = "row";
        btnGroup.alignChildren = ["fill", "top"];
        btnGroup.spacing = 5;
        btnGroup.alignment = ["fill", "top"];

        var createBtn = btnGroup.add("button", undefined, "CREATE");
        createBtn.preferredSize.height = 35;
        createBtn.preferredSize.width = 100;
        try { createBtn.graphics.font = ScriptUI.newFont("Arial", "BOLD", 13); } catch (e) { }

        var saveAsBtn = btnGroup.add("button", undefined, "SAVE AS...");
        saveAsBtn.preferredSize.height = 35;
        try { saveAsBtn.graphics.font = ScriptUI.newFont("Arial", "BOLD", 13); } catch (e) { }

        // Status
        var statusText = panel.add("statictext", undefined, "Ready");
        statusText.alignment = ["center", "top"];
        try { statusText.graphics.font = ScriptUI.newFont("Arial", "REGULAR", 10); } catch (e) { }

        // Footer: Template management
        var tmplMgmtGrp = panel.add("group");
        tmplMgmtGrp.orientation = "row";
        tmplMgmtGrp.alignChildren = ["center", "center"];
        tmplMgmtGrp.spacing = 5;

        var addBtn = tmplMgmtGrp.add("button", undefined, "+");
        addBtn.preferredSize = [28, 22];
        var editBtn = tmplMgmtGrp.add("button", undefined, "Edit");
        editBtn.preferredSize = [45, 22];
        var delBtn = tmplMgmtGrp.add("button", undefined, "Del");
        delBtn.preferredSize = [40, 22];
        var regenBtn = tmplMgmtGrp.add("button", undefined, "Regenerate");
        regenBtn.preferredSize.height = 22;
        var folderBtn = tmplMgmtGrp.add("button", undefined, "Folder...");
        folderBtn.preferredSize.height = 22;

        // Render button
        var renderBtn = panel.add("button", undefined, "ADD TO RENDER QUEUE");
        renderBtn.preferredSize.height = 28;
        renderBtn.alignment = ["fill", "top"];
        try { renderBtn.graphics.font = ScriptUI.newFont("Arial", "BOLD", 11); } catch (e) { }

        // =====================================================================
        // LOGIC
        // =====================================================================

        function setStatus(text, color) {
            statusText.text = text;
            try { statusText.graphics.foregroundColor = statusText.graphics.newPen(statusText.graphics.PenType.SOLID_COLOR, color, 1); } catch (e) { }
        }

        function updateStatus() {
            if (!templates.length || !templateDropdown.selection) {
                setStatus("No templates", [0.6, 0.6, 0.6]);
                return;
            }
            var t = templates[templateDropdown.selection.index];
            if (!t.path || !fileExists(t.path)) {
                setStatus("Template missing (Regenerate)", [0.9, 0.5, 0.2]);
            } else {
                setStatus("Ready: " + t.name, [0.5, 0.8, 0.5]);
            }
        }

        function updatePreview() {
            if (!templateDropdown.selection) return;
            var t = templates[templateDropdown.selection.index];
            var brand = sanitizeName(brandInput.text) || "Brand";
            var campaign = sanitizeName(campaignInput.text) || "Campaign";
            var quarter = quarterDropdown.selection ? quarterDropdown.selection.text : "Q1";
            var size = t.width + "x" + t.height;
            var version = "V" + (parseInt(versionInput.text) || 1);
            var revision = "R" + (parseInt(revisionInput.text) || 1);

            var filename;
            if (isDOOHTemplate(t.name)) {
                filename = "DOOH_" + (campaign || brand) + "_" + size + "_" + version + "_" + revision + ".aep";
            } else {
                filename = brand + "_" + campaign + "_" + quarter + "_" + size + "_" + version + "_" + revision + ".aep";
            }
            previewText.text = filename;
        }

        // Check for existing files and auto-increment version
        function checkVersion() {
            if (!templateDropdown.selection) return;
            var t = templates[templateDropdown.selection.index];
            var brand = sanitizeName(brandInput.text) || "Brand";
            var campaign = sanitizeName(campaignInput.text) || "Campaign";
            var quarter = quarterDropdown.selection ? quarterDropdown.selection.text : "Q1";
            var size = t.width + "x" + t.height;
            var revision = "R" + (parseInt(revisionInput.text) || 1);

            var saveFolder = getDefaultSaveFolder();
            var isDOOH = isDOOHTemplate(t.name);
            var maxV = 50; // Safety limit
            var foundV = 1;

            for (var v = 1; v <= maxV; v++) {
                var filename;
                if (isDOOH) {
                    filename = "DOOH_" + (campaign || brand) + "_" + size + "_V" + v + "_" + revision + ".aep";
                } else {
                    filename = brand + "_" + campaign + "_" + quarter + "_" + size + "_V" + v + "_" + revision + ".aep";
                }

                if (fileExists(saveFolder + "/" + filename)) {
                    foundV = v + 1; // Suggest next version
                } else {
                    break; // Found free slot
                }
            }

            versionInput.text = String(foundV);
            updatePreview();
        }

        // Event bindings
        brandInput.onChanging = campaignInput.onChanging = versionInput.onChanging = revisionInput.onChanging = updatePreview;
        // Trigger smart versioning when finishing input
        brandInput.onChange = campaignInput.onChange = quarterDropdown.onChange = function () { checkVersion(); };
        templateDropdown.onChange = function () { updateStatus(); checkVersion(); }; // Update preview called inside checkVersion

        regenBtn.onClick = function () {
            if (!confirm("Regenerate ALL templates?\nFolder: " + templatesFolder)) return;
            setStatus("Regenerating...", [0.6, 0.6, 0.6]);
            for (var i = 0; i < templates.length; i++) templates[i].path = "";
            var result = ensureTemplatesExist(templates, templatesFolder);
            templates = result.templates;
            setStatus("Generated " + result.generated.length, [0.5, 0.8, 0.5]);
            refreshDropdown();
            updateStatus();
        };

        folderBtn.onClick = function () {
            var f = Folder.selectDialog("Select Templates Folder");
            if (f) {
                templatesFolder = f.fsName;
                setSetting(TEMPLATES_FOLDER_KEY, templatesFolder);
                setStatus("Folder updated", [0.5, 0.8, 0.5]);
            }
        };

        addBtn.onClick = function () {
            var newT = showTemplateDialog({ name: "", width: 1920, height: 1080, fps: 24, duration: 15, path: "" }, true);
            if (newT) {
                templates.push(newT);
                saveTemplates(templates);
                refreshDropdown();
                templateDropdown.selection = templates.length - 1;
                updateStatus();
                updatePreview();
            }
        };

        editBtn.onClick = function () {
            if (!templateDropdown.selection) return;
            var idx = templateDropdown.selection.index;
            var edited = showTemplateDialog(templates[idx], false);
            if (edited) {
                templates[idx] = edited;
                saveTemplates(templates);
                refreshDropdown();
                templateDropdown.selection = idx;
                updateStatus();
                updatePreview();
            }
        };

        delBtn.onClick = function () {
            if (!templateDropdown.selection) return;
            var idx = templateDropdown.selection.index;
            if (!confirm("Delete '" + templates[idx].name + "'?")) return;
            templates.splice(idx, 1);
            saveTemplates(templates);
            refreshDropdown();
            updateStatus();
            updatePreview();
        };

        createBtn.onClick = function () {
            if (!templateDropdown.selection) return;
            var t = templates[templateDropdown.selection.index];
            if (!t.path || !fileExists(t.path)) {
                alert("Template not ready. Click 'Regenerate' first.");
                return;
            }

            var brand = sanitizeName(brandInput.text);
            var campaign = sanitizeName(campaignInput.text) || "Campaign";
            if (!brand) { alert("Enter a Brand name."); return; }

            var quarter = quarterDropdown.selection ? quarterDropdown.selection.text : "Q1";
            var size = t.width + "x" + t.height;
            var version = "V" + (parseInt(versionInput.text) || 1);
            var revision = "R" + (parseInt(revisionInput.text) || 1);

            var suggestedName;
            if (isDOOHTemplate(t.name)) {
                suggestedName = "DOOH_" + (campaign || brand) + "_" + size + "_" + version + "_" + revision + ".aep";
            } else {
                suggestedName = brand + "_" + campaign + "_" + quarter + "_" + size + "_" + version + "_" + revision + ".aep";
            }

            try {
                if (app.project) app.project.close(CloseOptions.PROMPT_TO_SAVE_CHANGES);
                app.open(new File(t.path));

                var defFolder = new Folder(getDefaultSaveFolder());
                var saveFile = new File(defFolder.fsName + "/" + suggestedName).saveDlg("Save New Project As");

                if (!saveFile) {
                    app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
                    return;
                }

                var savePath = saveFile.fsName.replace(/\.aep$/i, "") + ".aep"; // Ensure only one .aep
                saveFile = new File(savePath);

                if (isSameFolder(savePath, t.path)) {
                    alert("Cannot save to templates folder.");
                    app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
                    return;
                }

                setSetting(DEFAULT_SAVE_FOLDER_KEY, getParentFolder(savePath));
                app.project.save(saveFile);

                var mainComp = findMainComp();
                if (mainComp) mainComp.openInViewer();

                if (panel instanceof Window) panel.close();
            } catch (e) { alert("Error: " + e.toString()); }
        };

        saveAsBtn.onClick = function () {
            if (!app.project || !app.project.file) {
                alert("No project open.");
                return;
            }
            if (!templateDropdown.selection) return;
            var t = templates[templateDropdown.selection.index];

            var brand = sanitizeName(brandInput.text);
            var campaign = sanitizeName(campaignInput.text) || "Campaign";
            if (!brand) { alert("Enter a Brand name."); return; }

            var quarter = quarterDropdown.selection ? quarterDropdown.selection.text : "Q1";
            var size = t.width + "x" + t.height;
            var version = "V" + (parseInt(versionInput.text) || 1);
            var revision = "R" + (parseInt(revisionInput.text) || 1);

            var suggestedName;
            if (isDOOHTemplate(t.name)) {
                suggestedName = "DOOH_" + (campaign || brand) + "_" + size + "_" + version + "_" + revision;
            } else {
                suggestedName = brand + "_" + campaign + "_" + quarter + "_" + size + "_" + version + "_" + revision;
            }

            var saveFile = new File(app.project.file.parent.fsName + "/" + suggestedName + ".aep").saveDlg("Save Project As");
            if (saveFile) {
                var savePath = saveFile.fsName.replace(/\.aep$/i, "") + ".aep"; // Ensure only one .aep
                app.project.save(new File(savePath));
                alert("Project saved as:\n" + new File(savePath).name);

                // Update Inputs to match new file to keep in sync
                // already in sync because we just used them
            }
        };

        renderBtn.onClick = function () {
            if (!app.project || !app.project.file) {
                alert("No project open. Create or open a project first.");
                return;
            }

            var mainComp = findMainComp();
            if (!mainComp) {
                alert("Could not find 'Main' composition.");
                return;
            }

            var projectName = app.project.file.name.replace(/\.aep$/i, "");
            var type = getTemplateType(mainComp.width, mainComp.height);
            var parsed = parseProjectName(projectName);

            var renderName, formatInfo;

            if (type === "sunrise" && parsed && parsed.brand) {
                renderName = parsed.brand + "_" + parsed.campaign + "_CTA_AnimatedSunrise_" + parsed.version + "_" + parsed.revision;
                formatInfo = "PNG Sequence (RGB+Alpha)";
            } else if (type === "interscroller" && parsed && parsed.brand) {
                renderName = parsed.brand + "_" + parsed.campaign + "_CTA_InterScroller_" + parsed.version + "_" + parsed.revision;
                formatInfo = "MP4 (H.264)";
            } else if (type === "dooh" && parsed && parsed.prefix) {
                renderName = parsed.prefix + "_" + getDateString();
                formatInfo = "MP4 (H.264)";
            } else {
                renderName = projectName + "_" + getDateString();
                formatInfo = "MP4 (H.264)";
            }

            var outputFolder = app.project.file.parent.fsName;
            var rqItem = app.project.renderQueue.items.add(mainComp);
            rqItem.outputModule(1).file = new File(outputFolder + "/" + renderName);

            alert("Added to Render Queue!\n\nOutput: " + renderName + "\nFormat: " + formatInfo + "\n\nSelect your render preset in Render Queue.");
        };

        // Init
        // Auto-detect from open project
        if (app.project && app.project.file) {
            var currentName = app.project.file.name.replace(/\.aep$/i, "");
            var parsed = parseProjectName(currentName);
            var mainComp = findMainComp();

            if (parsed && parsed.brand) {
                // Determine template based on main comp size (most reliable)
                if (mainComp) {
                    var type = getTemplateType(mainComp.width, mainComp.height);
                    for (var i = 0; i < templates.length; i++) {
                        var t = templates[i];
                        if (type === "sunrise" && t.width === 750 && t.height === 300) { templateDropdown.selection = i; break; }
                        if (type === "interscroller" && t.width === 880 && t.height === 1912) { templateDropdown.selection = i; break; }
                        if (type === "dooh" && t.width === 1920 && t.height === 1080 && mainComp.width === 1920) { templateDropdown.selection = i; break; }
                        if (type === "dooh" && t.width === 1080 && t.height === 1920 && mainComp.width === 1080) { templateDropdown.selection = i; break; }
                    }
                }

                // Pre-fill inputs
                brandInput.text = parsed.brand;
                if (parsed.campaign) campaignInput.text = parsed.campaign;
                if (parsed.version) versionInput.text = parsed.version.replace("V", "");
                if (parsed.revision) revisionInput.text = parsed.revision.replace("R", "");

                // Attempt to find quarter if present
                var parts = currentName.split("_");
                if (parts.length > 2) {
                    var q = parts[2]; // usually Brand_Camp_Q1_...
                    for (var x = 0; x < quarterDropdown.items.length; x++) {
                        if (quarterDropdown.items[x].text === q) {
                            quarterDropdown.selection = x;
                            break;
                        }
                    }
                }
            } else if (parsed && parsed.prefix && mainComp) {
                // DOOH format: DOOH_ProjectName...
                // Try to infer inputs
                var p = parsed.prefix.split("_");
                if (p.length >= 2) { // DOOH_Brand...
                    brandInput.text = p[1]; // Guess brand is second part
                }
            }
        }

        updateStatus();
        updatePreview();

        panel.onResizing = panel.onResize = function () { this.layout.resize(); };
        if (panel instanceof Window) { panel.center(); panel.show(); } else { panel.layout.layout(true); }

        return panel;
    }

    buildUI(thisObj);

})(this);
