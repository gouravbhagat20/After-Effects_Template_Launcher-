/*
================================================================================
  BigHappyLauncher_Templates.jsx
  After Effects ScriptUI Panel - Auto-Generated Templates
  
  Features:
  - Client Name & Project Name inputs
  - Auto-generated filenames
  - Auto-generate template .aep files
  - Protected templates (can't overwrite originals)
================================================================================
*/

(function (thisObj) {

    var SETTINGS_SECTION = "BigHappyLauncher";
    var TEMPLATES_KEY = "templates_data";
    var TEMPLATES_FOLDER_KEY = "templates_folder";
    var DEFAULT_SAVE_FOLDER_KEY = "default_save_folder";

    // Default templates configuration
    var DEFAULT_TEMPLATES = [
        { name: "Sunrise", width: 750, height: 300, fps: 24, duration: 15, path: "" },
        { name: "InterScroller", width: 880, height: 1912, fps: 24, duration: 15, path: "" },
        { name: "DOOH Horizontal", width: 1920, height: 1080, fps: 29.97, duration: 15, path: "" },
        { name: "DOOH Vertical", width: 1080, height: 1920, fps: 29.97, duration: 15, path: "" }
    ];

    // =========================================================================
    // STORAGE FUNCTIONS
    // =========================================================================

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
        } catch (e) {
            return false;
        }
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
            for (var key in obj) {
                if (obj.hasOwnProperty(key)) pairs.push('"' + key + '":' + jsonStringify(obj[key]));
            }
            return "{" + pairs.join(",") + "}";
        }
        return String(obj);
    }

    // =========================================================================
    // TEMPLATE GENERATION
    // =========================================================================

    function generateTemplateFile(template, folderPath) {
        try {
            if (app.project) {
                app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
            }

            app.newProject();

            // Create folder structure
            var screensFolder = app.project.items.addFolder("Screens");
            var pngFolder = app.project.items.addFolder("png");
            var imageFolder = app.project.items.addFolder("Image");
            var compsFolder = app.project.items.addFolder("Comps");

            // Create Main comp
            var mainComp = app.project.items.addComp(
                "Main",
                template.width,
                template.height,
                1,
                template.duration,
                template.fps
            );
            mainComp.parentFolder = compsFolder;

            // Guide text
            var textLayer = mainComp.layers.addText(template.name + "\n" + template.width + "x" + template.height + " | " + template.fps + "fps | " + template.duration + "s");
            textLayer.property("Position").setValue([template.width / 2, template.height / 2]);

            // Save
            var fileName = template.name.replace(/\s+/g, "_") + "_" + template.width + "x" + template.height + ".aep";
            var filePath = folderPath + "/" + fileName;
            app.project.save(new File(filePath));
            app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);

            return filePath;
        } catch (e) {
            return null;
        }
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
    // HELPERS
    // =========================================================================

    function fileExists(path) {
        if (!path) return false;
        return new File(path).exists;
    }

    function getParentFolder(filePath) {
        var f = new File(filePath);
        return f.parent ? f.parent.fsName : "";
    }

    function isSameFolder(path1, path2) {
        return getParentFolder(path1).toLowerCase() === getParentFolder(path2).toLowerCase();
    }

    function getTemplateLabel(t) {
        return t.name + " (" + t.width + "x" + t.height + " | " + t.fps + "fps)";
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

    function getDateString() {
        var d = new Date();
        var m = d.getMonth() + 1;
        var day = d.getDate();
        return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
    }

    // =========================================================================
    // TEMPLATE DIALOG
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
        btnGroup.add("button", undefined, "OK", { name: "ok" });
        btnGroup.add("button", undefined, "Cancel", { name: "cancel" });

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

        var panel;
        if (thisObj instanceof Panel) {
            panel = thisObj;
        } else {
            panel = new Window("palette", "Big Happy Launcher", undefined, { resizeable: true });
        }

        panel.orientation = "column";
        panel.alignChildren = ["fill", "top"];
        panel.spacing = 4;
        panel.margins = 10;

        // Header
        var title = panel.add("statictext", undefined, "BIG HAPPY LAUNCHER");
        title.alignment = ["center", "top"];
        try { title.graphics.font = ScriptUI.newFont("Arial", "BOLD", 13); } catch (e) { }

        // =====================================================================
        // PROJECT INFO SECTION
        // =====================================================================
        var infoPanel = panel.add("panel", undefined, "Project Info");
        infoPanel.alignment = ["fill", "top"];
        infoPanel.alignChildren = ["fill", "top"];
        infoPanel.margins = 10;
        infoPanel.spacing = 6;

        // Brand
        var brandGroup = infoPanel.add("group");
        brandGroup.add("statictext", undefined, "Brand:");
        var brandInput = brandGroup.add("edittext", undefined, "");
        brandInput.characters = 15;
        brandInput.alignment = ["fill", "center"];

        // Campaign
        var campaignGroup = infoPanel.add("group");
        campaignGroup.add("statictext", undefined, "Campaign:");
        var campaignInput = campaignGroup.add("edittext", undefined, "");
        campaignInput.characters = 15;
        campaignInput.alignment = ["fill", "center"];

        // Quarter
        var quarterGroup = infoPanel.add("group");
        quarterGroup.add("statictext", undefined, "Quarter:");
        var quarterDropdown = quarterGroup.add("dropdownlist", undefined, ["Q1", "Q2", "Q3", "Q4"]);
        quarterDropdown.selection = 0;
        quarterDropdown.alignment = ["fill", "center"];

        // Version & Revision
        var versionGroup = infoPanel.add("group");
        versionGroup.add("statictext", undefined, "Version:");
        var versionInput = versionGroup.add("edittext", undefined, "1");
        versionInput.characters = 3;
        versionGroup.add("statictext", undefined, "Revision:");
        var revisionInput = versionGroup.add("edittext", undefined, "1");
        revisionInput.characters = 3;

        // Preview filename
        var previewText = infoPanel.add("statictext", undefined, "Filename: [Enter Brand]");
        previewText.alignment = ["fill", "top"];
        try { previewText.graphics.foregroundColor = previewText.graphics.newPen(previewText.graphics.PenType.SOLID_COLOR, [0.5, 0.7, 0.9], 1); } catch (e) { }

        // =====================================================================
        // TEMPLATE SECTION
        // =====================================================================
        var templatePanel = panel.add("panel", undefined, "Template");
        templatePanel.alignment = ["fill", "top"];
        templatePanel.alignChildren = ["fill", "top"];
        templatePanel.margins = 10;

        var templateDropdown = templatePanel.add("dropdownlist", undefined, []);
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

        // =====================================================================
        // STATUS SECTION
        // =====================================================================
        var pathPanel = panel.add("panel", undefined, "Status");
        pathPanel.alignment = ["fill", "top"];
        pathPanel.alignChildren = ["fill", "top"];
        pathPanel.margins = 10;

        var statusIcon = pathPanel.add("statictext", undefined, "");
        var pathText = pathPanel.add("statictext", undefined, "", { truncate: "middle" });
        pathText.preferredSize.height = 16;

        function updatePathDisplay() {
            if (templates.length === 0 || !templateDropdown.selection) {
                statusIcon.text = "No templates";
                pathText.text = "";
                return;
            }
            var t = templates[templateDropdown.selection.index];
            if (!t.path) {
                statusIcon.text = "[ Not Generated ]";
                pathText.text = "Click 'Generate All Templates'";
                try { statusIcon.graphics.foregroundColor = statusIcon.graphics.newPen(statusIcon.graphics.PenType.SOLID_COLOR, [0.9, 0.7, 0.3], 1); } catch (e) { }
            } else if (fileExists(t.path)) {
                statusIcon.text = "Ready";
                pathText.text = t.path;
                try { statusIcon.graphics.foregroundColor = statusIcon.graphics.newPen(statusIcon.graphics.PenType.SOLID_COLOR, [0.4, 0.75, 0.4], 1); } catch (e) { }
            } else {
                statusIcon.text = "File Missing";
                pathText.text = t.path;
                try { statusIcon.graphics.foregroundColor = statusIcon.graphics.newPen(statusIcon.graphics.PenType.SOLID_COLOR, [0.9, 0.4, 0.4], 1); } catch (e) { }
            }
        }

        // Update preview filename
        function updatePreview() {
            var brand = sanitizeName(brandInput.text) || "Brand";
            var campaign = sanitizeName(campaignInput.text) || "Campaign";
            var quarter = quarterDropdown.selection ? quarterDropdown.selection.text : "Q1";
            var size = "";
            var version = "V" + (parseInt(versionInput.text) || 1);
            var revision = "R" + (parseInt(revisionInput.text) || 1);

            if (templateDropdown.selection && templates.length > 0) {
                var t = templates[templateDropdown.selection.index];
                size = t.width + "x" + t.height;
            }

            // Format: Brand_Campaign_Quarter_Dimensions_V#_R#
            var filename = brand + "_" + campaign + "_" + quarter + "_" + size + "_" + version + "_" + revision + ".aep";
            previewText.text = filename;
        }

        brandInput.onChanging = updatePreview;
        campaignInput.onChanging = updatePreview;
        quarterDropdown.onChange = function () {
            updatePreview();
        };
        versionInput.onChanging = updatePreview;
        revisionInput.onChanging = updatePreview;
        templateDropdown.onChange = function () {
            updatePathDisplay();
            updatePreview();
        };

        updatePathDisplay();
        updatePreview();

        // =====================================================================
        // ACTIONS SECTION
        // =====================================================================
        var actionPanel = panel.add("panel", undefined, "Actions");
        actionPanel.alignment = ["fill", "top"];
        actionPanel.alignChildren = ["fill", "top"];
        actionPanel.margins = 10;
        actionPanel.spacing = 6;

        var newProjectBtn = actionPanel.add("button", undefined, "New Project from Template");
        newProjectBtn.preferredSize.height = 32;

        var generateBtn = actionPanel.add("button", undefined, "Generate All Templates");
        generateBtn.preferredSize.height = 24;

        // =====================================================================
        // MANAGE SECTION
        // =====================================================================
        var managePanel = panel.add("panel", undefined, "Manage");
        managePanel.alignment = ["fill", "top"];
        managePanel.alignChildren = ["fill", "top"];
        managePanel.margins = 10;
        managePanel.spacing = 6;

        var manageRow = managePanel.add("group");
        manageRow.alignment = ["fill", "top"];
        manageRow.spacing = 4;

        var addBtn = manageRow.add("button", undefined, "Add");
        addBtn.alignment = ["fill", "center"];
        var editBtn = manageRow.add("button", undefined, "Edit");
        editBtn.alignment = ["fill", "center"];
        var deleteBtn = manageRow.add("button", undefined, "Delete");
        deleteBtn.alignment = ["fill", "center"];

        var folderBtn = managePanel.add("button", undefined, "Change Templates Folder...");
        folderBtn.preferredSize.height = 22;

        var folderText = managePanel.add("statictext", undefined, "Folder: " + templatesFolder, { truncate: "middle" });
        try { folderText.graphics.foregroundColor = folderText.graphics.newPen(folderText.graphics.PenType.SOLID_COLOR, [0.5, 0.5, 0.5], 1); } catch (e) { }

        // Status
        var statusText = panel.add("statictext", undefined, "Templates are protected");
        statusText.alignment = ["fill", "bottom"];
        try { statusText.graphics.foregroundColor = statusText.graphics.newPen(statusText.graphics.PenType.SOLID_COLOR, [0.5, 0.5, 0.5], 1); } catch (e) { }

        // =====================================================================
        // HANDLERS
        // =====================================================================

        generateBtn.onClick = function () {
            if (!confirm("Generate ALL template .aep files?\n\nFolder: " + templatesFolder)) return;
            statusText.text = "Generating...";
            for (var i = 0; i < templates.length; i++) templates[i].path = "";
            var result = ensureTemplatesExist(templates, templatesFolder);
            templates = result.templates;
            statusText.text = "Generated " + result.generated.length + " templates";
            refreshDropdown();
            updatePathDisplay();
        };

        folderBtn.onClick = function () {
            var folder = Folder.selectDialog("Select Templates Folder");
            if (folder) {
                templatesFolder = folder.fsName;
                setTemplatesFolder(templatesFolder);
                folderText.text = "Folder: " + templatesFolder;
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

            if (!t.path || !fileExists(t.path)) {
                alert("Template not ready.\n\nClick 'Generate All Templates' first.");
                return;
            }

            // Build filename: Brand_Campaign_Quarter_Dimensions_V#_R#
            var brand = sanitizeName(brandInput.text) || "Brand";
            var campaign = sanitizeName(campaignInput.text) || "Campaign";
            var quarter = quarterDropdown.selection ? quarterDropdown.selection.text : "Q1";
            var size = t.width + "x" + t.height;
            var version = "V" + (parseInt(versionInput.text) || 1);
            var revision = "R" + (parseInt(revisionInput.text) || 1);

            var suggestedName = brand + "_" + campaign + "_" + quarter + "_" + size + "_" + version + "_" + revision + ".aep";

            try {
                app.open(new File(t.path));

                var saveFile = null;
                var valid = false;
                var defaultFolder = new Folder(getDefaultSaveFolder());

                while (!valid) {
                    saveFile = new File(defaultFolder.fsName + "/" + suggestedName).saveDlg("Save New Project As");

                    if (!saveFile) {
                        if (confirm("You must save to a new location.\n\nOK = Close\nCancel = Try again")) {
                            app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
                            return;
                        }
                        continue;
                    }

                    var savePath = saveFile.fsName;
                    if (savePath.toLowerCase().indexOf(".aep") === -1) savePath += ".aep";
                    saveFile = new File(savePath);

                    if (isSameFolder(savePath, t.path)) {
                        alert("Cannot save to templates folder.");
                        continue;
                    }

                    valid = true;
                }

                // Remember folder for next time
                setDefaultSaveFolder(getParentFolder(saveFile.fsName));

                app.project.save(saveFile);

                // Open Main comp
                for (var i = 1; i <= app.project.numItems; i++) {
                    var item = app.project.item(i);
                    if (item instanceof CompItem && item.name === "Main") {
                        item.openInViewer();
                        break;
                    }
                }

                // Close panel
                if (panel instanceof Window) panel.close();

            } catch (e) {
                alert("Error: " + e.toString());
            }
        };

        // Resize
        panel.onResizing = panel.onResize = function () { this.layout.resize(); };

        if (panel instanceof Window) {
            panel.center();
            panel.show();
        } else {
            panel.layout.layout(true);
        }

        return panel;
    }

    buildUI(thisObj);

})(this);
