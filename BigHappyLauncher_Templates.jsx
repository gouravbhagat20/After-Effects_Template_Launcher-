/*
================================================================================
  BigHappyLauncher_Templates.jsx
  After Effects ScriptUI Panel - Production Ready v2.1
  
  CHANGELOG v2.1:
  - Fixed AME export: now uses app.project.renderQueue.queueInAME(true) instead
    of unreliable BridgeTalk. Falls back to AE Render Queue if unavailable.
  - Improved parseProjectName(): parses from END with required size pattern
    (_<width>x<height>_V#_R#). Handles underscores in Brand/Campaign correctly.
  - Fixed template reorder UX: Up/Down buttons now call updateStatus() and
    updatePreview() after reordering.
  - Corrected format claims: says "format depends on Output Module preset"
    instead of claiming specific formats.
  
  CHANGELOG v2.0:
  - Added joinPath() for cross-platform path handling (Win/Mac)
  - Implemented robust regex-based parseProjectName()
  - Added input validation in Add/Edit Template dialog
  - Added Duplicate Template button
  - Added Move Up/Down buttons for template reordering
  - Added AME export option with fallback to AE Render Queue
  - Added comprehensive try/catch error handling
  - Refactored code into clear sections
  - Fixed all hardcoded "/" path separators
  
  Features:
  - Cross-platform (Windows + macOS)
  - Auto-generate template .aep files
  - Smart naming by template type
  - Render queue automation + AME export
  - Template management (Add/Edit/Delete/Duplicate/Reorder)
  - Auto-detect project details on open
================================================================================
*/

(function (thisObj) {

    // =========================================================================
    // SECTION 1: CONFIGURATION & SETTINGS
    // =========================================================================

    var SETTINGS_SECTION = "BigHappyLauncher";
    var TEMPLATES_KEY = "templates_data";
    var TEMPLATES_FOLDER_KEY = "templates_folder";
    var DEFAULT_SAVE_FOLDER_KEY = "default_save_folder";
    var AME_ENABLED_KEY = "ame_enabled";

    var DEFAULT_TEMPLATES = [
        { name: "Sunrise", width: 750, height: 300, fps: 24, duration: 15, path: "" },
        { name: "InterScroller", width: 880, height: 1912, fps: 24, duration: 15, path: "" },
        { name: "DOOH Horizontal", width: 1920, height: 1080, fps: 29.97, duration: 15, path: "" },
        { name: "DOOH Vertical", width: 1080, height: 1920, fps: 29.97, duration: 15, path: "" }
    ];

    // Validation limits
    var LIMITS = {
        WIDTH_MIN: 1, WIDTH_MAX: 8192,
        HEIGHT_MIN: 1, HEIGHT_MAX: 8192,
        FPS_MIN: 1, FPS_MAX: 120,
        DURATION_MIN: 0.1, DURATION_MAX: 3600
    };

    // =========================================================================
    // SECTION 2: PATH & IO UTILITIES
    // =========================================================================

    // Get separator with fallback - Folder.separator can be undefined at load time
    function getSeparator() {
        try {
            if (Folder.separator) return Folder.separator;
        } catch (e) { }
        // Fallback: detect OS
        return ($.os && $.os.indexOf("Windows") !== -1) ? "\\" : "/";
    }
    var SEP = getSeparator();

    function joinPath(a, b) {
        if (!a) return b;
        if (!b) return a;
        // Ensure SEP is valid
        var sep = SEP || "\\";
        // Remove trailing separator from a, leading from b
        a = String(a).replace(/[\/\\]$/, "");
        b = String(b).replace(/^[\/\\]/, "");
        return a + sep + b;
    }

    function fileExists(path) {
        try {
            return path && new File(path).exists;
        } catch (e) {
            return false;
        }
    }

    function getParentFolder(path) {
        try {
            var f = new File(path);
            return f.parent ? f.parent.fsName : "";
        } catch (e) {
            return "";
        }
    }

    function isSameFolder(p1, p2) {
        return getParentFolder(p1).toLowerCase() === getParentFolder(p2).toLowerCase();
    }

    // =========================================================================
    // SECTION 2B: SETTINGS HELPERS
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
        try {
            app.settings.saveSetting(SETTINGS_SECTION, key, String(value));
        } catch (e) { }
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
        return getSetting(TEMPLATES_FOLDER_KEY, joinPath(Folder.myDocuments.fsName, "BH_Templates"));
    }

    function getDefaultSaveFolder() {
        return getSetting(DEFAULT_SAVE_FOLDER_KEY, Folder.myDocuments.fsName);
    }

    // =========================================================================
    // SECTION 2C: JSON STRINGIFY (ES3 Compatible)
    // =========================================================================

    function jsonStringify(obj) {
        if (obj === null) return "null";
        if (typeof obj === "undefined") return "null";
        if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
        if (typeof obj === "string") {
            return '"' + obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
        }
        if (obj instanceof Array) {
            var arr = [];
            for (var i = 0; i < obj.length; i++) {
                arr.push(jsonStringify(obj[i]));
            }
            return "[" + arr.join(",") + "]";
        }
        if (typeof obj === "object") {
            var pairs = [];
            for (var k in obj) {
                if (obj.hasOwnProperty(k)) {
                    pairs.push('"' + k + '":' + jsonStringify(obj[k]));
                }
            }
            return "{" + pairs.join(",") + "}";
        }
        return String(obj);
    }

    // =========================================================================
    // SECTION 3: NAMING & PARSING
    // =========================================================================

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
        var pad = function (n) { return n < 10 ? "0" + n : String(n); };
        return pad(d.getMonth() + 1) + pad(d.getDate()) + d.getFullYear();
    }

    function getTemplateLabel(t) {
        return t.name + " (" + t.width + "x" + t.height + " | " + t.fps + "fps)";
    }

    /**
     * Detect template type by dimensions
     * @param {number} width
     * @param {number} height
     * @returns {string} "sunrise" | "interscroller" | "dooh" | "default"
     */
    function getTemplateType(width, height) {
        if (width === 750 && height === 300) return "sunrise";
        if (width === 880 && height === 1912) return "interscroller";
        if ((width === 1920 && height === 1080) || (width === 1080 && height === 1920)) return "dooh";
        return "default";
    }

    function isDOOHTemplate(name) {
        return name.toLowerCase().indexOf("dooh") !== -1;
    }

    /**
     * Robust project name parser - parses from the END
     * 
     * REQUIRED pattern at end: _<width>x<height>_V<n>_R<n>
     * 
     * Supported formats:
     * - Standard: Brand_Campaign_Q#_<size>_V#_R#
     * - Standard without quarter: Brand_Campaign_<size>_V#_R#
     * - DOOH: DOOH_<anything>_<size>_V#_R#
     * 
     * Handles underscores in Brand/Campaign by parsing from END first.
     * 
     * @param {string} projectName - Filename without .aep extension
     * @returns {object|null} Parsed components or null if pattern not matched
     */
    function parseProjectName(projectName) {
        if (!projectName) return null;

        var result = {};
        var remaining = projectName;

        // Step 1: Extract _V#_R# from end (REQUIRED)
        var versionMatch = remaining.match(/_V(\d+)_R(\d+)$/i);
        if (!versionMatch) {
            return null; // Pattern not matched
        }
        result.version = "V" + versionMatch[1];
        result.revision = "R" + versionMatch[2];
        remaining = remaining.replace(/_V\d+_R\d+$/i, "");

        // Step 2: Extract _<width>x<height> from end (REQUIRED)
        var sizeMatch = remaining.match(/_(\d+x\d+)$/i);
        if (!sizeMatch) {
            return null; // Size is required
        }
        result.size = sizeMatch[1];
        remaining = remaining.replace(/_\d+x\d+$/i, "");

        // Step 3: Check for DOOH prefix
        if (remaining.match(/^DOOH/i)) {
            result.isDOOH = true;
            // prefix = everything before _<size>_V#_R#
            result.prefix = projectName.replace(/_\d+x\d+_V\d+_R\d+$/i, "");
            // campaign = everything after "DOOH_"
            var doohContent = remaining.replace(/^DOOH_?/i, "");
            if (doohContent) {
                result.campaign = doohContent;
            }
            return result;
        }

        // Step 4: Extract _Q# quarter (OPTIONAL, for standard format)
        var quarterMatch = remaining.match(/_Q([1-4])$/i);
        if (quarterMatch) {
            result.quarter = "Q" + quarterMatch[1];
            remaining = remaining.replace(/_Q[1-4]$/i, "");
        }

        // Step 5: Split remaining into Brand and Campaign
        // Remaining is now "Brand_Campaign" or "Brand_Some_Long_Campaign" or just "Brand"
        var firstUnderscore = remaining.indexOf("_");
        if (firstUnderscore > 0) {
            result.brand = remaining.substring(0, firstUnderscore);
            result.campaign = remaining.substring(firstUnderscore + 1);
        } else {
            result.brand = remaining;
            result.campaign = "";
        }

        result.isDOOH = false;
        return result;
    }

    // =========================================================================
    // SECTION 4: TEMPLATE MANAGEMENT
    // =========================================================================

    function findMainComp() {
        try {
            for (var i = 1; i <= app.project.numItems; i++) {
                var item = app.project.item(i);
                if (item instanceof CompItem && item.name === "Main") return item;
            }
        } catch (e) { }
        return null;
    }

    function generateTemplateFile(template, folderPath) {
        try {
            if (app.project) {
                app.project.close(CloseOptions.PROMPT_TO_SAVE_CHANGES);
            }
            app.newProject();

            app.project.items.addFolder("Screens");
            app.project.items.addFolder("png");
            app.project.items.addFolder("Image");
            var compsFolder = app.project.items.addFolder("Comps");

            var mainComp = app.project.items.addComp("Main", template.width, template.height, 1, template.duration, template.fps);
            mainComp.parentFolder = compsFolder;

            // Create two separate text layers to avoid leading/overlap issues
            var titleText = template.name;
            var detailsText = template.width + "x" + template.height + " | " + template.fps + "fps | " + template.duration + "s";

            // Title layer (top)
            var titleLayer = mainComp.layers.addText(titleText);
            try {
                var titleProp = titleLayer.property("Source Text");
                var titleDoc = titleProp.value;
                titleDoc.fontSize = 55;
                titleDoc.tracking = -10;
                titleDoc.justification = ParagraphJustification.CENTER_JUSTIFY;
                titleDoc.fillColor = [1, 0, 0];
                titleProp.setValue(titleDoc);
            } catch (e) { }
            titleLayer.property("Position").setValue([template.width / 2, template.height / 2 - 35]);

            // Details layer (bottom)
            var detailsLayer = mainComp.layers.addText(detailsText);
            try {
                var detailsProp = detailsLayer.property("Source Text");
                var detailsDoc = detailsProp.value;
                detailsDoc.fontSize = 55;
                detailsDoc.tracking = -10;
                detailsDoc.justification = ParagraphJustification.CENTER_JUSTIFY;
                detailsDoc.fillColor = [1, 0, 0];
                detailsProp.setValue(detailsDoc);
            } catch (e) { }
            detailsLayer.property("Position").setValue([template.width / 2, template.height / 2 + 35]);

            var fileName = template.name.replace(/\s+/g, "_") + "_" + template.width + "x" + template.height + ".aep";
            var filePath = joinPath(folderPath, fileName);

            app.project.save(new File(filePath));
            app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);

            return filePath;
        } catch (e) {
            alert("Error generating template:\n" + e.toString());
            return null;
        }
    }

    function ensureTemplatesExist(templates, folderPath, forceRegenerate) {
        var folder = new Folder(folderPath);
        if (!folder.exists) folder.create();

        var generated = [];
        for (var i = 0; i < templates.length; i++) {
            var t = templates[i];

            var expectedName = t.name.replace(/\s+/g, "_") + "_" + t.width + "x" + t.height + ".aep";
            var expectedPath = joinPath(folderPath, expectedName);

            // If force regenerate, delete existing file first
            if (forceRegenerate) {
                try {
                    var existingFile = new File(expectedPath);
                    if (existingFile.exists) existingFile.remove();
                } catch (e) { }
            } else {
                // Skip if file already exists
                if (t.path && new File(t.path).exists) continue;
                if (new File(expectedPath).exists) {
                    templates[i].path = expectedPath;
                    generated.push(t.name);
                    continue;
                }
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
    // SECTION 5: DIALOGS
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

        // Validation info
        var infoText = dlg.add("statictext", undefined, "Width/Height: 1-8192 | FPS: 1-120 | Duration: 0.1-3600");
        try { infoText.graphics.foregroundColor = infoText.graphics.newPen(infoText.graphics.PenType.SOLID_COLOR, [0.5, 0.5, 0.5], 1); } catch (e) { }

        var btnGrp = dlg.add("group");
        btnGrp.alignment = ["center", "top"];
        var okBtn = btnGrp.add("button", undefined, "OK", { name: "ok" });
        btnGrp.add("button", undefined, "Cancel", { name: "cancel" });

        var result = null;

        okBtn.onClick = function () {
            var name = nameInput.text.replace(/^\s+|\s+$/g, "");
            if (!name) {
                alert("Please enter a template name.");
                return;
            }

            var width = parseInt(widthInput.text, 10);
            var height = parseInt(heightInput.text, 10);
            var fps = parseFloat(fpsInput.text);
            var duration = parseFloat(durInput.text);

            // Validation
            if (isNaN(width) || width < LIMITS.WIDTH_MIN || width > LIMITS.WIDTH_MAX) {
                alert("Width must be a number between " + LIMITS.WIDTH_MIN + " and " + LIMITS.WIDTH_MAX);
                return;
            }
            if (isNaN(height) || height < LIMITS.HEIGHT_MIN || height > LIMITS.HEIGHT_MAX) {
                alert("Height must be a number between " + LIMITS.HEIGHT_MIN + " and " + LIMITS.HEIGHT_MAX);
                return;
            }
            if (isNaN(fps) || fps < LIMITS.FPS_MIN || fps > LIMITS.FPS_MAX) {
                alert("FPS must be a number between " + LIMITS.FPS_MIN + " and " + LIMITS.FPS_MAX);
                return;
            }
            if (isNaN(duration) || duration < LIMITS.DURATION_MIN || duration > LIMITS.DURATION_MAX) {
                alert("Duration must be a number between " + LIMITS.DURATION_MIN + " and " + LIMITS.DURATION_MAX);
                return;
            }

            result = {
                name: name,
                width: width,
                height: height,
                fps: fps,
                duration: duration,
                path: template.path || ""
            };
            dlg.close();
        };

        dlg.show();
        return result;
    }

    // =========================================================================
    // SECTION 6: RENDER & EXPORT
    // =========================================================================

    /**
     * Check if queueInAME is available (AE CC 2014+)
     */
    function canQueueInAME() {
        try {
            return typeof app.project.renderQueue.queueInAME === "function";
        } catch (e) {
            return false;
        }
    }

    /**
     * Add composition to Render Queue
     * @param {CompItem} comp
     * @param {string} outputPath - Full path without extension (extension set by Output Module)
     * @returns {RenderQueueItem|null}
     */
    function addToRenderQueue(comp, outputPath) {
        try {
            var rqItem = app.project.renderQueue.items.add(comp);
            var om = rqItem.outputModule(1);
            om.file = new File(outputPath);
            return rqItem;
        } catch (e) {
            alert("Error adding to Render Queue:\n" + e.toString());
            return null;
        }
    }

    /**
     * Queue to Adobe Media Encoder using queueInAME(true)
     * This is the most reliable method for AME export in After Effects.
     * @returns {boolean} success
     */
    function queueToAME() {
        try {
            if (canQueueInAME()) {
                // queueInAME(true) sends all queued items to AME and renders immediately
                app.project.renderQueue.queueInAME(true);
                return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    // =========================================================================
    // SECTION 7: BUILD UI
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
        templateDropdown.helpTip = "Select a template with predefined dimensions, FPS, and duration";

        function refreshDropdown() {
            var prevIdx = templateDropdown.selection ? templateDropdown.selection.index : 0;
            templateDropdown.removeAll();
            for (var i = 0; i < templates.length; i++) {
                templateDropdown.add("item", getTemplateLabel(templates[i]));
            }
            if (templates.length > 0) {
                templateDropdown.selection = Math.min(prevIdx, templates.length - 1);
            }
        }
        refreshDropdown();

        var brandInput = addRow(mainGrp, "Brand:", "");
        brandInput.helpTip = "Enter the brand/client name (required)";
        var campaignInput = addRow(mainGrp, "Campaign:", "");
        campaignInput.helpTip = "Enter the campaign or project name";

        // Quarter row
        var qRow = mainGrp.add("group");
        qRow.orientation = "row";
        qRow.alignChildren = ["left", "center"];
        var qLbl = qRow.add("statictext", undefined, "Quarter:");
        qLbl.preferredSize.width = 65;
        var quarterDropdown = qRow.add("dropdownlist", undefined, ["Q1", "Q2", "Q3", "Q4"]);
        quarterDropdown.selection = 0;
        quarterDropdown.preferredSize.width = 70;
        quarterDropdown.helpTip = "Select the fiscal quarter for this project";

        // Version & Revision row
        var vrRow = mainGrp.add("group");
        vrRow.orientation = "row";
        vrRow.alignChildren = ["left", "center"];
        var verLbl = vrRow.add("statictext", undefined, "Version:");
        verLbl.preferredSize.width = 65;
        var versionInput = vrRow.add("edittext", undefined, "1");
        versionInput.preferredSize.width = 50;
        versionInput.helpTip = "Major version number (for significant creative changes)";
        var revLbl = vrRow.add("statictext", undefined, "Revision:");
        revLbl.preferredSize.width = 60;
        var revisionInput = vrRow.add("edittext", undefined, "1");
        revisionInput.preferredSize.width = 50;
        revisionInput.helpTip = "Revision number (auto-increments for minor tweaks)";

        // Divider
        var div = panel.add("panel", [0, 0, 100, 1]);
        div.alignment = ["fill", "top"];

        // Preview
        var previewText = panel.add("statictext", undefined, "Filename: ...");
        previewText.alignment = ["center", "top"];
        try { previewText.graphics.foregroundColor = previewText.graphics.newPen(previewText.graphics.PenType.SOLID_COLOR, [0.4, 0.7, 1], 1); } catch (e) { }

        // Main buttons
        var btnGroup = panel.add("group");
        btnGroup.orientation = "row";
        btnGroup.alignChildren = ["fill", "top"];
        btnGroup.spacing = 5;
        btnGroup.alignment = ["fill", "top"];

        var createBtn = btnGroup.add("button", undefined, "CREATE");
        createBtn.preferredSize.height = 35;
        createBtn.preferredSize.width = 100;
        createBtn.helpTip = "Create a new project from the selected template";
        try { createBtn.graphics.font = ScriptUI.newFont("Arial", "BOLD", 13); } catch (e) { }

        var saveAsBtn = btnGroup.add("button", undefined, "SAVE AS...");
        saveAsBtn.preferredSize.height = 35;
        saveAsBtn.helpTip = "Save the current project with the generated filename";
        try { saveAsBtn.graphics.font = ScriptUI.newFont("Arial", "BOLD", 13); } catch (e) { }

        // Status
        var statusText = panel.add("statictext", undefined, "Ready");
        statusText.alignment = ["center", "top"];
        try { statusText.graphics.font = ScriptUI.newFont("Arial", "REGULAR", 10); } catch (e) { }

        // Template management row 1
        var tmplMgmt1 = panel.add("group");
        tmplMgmt1.orientation = "row";
        tmplMgmt1.alignChildren = ["center", "center"];
        tmplMgmt1.spacing = 3;

        var addBtn = tmplMgmt1.add("button", undefined, "+");
        addBtn.preferredSize = [25, 22];
        addBtn.helpTip = "Add a new template";
        var editBtn = tmplMgmt1.add("button", undefined, "Edit");
        editBtn.preferredSize = [40, 22];
        editBtn.helpTip = "Edit selected template settings";
        var dupBtn = tmplMgmt1.add("button", undefined, "Dup");
        dupBtn.preferredSize = [35, 22];
        dupBtn.helpTip = "Duplicate selected template";
        var delBtn = tmplMgmt1.add("button", undefined, "Del");
        delBtn.preferredSize = [35, 22];
        delBtn.helpTip = "Delete selected template";
        var upBtn = tmplMgmt1.add("button", undefined, "▲");
        upBtn.preferredSize = [22, 22];
        upBtn.helpTip = "Move template up in list";
        var downBtn = tmplMgmt1.add("button", undefined, "▼");
        downBtn.preferredSize = [22, 22];
        downBtn.helpTip = "Move template down in list";

        // Template management row 2
        var tmplMgmt2 = panel.add("group");
        tmplMgmt2.orientation = "row";
        tmplMgmt2.alignChildren = ["center", "center"];
        tmplMgmt2.spacing = 5;

        var regenBtn = tmplMgmt2.add("button", undefined, "Regenerate");
        regenBtn.preferredSize.height = 22;
        regenBtn.helpTip = "Regenerate all template .aep files (use if templates are missing)";
        var folderBtn = tmplMgmt2.add("button", undefined, "Folder...");
        folderBtn.preferredSize.height = 22;
        folderBtn.helpTip = "Choose folder where template files are stored";

        // AME checkbox
        var ameGrp = panel.add("group");
        ameGrp.alignment = ["center", "top"];
        var ameCheckbox = ameGrp.add("checkbox", undefined, "Send to AME after queuing");
        ameCheckbox.value = getSetting(AME_ENABLED_KEY, "false") === "true";
        ameCheckbox.helpTip = "Send render to Adobe Media Encoder (renders in background, keeps AE free)";

        // Render button
        var renderBtn = panel.add("button", undefined, "ADD TO RENDER QUEUE");
        renderBtn.preferredSize.height = 28;
        renderBtn.alignment = ["fill", "top"];
        renderBtn.helpTip = "Add the Main comp to the render queue with auto-generated output name";
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

        function buildFilename(brand, campaign, quarter, size, version, revision, isDOOH) {
            if (isDOOH) {
                return "DOOH_" + (campaign || brand) + "_" + size + "_" + version + "_" + revision + ".aep";
            } else {
                return brand + "_" + campaign + "_" + quarter + "_" + size + "_" + version + "_" + revision + ".aep";
            }
        }

        function updatePreview() {
            if (!templateDropdown.selection) return;
            var t = templates[templateDropdown.selection.index];
            var brand = sanitizeName(brandInput.text) || "Brand";
            var campaign = sanitizeName(campaignInput.text) || "Campaign";
            var quarter = quarterDropdown.selection ? quarterDropdown.selection.text : "Q1";
            var size = t.width + "x" + t.height;
            var version = "V" + (parseInt(versionInput.text, 10) || 1);
            var revision = "R" + (parseInt(revisionInput.text, 10) || 1);

            var filename = buildFilename(brand, campaign, quarter, size, version, revision, isDOOHTemplate(t.name));
            previewText.text = filename;
        }

        function checkRevision() {
            if (!templateDropdown.selection) return;
            var t = templates[templateDropdown.selection.index];
            var brand = sanitizeName(brandInput.text) || "Brand";
            var campaign = sanitizeName(campaignInput.text) || "Campaign";
            var quarter = quarterDropdown.selection ? quarterDropdown.selection.text : "Q1";
            var size = t.width + "x" + t.height;
            var version = "V" + (parseInt(versionInput.text, 10) || 1);

            var saveFolder = getDefaultSaveFolder();
            var isDOOH = isDOOHTemplate(t.name);
            var maxR = 50;
            var foundR = 1;

            // Find next available revision for the current version
            for (var r = 1; r <= maxR; r++) {
                var filename = buildFilename(brand, campaign, quarter, size, version, "R" + r, isDOOH);
                if (fileExists(joinPath(saveFolder, filename))) {
                    foundR = r + 1;
                } else {
                    break;
                }
            }

            revisionInput.text = String(foundR);
            updatePreview();
        }

        // Event bindings
        brandInput.onChanging = campaignInput.onChanging = versionInput.onChanging = revisionInput.onChanging = updatePreview;
        brandInput.onChange = campaignInput.onChange = quarterDropdown.onChange = function () { checkRevision(); };
        templateDropdown.onChange = function () { updateStatus(); checkRevision(); };

        // When Version is manually changed, reset Revision to 1 and find next available
        versionInput.onChange = function () {
            revisionInput.text = "1";
            checkRevision();
        };

        ameCheckbox.onClick = function () {
            setSetting(AME_ENABLED_KEY, String(ameCheckbox.value));
        };

        regenBtn.onClick = function () {
            if (!confirm("Regenerate ALL templates?\\nThis will delete and recreate template files.\\nFolder: " + templatesFolder)) return;
            setStatus("Regenerating...", [0.6, 0.6, 0.6]);
            for (var i = 0; i < templates.length; i++) templates[i].path = "";
            var result = ensureTemplatesExist(templates, templatesFolder, true); // Force regenerate
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

        dupBtn.onClick = function () {
            if (!templateDropdown.selection) return;
            var idx = templateDropdown.selection.index;
            var orig = templates[idx];
            var copy = {
                name: orig.name + " Copy",
                width: orig.width,
                height: orig.height,
                fps: orig.fps,
                duration: orig.duration,
                path: "" // New template needs regeneration
            };
            templates.splice(idx + 1, 0, copy);
            saveTemplates(templates);
            refreshDropdown();
            templateDropdown.selection = idx + 1;
            updateStatus();
            updatePreview();
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

        upBtn.onClick = function () {
            if (!templateDropdown.selection) return;
            var idx = templateDropdown.selection.index;
            if (idx === 0) return; // Already at top
            var temp = templates[idx];
            templates[idx] = templates[idx - 1];
            templates[idx - 1] = temp;
            saveTemplates(templates);
            refreshDropdown();
            templateDropdown.selection = idx - 1;
            updateStatus();
            updatePreview();
        };

        downBtn.onClick = function () {
            if (!templateDropdown.selection) return;
            var idx = templateDropdown.selection.index;
            if (idx >= templates.length - 1) return; // Already at bottom
            var temp = templates[idx];
            templates[idx] = templates[idx + 1];
            templates[idx + 1] = temp;
            saveTemplates(templates);
            refreshDropdown();
            templateDropdown.selection = idx + 1;
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
            var version = "V" + (parseInt(versionInput.text, 10) || 1);
            var revision = "R" + (parseInt(revisionInput.text, 10) || 1);

            var suggestedName = buildFilename(brand, campaign, quarter, size, version, revision, isDOOHTemplate(t.name));

            try {
                if (app.project) app.project.close(CloseOptions.PROMPT_TO_SAVE_CHANGES);
                app.open(new File(t.path));

                var defFolder = new Folder(getDefaultSaveFolder());
                var saveFile = new File(joinPath(defFolder.fsName, suggestedName)).saveDlg("Save New Project As");

                if (!saveFile) {
                    app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
                    return;
                }

                var savePath = saveFile.fsName.replace(/\.aep$/i, "") + ".aep";
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
            } catch (e) {
                alert("Error creating project:\n" + e.toString());
            }
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
            var version = "V" + (parseInt(versionInput.text, 10) || 1);
            var revision = "R" + (parseInt(revisionInput.text, 10) || 1);

            var suggestedName = buildFilename(brand, campaign, quarter, size, version, revision, isDOOHTemplate(t.name));
            suggestedName = suggestedName.replace(/\.aep$/i, ""); // Remove .aep for dialog

            var saveFile = new File(joinPath(app.project.file.parent.fsName, suggestedName + ".aep")).saveDlg("Save Project As");
            if (saveFile) {
                try {
                    var savePath = saveFile.fsName.replace(/\.aep$/i, "") + ".aep";
                    app.project.save(new File(savePath));
                    alert("Project saved as:\n" + new File(savePath).name);
                } catch (e) {
                    alert("Error saving project:\n" + e.toString());
                }
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

            var renderName;

            if (type === "sunrise" && parsed && parsed.brand) {
                // Sunrise: Brand_Campaign_CTA_AnimatedSunrise_V#_R#
                renderName = parsed.brand + "_" + (parsed.campaign || "Campaign") + "_CTA_AnimatedSunrise_" + parsed.version + "_" + parsed.revision;
            } else if (type === "interscroller" && parsed && parsed.brand) {
                // InterScroller: Brand_Campaign_CTA_InterScroller_V#_R#
                renderName = parsed.brand + "_" + (parsed.campaign || "Campaign") + "_CTA_InterScroller_" + parsed.version + "_" + parsed.revision;
            } else if (type === "dooh" || (parsed && parsed.isDOOH)) {
                // DOOH: DOOH_ProjectName_Size_MMDDYYYY
                var doohSize = mainComp.width + "x" + mainComp.height;
                var doohName = (parsed && parsed.campaign) ? parsed.campaign : projectName.replace(/^DOOH_?/i, "").replace(/_\d+x\d+.*$/i, "");
                renderName = "DOOH_" + doohName + "_" + doohSize + "_" + getDateString();
            } else {
                // Default: ProjectName_MMDDYYYY
                renderName = projectName + "_" + getDateString();
            }

            var outputFolder = app.project.file.parent.fsName;
            var outputPath = joinPath(outputFolder, renderName);

            // Add to AE Render Queue first
            var rqItem = addToRenderQueue(mainComp, outputPath);
            if (!rqItem) return;

            // Check if user wants to send to AME
            if (ameCheckbox.value) {
                if (canQueueInAME()) {
                    if (queueToAME()) {
                        alert("Sent to Adobe Media Encoder!\n\nOutput: " + renderName + "\n\nFormat depends on AME preset settings.");
                        return;
                    } else {
                        alert("Failed to send to AME.\nItem remains in AE Render Queue.");
                    }
                } else {
                    alert("queueInAME not available in this AE version.\nItem added to AE Render Queue instead.\n\nOutput: " + renderName);
                    return;
                }
            }

            // Standard RQ alert
            alert("Added to Render Queue!\n\nOutput: " + renderName + "\n\nFormat depends on your Output Module preset.");
        };

        // =====================================================================
        // INIT: Auto-detect from open project
        // =====================================================================
        if (app.project && app.project.file) {
            try {
                var currentName = app.project.file.name.replace(/\.aep$/i, "");
                var parsed = parseProjectName(currentName);
                var mainComp = findMainComp();

                if (parsed && parsed.brand) {
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

                    brandInput.text = parsed.brand;
                    if (parsed.campaign) campaignInput.text = parsed.campaign;
                    if (parsed.version) versionInput.text = parsed.version.replace(/^V/i, "");
                    if (parsed.revision) revisionInput.text = parsed.revision.replace(/^R/i, "");

                    if (parsed.quarter) {
                        for (var x = 0; x < quarterDropdown.items.length; x++) {
                            if (quarterDropdown.items[x].text === parsed.quarter) {
                                quarterDropdown.selection = x;
                                break;
                            }
                        }
                    }
                } else if (parsed && parsed.isDOOH && mainComp) {
                    if (parsed.campaign) {
                        brandInput.text = parsed.campaign;
                    }
                }
            } catch (e) { }
        }

        updateStatus();
        updatePreview();

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

/*
================================================================================
  HOW TO INSTALL & RUN
================================================================================

1. SAVE THE FILE:
   - Save this file as "BigHappyLauncher_Templates.jsx"

2. INSTALL LOCATION (choose one):
   
   A) For Panel (recommended - dockable):
      - macOS: /Applications/Adobe After Effects [version]/Scripts/ScriptUI Panels/
      - Windows: C:\Program Files\Adobe\Adobe After Effects [version]\Support Files\Scripts\ScriptUI Panels\
   
   B) For Script (run once):
      - macOS: /Applications/Adobe After Effects [version]/Scripts/
      - Windows: C:\Program Files\Adobe\Adobe After Effects [version]\Support Files\Scripts\

3. ENABLE SCRIPT ACCESS:
   - After Effects > Preferences > Scripting & Expressions
   - Enable "Allow Scripts to Write Files and Access Network"

4. RUN THE PANEL:
   - Restart After Effects
   - Go to Window > BigHappyLauncher_Templates.jsx
   - Dock the panel wherever you prefer

5. FIRST RUN:
   - Click "Regenerate" to create template .aep files
   - The templates will be saved to Documents/BH_Templates/

================================================================================
*/
