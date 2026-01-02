/*
================================================================================
  BigHappyLauncher_Templates.jsx
  After Effects ScriptUI Panel - Auto-Generated Templates
  
  Features:
  - Minimalist UI (Groups instead of Panels)
  - Auto-generate template .aep files
  - Template Protection (Save As)
  - Brand & Campaign Inputs
  - Auto-generated filenames (Brand_Campaign_Q#_Size_V#_R#)
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

    function loadTemplates() {
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, TEMPLATES_KEY)) {
                var data = app.settings.getSetting(SETTINGS_SECTION, TEMPLATES_KEY);
                var templates = eval("(" + data + ")");
                if (templates && templates.length > 0) return templates;
            }
        } catch (e) { }
        return DEFAULT_TEMPLATES.slice();
    }

    function saveTemplates(templates) {
        try {
            app.settings.saveSetting(SETTINGS_SECTION, TEMPLATES_KEY, jsonStringify(templates));
            return true;
        } catch (e) { return false; }
    }

    function getTemplatesFolder() {
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, TEMPLATES_FOLDER_KEY)) {
                return app.settings.getSetting(SETTINGS_SECTION, TEMPLATES_FOLDER_KEY);
            }
        } catch (e) { }
        return Folder.myDocuments.fsName + "/BH_Templates";
    }

    function setTemplatesFolder(path) {
        app.settings.saveSetting(SETTINGS_SECTION, TEMPLATES_FOLDER_KEY, path);
    }

    function getDefaultSaveFolder() {
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, DEFAULT_SAVE_FOLDER_KEY)) {
                return app.settings.getSetting(SETTINGS_SECTION, DEFAULT_SAVE_FOLDER_KEY);
            }
        } catch (e) { }
        return Folder.myDocuments.fsName;
    }

    function setDefaultSaveFolder(path) {
        app.settings.saveSetting(SETTINGS_SECTION, DEFAULT_SAVE_FOLDER_KEY, path);
    }

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
            for (var key in obj) { if (obj.hasOwnProperty(key)) pairs.push('"' + key + '":' + jsonStringify(obj[key])); }
            return "{" + pairs.join(",") + "}";
        }
        return String(obj);
    }

    // =========================================================================
    // ASSET & FILE LOGIC
    // =========================================================================

    function generateTemplateFile(template, folderPath) {
        try {
            if (app.project) app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
            app.newProject();

            var screensFolder = app.project.items.addFolder("Screens");
            var pngFolder = app.project.items.addFolder("png");
            var imageFolder = app.project.items.addFolder("Image");
            var compsFolder = app.project.items.addFolder("Comps");

            var mainComp = app.project.items.addComp("Main", template.width, template.height, 1, template.duration, template.fps);
            mainComp.parentFolder = compsFolder;

            var textLayer = mainComp.layers.addText(template.name + "\n" + template.width + "x" + template.height + " | " + template.fps + "fps | " + template.duration + "s");
            textLayer.property("Position").setValue([template.width / 2, template.height / 2]);

            // Default save location for templates
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

    function sanitizeName(name) {
        var result = "";
        var invalid = "<>:\"/\\|?*";
        for (var i = 0; i < name.length; i++) {
            var c = name.charAt(i);
            if (invalid.indexOf(c) === -1 && name.charCodeAt(i) >= 32) {
                result += (c === " ") ? "_" : c;
            }
        }
        return result;
    }

    function fileExists(path) { return path && new File(path).exists; }
    function getParentFolder(filePath) { var f = new File(filePath); return f.parent ? f.parent.fsName : ""; }
    function isSameFolder(path1, path2) { return getParentFolder(path1).toLowerCase() === getParentFolder(path2).toLowerCase(); }
    function getTemplateLabel(t) { return t.name + " (" + t.width + "x" + t.height + " | " + t.fps + "fps)"; }

    // =========================================================================
    // DIALOGS
    // =========================================================================

    function showTemplateDialog(template, isNew) {
        var dlg = new Window("dialog", isNew ? "Add Template" : "Edit Template");
        dlg.orientation = "column";
        dlg.alignChildren = ["fill", "top"];
        dlg.spacing = 10;
        dlg.margins = 20;

        var nameGroup = dlg.add("group");
        nameGroup.add("statictext", undefined, "Name:");
        var nameInput = nameGroup.add("edittext", undefined, template.name || "");
        nameInput.characters = 20;

        var dimGroup = dlg.add("group");
        dimGroup.add("statictext", undefined, "Width:");
        var widthInput = dimGroup.add("edittext", undefined, String(template.width || 1920));
        widthInput.characters = 6;
        dimGroup.add("statictext", undefined, "Height:");
        var heightInput = dimGroup.add("edittext", undefined, String(template.height || 1080));
        heightInput.characters = 6;

        var fpsGroup = dlg.add("group");
        fpsGroup.add("statictext", undefined, "FPS:");
        var fpsInput = fpsGroup.add("edittext", undefined, String(template.fps || 24));
        fpsInput.characters = 8;
        fpsGroup.add("statictext", undefined, "Duration:");
        var durInput = fpsGroup.add("edittext", undefined, String(template.duration || 15));
        durInput.characters = 6;

        var btnGroup = dlg.add("group");
        btnGroup.alignment = ["center", "top"];
        var okBtn = btnGroup.add("button", undefined, "OK", { name: "ok" });
        var cancelBtn = btnGroup.add("button", undefined, "Cancel", { name: "cancel" });

        var result = null;
        okBtn.onClick = function () {
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
        cancelBtn.onClick = function () { dlg.close(); };
        dlg.show();
        return result;
    }

    // =========================================================================
    // BUILD UI
    // =========================================================================

    function buildUI(thisObj) {
        var templates = loadTemplates();
        var templatesFolder = getTemplatesFolder();

        var panel;
        if (thisObj instanceof Panel) {
            panel = thisObj;
        } else {
            panel = new Window("palette", "Big Happy Launcher", undefined, { resizeable: true });
        }

        panel.orientation = "column";
        panel.alignChildren = ["fill", "top"];
        panel.spacing = 10;
        panel.margins = 15;

        // --- TITLE ---
        var title = panel.add("statictext", undefined, "BIG HAPPY LAUNCHER");
        title.alignment = ["center", "top"];
        try { title.graphics.font = ScriptUI.newFont("Arial", "BOLD", 14); } catch (e) { }

        // --- MAIN INPUTS ---
        var mainGroup = panel.add("group");
        mainGroup.orientation = "column";
        mainGroup.alignChildren = ["fill", "top"];
        mainGroup.spacing = 5;

        function addInputRow(parent, labelText, defaultText) {
            var grp = parent.add("group");
            grp.orientation = "row";
            grp.alignChildren = ["left", "center"];
            var lbl = grp.add("statictext", undefined, labelText);
            lbl.preferredSize.width = 65;
            var inp = grp.add("edittext", undefined, defaultText);
            inp.alignment = ["fill", "center"];
            return inp;
        }

        // --- TEMPLATE ---
        var tmplGroup = mainGroup.add("group");
        tmplGroup.orientation = "row";
        tmplGroup.alignChildren = ["left", "center"];
        var tmplLabel = tmplGroup.add("statictext", undefined, "Template:");
        tmplLabel.preferredSize.width = 65;
        var templateDropdown = tmplGroup.add("dropdownlist", undefined, []);
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

        var brandInput = addInputRow(mainGroup, "Brand:", "");
        var campaignInput = addInputRow(mainGroup, "Campaign:", "");

        // --- DETAILS ROW (Q + V + R) ---
        var detailsGroup = mainGroup.add("group");
        detailsGroup.orientation = "row";
        detailsGroup.alignChildren = ["left", "center"];

        detailsGroup.add("statictext", undefined, "Quarter:");
        var quarterDropdown = detailsGroup.add("dropdownlist", undefined, ["Q1", "Q2", "Q3", "Q4"]);
        quarterDropdown.selection = 0;
        quarterDropdown.preferredSize.width = 60;

        detailsGroup.add("statictext", undefined, "  Ver:");
        var versionInput = detailsGroup.add("edittext", undefined, "1");
        versionInput.preferredSize.width = 40;

        detailsGroup.add("statictext", undefined, "Rev:");
        var revisionInput = detailsGroup.add("edittext", undefined, "1");
        revisionInput.preferredSize.width = 40;

        // Divider
        var div = panel.add("panel", [0, 0, 100, 1], undefined);
        div.alignment = ["fill", "top"];

        // --- PREVIEW ---
        var previewText = panel.add("statictext", undefined, "Filename: ...");
        previewText.alignment = ["center", "top"];
        try { previewText.graphics.foregroundColor = previewText.graphics.newPen(previewText.graphics.PenType.SOLID_COLOR, [0.4, 0.7, 1], 1); } catch (e) { }

        // --- MAIN BUTTON ---
        var newProjectBtn = panel.add("button", undefined, "CREATE PROJECT");
        newProjectBtn.preferredSize.height = 35;
        newProjectBtn.alignment = ["fill", "top"];
        try { newProjectBtn.graphics.font = ScriptUI.newFont("Arial", "BOLD", 13); } catch (e) { }

        // Status Line
        var statusText = panel.add("statictext", undefined, "Ready");
        statusText.alignment = ["center", "top"];
        try { statusText.graphics.font = ScriptUI.newFont("Arial", "REGULAR", 10); } catch (e) { }
        try { statusText.graphics.foregroundColor = statusText.graphics.newPen(statusText.graphics.PenType.SOLID_COLOR, [0.6, 0.6, 0.6], 1); } catch (e) { }

        // --- UTILITIES (Footer) ---
        var utilsGroup = panel.add("group");
        utilsGroup.orientation = "row";
        utilsGroup.alignChildren = ["center", "center"];
        utilsGroup.spacing = 2;

        var addBtn = utilsGroup.add("button", undefined, "+");
        addBtn.preferredSize.width = 25;
        var editBtn = utilsGroup.add("button", undefined, "Edit");
        editBtn.preferredSize.width = 40;
        var deleteBtn = utilsGroup.add("button", undefined, "Del");
        deleteBtn.preferredSize.width = 40;

        utilsGroup.add("statictext", undefined, "|");

        var generateBtn = utilsGroup.add("button", undefined, "Regenerate Assets");
        generateBtn.preferredSize.height = 20;

        var folderBtn = utilsGroup.add("button", undefined, "Folder...");
        folderBtn.preferredSize.height = 20;

        // --- RENDER BUTTON ---
        var renderBtn = panel.add("button", undefined, "ADD TO RENDER QUEUE");
        renderBtn.preferredSize.height = 28;
        renderBtn.alignment = ["fill", "top"];
        try { renderBtn.graphics.font = ScriptUI.newFont("Arial", "BOLD", 11); } catch (e) { }

        // =====================================================================
        // LOGIC
        // =====================================================================

        function updatePathDisplay() {
            if (templates.length === 0 || !templateDropdown.selection) {
                statusText.text = "No templates selected";
                return;
            }
            var t = templates[templateDropdown.selection.index];
            if (!t.path || !fileExists(t.path)) {
                statusText.text = "Template missing (Click Regenerate Assets)";
                try { statusText.graphics.foregroundColor = statusText.graphics.newPen(statusText.graphics.PenType.SOLID_COLOR, [0.9, 0.5, 0.2], 1); } catch (e) { }
            } else {
                statusText.text = "Ready: " + t.name;
                try { statusText.graphics.foregroundColor = statusText.graphics.newPen(statusText.graphics.PenType.SOLID_COLOR, [0.5, 0.8, 0.5], 1); } catch (e) { }
            }
        }

        function getDateString() {
            var d = new Date();
            var mm = String(d.getMonth() + 1);
            if (mm.length < 2) mm = "0" + mm;
            var dd = String(d.getDate());
            if (dd.length < 2) dd = "0" + dd;
            var yyyy = String(d.getFullYear());
            return mm + dd + yyyy;
        }

        function isDOOHTemplate(templateName) {
            return templateName.toLowerCase().indexOf("dooh") !== -1;
        }

        function updatePreview() {
            var brand = sanitizeName(brandInput.text) || "Brand";
            var campaign = sanitizeName(campaignInput.text) || "Campaign";
            var quarter = quarterDropdown.selection ? quarterDropdown.selection.text : "Q1";
            var size = "0x0";
            var version = "V" + (parseInt(versionInput.text) || 1);
            var revision = "R" + (parseInt(revisionInput.text) || 1);
            var filename = "";

            if (templateDropdown.selection && templates.length > 0) {
                var t = templates[templateDropdown.selection.index];
                size = t.width + "x" + t.height;

                if (isDOOHTemplate(t.name)) {
                    // DOOH AE format: DOOH_ProjectName_Size_V#_R#
                    var projectName = campaign || brand;
                    filename = "DOOH_" + projectName + "_" + size + "_" + version + "_" + revision + ".aep";
                } else {
                    // Standard format: Brand_Campaign_Quarter_Size_V#_R#
                    filename = brand + "_" + campaign + "_" + quarter + "_" + size + "_" + version + "_" + revision + ".aep";
                }
            } else {
                filename = brand + "_" + campaign + "_" + quarter + "_" + size + "_" + version + "_" + revision + ".aep";
            }

            previewText.text = filename;
        }

        brandInput.onChanging = updatePreview;
        campaignInput.onChanging = updatePreview;
        quarterDropdown.onChange = updatePreview;
        versionInput.onChanging = updatePreview;
        revisionInput.onChanging = updatePreview;
        templateDropdown.onChange = function () { updatePathDisplay(); updatePreview(); };

        generateBtn.onClick = function () {
            if (!confirm("Regenerate ALL template assets?\n\nFolder: " + templatesFolder)) return;
            statusText.text = "Regenerating...";
            for (var i = 0; i < templates.length; i++) templates[i].path = "";
            var result = ensureTemplatesExist(templates, templatesFolder);
            templates = result.templates;
            statusText.text = "Generated " + result.generated.length + " templates";
            refreshDropdown();
            updatePathDisplay();
        };

        folderBtn.onClick = function () {
            var f = Folder.selectDialog("Select Templates Folder");
            if (f) {
                templatesFolder = f.fsName;
                setTemplatesFolder(templatesFolder);
                statusText.text = "Folder updated";
                // Optionally regenerate on folder change or just update
            }
        };

        addBtn.onClick = function () {
            var newT = showTemplateDialog({ name: "", width: 1920, height: 1080, fps: 24, duration: 15, path: "" }, true);
            if (newT) {
                templates.push(newT);
                saveTemplates(templates);
                refreshDropdown();
                templateDropdown.selection = templates.length - 1;
                updatePathDisplay();
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
                updatePathDisplay();
                updatePreview();
            }
        };

        deleteBtn.onClick = function () {
            if (!templateDropdown.selection) return;
            var idx = templateDropdown.selection.index;
            if (!confirm("Delete '" + templates[idx].name + "'?")) return;
            templates.splice(idx, 1);
            saveTemplates(templates);
            refreshDropdown();
            updatePathDisplay();
            updatePreview();
        };

        newProjectBtn.onClick = function () {
            if (!templateDropdown.selection) return;
            var t = templates[templateDropdown.selection.index];
            if (!t.path || !fileExists(t.path)) { alert("Template not ready.\nClick 'Regenerate Assets' first."); return; }

            var brand = sanitizeName(brandInput.text);
            var campaign = sanitizeName(campaignInput.text) || "Campaign";
            if (!brand) { alert("Please enter a Brand name."); return; }

            var quarter = quarterDropdown.selection ? quarterDropdown.selection.text : "Q1";
            var size = t.width + "x" + t.height;
            var version = "V" + (parseInt(versionInput.text) || 1);
            var revision = "R" + (parseInt(revisionInput.text) || 1);
            var suggestedName;

            if (isDOOHTemplate(t.name)) {
                // DOOH AE format: DOOH_ProjectName_Size_V#_R#
                var projectName = campaign || brand;
                suggestedName = "DOOH_" + projectName + "_" + size + "_" + version + "_" + revision + ".aep";
            } else {
                // Standard format
                suggestedName = brand + "_" + campaign + "_" + quarter + "_" + size + "_" + version + "_" + revision + ".aep";
            }

            try {
                if (app.project) app.project.close(CloseOptions.PROMPT_TO_SAVE_CHANGES);
                app.open(new File(t.path));

                // Save As Logic
                // Try to default to last used save folder
                var defaultFolder = new Folder(getDefaultSaveFolder());
                var saveFile = new File(defaultFolder.fsName + "/" + suggestedName).saveDlg("Save New Project As");

                if (!saveFile) {
                    app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
                    return;
                }

                var savePath = saveFile.fsName;
                if (savePath.toLowerCase().indexOf(".aep") === -1) savePath += ".aep";
                saveFile = new File(savePath);

                // Prevent saving to template folder
                if (isSameFolder(savePath, t.path)) { alert("Cannot save to templates folder."); return; }

                setDefaultSaveFolder(getParentFolder(savePath));
                app.project.save(saveFile);

                // Open Main
                for (var i = 1; i <= app.project.numItems; i++) {
                    var item = app.project.item(i);
                    if (item instanceof CompItem && item.name === "Main") {
                        item.openInViewer();
                        break;
                    }
                }

                if (panel instanceof Window) panel.close();

            } catch (e) { alert("Error: " + e.toString()); }
        };

        // --- RENDER QUEUE LOGIC ---
        renderBtn.onClick = function () {
            if (!app.project || !app.project.file) {
                alert("No project open. Create or open a project first.");
                return;
            }

            // Find Main comp
            var mainComp = null;
            for (var i = 1; i <= app.project.numItems; i++) {
                var item = app.project.item(i);
                if (item instanceof CompItem && item.name === "Main") {
                    mainComp = item;
                    break;
                }
            }

            if (!mainComp) {
                alert("Could not find 'Main' composition.");
                return;
            }

            // Detect template type from project filename
            var projectName = app.project.file.name.replace(/\.aep$/i, "");
            var isDOOH = projectName.toLowerCase().indexOf("dooh") !== -1;

            // Build render output name
            var renderName;
            if (isDOOH) {
                // Extract parts: DOOH_ProjectName_Size_V#_R# -> DOOH_ProjectName_Size_MMDDYYYY
                var parts = projectName.split("_");
                // Remove V#_R# at end, add date
                if (parts.length >= 4) {
                    // Keep DOOH, ProjectName, Size
                    var prefix = parts.slice(0, parts.length - 2).join("_");
                    renderName = prefix + "_" + getDateString();
                } else {
                    renderName = projectName + "_" + getDateString();
                }
            } else {
                // Non-DOOH: use project name + date
                renderName = projectName + "_" + getDateString();
            }

            // Get project folder for output
            var outputFolder = app.project.file.parent.fsName;
            var outputPath = outputFolder + "/" + renderName;

            // Add to Render Queue
            var rqItem = app.project.renderQueue.items.add(mainComp);
            var om = rqItem.outputModule(1);

            // Set output file
            om.file = new File(outputPath);

            alert("Added to Render Queue!\n\nOutput: " + renderName + ".mp4\n\nNote: Select your render preset in the Render Queue.");
        };

        // Init
        updatePathDisplay();
        updatePreview();

        panel.onResizing = panel.onResize = function () { this.layout.resize(); };
        if (panel instanceof Window) { panel.center(); panel.show(); } else { panel.layout.layout(true); }

        return panel;
    }

    buildUI(thisObj);

})(this);
