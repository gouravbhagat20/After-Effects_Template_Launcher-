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
    var RECENT_FILES_KEY = "recent_files";
    var BASE_WORK_FOLDER_KEY = "base_work_folder";
    var LOG_FILE_PATH = joinPath(Folder.myDocuments.fsName, "BigHappyLauncher_Log.txt");
    var MAX_RECENT_FILES = 10;

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
        DURATION_MIN: 0.1, DURATION_MAX: 3600,
        BRAND_MIN: 2, BRAND_MAX: 50,
        CAMPAIGN_MAX: 50,
        PATH_MAX: 240 // Windows approx limit
    };

    // Template-specific asset folder presets
    // Each template type gets different asset subfolders based on its needs
    var TEMPLATE_FOLDERS = {
        "sunrise": ["Image", "Screen"],
        "interscroller": ["Image", "Screen", "GIF"],
        "dooh_horizontal": ["Image", "Screen", "PNG"],
        "dooh_vertical": ["Image", "Screen", "PNG"],
        "default": ["Image", "Screen"]
    };

    // Template-specific render output formats
    // format: "png_sequence" = PNG with RGB+Alpha, "mp4" = H.264 MP4
    var TEMPLATE_RENDER_FORMATS = {
        "sunrise": { format: "png_sequence", outputModule: "PNG Sequence with Alpha" },
        "interscroller": { format: "mp4", outputModule: "H.264" },
        "dooh_horizontal": { format: "mp4", outputModule: "H.264" },
        "dooh_vertical": { format: "mp4", outputModule: "H.264" },
        "default": { format: "png_sequence", outputModule: "Lossless with Alpha" }
    };

    // =========================================================================
    // SECTION 1B: ERROR CODES & HANDLING
    // =========================================================================

    var ERROR_CODES = {
        // 1xxx - Template Errors
        "BH-1001": { msg: "Template file not found", fix: "Click 'Regenerate' to recreate template files" },
        "BH-1002": { msg: "Template folder does not exist", fix: "Click 'Folder...' to select or create a templates folder" },
        "BH-1003": { msg: "Failed to generate template file", fix: "Check disk space and folder permissions" },
        "BH-1004": { msg: "No templates available", fix: "Add a template using the '+' button" },
        "BH-1005": { msg: "Base work folder does not exist", fix: "Click '...' to select a valid base folder, or create it first" },

        // 2xxx - Project Errors
        "BH-2001": { msg: "Failed to save project", fix: "Check disk space, file permissions, or if file is in use" },
        "BH-2002": { msg: "Cannot save to templates folder", fix: "Choose a different folder - templates folder is protected" },
        "BH-2003": { msg: "No project currently open", fix: "Create a new project or open an existing one" },
        "BH-2004": { msg: "Failed to open template", fix: "Regenerate templates or check file permissions" },

        // 3xxx - Render Errors
        "BH-3001": { msg: "Main composition not found", fix: "Ensure your project has a composition named 'Main'" },
        "BH-3002": { msg: "Failed to add to Render Queue", fix: "Check After Effects render settings and try again" },
        "BH-3003": { msg: "Adobe Media Encoder not available", fix: "AME requires AE CC 2014+. Item added to AE Render Queue instead" },
        "BH-3004": { msg: "Failed to send to Adobe Media Encoder", fix: "Make sure AME is installed. Item remains in AE Render Queue" },

        // 4xxx - Input/Validation Errors
        "BH-4001": { msg: "Brand name is required", fix: "Enter a brand/client name in the Brand field" },
        "BH-4002": { msg: "Template name is required", fix: "Enter a name for the template" },
        "BH-4003": { msg: "Invalid width value", fix: "Width must be between " + LIMITS.WIDTH_MIN + " and " + LIMITS.WIDTH_MAX },
        "BH-4004": { msg: "Invalid height value", fix: "Height must be between " + LIMITS.HEIGHT_MIN + " and " + LIMITS.HEIGHT_MAX },
        "BH-4005": { msg: "Invalid FPS value", fix: "FPS must be between " + LIMITS.FPS_MIN + " and " + LIMITS.FPS_MAX },
        "BH-4006": { msg: "Invalid duration value", fix: "Duration must be between " + LIMITS.DURATION_MIN + " and " + LIMITS.DURATION_MAX + " seconds" },
        "BH-4007": { msg: "Brand name too short or too long", fix: "Brand must be " + LIMITS.BRAND_MIN + "-" + LIMITS.BRAND_MAX + " characters" },
        "BH-4008": { msg: "Campaign name too long", fix: "Campaign must be under " + LIMITS.CAMPAIGN_MAX + " characters" },

        // 5xxx - Settings Errors
        "BH-5001": { msg: "Failed to save settings", fix: "After Effects preferences may be locked or corrupted" },
        "BH-5002": { msg: "Failed to load templates data", fix: "Using default templates. Your custom templates may have been reset" }
    };

    /**
     * Show error alert with code, description, and solution
     * @param {string} code - Error code like "BH-1001"
     * @param {string} [details] - Optional additional details about the error
     */
    function showError(code, details) {
        var error = ERROR_CODES[code];

        // Log the error
        writeLog("ERROR: " + code + " - " + (error ? error.msg : "Unknown Error") + (details ? " | Details: " + details : ""), "ERROR");

        if (!error) {
            alert("Unknown Error\n\nCode: " + code + (details ? "\n\nDetails: " + details : ""));
            return;
        }

        var message = "Error " + code + "\n";
        message += "─────────────────────\n\n";
        message += error.msg + "\n\n";
        if (details) {
            message += "Details: " + details + "\n\n";
        }
        message += "Solution:\n" + error.fix;

        alert(message);
    }

    /**
     * Show warning (non-critical issue)
     * @param {string} code - Error code
     * @param {string} [details] - Optional details
     */
    function showWarning(code, details) {
        var error = ERROR_CODES[code];

        // Log the warning
        if (error) {
            writeLog("WARNING: " + code + " - " + error.msg + (details ? " | Details: " + details : ""), "WARN");
        }

        if (!error) return;

        var message = "Warning " + code + ": " + error.msg;
        if (details) message += "\n" + details;
        message += "\n\n" + error.fix;

        alert(message);
    }

    // =========================================================================
    // SECTION 1C: LOGGING
    // =========================================================================

    /**
     * Append message to log file with timestamp
     * @param {string} message - Message to log
     * @param {string} [level] - INFO, WARN, ERROR (default: INFO)
     */
    function writeLog(message, level) {
        try {
            var f = new File(LOG_FILE_PATH);
            var timestamp = new Date().toLocaleString();
            var logLine = "[" + timestamp + "] [" + (level || "INFO") + "] " + message;

            // Append to file
            f.open("a"); // Append mode
            f.encoding = "UTF-8";
            f.writeln(logLine);
            f.close();
        } catch (e) {
            // Fail silently if logging fails to avoid infinite loops
        }
    }

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
                var templates = jsonParse(data, null);
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

    function getBaseWorkFolder() {
        var defaultPath = ($.os && $.os.indexOf("Windows") !== -1)
            ? "C:\\Work\\Animate CC"
            : "~/Work/Animate CC";
        return getSetting(BASE_WORK_FOLDER_KEY, defaultPath);
    }

    function setBaseWorkFolder(path) {
        setSetting(BASE_WORK_FOLDER_KEY, path);
    }

    function getCurrentYear() {
        return new Date().getFullYear();
    }

    function getCurrentQuarter() {
        var month = new Date().getMonth(); // 0-11
        return Math.floor(month / 3); // 0-3
    }

    function folderExists(path) {
        try {
            return path && new Folder(path).exists;
        } catch (e) {
            return false;
        }
    }

    function createFolderRecursive(path) {
        try {
            var folder = new Folder(path);
            if (folder.exists) return true;
            return folder.create();
        } catch (e) {
            return false;
        }
    }

    function buildProjectFolderName(brand, campaign) {
        if (campaign && campaign.length > 0) {
            return brand + "_" + campaign;
        }
        return brand;
    }

    // =========================================================================
    // SECTION 2B.1: VALIDATION HELPERS
    // =========================================================================

    function sanitizeName(str) {
        if (!str) return "";
        return str.replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_");
    }

    function validateInput(text, type) {
        if (!text || text.length === 0) return { isValid: false, msg: "Required" };

        if (text.length > LIMITS.BRAND_MAX && type === "brand") return { isValid: false, msg: "Too long (>" + LIMITS.BRAND_MAX + ")" };
        if (text.length > LIMITS.CAMPAIGN_MAX && type === "campaign") return { isValid: false, msg: "Too long (>" + LIMITS.CAMPAIGN_MAX + ")" };

        var illegal = text.match(/[^a-zA-Z0-9_\-\s]/);
        if (illegal) return { isValid: false, msg: "Illegal char: '" + illegal[0] + "'" };

        var reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "LPT1"];
        if (reserved.indexOf(text.toUpperCase()) !== -1) return { isValid: false, msg: "Reserved name" };

        return { isValid: true, msg: "OK" };
    }

    // =========================================================================
    // SECTION 2C: RECENT FILES
    // =========================================================================

    function loadRecentFiles() {
        try {
            var data = getSetting(RECENT_FILES_KEY, "[]");
            var list = jsonParse(data, []);
            if (!list || !list.length) return [];
            // Filter out non-existing files to keep list clean
            var cleanList = [];
            for (var i = 0; i < list.length; i++) {
                if (fileExists(list[i])) cleanList.push(list[i]);
            }
            if (cleanList.length !== list.length) saveRecentFiles(cleanList);
            return cleanList;
        } catch (e) {
            return [];
        }
    }

    function saveRecentFiles(list) {
        setSetting(RECENT_FILES_KEY, jsonStringify(list));
    }

    function addToRecentFiles(path) {
        if (!path) return;
        var list = loadRecentFiles();

        // Remove if already exists (to move to top)
        for (var i = list.length - 1; i >= 0; i--) {
            if (list[i].toLowerCase() === path.toLowerCase()) {
                list.splice(i, 1);
            }
        }

        // Add to top
        list.unshift(path);

        // Limit size
        if (list.length > MAX_RECENT_FILES) {
            list = list.slice(0, MAX_RECENT_FILES);
        }

        saveRecentFiles(list);
    }

    // =========================================================================
    // SECTION 2D: JSON STRINGIFY & PARSE (ES3 Compatible)
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

    /**
     * Safe JSON parse with validation (ES3 compatible)
     * Only allows valid JSON-like structures, rejects dangerous code
     * @param {string} str - JSON string to parse
     * @param {*} defaultValue - Default value if parsing fails
     * @returns {*} Parsed object or defaultValue
     */
    function jsonParse(str, defaultValue) {
        if (!str || typeof str !== "string") return defaultValue;

        // Trim whitespace
        str = str.replace(/^\s+|\s+$/g, "");

        // Basic validation: must start with [ or {
        if (str.charAt(0) !== "[" && str.charAt(0) !== "{") {
            return defaultValue;
        }

        // Security check: reject strings containing dangerous patterns
        // Block function calls, assignments, and dangerous keywords
        var dangerous = /\b(function|eval|new\s+Function|setTimeout|setInterval|execScript|document|window|alert|this\.)\b/i;
        if (dangerous.test(str)) {
            return defaultValue;
        }

        // Block assignment operators and semicolons (code injection)
        if (/[;=](?!=)/.test(str) || /[+\-*\/]=/.test(str)) {
            return defaultValue;
        }

        try {
            // Wrap in parentheses for object literals
            var result = eval("(" + str + ")");
            return result;
        } catch (e) {
            return defaultValue;
        }
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
        if (width === 1920 && height === 1080) return "dooh_horizontal";
        if (width === 1080 && height === 1920) return "dooh_vertical";
        return "default";
    }

    /**
     * Get display-friendly template name for folder naming
     * @param {number} width
     * @param {number} height
     * @returns {string} Template name like "Sunrise", "DOOH-Horizontal", etc.
     */
    function getTemplateFolderName(width, height) {
        if (width === 750 && height === 300) return "Sunrise";
        if (width === 880 && height === 1912) return "InterScroller";
        if (width === 1920 && height === 1080) return "DOOH-Horizontal";
        if (width === 1080 && height === 1920) return "DOOH-Vertical";
        return "Custom";
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

        // Step 1: Extract optional V# and required R# from end
        // Matches: _V1_R1 OR _R1
        var versionMatch = remaining.match(/(?:_V(\d+))?_R(\d+)$/i);
        if (!versionMatch) {
            return null; // Pattern not matched (R# is strictly required)
        }

        result.version = versionMatch[1] ? ("V" + versionMatch[1]) : "V1"; // Default to V1 if missing
        result.revision = "R" + versionMatch[2];

        // Remove the matched suffix
        remaining = remaining.replace(/(?:_V\d+)?_R\d+$/i, "");

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
            // prefix = everything before suffix was removed
            // We need to reconstruct the prefix since we've been stripping from 'remaining'
            // The logic below for DOOH parsing needs to just look at what's left in 'remaining'

            // campaign = everything after "DOOH_"
            var doohContent = remaining.replace(/^DOOH_?/i, "");
            if (doohContent) {
                result.campaign = doohContent;
            }
            // Use remaining (without DOOH_) as campaign if present, or just generic
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
            app.beginUndoGroup("Generate Template: " + template.name);

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

            app.endUndoGroup();
            app.project.save(new File(filePath));
            app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);

            return filePath;
        } catch (e) {
            writeLog("Failed to generate template '" + template.name + "': " + e.toString(), "ERROR");
            showError("BH-1003", e.toString());
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
                writeLog("Generated template file: " + t.name, "INFO");
                templates[i].path = newPath;
                generated.push(t.name);
            }
        }
        if (generated.length > 0) saveTemplates(templates);
        return { templates: templates, generated: generated };
    }

    /**
     * Create project folder structure with error recovery
     * @param {string} basePath - Base work folder (e.g., C:\Work\Animate CC)
     * @param {string} year - Year (e.g., "2026")
     * @param {string} quarter - Quarter (e.g., "Q1")
     * @param {string} projectName - Project folder name (e.g., "Nike_SummerSale")
     * @param {string} size - Size folder name (e.g., "1920x1080")
     * @param {string} revision - Revision number (e.g., "R1")
     * @param {string} templateType - Template type for folder presets (e.g., "sunrise", "dooh")
     * @param {string} version - Version number (e.g., "V1")
     * @returns {object|null} Object with folder paths or null on failure
     */
    function createProjectStructure(basePath, year, quarter, projectName, size, revision, templateType, version) {
        // Validate base folder exists
        if (!folderExists(basePath)) {
            showError("BH-1005", basePath);
            return null;
        }

        var createdFolders = []; // Track created folders for cleanup

        try {
            // Build paths: BaseFolder/Year/Quarter/Brand_Campaign/TemplateName_WIDTHxHEIGHT/V#/
            var projectRoot = joinPath(joinPath(joinPath(basePath, String(year)), quarter), projectName);
            var sizeFolder = joinPath(projectRoot, size);
            var versionFolder = joinPath(sizeFolder, version);
            var aeFolder = joinPath(versionFolder, "AE_File");
            var publishedFolder = joinPath(aeFolder, "Render_" + revision);
            var assetsFolder = joinPath(versionFolder, "Assets");

            // Get template-specific asset folders or use default
            var assetSubfolders = TEMPLATE_FOLDERS[templateType] || TEMPLATE_FOLDERS["default"];

            // Build list of all folders to create
            var folders = [projectRoot, sizeFolder, versionFolder, aeFolder, publishedFolder, assetsFolder];

            // Add template-specific asset subfolders with revision subfolders inside each
            var assetFolderPaths = {};
            for (var a = 0; a < assetSubfolders.length; a++) {
                var subfolderPath = joinPath(assetsFolder, assetSubfolders[a]);
                var revisionSubfolderPath = joinPath(subfolderPath, revision);
                folders.push(subfolderPath);
                folders.push(revisionSubfolderPath);
                assetFolderPaths[assetSubfolders[a]] = subfolderPath;
                assetFolderPaths[assetSubfolders[a] + "_" + revision] = revisionSubfolderPath;
            }

            // Create all folders, tracking each for potential cleanup
            for (var i = 0; i < folders.length; i++) {
                var wasNew = !folderExists(folders[i]);
                if (!createFolderRecursive(folders[i])) {
                    // Cleanup: remove folders we created (in reverse order)
                    for (var j = createdFolders.length - 1; j >= 0; j--) {
                        try {
                            var cleanupFolder = new Folder(createdFolders[j]);
                            if (cleanupFolder.exists) cleanupFolder.remove();
                        } catch (cleanupErr) { }
                    }
                    showError("BH-1002", "Failed to create: " + folders[i]);
                    return null;
                }
                if (wasNew) createdFolders.push(folders[i]);
            }

            return {
                projectRoot: projectRoot,
                sizeFolder: sizeFolder,
                versionFolder: versionFolder,
                aeFolder: aeFolder,
                publishedFolder: publishedFolder,
                assetsFolder: assetsFolder,
                assetFolders: assetFolderPaths,
                templateType: templateType,
                version: version,
                revision: revision
            };
        } catch (e) {
            writeLog("Create Project Structure Failed: " + e.toString(), "ERROR");
            // Cleanup on exception
            for (var k = createdFolders.length - 1; k >= 0; k--) {
                try {
                    var cleanupFolder = new Folder(createdFolders[k]);
                    if (cleanupFolder.exists) cleanupFolder.remove();
                } catch (cleanupErr) { }
            }
            showError("BH-1003", e.toString());
            return null;
        }
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
                showError("BH-4002");
                return;
            }

            var width = parseInt(widthInput.text, 10);
            var height = parseInt(heightInput.text, 10);
            var fps = parseFloat(fpsInput.text);
            var duration = parseFloat(durInput.text);

            // Validation
            if (isNaN(width) || width < LIMITS.WIDTH_MIN || width > LIMITS.WIDTH_MAX) {
                showError("BH-4003");
                return;
            }
            if (isNaN(height) || height < LIMITS.HEIGHT_MIN || height > LIMITS.HEIGHT_MAX) {
                showError("BH-4004");
                return;
            }
            if (isNaN(fps) || fps < LIMITS.FPS_MIN || fps > LIMITS.FPS_MAX) {
                showError("BH-4005");
                return;
            }
            if (isNaN(duration) || duration < LIMITS.DURATION_MIN || duration > LIMITS.DURATION_MAX) {
                showError("BH-4006");
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
     * Add composition to Render Queue with template-specific output format
     * @param {CompItem} comp
     * @param {string} outputPath - Full path without extension (extension set by Output Module)
     * @param {string} templateType - Template type for output format (e.g., "sunrise", "dooh_horizontal")
     * @returns {RenderQueueItem|null}
     */
    function addToRenderQueue(comp, outputPath, templateType) {
        try {
            var rqItem = app.project.renderQueue.items.add(comp);
            var om = rqItem.outputModule(1);

            // Get render format for this template type
            var renderConfig = TEMPLATE_RENDER_FORMATS[templateType] || TEMPLATE_RENDER_FORMATS["default"];

            // Try to apply the output module template
            try {
                om.applyTemplate(renderConfig.outputModule);
            } catch (templateErr) {
                // Fallback: try common preset names
                try {
                    if (renderConfig.format === "png_sequence") {
                        om.applyTemplate("PNG Sequence");
                    } else {
                        om.applyTemplate("H.264 - Match Render Settings - 15 Mbps");
                    }
                } catch (fallbackErr) {
                    // Use default output module if presets not found
                }
            }

            om.file = new File(outputPath);
            return rqItem;
        } catch (e) {
            showError("BH-3002", e.toString());
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
        writeLog("Starting BigHappyLauncher UI...", "INFO");

        // Scope object to hold UI elements and data
        var ui = {
            // Data
            templates: loadTemplates(),
            templatesFolder: getTemplatesFolder(),

            // Layout Containers
            w: null,      // Main Window/Panel
            mainGrp: null,

            // Controls
            inputs: {
                brand: null,
                campaign: null,
                version: null,
                revision: null
            },
            dropdowns: {
                template: null,
                quarter: null,
                year: null
            },
            btns: {
                create: null,
                saveAs: null,
                render: null,
                quickDup: null,
                ameCheckbox: null,
                baseBrowse: null,
                template: {
                    add: null,
                    edit: null,
                    dup: null,
                    del: null,
                    up: null,
                    down: null,
                    regen: null,
                    folder: null
                }
            },
            labels: {
                pathPreview: null,
                filenamePreview: null,
                basePath: null,
                status: null
            }
        };

        // Initialize Panel
        if (thisObj instanceof Panel) {
            ui.w = thisObj;
        } else {
            ui.w = new Window("palette", "Big Happy Launcher", undefined, { resizeable: true });
        }
        ui.w.orientation = "column";
        ui.w.alignChildren = ["fill", "top"];
        ui.w.spacing = 10;
        ui.w.margins = 15;

        // UI Helpers
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

        ui.btns.settings = null;

        // --- SUB-BUILDER FUNCTIONS ---

        function createHeader() {
            var hdrGrp = ui.w.add("group");
            hdrGrp.orientation = "row";
            hdrGrp.alignment = ["fill", "top"];
            hdrGrp.alignChildren = ["fill", "center"];

            var title = hdrGrp.add("statictext", undefined, "BIG HAPPY LAUNCHER");
            title.alignment = ["center", "center"];
            try { title.graphics.font = ScriptUI.newFont("Arial", "BOLD", 14); } catch (e) { }

            // Spacer to push settings button to right
            var spacer = hdrGrp.add("group");
            spacer.alignment = ["fill", "fill"];

            ui.btns.settings = hdrGrp.add("button", undefined, "⚙");
            ui.btns.settings.preferredSize = [25, 25];
            ui.btns.settings.helpTip = "Open Settings";
        }

        function showSettingsDialog() {
            var d = new Window("dialog", "Launcher Settings");
            d.orientation = "column";
            d.alignChildren = ["fill", "top"];
            d.spacing = 10;
            d.margins = 15;

            // --- PATHS SECTION ---
            var pPanel = d.add("panel", undefined, "Paths");
            pPanel.orientation = "column";
            pPanel.alignChildren = ["fill", "top"];
            pPanel.spacing = 5;

            // Base Folder
            var bGrp = pPanel.add("group");
            bGrp.orientation = "row";
            bGrp.add("statictext", undefined, "Base Work Folder:");
            var baseInput = bGrp.add("edittext", undefined, getBaseWorkFolder());
            baseInput.alignment = ["fill", "center"];
            var baseBtn = bGrp.add("button", undefined, "...");
            baseBtn.preferredSize = [30, 22];
            baseBtn.onClick = function () {
                var f = Folder.selectDialog("Select Base Work Folder");
                if (f) baseInput.text = f.fsName;
            };

            // Templates Folder
            var tGrp = pPanel.add("group");
            tGrp.orientation = "row";
            tGrp.add("statictext", undefined, "Templates Folder:");
            var tmplInput = tGrp.add("edittext", undefined, ui.templatesFolder);
            tmplInput.alignment = ["fill", "center"];
            var tmplBtn = tGrp.add("button", undefined, "...");
            tmplBtn.preferredSize = [30, 22];
            tmplBtn.onClick = function () {
                var f = Folder.selectDialog("Select Templates Folder");
                if (f) tmplInput.text = f.fsName;
            };

            // --- RENDER SECTION ---
            var rPanel = d.add("panel", undefined, "Render & Output");
            rPanel.orientation = "column";
            rPanel.alignChildren = ["left", "top"];

            var ameCheck = rPanel.add("checkbox", undefined, "Enable Adobe Media Encoder (AME)");
            ameCheck.value = (getSetting(AME_ENABLED_KEY) === "true");

            // --- SYSTEM SECTION ---
            var sPanel = d.add("panel", undefined, "System");
            sPanel.orientation = "column";
            sPanel.alignChildren = ["left", "top"];

            var logGrp = sPanel.add("group");
            logGrp.add("statictext", undefined, "Log File:");
            var openLogBtn = logGrp.add("button", undefined, "Open Log");
            openLogBtn.onClick = function () {
                var logF = new File(LOG_FILE_PATH);
                if (logF.exists) logF.execute();
                else alert("Log file not found yet.");
            };

            // --- BUTTONS ---
            var btnGrp = d.add("group");
            btnGrp.orientation = "row";
            btnGrp.alignment = ["center", "bottom"];
            var saveBtn = btnGrp.add("button", undefined, "Save");
            var cancelBtn = btnGrp.add("button", undefined, "Cancel");

            saveBtn.onClick = function () {
                // Validation
                if (!baseInput.text) { alert("Base Work Folder cannot be empty."); return; }
                if (!tmplInput.text) { alert("Templates Folder cannot be empty."); return; }

                // Save
                setBaseWorkFolder(baseInput.text);
                setSetting(TEMPLATES_FOLDER_KEY, tmplInput.text);
                setSetting(AME_ENABLED_KEY, String(ameCheck.value));

                // Update UI state
                ui.templatesFolder = tmplInput.text;
                ui.labels.basePath.text = baseInput.text;


                // Reload templates if folder changed
                ui.templates = loadTemplates();
                ui.refreshDropdown();
                ui.updatePreview();

                d.close();
            };
            cancelBtn.onClick = function () { d.close(); };

            d.center();
            d.show();
        }

        function createMainInputs() {
            ui.mainGrp = ui.w.add("group");
            ui.mainGrp.orientation = "column";
            ui.mainGrp.alignChildren = ["fill", "top"];
            ui.mainGrp.spacing = 5;

            // Template Dropdown
            var tmplGrp = ui.mainGrp.add("group");
            tmplGrp.orientation = "row";
            tmplGrp.alignChildren = ["left", "center"];
            var tmplLbl = tmplGrp.add("statictext", undefined, "Template:");
            tmplLbl.preferredSize.width = 65;
            ui.dropdowns.template = tmplGrp.add("dropdownlist", undefined, []);
            ui.dropdowns.template.alignment = ["fill", "center"];
            ui.dropdowns.template.preferredSize.height = 25;
            ui.dropdowns.template.helpTip = "Select a template";

            // Brand & Campaign
            ui.inputs.brand = addRow(ui.mainGrp, "Brand:", "");
            ui.inputs.brand.helpTip = "Enter the brand/client name (required)";
            // Capture default background


            ui.inputs.campaign = addRow(ui.mainGrp, "Campaign:", "");
            ui.inputs.campaign.helpTip = "Enter the campaign or project name";
            // Capture default background


            // Quarter & Year
            var qyRow = ui.mainGrp.add("group");
            qyRow.orientation = "row";
            qyRow.alignChildren = ["left", "center"];
            var qLbl = qyRow.add("statictext", undefined, "Quarter:");
            qLbl.preferredSize.width = 65;
            ui.dropdowns.quarter = qyRow.add("dropdownlist", undefined, ["Q1", "Q2", "Q3", "Q4"]);
            ui.dropdowns.quarter.selection = getCurrentQuarter();
            ui.dropdowns.quarter.preferredSize.width = 60;
            ui.dropdowns.quarter.helpTip = "Select fiscal quarter";

            var yLbl = qyRow.add("statictext", undefined, "Year:");
            yLbl.preferredSize.width = 35;
            var currentYear = getCurrentYear();
            ui.dropdowns.year = qyRow.add("dropdownlist", undefined, [
                String(currentYear - 1),
                String(currentYear),
                String(currentYear + 1),
                String(currentYear + 2)
            ]);
            ui.dropdowns.year.selection = 1; // Current year
            ui.dropdowns.year.preferredSize.width = 65;

            // Version & Revision
            var vrRow = ui.mainGrp.add("group");
            vrRow.orientation = "row";
            vrRow.alignChildren = ["left", "center"];
            var verLbl = vrRow.add("statictext", undefined, "Version:");
            verLbl.preferredSize.width = 65;
            ui.inputs.version = vrRow.add("edittext", undefined, "1");
            ui.inputs.version.preferredSize.width = 50;
            var revLbl = vrRow.add("statictext", undefined, "Revision:");
            revLbl.preferredSize.width = 60;
            ui.inputs.revision = vrRow.add("edittext", undefined, "1");
            ui.inputs.revision.preferredSize.width = 50;

            // Base Folder (Label Only)
            var baseGrp = ui.mainGrp.add("group");
            baseGrp.orientation = "row";
            baseGrp.alignChildren = ["left", "center"];
            var baseLbl = baseGrp.add("statictext", undefined, "Base:");
            baseLbl.preferredSize.width = 65;
            ui.labels.basePath = baseGrp.add("statictext", undefined, getBaseWorkFolder());
            ui.labels.basePath.alignment = ["fill", "center"];
            try { ui.labels.basePath.graphics.foregroundColor = ui.labels.basePath.graphics.newPen(ui.labels.basePath.graphics.PenType.SOLID_COLOR, [0.5, 0.5, 0.5], 1); } catch (e) { }
            // Cleaned up: Browse button removed, moved to Settings
        }

        function createPreview() {
            var div = ui.w.add("panel", [0, 0, 100, 1]);
            div.alignment = ["fill", "top"];

            ui.labels.pathPreview = ui.w.add("statictext", undefined, "Path: ...");
            ui.labels.pathPreview.alignment = ["fill", "top"];
            try { ui.labels.pathPreview.graphics.foregroundColor = ui.labels.pathPreview.graphics.newPen(ui.labels.pathPreview.graphics.PenType.SOLID_COLOR, [0.4, 0.8, 0.4], 1); } catch (e) { }

            ui.labels.filenamePreview = ui.w.add("statictext", undefined, "Filename: ...");
            ui.labels.filenamePreview.alignment = ["center", "top"];
            try { ui.labels.filenamePreview.graphics.foregroundColor = ui.labels.filenamePreview.graphics.newPen(ui.labels.filenamePreview.graphics.PenType.SOLID_COLOR, [0.4, 0.7, 1], 1); } catch (e) { }
        }

        function createActionButtons() {
            var btnGroup = ui.w.add("group");
            btnGroup.orientation = "row";
            btnGroup.alignChildren = ["fill", "top"];
            btnGroup.spacing = 5;
            btnGroup.alignment = ["fill", "top"];

            ui.btns.create = btnGroup.add("button", undefined, "CREATE");
            ui.btns.create.preferredSize.height = 35;
            ui.btns.create.preferredSize.width = 100;
            try { ui.btns.create.graphics.font = ScriptUI.newFont("Arial", "BOLD", 13); } catch (e) { }

            ui.btns.saveAs = btnGroup.add("button", undefined, "SAVE AS...");
            ui.btns.saveAs.preferredSize.height = 35;
            try { ui.btns.saveAs.graphics.font = ScriptUI.newFont("Arial", "BOLD", 13); } catch (e) { }

            ui.btns.quickDup = btnGroup.add("button", undefined, "R+");
            ui.btns.quickDup.preferredSize.height = 35;
            ui.btns.quickDup.preferredSize.width = 40;
            try { ui.btns.quickDup.graphics.font = ScriptUI.newFont("Arial", "BOLD", 13); } catch (e) { }
        }

        function createTemplateManagement() {
            ui.labels.status = ui.w.add("statictext", undefined, "Ready");
            ui.labels.status.alignment = ["center", "top"];
            try { ui.labels.status.graphics.font = ScriptUI.newFont("Arial", "REGULAR", 10); } catch (e) { }

            var tmplMgmt1 = ui.w.add("group");
            tmplMgmt1.orientation = "row";
            tmplMgmt1.alignChildren = ["center", "center"];
            tmplMgmt1.spacing = 3;

            ui.btns.template.add = tmplMgmt1.add("button", undefined, "+");
            ui.btns.template.add.preferredSize = [25, 22];
            ui.btns.template.edit = tmplMgmt1.add("button", undefined, "Edit");
            ui.btns.template.edit.preferredSize = [40, 22];
            ui.btns.template.dup = tmplMgmt1.add("button", undefined, "Dup");
            ui.btns.template.dup.preferredSize = [35, 22];
            ui.btns.template.del = tmplMgmt1.add("button", undefined, "Del");
            ui.btns.template.del.preferredSize = [35, 22];
            ui.btns.template.up = tmplMgmt1.add("button", undefined, "▲");
            ui.btns.template.up.preferredSize = [22, 22];
            ui.btns.template.down = tmplMgmt1.add("button", undefined, "▼");
            ui.btns.template.down.preferredSize = [22, 22];

            var tmplMgmt2 = ui.w.add("group");
            tmplMgmt2.orientation = "row";
            tmplMgmt2.alignChildren = ["center", "center"];
            tmplMgmt2.spacing = 5;

            ui.btns.template.regen = tmplMgmt2.add("button", undefined, "Regenerate");
            ui.btns.template.regen.preferredSize.height = 22;
            ui.btns.template.folder = tmplMgmt2.add("button", undefined, "Folder...");
            ui.btns.template.folder.preferredSize.height = 22;
        }

        function createRenderSection() {


            ui.btns.render = ui.w.add("button", undefined, "ADD TO RENDER QUEUE");
            ui.btns.render.preferredSize.height = 28;
            ui.btns.render.alignment = ["fill", "top"];
            try { ui.btns.render.graphics.font = ScriptUI.newFont("Arial", "BOLD", 11); } catch (e) { }
        }

        // --- LOGIC FUNCTIONS (Methods attached to UI object) ---

        ui.refreshDropdown = function () {
            var prevIdx = ui.dropdowns.template.selection ? ui.dropdowns.template.selection.index : 0;
            ui.dropdowns.template.removeAll();
            for (var i = 0; i < ui.templates.length; i++) {
                ui.dropdowns.template.add("item", getTemplateLabel(ui.templates[i]));
            }
            if (ui.templates.length > 0) {
                ui.dropdowns.template.selection = Math.min(prevIdx, ui.templates.length - 1);
            }
        };

        ui.setStatus = function (text, color) {
            ui.labels.status.text = text;
            try { ui.labels.status.graphics.foregroundColor = ui.labels.status.graphics.newPen(ui.labels.status.graphics.PenType.SOLID_COLOR, color, 1); } catch (e) { }
        };

        ui.updateStatus = function () {
            if (!ui.templates.length || !ui.dropdowns.template.selection) {
                ui.setStatus("No templates", [0.6, 0.6, 0.6]);
                return;
            }
            var t = ui.templates[ui.dropdowns.template.selection.index];
            if (!t.path || !fileExists(t.path)) {
                ui.setStatus("Template missing (Regenerate)", [0.9, 0.5, 0.2]);
            } else {
                ui.setStatus("Ready: " + t.name, [0.5, 0.8, 0.5]);
            }
        };

        ui.buildFilename = function (brand, campaign, quarter, size, version, revision, isDOOH) {
            if (isDOOH) {
                return "DOOH_" + (campaign || brand) + "_" + size + "_" + version + "_" + revision + ".aep";
            } else {
                var campaignName = (campaign && campaign.length > 0) ? campaign : "Campaign";
                return brand + "_" + campaignName + "_" + quarter + "_" + size + "_" + version + "_" + revision + ".aep";
            }
        };

        ui.updatePreview = function () {
            if (!ui.dropdowns.template.selection) return;
            var t = ui.templates[ui.dropdowns.template.selection.index];
            var brand = sanitizeName(ui.inputs.brand.text) || "Brand";
            var campaign = sanitizeName(ui.inputs.campaign.text) || "";
            var quarter = ui.dropdowns.quarter.selection ? ui.dropdowns.quarter.selection.text : "Q1";
            var year = ui.dropdowns.year.selection ? ui.dropdowns.year.selection.text : String(getCurrentYear());
            var size = t.width + "x" + t.height;
            var version = "V" + (parseInt(ui.inputs.version.text, 10) || 1);
            var revision = "R" + (parseInt(ui.inputs.revision.text, 10) || 1);

            // Validation Feedback
            var brandVal = validateInput(ui.inputs.brand.text, "brand");
            if (!brandVal.isValid && ui.inputs.brand.text.length > 0) {
                ui.inputs.brand.helpTip = "Error: " + brandVal.msg;
            } else {
                ui.inputs.brand.helpTip = "Enter the brand/client name (required)";
            }

            var cmpVal = validateInput(ui.inputs.campaign.text, "campaign");
            if (!cmpVal.isValid && ui.inputs.campaign.text.length > 0) {
                ui.inputs.campaign.helpTip = "Error: " + cmpVal.msg;
            } else {
                ui.inputs.campaign.helpTip = "Enter the campaign or project name";
            }

            var filename = ui.buildFilename(brand, campaign, quarter, size, version, revision, isDOOHTemplate(t.name));
            var projectFolderName = buildProjectFolderName(brand, campaign);
            var fullPath = joinPath(joinPath(joinPath(joinPath(joinPath(getBaseWorkFolder(), year), quarter), projectFolderName), size), "Animate CC_AE");

            ui.labels.pathPreview.text = fullPath;
            ui.labels.filenamePreview.text = filename;
        };

        ui.checkRevision = function () {
            if (!ui.dropdowns.template.selection) return;
            var t = ui.templates[ui.dropdowns.template.selection.index];
            var brand = sanitizeName(ui.inputs.brand.text) || "Brand";
            var campaign = sanitizeName(ui.inputs.campaign.text) || "";
            var quarter = ui.dropdowns.quarter.selection ? ui.dropdowns.quarter.selection.text : "Q1";
            var year = ui.dropdowns.year.selection ? ui.dropdowns.year.selection.text : String(getCurrentYear());
            var size = t.width + "x" + t.height;
            var version = "V" + (parseInt(ui.inputs.version.text, 10) || 1);

            var projectFolderName = buildProjectFolderName(brand, campaign);
            var aeFolder = joinPath(joinPath(joinPath(joinPath(joinPath(getBaseWorkFolder(), year), quarter), projectFolderName), size), "Animate CC_AE");
            var isDOOH = isDOOHTemplate(t.name);
            var maxR = 50;
            var foundR = 1;

            for (var r = 1; r <= maxR; r++) {
                var filename = ui.buildFilename(brand, campaign, quarter, size, version, "R" + r, isDOOH);
                if (fileExists(joinPath(aeFolder, filename))) {
                    foundR = r + 1;
                } else {
                    break;
                }
            }

            ui.inputs.revision.text = String(foundR);
            ui.updatePreview();
        };

        // --- EVENT BINDING ---

        function bindEvents() {
            // Inputs
            ui.inputs.brand.onChanging = ui.inputs.campaign.onChanging = ui.inputs.version.onChanging = ui.inputs.revision.onChanging = ui.updatePreview;
            ui.inputs.brand.onChange = ui.inputs.campaign.onChange = ui.dropdowns.quarter.onChange = ui.dropdowns.year.onChange = function () { ui.checkRevision(); };

            ui.dropdowns.template.onChange = function () {
                ui.updateStatus();
                ui.checkRevision();
            };

            ui.inputs.version.onChange = function () {
                ui.inputs.revision.text = "1";
                ui.checkRevision();
            };

            // Header/Settings
            if (ui.btns.settings) {
                ui.btns.settings.onClick = function () {
                    showSettingsDialog();
                };
            }



            // Template Mgmt
            ui.btns.template.add.onClick = function () {
                var newT = showTemplateDialog({ name: "", width: 1920, height: 1080, fps: 24, duration: 15, path: "" }, true);
                if (newT) {
                    ui.templates.push(newT);
                    saveTemplates(ui.templates);
                    ui.refreshDropdown();
                    ui.dropdowns.template.selection = ui.templates.length - 1;
                    ui.updateStatus();
                    ui.updatePreview();
                }
            };

            ui.btns.template.edit.onClick = function () {
                if (!ui.dropdowns.template.selection) return;
                var idx = ui.dropdowns.template.selection.index;
                var edited = showTemplateDialog(ui.templates[idx], false);
                if (edited) {
                    ui.templates[idx] = edited;
                    saveTemplates(ui.templates);
                    ui.refreshDropdown();
                    ui.dropdowns.template.selection = idx;
                    ui.updateStatus();
                    ui.updatePreview();
                }
            };

            ui.btns.template.dup.onClick = function () {
                if (!ui.dropdowns.template.selection) return;
                var idx = ui.dropdowns.template.selection.index;
                var orig = ui.templates[idx];
                var copy = {
                    name: orig.name + " Copy",
                    width: orig.width,
                    height: orig.height,
                    fps: orig.fps,
                    duration: orig.duration,
                    path: ""
                };
                ui.templates.splice(idx + 1, 0, copy);
                saveTemplates(ui.templates);
                ui.refreshDropdown();
                ui.dropdowns.template.selection = idx + 1;
                ui.updateStatus();
                ui.updatePreview();
            };

            ui.btns.template.del.onClick = function () {
                if (!ui.dropdowns.template.selection) return;
                var idx = ui.dropdowns.template.selection.index;
                if (!confirm("Delete '" + ui.templates[idx].name + "'?")) return;
                ui.templates.splice(idx, 1);
                saveTemplates(ui.templates);
                ui.refreshDropdown();
                ui.updateStatus();
                ui.updatePreview();
            };

            ui.btns.template.up.onClick = function () {
                if (!ui.dropdowns.template.selection) return;
                var idx = ui.dropdowns.template.selection.index;
                if (idx === 0) return;
                var temp = ui.templates[idx];
                ui.templates[idx] = ui.templates[idx - 1];
                ui.templates[idx - 1] = temp;
                saveTemplates(ui.templates);
                ui.refreshDropdown();
                ui.dropdowns.template.selection = idx - 1;
                ui.updateStatus();
                ui.updatePreview();
            };

            ui.btns.template.down.onClick = function () {
                if (!ui.dropdowns.template.selection) return;
                var idx = ui.dropdowns.template.selection.index;
                if (idx >= ui.templates.length - 1) return;
                var temp = ui.templates[idx];
                ui.templates[idx] = ui.templates[idx + 1];
                ui.templates[idx + 1] = temp;
                saveTemplates(ui.templates);
                ui.refreshDropdown();
                ui.dropdowns.template.selection = idx + 1;
                ui.updateStatus();
                ui.updatePreview();
            };

            ui.btns.template.regen.onClick = function () {
                if (!confirm("Regenerate ALL templates?\nThis will delete and recreate template files.\nFolder: " + ui.templatesFolder)) return;
                ui.setStatus("Regenerating...", [0.6, 0.6, 0.6]);
                for (var i = 0; i < ui.templates.length; i++) ui.templates[i].path = "";
                var result = ensureTemplatesExist(ui.templates, ui.templatesFolder, true);
                ui.templates = result.templates;
                ui.setStatus("Generated " + result.generated.length, [0.5, 0.8, 0.5]);
                ui.refreshDropdown();
                ui.updateStatus();
            };

            ui.btns.template.folder.onClick = function () {
                var f = Folder.selectDialog("Select Templates Folder");
                if (f) {
                    ui.templatesFolder = f.fsName;
                    setSetting(TEMPLATES_FOLDER_KEY, ui.templatesFolder);
                    ui.setStatus("Folder updated", [0.5, 0.8, 0.5]);
                }
            };

            // Main Actions
            ui.btns.create.onClick = function () {
                if (!ui.templates.length) { showError("BH-1004"); return; }
                if (!ui.dropdowns.template.selection) return;
                var t = ui.templates[ui.dropdowns.template.selection.index];
                if (!t.path || !fileExists(t.path)) { showError("BH-1001", t.path); return; }

                var brand = sanitizeName(ui.inputs.brand.text);
                var campaign = sanitizeName(ui.inputs.campaign.text) || "";

                if (!brand) { showError("BH-4001"); return; }
                var brandVal = validateInput(ui.inputs.brand.text, "brand");
                if (!brandVal.isValid) { showError("BH-4007", brandVal.msg); return; }

                var cmpVal = validateInput(ui.inputs.campaign.text, "campaign");
                if (!cmpVal.isValid) { showError("BH-4008", cmpVal.msg); return; }

                var quarter = ui.dropdowns.quarter.selection ? ui.dropdowns.quarter.selection.text : "Q1";
                var year = ui.dropdowns.year.selection ? ui.dropdowns.year.selection.text : String(getCurrentYear());
                var templateFolderName = getTemplateFolderName(t.width, t.height);
                var size = templateFolderName + "_" + t.width + "x" + t.height;
                var version = "V" + (parseInt(ui.inputs.version.text, 10) || 1);
                var revNum = "R" + (parseInt(ui.inputs.revision.text, 10) || 1);
                var revision = revNum;

                var projectName = buildProjectFolderName(brand, campaign);
                var filename = ui.buildFilename(brand, campaign, quarter, t.width + "x" + t.height, version, revision, isDOOHTemplate(t.name));

                try {
                    var templateType = getTemplateType(t.width, t.height);
                    var folders = createProjectStructure(getBaseWorkFolder(), year, quarter, projectName, size, revNum, templateType, version);
                    if (!folders) return;

                    var savePath = joinPath(folders.aeFolder, filename);
                    var saveFile = new File(savePath);

                    if (saveFile.exists) {
                        if (!confirm("File already exists:\n" + filename + "\n\nOverwrite?")) return;
                    }

                    if (app.project) app.project.close(CloseOptions.PROMPT_TO_SAVE_CHANGES);
                    app.open(new File(t.path));
                    app.project.save(saveFile);

                    var mainComp = findMainComp();
                    if (mainComp) mainComp.openInViewer();

                    addToRecentFiles(savePath);

                    var assetFoldersList = TEMPLATE_FOLDERS[templateType] || TEMPLATE_FOLDERS["default"];

                    var successMsg = "Project Created!\n\nFile: " + filename + "\n\nLocation:\n" + folders.aeFolder;
                    alert(successMsg);

                    if (ui.w instanceof Window) ui.w.close();

                } catch (e) {
                    showError("BH-2004", e.toString());
                }
            };

            ui.btns.saveAs.onClick = function () {
                if (!app.project || !app.project.file) { showError("BH-2003"); return; }
                if (!ui.dropdowns.template.selection) return;
                var t = ui.templates[ui.dropdowns.template.selection.index];

                var brand = sanitizeName(ui.inputs.brand.text);
                var campaign = sanitizeName(ui.inputs.campaign.text) || "Campaign";
                if (!brand) { showError("BH-4001"); return; }

                var quarter = ui.dropdowns.quarter.selection ? ui.dropdowns.quarter.selection.text : "Q1";
                var size = t.width + "x" + t.height;
                var version = "V" + (parseInt(ui.inputs.version.text, 10) || 1);
                var revision = "R" + (parseInt(ui.inputs.revision.text, 10) || 1);

                var suggestedName = ui.buildFilename(brand, campaign, quarter, size, version, revision, isDOOHTemplate(t.name));
                suggestedName = suggestedName.replace(/\.aep$/i, "");

                var saveFile = new File(joinPath(app.project.file.parent.fsName, suggestedName + ".aep")).saveDlg("Save Project As");
                if (saveFile) {
                    try {
                        var savePath = saveFile.fsName.replace(/\.aep$/i, "") + ".aep";
                        app.project.save(new File(savePath));
                        addToRecentFiles(savePath);
                        alert("Project saved as:\n" + new File(savePath).name);
                    } catch (e) {
                        showError("BH-2001", e.toString());
                    }
                }
            };

            ui.btns.quickDup.onClick = function () {
                if (!app.project || !app.project.file) { showError("BH-2003"); return; }
                try {
                    var currentName = app.project.file.name.replace(/\.aep$/i, "");
                    var parsed = parseProjectName(currentName);
                    if (!parsed) { alert("Cannot parse project name format."); return; }

                    // 1. Calculate New Revision
                    var currentRevNum = parseInt(parsed.revision.replace(/^R/i, ""), 10) || 1;
                    var newRevNum = currentRevNum + 1;
                    var revision = "R" + newRevNum;
                    var version = parsed.version || "V1";

                    // 2. Initial Guess for Year/Quarter (from path or UI)
                    var currentPath = app.project.file.parent.fsName;
                    var yearMatch = currentPath.match(/[\/\\](\d{4})[\/\\]/);
                    var quarterMatch = currentPath.match(/[\/\\](Q[1-4])[\/\\]/);

                    var year = yearMatch ? yearMatch[1] : String(getCurrentYear());
                    var quarter = parsed.quarter || (quarterMatch ? quarterMatch[1] : (ui.dropdowns.quarter.selection ? ui.dropdowns.quarter.selection.text : "Q1"));

                    // 3. POPUP: Confirm/Edit Year & Quarter
                    var confirmWin = new Window("dialog", "Quick Duplicate");
                    confirmWin.add("statictext", undefined, "Confirm Target Period:");

                    var grp = confirmWin.add("group");
                    grp.orientation = "row";
                    var yInput = grp.add("edittext", undefined, year);
                    yInput.preferredSize.width = 50;
                    yInput.helpTip = "Year";

                    var qItems = ["Q1", "Q2", "Q3", "Q4"];
                    var qInput = grp.add("dropdownlist", undefined, qItems);
                    qInput.preferredSize.width = 50;
                    // Select index based on text
                    for (var i = 0; i < qItems.length; i++) if (qItems[i] === quarter) qInput.selection = i;
                    if (!qInput.selection) qInput.selection = 0;

                    var btnGrp = confirmWin.add("group");
                    btnGrp.alignment = ["center", "bottom"];
                    var okBtn = btnGrp.add("button", undefined, "OK", { name: "ok" });
                    var cnclBtn = btnGrp.add("button", undefined, "Cancel", { name: "cancel" });

                    if (confirmWin.show() !== 1) return; // Cancelled

                    // Update values from dialog
                    year = yInput.text;
                    quarter = qInput.selection.text;

                    // 4. Derive Data for Folder Structure
                    var dims = parsed.size.split("x");
                    var width = parseInt(dims[0], 10);
                    var height = parseInt(dims[1], 10);

                    var templateType = getTemplateType(width, height);
                    var templateFolderName = getTemplateFolderName(width, height);
                    var sizeFolderName = templateFolderName + "_" + parsed.size; // e.g. Sunrise_750x300

                    var brand = parsed.brand;
                    var campaign = parsed.campaign || "";
                    var projectName = buildProjectFolderName(brand, campaign);
                    var basePath = getBaseWorkFolder();

                    // 5. Create Full Folder Structure (Assets, etc.)
                    // This function automatically checks existence and creates missing folders
                    var folders = createProjectStructure(basePath, year, quarter, projectName, sizeFolderName, revision, templateType, version);
                    if (!folders) return;

                    // 6. Construct New Filename (Standardized)
                    var newFilename;
                    if (parsed.isDOOH) {
                        newFilename = "DOOH_" + (campaign || brand) + "_" + parsed.size + "_" + version + "_" + revision + ".aep";
                    } else {
                        newFilename = brand + "_" + campaign + "_" + quarter + "_" + parsed.size + "_" + version + "_" + revision + ".aep";
                    }

                    // 7. Save in Correct Location (Inside newly verified structure)
                    var savePath = joinPath(folders.aeFolder, newFilename);
                    var saveFile = new File(savePath);

                    if (saveFile.exists) {
                        if (!confirm("File already exists:\n" + newFilename + "\n\nOverwrite?")) return;
                    }

                    app.project.save(saveFile);

                    // Update UI and History
                    ui.inputs.revision.text = String(newRevNum);
                    ui.updatePreview();
                    addToRecentFiles(savePath); // Add standard path to recent

                    alert("Quick Saved!\n\nStandardized & Saved to:\n" + folders.aeFolder);
                    return; // Prevent falling through to old code

                } catch (e) { showError("BH-2001", e.toString()); }
                /* // OLD CODE STARTS HERE:
                try {
                    var currentName = app.project.file.name.replace(/\.aep$/i, "");
                    var parsed = parseProjectName(currentName);
                    if (!parsed) { alert("Cannot parse project name format."); return; }
                
                    // 1. Calculate New Revision
                    var currentRevNum = parseInt(parsed.revision.replace(/^R/i, ""), 10) || 1;
                    var newRevNum = currentRevNum + 1;
                    var revision = "R" + newRevNum;
                    var version = parsed.version || "V1";
                
                    // 2. Derive Data for Folder Structure
                    // Need dimensions to determine template type and folder names
                    var dims = parsed.size.split("x");
                    var width = parseInt(dims[0], 10);
                    var height = parseInt(dims[1], 10);
                
                    var templateType = getTemplateType(width, height);
                    var templateFolderName = getTemplateFolderName(width, height);
                    var sizeFolderName = templateFolderName + "_" + parsed.size; // e.g. Sunrise_750x300
                
                    var brand = parsed.brand;
                    var campaign = parsed.campaign || "";
                    var projectName = buildProjectFolderName(brand, campaign);
                
                    var basePath = getBaseWorkFolder();
                    var year = String(getCurrentYear());
                    var quarter = parsed.quarter || (ui.dropdowns.quarter.selection ? ui.dropdowns.quarter.selection.text : "Q1");
                
                    // 3. Create Full Folder Structure (Assets, etc.)
                    // This function automatically checks existence and creates missing folders
                    var folders = createProjectStructure(basePath, year, quarter, projectName, sizeFolderName, revision, templateType, version);
                    if (!folders) return;
                
                    // 4. Construct New Filename (Standardized)
                    var newFilename;
                    if (parsed.isDOOH) {
                        newFilename = "DOOH_" + (campaign || brand) + "_" + parsed.size + "_" + version + "_" + revision + ".aep";
                    } else {
                        newFilename = brand + "_" + campaign + "_" + quarter + "_" + parsed.size + "_" + version + "_" + revision + ".aep";
                    }
                
                    // 5. Save in Correct Location (Inside newly verified structure)
                    var savePath = joinPath(folders.aeFolder, newFilename);
                    var saveFile = new File(savePath);
                
                    if (saveFile.exists) {
                        if (!confirm("File already exists:\n" + newFilename + "\n\nOverwrite?")) return;
                    }
                
                    app.project.save(saveFile);
                
                    // Update UI and History
                    ui.inputs.revision.text = String(newRevNum);
                    ui.updatePreview();
                    addToRecentFiles(savePath); // Add standard path to recent
                
                    alert("Quick Saved!\n\nStandardized & Saved to:\n" + folders.aeFolder);
                
                                } catch (e) { showError("BH-2001", e.toString()); } */
            };

            ui.btns.render.onClick = function () {
                if (!app.project || !app.project.file) { showError("BH-2003"); return; }
                var mainComp = findMainComp();
                if (!mainComp) { showError("BH-3001"); return; }

                var projectName = app.project.file.name.replace(/\.aep$/i, "");
                var type = getTemplateType(mainComp.width, mainComp.height);
                var parsed = parseProjectName(projectName);
                var renderName = projectName + "_" + getDateString();

                if (type === "sunrise" && parsed && parsed.brand) renderName = parsed.brand + "_" + (parsed.campaign || "Campaign") + "_CTA_AnimatedSunrise_" + parsed.version + "_" + parsed.revision;
                // Add other types if needed, simplified for now to standard types

                var aeFolder = app.project.file.parent.fsName;
                var revision = (parsed && parsed.revision) ? parsed.revision : ui.inputs.revision.text;
                var renderFolder = joinPath(aeFolder, "Render_" + revision);
                createFolderRecursive(renderFolder);
                var outputPath = joinPath(renderFolder, renderName);

                var rqItem = addToRenderQueue(mainComp, outputPath, type);
                if (!rqItem) return;

                if (ui.btns.ameCheckbox.value && canQueueInAME()) {
                    queueToAME();
                    alert("Sent to AME!");
                } else {
                    alert("Added to Render Queue!");
                }
            };

            // Keyboard Shortcuts
            ui.w.addEventListener("keydown", function (e) {
                if (e.ctrlKey && e.keyName === "Enter") { ui.btns.create.notify("onClick"); e.preventDefault(); }
                if (e.ctrlKey && e.keyName === "S") { ui.btns.saveAs.notify("onClick"); e.preventDefault(); }
                if (e.ctrlKey && e.keyName === "R") { ui.btns.render.notify("onClick"); e.preventDefault(); }
            });
        }

        // --- EXECUTE BUILD ---
        createHeader();
        createMainInputs();
        createPreview();
        createActionButtons();
        createTemplateManagement();
        createRenderSection();

        // Init
        ui.refreshDropdown();
        bindEvents();

        // Auto-detect project logic
        if (app.project && app.project.file) {
            try {
                var currentName = app.project.file.name.replace(/\.aep$/i, "");
                var parsed = parseProjectName(currentName);
                var mainComp = findMainComp();

                if (parsed && parsed.brand) {
                    if (mainComp) {
                        var type = getTemplateType(mainComp.width, mainComp.height);
                        for (var i = 0; i < ui.templates.length; i++) {
                            var t = ui.templates[i];
                            if (type === "sunrise" && t.width === 750 && t.height === 300) { ui.dropdowns.template.selection = i; break; }
                            if (type === "interscroller" && t.width === 880 && t.height === 1912) { ui.dropdowns.template.selection = i; break; }
                            if (type === "dooh" && t.width === 1920 && t.height === 1080 && mainComp.width === 1920) { ui.dropdowns.template.selection = i; break; }
                            if (type === "dooh" && t.width === 1080 && t.height === 1920 && mainComp.width === 1080) { ui.dropdowns.template.selection = i; break; }
                        }
                    }

                    ui.inputs.brand.text = parsed.brand;
                    if (parsed.campaign) ui.inputs.campaign.text = parsed.campaign;
                    if (parsed.version) ui.inputs.version.text = parsed.version.replace(/^V/i, "");
                    if (parsed.revision) ui.inputs.revision.text = parsed.revision.replace(/^R/i, "");

                    if (parsed.quarter) {
                        for (var x = 0; x < ui.dropdowns.quarter.items.length; x++) {
                            if (ui.dropdowns.quarter.items[x].text === parsed.quarter) {
                                ui.dropdowns.quarter.selection = x;
                                break;
                            }
                        }
                    }
                } else if (parsed && parsed.isDOOH && mainComp) {
                    if (parsed.campaign) {
                        ui.inputs.brand.text = parsed.campaign;
                    }
                }
            } catch (e) { }
        }
        ui.updateStatus();
        ui.updatePreview();

        ui.w.onResizing = ui.w.onResize = function () { this.layout.resize(); };
        if (ui.w instanceof Window) {
            ui.w.center();
            ui.w.show();
        } else {
            ui.w.layout.layout(true);
        }

        return ui.w;
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
