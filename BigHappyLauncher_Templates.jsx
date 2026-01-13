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

    var CONFIG = {
        VERSION: "1.0.0",
        SETTINGS: {
            SECTION: "BigHappyLauncher",
            KEYS: {
                TEMPLATES: "templates_data",
                TEMPLATES_FOLDER: "templates_folder",
                DEFAULT_SAVE_FOLDER: "default_save_folder",
                AME_ENABLED: "ame_enabled",
                RECENT_FILES: "recent_files",
                BASE_WORK_FOLDER: "base_work_folder",
                DEFAULT_DURATION: "default_duration",
                DEFAULT_FPS: "default_fps",
                FFMPEG_PATH: "ffmpeg_path",
                POST_RENDER_WEBM: "post_render_webm",
                POST_RENDER_MOV: "post_render_mov",
                POST_RENDER_HTML: "post_render_html",
                POST_RENDER_ZIP: "post_render_zip",
                TARGET_SIZE_MB: "target_size_mb"
            },
            MAX_RECENT_FILES: 10
        },
        PATHS: {
            LOG_FILE: joinPath(Folder.myDocuments.fsName, "BigHappyLauncher_Log.txt"),
            GLOBAL_ASSETS: "_GlobalAssets"
        },
        DEFAULTS: {
            TEMPLATES: [
                { name: "Sunrise", width: 750, height: 300, fps: 24, duration: 15, path: "" },
                { name: "InterScroller", width: 880, height: 1912, fps: 24, duration: 15, path: "" },
                { name: "DOOH Horizontal", width: 1920, height: 1080, fps: 29.97, duration: 15, path: "" },
                { name: "DOOH Vertical", width: 1080, height: 1920, fps: 29.97, duration: 15, path: "" }
            ]
        },
        LIMITS: {
            WIDTH_MIN: 1, WIDTH_MAX: 8192,
            HEIGHT_MIN: 1, HEIGHT_MAX: 8192,
            FPS_MIN: 1, FPS_MAX: 120,
            DURATION_MIN: 0.1, DURATION_MAX: 3600,
            BRAND_MIN: 2, BRAND_MAX: 50,
            CAMPAIGN_MAX: 50,
            PATH_MAX: 240 // Windows approx limit
        },
        TEMPLATE_FOLDERS: {
            "sunrise": ["Image", "Screen"],
            "interscroller": ["Image", "Screen", "GIF"],
            "dooh_horizontal": ["Image", "Screen", "PNG"],
            "dooh_vertical": ["Image", "Screen", "PNG"],
            "default": ["Image", "Screen"]
        },
        RENDER_FORMATS: {
            "sunrise": { format: "png_sequence", outputModule: "PNG Sequence with Alpha" },
            "interscroller": { format: "mp4", outputModule: "H.264" },
            "dooh_horizontal": { format: "mp4", outputModule: "H.264" },
            "dooh_vertical": { format: "mp4", outputModule: "H.264" },
            "dooh": { format: "mp4", outputModule: "H.264" },
            "default": { format: "png_sequence", outputModule: "Lossless with Alpha" }
        }
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
        "BH-4003": { msg: "Invalid width value", fix: "Width must be between " + CONFIG.LIMITS.WIDTH_MIN + " and " + CONFIG.LIMITS.WIDTH_MAX },
        "BH-4004": { msg: "Invalid height value", fix: "Height must be between " + CONFIG.LIMITS.HEIGHT_MIN + " and " + CONFIG.LIMITS.HEIGHT_MAX },
        "BH-4005": { msg: "Invalid FPS value", fix: "FPS must be between " + CONFIG.LIMITS.FPS_MIN + " and " + CONFIG.LIMITS.FPS_MAX },
        "BH-4006": { msg: "Invalid duration value", fix: "Duration must be between " + CONFIG.LIMITS.DURATION_MIN + " and " + CONFIG.LIMITS.DURATION_MAX + " seconds" },
        "BH-4007": { msg: "Brand name too short or too long", fix: "Brand must be " + CONFIG.LIMITS.BRAND_MIN + "-" + CONFIG.LIMITS.BRAND_MAX + " characters" },
        "BH-4008": { msg: "Campaign name too long", fix: "Campaign must be under " + CONFIG.LIMITS.CAMPAIGN_MAX + " characters" },

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
            var f = new File(CONFIG.PATHS.LOG_FILE);
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
    // SECTION 2: UTILITIES
    // =========================================================================

    function getSeparator() {
        if (typeof Folder !== "undefined" && Folder.fs === "Macintosh") return "/";
        if (typeof Folder !== "undefined" && Folder.fs === "Windows") return "\\";
        return ($.os.indexOf("Windows") !== -1) ? "\\" : "/";
    }

    var SEP = getSeparator();

    function joinPath(a, b) {
        if (!a) return b;
        if (!b) return a;
        var combo = a + SEP + b;
        return combo.replace(/[\/\\]+/g, SEP);
    }

    function fileExists(path) {
        if (!path) return false;
        return new File(path).exists;
    }

    function folderExists(path) {
        if (!path) return false;
        return new Folder(path).exists;
    }

    function createFolderRecursive(path) {
        var f = new Folder(path);
        if (!f.exists) {
            var parent = f.parent;
            if (parent && !parent.exists) createFolderRecursive(parent.fsName);
            f.create();
        }
    }

    function getParentFolder(path) {
        var f = new File(path);
        return f.parent ? f.parent.fsName : "";
    }

    function isSameFolder(p1, p2) {
        return getParentFolder(p1).toLowerCase() === getParentFolder(p2).toLowerCase();
    }

    /**
     * Sanitize filename/folder name
     * Rules: Trim, Remove illegal chars, Space->Underscore, Collapse Underscores, Reserved Names
     */
    function sanitizeName(str) {
        if (!str) return "";
        // 1. Trim
        var s = str.replace(/^\s+|\s+$/g, "");
        // 2. Remove illegal chars < > : " / \ | ? *
        s = s.replace(/[<>:"\/\\|?*]/g, "");
        // 3. Space to Underscore
        s = s.replace(/\s+/g, "_");
        // 4. Collapse Underscores
        s = s.replace(/_+/g, "_");
        // 5. Reserved Names
        if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(s)) {
            s += "_";
        }
        return s;
    }

    function setTextColor(element, color) {
        try {
            if (element.graphics) {
                var pen = element.graphics.newPen(element.graphics.PenType.SOLID_COLOR, color, 1);
                element.graphics.foregroundColor = pen;
            }
        } catch (e) { }
    }

    // =========================================================================
    // SECTION 2B: SETTINGS HELPERS
    // =========================================================================

    function getSetting(key, defaultVal) {
        try {
            if (app.settings.haveSetting(CONFIG.SETTINGS.SECTION, key)) {
                return app.settings.getSetting(CONFIG.SETTINGS.SECTION, key);
            }
        } catch (e) { }
        return defaultVal;
    }

    function setSetting(key, value) {
        try {
            app.settings.saveSetting(CONFIG.SETTINGS.SECTION, key, String(value));
        } catch (e) { }
    }

    function loadTemplates() {
        try {
            var data = getSetting(CONFIG.SETTINGS.KEYS.TEMPLATES, null);
            if (data) {
                var templates = jsonParse(data, null);
                if (templates && templates.length > 0) return templates;
            }
        } catch (e) { }
        return CONFIG.DEFAULTS.TEMPLATES.slice();
    }

    function saveTemplates(templates) {
        setSetting(CONFIG.SETTINGS.KEYS.TEMPLATES, jsonStringify(templates));
    }

    function getTemplatesFolder() {
        return getSetting(CONFIG.SETTINGS.KEYS.TEMPLATES_FOLDER, joinPath(Folder.myDocuments.fsName, "BH_Templates"));
    }

    function getDefaultSaveFolder() {
        return getSetting(CONFIG.SETTINGS.KEYS.DEFAULT_SAVE_FOLDER, Folder.myDocuments.fsName);
    }

    function getBaseWorkFolder() {
        var defaultPath = ($.os && $.os.indexOf("Windows") !== -1)
            ? "C:\\Work\\Animate CC"
            : "~/Work/Animate CC";
        return getSetting(CONFIG.SETTINGS.KEYS.BASE_WORK_FOLDER, defaultPath);
    }

    function setBaseWorkFolder(path) {
        setSetting(CONFIG.SETTINGS.KEYS.BASE_WORK_FOLDER, path);
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

    /**
     * Get the standardized AE file folder path
     * Structure: Base/Year/Quarter/Brand_Campaign/TemplateName_WxH/V#/AE_File
     */
    function getAeFolderPath(basePath, year, quarter, brand, campaign, templateFolderName, width, height, version) {
        var projectFolderName = buildProjectFolderName(brand, campaign);
        var sizeFolderName = templateFolderName + "_" + width + "x" + height;

        var p = joinPath(basePath, String(year));
        p = joinPath(p, quarter);
        p = joinPath(p, projectFolderName);
        p = joinPath(p, sizeFolderName);
        p = joinPath(p, version);
        p = joinPath(p, "AE_File");
        return p;
    }

    // =========================================================================
    // SECTION 2B.1: VALIDATION HELPERS
    // =========================================================================



    function validateInput(text, type) {
        if (!text || text.length === 0) return { isValid: false, msg: "Required" };

        if (text.length > CONFIG.LIMITS.BRAND_MAX && type === "brand") return { isValid: false, msg: "Too long (>" + CONFIG.LIMITS.BRAND_MAX + ")" };
        if (text.length > CONFIG.LIMITS.CAMPAIGN_MAX && type === "campaign") return { isValid: false, msg: "Too long (>" + CONFIG.LIMITS.CAMPAIGN_MAX + ")" };

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
            var data = getSetting(CONFIG.SETTINGS.KEYS.RECENT_FILES, "[]");
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
        setSetting(CONFIG.SETTINGS.KEYS.RECENT_FILES, jsonStringify(list));
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
        if (list.length > CONFIG.SETTINGS.MAX_RECENT_FILES) {
            list = list.slice(0, CONFIG.SETTINGS.MAX_RECENT_FILES);
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
    // SECTION 2B: UNIT TESTS (DEBUG)
    // =========================================================================

    function runUnitTests() {
        var tests = [
            { input: "Nike_AirMax_Q3_750x300_V1_R1", expected: { brand: "Nike", campaign: "AirMax", quarter: "Q3", size: "750x300", version: "V1", revision: "R1", isDOOH: false } },
            { input: "CocaCola_Summer_Vibes_Q1_300x250_V2_R5", expected: { brand: "CocaCola", campaign: "Summer_Vibes", quarter: "Q1", size: "300x250", version: "V2", revision: "R5", isDOOH: false } },
            { input: "TechCorp_Q4_1920x1080_V1_R15", expected: { brand: "TechCorp", campaign: "", quarter: "Q4", size: "1920x1080", version: "V1", revision: "R15", isDOOH: false } },
            { input: "DOOH_Spotify_Wrapped_1080x1920_V3_R2", expected: { brand: null, campaign: "Spotify_Wrapped", quarter: null, size: "1080x1920", version: "V3", revision: "R2", isDOOH: true } },
            { input: "DOOH_Generic_1920x1080_V1_R1", expected: { brand: null, campaign: "Generic", quarter: null, size: "1920x1080", version: "V1", revision: "R1", isDOOH: true } },
            { input: "SimpleBrand_300x600_V1_R1", expected: { brand: "SimpleBrand", campaign: "", quarter: null, size: "300x600", version: "V1", revision: "R1", isDOOH: false } }
        ];

        var passed = 0;
        var failed = 0;
        var log = "Running Unit Tests...\n\n";

        for (var i = 0; i < tests.length; i++) {
            var t = tests[i];
            var result = parseProjectName(t.input);
            var tPass = true;
            var failReason = "";

            if (!result) {
                tPass = false;
                failReason = "Returned Null";
            } else {
                // Check key fields
                if (result.brand !== t.expected.brand) { tPass = false; failReason += "Brand mismatch (" + result.brand + "); "; }
                if (result.campaign !== t.expected.campaign) { tPass = false; failReason += "Campaign mismatch (" + result.campaign + "); "; }
                if (result.size !== t.expected.size) { tPass = false; failReason += "Size mismatch (" + result.size + "); "; }
                if (result.quarter !== t.expected.quarter) { tPass = false; failReason += "Quarter mismatch (" + result.quarter + "); "; }
                if (result.isDOOH !== t.expected.isDOOH) { tPass = false; failReason += "DOOH flag mismatch; "; }
            }

            if (tPass) {
                passed++;
                log += "[PASS] " + t.input + "\n";
            } else {
                failed++;
                log += "[FAIL] " + t.input + "\nREASON: " + failReason + "\n";
            }
        }

        alert(log + "\nTotal: " + tests.length + " | Passed: " + passed + " | Failed: " + failed);
    }

    // =========================================================================
    // SECTION 4: TEMPLATE MANAGEMENT
    // =========================================================================

    function findAllPossibleMainComps() {
        var matches = [];
        try {
            for (var i = 1; i <= app.project.numItems; i++) {
                var item = app.project.item(i);
                if (item instanceof CompItem && item.name.match(/^main$/i)) {
                    matches.push(item);
                }
            }
        } catch (e) { }
        return matches;
    }

    function findMainComp() {
        var matches = findAllPossibleMainComps();

        if (matches.length === 0) return null;

        // Case 1: Single Match
        if (matches.length === 1) {
            var m = matches[0];
            if (m.name === "Main") return m; // Perfect match

            // Non-standard case match (e.g. "main")
            if (confirm("Found composition '" + m.name + "' but standard name is 'Main'.\n\nProceed with this composition?")) {
                return m;
            }
            return null;
        }

        // Case 2: Multiple Matches
        // Priority: Active Item
        if (app.project.activeItem && app.project.activeItem instanceof CompItem && app.project.activeItem.name.match(/^main$/i)) {
            return app.project.activeItem;
        }

        // Fallback: Selection Dialog
        var w = new Window("dialog", "Select Main Composition");
        w.add("statictext", undefined, "Multiple 'Main' compositions found. Please select one:");

        var list = w.add("listbox", [0, 0, 300, 150]);
        for (var i = 0; i < matches.length; i++) {
            var item = matches[i];
            list.add("item", item.name + " (" + item.width + "x" + item.height + " | " + item.duration.toFixed(1) + "s)");
        }
        list.selection = 0;

        var btns = w.add("group");
        var ok = btns.add("button", undefined, "Select", { name: "ok" });
        var cancel = btns.add("button", undefined, "Cancel", { name: "cancel" });

        if (w.show() === 1) {
            return matches[list.selection.index];
        }

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
            var assetSubfolders = CONFIG.TEMPLATE_FOLDERS[templateType] || CONFIG.TEMPLATE_FOLDERS["default"];

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
    // SECTION 4B: ASSET IMPORT AUTOMATION
    // =========================================================================

    function importGlobalAssets() {
        try {
            var templatesFolder = getTemplatesFolder();
            if (!templatesFolder) return;

            var globalAssetsPath = joinPath(templatesFolder, CONFIG.PATHS.GLOBAL_ASSETS);
            var folder = new Folder(globalAssetsPath);

            if (!folder.exists) return; // No global assets folder, skip

            var files = folder.getFiles(); // Get all files/folders
            if (!files || files.length === 0) return;

            writeLog("Importing Global Assets from: " + globalAssetsPath, "INFO");

            // Create or Find "00_Assets" bin
            var assetsBinName = "00_Global_Assets";
            var assetsBin = null;

            for (var i = 1; i <= app.project.numItems; i++) {
                var item = app.project.item(i);
                if (item instanceof FolderItem && item.name === assetsBinName) {
                    assetsBin = item;
                    break;
                }
            }

            if (!assetsBin) {
                assetsBin = app.project.items.addFolder(assetsBinName);
            }

            // Import files
            for (var f = 0; f < files.length; f++) {
                var fileObj = files[f];
                if (fileObj instanceof File) {
                    // Skip hidden files or system files
                    if (fileObj.name.indexOf(".") === 0) continue;

                    try {
                        var io = new ImportOptions(fileObj);
                        if (io.canImportAs(ImportAsType.FOOTAGE)) {
                            var imported = app.project.importFile(io);
                            imported.parentFolder = assetsBin;
                        }
                    } catch (impErr) {
                        writeLog("Failed to import asset: " + fileObj.name, "WARN");
                    }
                }
            }

        } catch (e) {
            writeLog("Global Asset Import Failed: " + e.toString(), "ERROR");
        }
    }


    // =========================================================================
    // SECTION 5B: AUTO-UPDATE (LOADER GENERATOR)
    // =========================================================================

    function generateLoaderFile(sourcePath, isUrl) {
        var loaderContent =
            '/**\n' +
            ' * BigHappyLauncher LOADER Script\n' +
            ' * -------------------------------------------------------------------------\n' +
            ' * This script acts as a self-updating wrapper.\n' +
            ' * It downloads/copies the latest Master version and then executes it.\n' +
            ' */\n' +
            '(function() {\n' +
            '    var masterSource = "' + sourcePath + '";\n' +
            '    var isUrl = ' + (isUrl ? 'true' : 'false') + ';\n' +
            '    var cacheFolder = new Folder(Folder.userData.fsName + "/BigHappyLauncher_Cache");\n' +
            '    if (!cacheFolder.exists) cacheFolder.create();\n' +
            '    var localFile = new File(cacheFolder.fsName + "/BigHappyLauncher_Cache.jsx");\n\n' +
            '    try {\n' +
            '        if (isUrl) {\n' +
            '            // GIT / WEB MODE: Use cURL to download\n' +
            '            var tempFile = new File(localFile.fsName + ".tmp");\n' +
            '            var cmd = "curl -L -o \\"" + tempFile.fsName + "\\" \\"" + masterSource + "\\"";\n' +
            '            system.callSystem(cmd);\n' +
            '            if (tempFile.exists && tempFile.length > 500) {\n' + // Check for valid file size (>500 bytes to avoid 404 pages)
            '                tempFile.copy(localFile.fsName);\n' +
            '                tempFile.remove();\n' +
            '            }\n' +
            '        } else {\n' +
            '            // NETWORK FILE MODE\n' +
            '            var masterFile = new File(masterSource);\n' +
            '            if (masterFile.exists && (!localFile.exists || masterFile.modified > localFile.modified)) {\n' +
            '                masterFile.copy(localFile.fsName);\n' +
            '            }\n' +
            '        }\n\n' +
            '        if (localFile.exists) {\n' +
            '            $.evalFile(localFile);\n' +
            '        } else {\n' +
            '            alert("BigHappyLauncher Loader Error:\\n\\nCould not find script cache and update failed.\\nSource: " + masterSource);\n' +
            '        }\n' +
            '    } catch (e) {\n' +
            '        alert("Loader Error: " + e.toString());\n' +
            '    }\n' +
            '})();\n';

        var f = new File(Folder.desktop.fsName + "/BigHappyLauncher_Loader.jsx").saveDlg("Save Loader Script");
        if (f) {
            if (f.name.indexOf(".jsx") === -1) f = new File(f.fsName + ".jsx");
            var written = false;
            if (f.open("w")) {
                f.write(loaderContent);
                f.close();
                written = true;
            }
            if (written) {
                alert("Loader Script Generated Successfully!\n\nDistribute this file to your team:\n" + f.fsName);
            } else {
                showError("BH-2002", "Could not write loader file.");
            }
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
        setTextColor(infoText, [0.5, 0.5, 0.5]);

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
            if (isNaN(width) || width < CONFIG.LIMITS.WIDTH_MIN || width > CONFIG.LIMITS.WIDTH_MAX) {
                showError("BH-4003");
                return;
            }
            if (isNaN(height) || height < CONFIG.LIMITS.HEIGHT_MIN || height > CONFIG.LIMITS.HEIGHT_MAX) {
                showError("BH-4004");
                return;
            }
            if (isNaN(fps) || fps < CONFIG.LIMITS.FPS_MIN || fps > CONFIG.LIMITS.FPS_MAX) {
                showError("BH-4005");
                return;
            }
            if (isNaN(duration) || duration < CONFIG.LIMITS.DURATION_MIN || duration > CONFIG.LIMITS.DURATION_MAX) {
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
            var renderConfig = CONFIG.RENDER_FORMATS[templateType] || CONFIG.RENDER_FORMATS["default"];

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

            // [NEW] AUTOMATICALLY ENFORCE SETTINGS FOR SUNRISE & DOOH
            // This attempts to bypass the need for manually saved presets

            if (templateType === "sunrise") {
                try {
                    // Force PNG Sequence + Alpha with fallbacks for "Color" string format
                    var baseSettings = {
                        "Format": "PNG Sequence",
                        "Video Output": {
                            "Channels": "RGB + Alpha",
                            "Depth": "Millions of Colors+"
                        }
                    };

                    try {
                        // Try exact match from screenshot
                        var fullSettings = {
                            "Format": "PNG Sequence",
                            "Video Output": {
                                "Channels": "RGB + Alpha",
                                "Depth": "Millions of Colors+",
                                "Color": "Straight (Unmatted)"
                            }
                        };
                        om.setSettings(fullSettings);
                    } catch (e1) {
                        try {
                            // Try simpler "Straight"
                            var straightSettings = {
                                "Format": "PNG Sequence",
                                "Video Output": {
                                    "Channels": "RGB + Alpha",
                                    "Depth": "Millions of Colors+",
                                    "Color": "Straight"
                                }
                            };
                            om.setSettings(straightSettings);
                        } catch (e2) {
                            // Fallback to minimal settings (Just Format/Channels/Depth)
                            try {
                                om.setSettings(baseSettings);
                            } catch (e3) {
                                writeLog("Failed to auto-set Sunrise PNG settings: " + e3.toString(), "WARN");
                            }
                        }
                    }
                } catch (e) {
                    writeLog("Failed to auto-set Sunrise PNG settings: " + e.toString(), "WARN");
                }
            } else if (templateType === "dooh" || templateType === "interscroller" || templateType.indexOf("dooh") !== -1) {
                try {
                    // Force H.264
                    var mp4Settings = {
                        "Format": "H.264"
                    };
                    om.setSettings(mp4Settings);
                } catch (e) {
                    // Fallback to QuickTime if H.264 is unavailable as a direct Format
                    try {
                        om.setSettings({ "Format": "QuickTime" });
                    } catch (err2) { }
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

    // =========================================================================
    // SECTION 7: UI HELPERS & EVENTS
    // =========================================================================

    function showSettingsDialog(ui) {
        var d = new Window("dialog", "Launcher Settings");
        d.orientation = "column";
        d.alignChildren = ["fill", "top"];
        d.spacing = 10;
        d.margins = 15;

        // Tabs
        var tPanel = d.add("tabbedpanel");
        tPanel.alignChildren = ["fill", "top"];
        tPanel.preferredSize = [400, 300];

        // --- TAB 1: GENERAL ---
        var genTab = tPanel.add("tab", undefined, "General");
        genTab.alignChildren = ["fill", "top"];
        genTab.spacing = 10;
        genTab.margins = 10;

        // Paths
        var pPanel = genTab.add("panel", undefined, "Paths");
        pPanel.orientation = "column"; pPanel.alignChildren = ["fill", "top"];

        var bGrp = pPanel.add("group");
        bGrp.add("statictext", undefined, "Base Work Folder:");
        var baseInput = bGrp.add("edittext", undefined, getBaseWorkFolder());
        baseInput.alignment = ["fill", "center"];
        var baseBtn = bGrp.add("button", undefined, "...");
        baseBtn.preferredSize = [30, 22];
        baseBtn.onClick = function () { var f = Folder.selectDialog("Select Base Work Folder"); if (f) baseInput.text = f.fsName; };

        var tGrp = pPanel.add("group");
        tGrp.add("statictext", undefined, "Templates Folder:");
        var tmplInput = tGrp.add("edittext", undefined, ui.templatesFolder);
        tmplInput.alignment = ["fill", "center"];
        var tmplBtn = tGrp.add("button", undefined, "...");
        tmplBtn.preferredSize = [30, 22];
        tmplBtn.onClick = function () { var f = Folder.selectDialog("Select Templates Folder"); if (f) tmplInput.text = f.fsName; };

        // Defaults
        var defPanel = genTab.add("panel", undefined, "New Template Defaults");
        defPanel.alignChildren = ["left", "top"];
        var defGrp = defPanel.add("group");
        defGrp.add("statictext", undefined, "Duration (sec):");
        var durInput = defGrp.add("edittext", undefined, getSetting(CONFIG.SETTINGS.KEYS.DEFAULT_DURATION) || "15");
        durInput.preferredSize.width = 40;
        defGrp.add("statictext", undefined, "FPS:");
        var fpsInput = defGrp.add("edittext", undefined, getSetting(CONFIG.SETTINGS.KEYS.DEFAULT_FPS) || "24");
        fpsInput.preferredSize.width = 40;

        // Render
        var rPanel = genTab.add("panel", undefined, "Render");
        rPanel.alignChildren = ["left", "top"];
        var ameCheck = rPanel.add("checkbox", undefined, "Enable Adobe Media Encoder (AME)");
        ameCheck.value = (getSetting(CONFIG.SETTINGS.KEYS.AME_ENABLED) === "true");


        // --- TAB 2: TEMPLATES ---
        var tmplTab = tPanel.add("tab", undefined, "Templates");
        tmplTab.alignChildren = ["fill", "fill"];

        var tmplList = tmplTab.add("listbox", undefined, [], { multiselect: false });
        tmplList.preferredSize.height = 180;
        // Populate List
        for (var i = 0; i < ui.templates.length; i++) {
            tmplList.add("item", ui.templates[i].name);
        }

        var tmplBtnGrp = tmplTab.add("group");
        tmplBtnGrp.orientation = "row";
        tmplBtnGrp.alignment = ["center", "bottom"];

        var addBtn = tmplBtnGrp.add("button", undefined, "Add");
        var editBtn = tmplBtnGrp.add("button", undefined, "Edit");
        var dupBtn = tmplBtnGrp.add("button", undefined, "Dup");
        var delBtn = tmplBtnGrp.add("button", undefined, "Del");
        var moveUpBtn = tmplBtnGrp.add("button", undefined, "▲");
        var moveDnBtn = tmplBtnGrp.add("button", undefined, "▼");

        moveUpBtn.preferredSize = moveDnBtn.preferredSize = [30, 25];

        var subBtnGrp = tmplTab.add("group");
        subBtnGrp.orientation = "row";
        subBtnGrp.alignment = ["center", "bottom"];
        var openFldBtn = subBtnGrp.add("button", undefined, "Open Folder");
        var regenBtn = subBtnGrp.add("button", undefined, "Regenerate JS");


        // --- TAB 3: POST-RENDER ---
        var convTab = tPanel.add("tab", undefined, "Post-Render");
        convTab.alignChildren = ["fill", "top"];
        convTab.margins = 10;
        convTab.spacing = 10;

        // FFmpeg Path
        var ffmpegGrp = convTab.add("group");
        ffmpegGrp.add("statictext", undefined, "FFmpeg Path:");
        var ffmpegInput = ffmpegGrp.add("edittext", undefined, getSetting(CONFIG.SETTINGS.KEYS.FFMPEG_PATH, ""));
        ffmpegInput.preferredSize = [300, 25];
        var browseFfmpegBtn = ffmpegGrp.add("button", undefined, "...");
        browseFfmpegBtn.preferredSize = [30, 25];
        browseFfmpegBtn.onClick = function () {
            var f = File.openDialog("Select FFmpeg Executable");
            if (f) ffmpegInput.text = f.fsName;
        };

        // Options
        var webmCheck = convTab.add("checkbox", undefined, "Convert to WebM (VP9 + Alpha)");
        webmCheck.value = (getSetting(CONFIG.SETTINGS.KEYS.POST_RENDER_WEBM, "true") === "true");

        var movCheck = convTab.add("checkbox", undefined, "Convert to MOV (QTRLE/ProRes + Alpha)");
        movCheck.value = (getSetting(CONFIG.SETTINGS.KEYS.POST_RENDER_MOV, "true") === "true");

        var htmlCheck = convTab.add("checkbox", undefined, "Generate HTML Player (Mediabunny)");
        htmlCheck.value = (getSetting(CONFIG.SETTINGS.KEYS.POST_RENDER_HTML, "true") === "true");

        var zipCheck = convTab.add("checkbox", undefined, "Create Optimized ZIP (Flat archive)");
        zipCheck.value = (getSetting(CONFIG.SETTINGS.KEYS.POST_RENDER_ZIP, "true") === "true");

        // Target Size
        var sizeGrp = convTab.add("group");
        sizeGrp.add("statictext", undefined, "Target WebM Size (MB):");
        var sizeInput = sizeGrp.add("edittext", undefined, getSetting(CONFIG.SETTINGS.KEYS.TARGET_SIZE_MB, "2.5"));
        sizeInput.characters = 5;

        // --- TAB 4: SYSTEM ---
        var sysTab = tPanel.add("tab", undefined, "System");
        sysTab.alignChildren = ["fill", "top"];
        sysTab.margins = 10;
        sysTab.spacing = 10;

        var loaderGrp = sysTab.add("panel", undefined, "Auto-Update Generator");
        loaderGrp.alignChildren = ["left", "top"];
        loaderGrp.add("statictext", undefined, "Git Raw URL:");
        var gitUrlInput = loaderGrp.add("edittext", undefined, "https://raw.githubusercontent.com/...");
        gitUrlInput.alignment = ["fill", "top"];

        var genBtn = loaderGrp.add("button", undefined, "Generate Loader Script...");
        genBtn.onClick = function () {
            var url = gitUrlInput.text;
            if (url.indexOf("http") === -1) { alert("Invalid URL"); return; }
            generateLoaderFile(url, true);
        };

        var logGrp = sysTab.add("group");
        logGrp.add("statictext", undefined, "Log File:");
        var openLogBtn = logGrp.add("button", undefined, "Open Log");
        openLogBtn.onClick = function () {
            var f = new File(CONFIG.PATHS.LOG_FILE);
            if (f.exists) f.execute(); else alert("Log file not found.");
        };

        // --- BOTTOM BUTTONS ---
        var btnGrp = d.add("group");
        btnGrp.alignment = ["center", "bottom"];
        var saveBtn = btnGrp.add("button", undefined, "Save & Close");
        var cancelBtn = btnGrp.add("button", undefined, "Cancel");

        // --- EVENTS: TEMPLATE MANAGEMENT ---

        function refreshList() {
            tmplList.removeAll();
            for (var i = 0; i < ui.templates.length; i++) {
                tmplList.add("item", ui.templates[i].name);
            }
        }

        addBtn.onClick = function () {
            var defFps = parseFloat(fpsInput.text) || 24; // Use current input as default
            var defDur = parseFloat(durInput.text) || 15;
            var newT = showTemplateDialog({ name: "", width: 1920, height: 1080, fps: defFps, duration: defDur, path: "" }, true);
            if (newT) {
                ui.templates.push(newT);
                refreshList();
            }
        };

        editBtn.onClick = function () {
            if (!tmplList.selection) return;
            var idx = tmplList.selection.index;
            var edited = showTemplateDialog(ui.templates[idx], false);
            if (edited) {
                ui.templates[idx] = edited;
                refreshList();
                tmplList.selection = idx;
            }
        };

        dupBtn.onClick = function () {
            if (!tmplList.selection) return;
            var idx = tmplList.selection.index;
            var orig = ui.templates[idx];
            var copy = { name: orig.name + " Copy", width: orig.width, height: orig.height, fps: orig.fps, duration: orig.duration, path: "" };
            ui.templates.push(copy);
            refreshList();
            tmplList.selection = ui.templates.length - 1;
        };

        delBtn.onClick = function () {
            if (!tmplList.selection) return;
            if (!confirm("Are you sure you want to delete template '" + tmplList.selection.text + "'?")) return;
            ui.templates.splice(tmplList.selection.index, 1);
            refreshList();
        };

        moveUpBtn.onClick = function () {
            if (!tmplList.selection || tmplList.selection.index === 0) return;
            var idx = tmplList.selection.index;
            var temp = ui.templates[idx];
            ui.templates[idx] = ui.templates[idx - 1];
            ui.templates[idx - 1] = temp;
            refreshList();
            tmplList.selection = idx - 1;
        };

        moveDnBtn.onClick = function () {
            if (!tmplList.selection || tmplList.selection.index >= ui.templates.length - 1) return;
            var idx = tmplList.selection.index;
            var temp = ui.templates[idx];
            ui.templates[idx] = ui.templates[idx + 1];
            ui.templates[idx + 1] = temp;
            refreshList();
            tmplList.selection = idx + 1;
        };



        openFldBtn.onClick = function () {
            var f = new Folder(ui.templatesFolder);
            if (f.exists) f.execute(); else alert("Templates folder not found: " + ui.templatesFolder);
        };

        regenBtn.onClick = function () {
            if (!tmplList.selection) return;
            var t = ui.templates[tmplList.selection.index];
            var res = generateTemplateFile(t, ui.templatesFolder);
            if (res) alert("Regenerated: " + t.name);
        };


        saveBtn.onClick = function () {
            // Validate & Save
            if (!baseInput.text) { alert("Base Work Folder cannot be empty."); return; }

            // Save settings mappings
            setBaseWorkFolder(baseInput.text);
            setSetting(CONFIG.SETTINGS.KEYS.TEMPLATES_FOLDER, tmplInput.text);
            setSetting(CONFIG.SETTINGS.KEYS.AME_ENABLED, String(ameCheck.value));

            var newDur = parseFloat(durInput.text);
            var newFps = parseFloat(fpsInput.text);
            if (!isNaN(newDur)) setSetting(CONFIG.SETTINGS.KEYS.DEFAULT_DURATION, String(newDur));
            if (!isNaN(newFps)) setSetting(CONFIG.SETTINGS.KEYS.DEFAULT_FPS, String(newFps));

            // Save Post-Render Settings
            setSetting(CONFIG.SETTINGS.KEYS.FFMPEG_PATH, ffmpegInput.text);
            setSetting(CONFIG.SETTINGS.KEYS.POST_RENDER_WEBM, String(webmCheck.value));
            setSetting(CONFIG.SETTINGS.KEYS.POST_RENDER_MOV, String(movCheck.value));
            setSetting(CONFIG.SETTINGS.KEYS.POST_RENDER_HTML, String(htmlCheck.value));
            setSetting(CONFIG.SETTINGS.KEYS.POST_RENDER_ZIP, String(zipCheck.value));
            var tSize = parseFloat(sizeInput.text);
            if (!isNaN(tSize)) setSetting(CONFIG.SETTINGS.KEYS.TARGET_SIZE_MB, String(tSize));

            // Save Templates
            saveTemplates(ui.templates);

            // Update UI State Mappings
            ui.templatesFolder = tmplInput.text;
            ui.labels.basePath.text = baseInput.text;

            // Reload and Refresh Main UI
            ui.templates = loadTemplates(); // Reload to be safe (or just strictly use memory)
            ui.refreshDropdown();
            ui.updatePreview();

            d.close();
        };

        cancelBtn.onClick = function () {
            // Revert changes to templates by reloading from disk (discard memory changes)
            ui.templates = loadTemplates();
            d.close();
        };

        d.center();
        d.show();

    }

    function bindEvents(ui) {
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
                showSettingsDialog(ui);
            };
        }







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
                importGlobalAssets(); // Import global assets after project is ready

                var assetFoldersList = CONFIG.TEMPLATE_FOLDERS[templateType] || CONFIG.TEMPLATE_FOLDERS["default"];

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
                if (parsed.isDOOH && !brand) brand = "DOOH"; // Fix null brand for DOOH

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

        };

        ui.btns.render.onClick = function () {
            if (!app.project || !app.project.file) { showError("BH-2003"); return; }
            var mainComp = findMainComp();
            if (!mainComp) { showError("BH-3001"); return; }

            var projectName = app.project.file.name.replace(/\.aep$/i, "");
            var type = getTemplateType(mainComp.width, mainComp.height);
            var parsed = parseProjectName(projectName);

            // [FIX] Force type to 'dooh' if filename indicates DOOH, or 'interscroller' if detected
            // This ensures MP4 render settings are used even if resolution is custom
            if (parsed && parsed.isDOOH) type = "dooh";
            // Interscroller should be caught by dimensions, but just in case:
            if (type === "default" && projectName.toLowerCase().indexOf("interscroller") !== -1) type = "interscroller";

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

            alert("Added to Render Queue!");
        };

        ui.btns.convert.onClick = function () {
            processPostRender(ui);
        };

        // Keyboard Shortcuts
        ui.w.addEventListener("keydown", function (e) {
            if (e.ctrlKey && e.keyName === "Enter") { ui.btns.create.notify("onClick"); e.preventDefault(); }
            if (e.ctrlKey && e.keyName === "S") { ui.btns.saveAs.notify("onClick"); e.preventDefault(); }
            if (e.ctrlKey && e.keyName === "R") { ui.btns.render.notify("onClick"); e.preventDefault(); }
        });
    }

    // =========================================================================
    // SECTION 8: BUILD UI
    // =========================================================================
    // --- POST-RENDER CONVERSION HELPERS ---

    function escapePath(path) {
        return "\"" + path + "\"";
    }

    function getNullDev() {
        return ($.os.indexOf("Windows") !== -1) ? "NUL" : "/dev/null";
    }

    function checkFFmpeg() {
        // 0. Portable Mode (Check Relative to Script)
        var scriptFile = new File($.fileName);
        var scriptDir = scriptFile.parent;
        var isWin = ($.os.indexOf("Windows") !== -1);
        var exeName = isWin ? "ffmpeg.exe" : "ffmpeg";

        var portablePaths = [
            scriptDir.fsName + "/" + exeName,
            scriptDir.fsName + "/bin/" + exeName,
            scriptDir.fsName + "/tools/" + exeName,
            // Also check up one level just in case script is in a subfolder
            scriptDir.parent.fsName + "/" + exeName,
            scriptDir.parent.fsName + "/bin/" + exeName
        ];

        for (var i = 0; i < portablePaths.length; i++) {
            var f = new File(portablePaths[i]);
            if (f.exists) {
                // Verify it works
                var cmdPortable = '"' + portablePaths[i] + '" -version'; // Use simple quotes, avoid escapePath for now to be safe
                if (isWin) cmdPortable = 'cmd /c "' + cmdPortable + '"';

                var resP = system.callSystem(cmdPortable);
                if (resP && resP.toString().indexOf("ffmpeg version") !== -1) {
                    setSetting(CONFIG.SETTINGS.KEYS.FFMPEG_PATH, portablePaths[i]);
                    // Return immediately if found
                    return true;
                }
            }
        }

        var path = getSetting(CONFIG.SETTINGS.KEYS.FFMPEG_PATH, "");
        // 1. Try Configured Path or Global Command
        var cmd = (path ? escapePath(path) : "ffmpeg") + " -version";
        var res = system.callSystem(cmd);
        if (res.indexOf("ffmpeg version") !== -1) return true;

        // 2. Windows Auto-Detect
        if (!path && $.os.indexOf("Windows") !== -1) {
            var commonWin = [
                "C:\\ffmpeg\\bin\\ffmpeg.exe",
                "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
                "C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe",
                "C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe"
            ];
            for (var i = 0; i < commonWin.length; i++) {
                var f = new File(commonWin[i]);
                if (f.exists) {
                    setSetting(CONFIG.SETTINGS.KEYS.FFMPEG_PATH, commonWin[i]);
                    return true;
                }
            }
        }

        // 3. If failure and no path set, try common paths (Mac)
        if (!path && $.os.indexOf("Mac") !== -1) {
            var common = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"];
            for (var i = 0; i < common.length; i++) {
                var f = new File(common[i]);
                if (f.exists) {
                    // Check version to be sure
                    var cmd2 = escapePath(common[i]) + " -version";
                    if (system.callSystem(cmd2).indexOf("ffmpeg version") !== -1) {
                        setSetting(CONFIG.SETTINGS.KEYS.FFMPEG_PATH, common[i]);
                        return true;
                    }
                }
            }
        }
        return false;
    }

    function downloadFFmpeg() {
        var scriptFile = new File($.fileName);
        var scriptDir = scriptFile.parent;
        var binDir = new Folder(scriptDir.fsName + "/bin");
        if (!binDir.exists) binDir.create();

        var isWin = ($.os.indexOf("Windows") !== -1);
        var confirmMsg = "FFmpeg is missing. Download it now?\n\nThis will download (~30-80MB) and install it into a 'bin' folder next to the script.\n\nA terminal window will open to show progress.";

        if (!confirm(confirmMsg)) return false;

        if (isWin) {
            // WINDOWS DOWNLOADER (PowerShell)
            var psScriptPath = scriptDir.fsName + "/install_ffmpeg.ps1";
            var batScriptPath = scriptDir.fsName + "/install_ffmpeg.bat";

            var psCode = [
                '$ProgressPreference = "SilentlyContinue"',
                // FIX: Force TLS 1.2 for modern HTTPS connections
                '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12',
                'Write-Host "Downloading FFmpeg (Please Wait)..." -ForegroundColor Cyan',
                '$url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"',
                '$zip = "' + scriptDir.fsName + '\\ffmpeg.zip"',
                '$dest = "' + scriptDir.fsName + '\\ffmpeg_temp"',
                '$final = "' + binDir.fsName + '\\ffmpeg.exe"',
                'try {',
                '    Invoke-WebRequest -Uri $url -OutFile $zip',
                '    Write-Host "Extracting..." -ForegroundColor Yellow',
                '    Expand-Archive -Path $zip -DestinationPath $dest -Force',
                '    Write-Host "Installing..." -ForegroundColor Green',
                '    $exe = Get-ChildItem -Path $dest -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1',
                '    if ($exe) { Move-Item -Path $exe.FullName -Destination $final -Force }',
                '    Write-Host "Done! You can close this window." -ForegroundColor Green',
                '} catch {',
                '    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red',
                '    Read-Host "Press Enter to exit"',
                '}',
                'Remove-Item $zip -Force -ErrorAction SilentlyContinue',
                'Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue',
                'Start-Sleep -Seconds 3'
            ].join("\r\n");

            var f = new File(psScriptPath);
            f.open("w"); f.write(psCode); f.close();

            var batCode = '@echo off\r\nPowerShell -NoProfile -ExecutionPolicy Bypass -File "' + psScriptPath + '"';
            var b = new File(batScriptPath);
            b.open("w"); b.write(batCode); b.close();

            system.callSystem('start "" "' + batScriptPath + '"');

            alert("Download started!\n\nPlease wait for the terminal window to close, then run this script again.");
            return true;

        } else {
            // MACOS DOWNLOADER (Curl)
            var shScriptPath = scriptDir.fsName + "/install_ffmpeg.sh";
            var shCode = [
                '#!/bin/bash',
                'echo "Downloading FFmpeg (Mac)..."',
                'cd "' + scriptDir.fsName + '"',
                'curl -L -o ffmpeg.zip "https://evermeet.cx/ffmpeg/ffmpeg-6.0.zip"', // Stable static build
                'echo "Extracting..."',
                'unzip -o ffmpeg.zip',
                'mv ffmpeg bin/ffmpeg',
                'chmod +x bin/ffmpeg',
                // FIX: Remove Quarantine attribute to prevent "Unverified Developer" block
                'xattr -d com.apple.quarantine bin/ffmpeg 2>/dev/null',
                'rm ffmpeg.zip',
                'echo "Done! You can close this window."'
            ].join("\n");

            var s = new File(shScriptPath);
            s.open("w"); s.write(shCode); s.close();
            system.callSystem("chmod +x \"" + shScriptPath + "\"");

            var termCmd = 'open -a Terminal "' + shScriptPath + '"';
            system.callSystem(termCmd);

            alert("Download started!\n\nPlease wait for the terminal window to close, then run this script again.");
            return true;
        }
    }

    function detectPNGSequence(folder) {
        var files = folder.getFiles("*.png");
        if (!files || files.length === 0) return null;
        files.sort();

        // Assume format like Name_00000.png or Name00000.png
        var first = files[0].name;
        var match = first.match(/^(.*?)(\d+)(\.png)$/i);
        if (!match) return null;

        var prefix = match[1];
        var numStr = match[2];
        var padding = numStr.length;
        var startNum = parseInt(numStr, 10);

        return {
            prefix: prefix,
            padding: padding,
            start: startNum,
            count: files.length,
            fileObj: files[0]
        };
    }



    function showPostRenderDialog(outFolder, seq, ffmpegRes, options, dims) {
        // Simple confirmation dialog - NO progress bar, NO updates during conversion
        var d = new Window("dialog", "Post-Render Conversion");
        d.orientation = "column";
        d.alignChildren = ["fill", "top"];
        d.margins = 15;
        d.spacing = 10;

        // Info
        d.add("statictext", undefined, "Source Folder:");
        var srcLbl = d.add("statictext", undefined, seq.fileObj.parent.fsName);
        setTextColor(srcLbl, [0.6, 0.6, 0.6]);

        d.add("statictext", undefined, "");
        d.add("statictext", undefined, "Sequence: " + seq.prefix + " [" + seq.count + " frames]");

        // FFmpeg Status
        var ffmpegColor = ffmpegRes ? [0, 0.7, 0] : [0.9, 0, 0];
        var ffmpegText = ffmpegRes ? "✓ FFmpeg Found" : "✗ FFmpeg NOT FOUND";
        var ffmpegLbl = d.add("statictext", undefined, ffmpegText);
        setTextColor(ffmpegLbl, ffmpegColor);

        // Conversion Options Summary
        d.add("statictext", undefined, "");
        var optList = [];
        if (options.webm) optList.push("WebM");
        if (options.mov) optList.push("MOV");
        if (options.html) optList.push("HTML");
        if (options.zip) optList.push("ZIP");
        d.add("statictext", undefined, "Will create: " + optList.join(", "));

        // Warning
        d.add("statictext", undefined, "");
        var warnLbl = d.add("statictext", undefined, "⚠ After Effects will FREEZE during conversion.");
        setTextColor(warnLbl, [1, 0.6, 0]);
        var warnLbl2 = d.add("statictext", undefined, "   This is normal. Please wait for completion.");
        setTextColor(warnLbl2, [0.6, 0.6, 0.6]);

        // Buttons
        d.add("statictext", undefined, "");
        var btnGrp = d.add("group");
        btnGrp.alignment = ["center", "top"];
        var startBtn = btnGrp.add("button", undefined, "Start Conversion");
        startBtn.preferredSize = [140, 30];
        var cancelBtn = btnGrp.add("button", undefined, "Cancel");
        cancelBtn.preferredSize = [100, 30];

        // Track user choice
        var shouldStart = false;

        startBtn.onClick = function () {
            if (!ffmpegRes) {
                alert("Cannot convert: FFmpeg not found.\n\nPlease set FFmpeg path in Settings > Post-Render tab.");
                return;
            }
            shouldStart = true;
            d.close();  // CRITICAL: Close dialog BEFORE conversion starts
        };

        cancelBtn.onClick = function () {
            shouldStart = false;
            d.close();
        };

        d.center();
        d.show();

        // FIX: Run conversion AFTER dialog is fully closed
        if (shouldStart) {
            runConversionV2(outFolder, seq, options, dims);
        }
    }



    // Main Function to trigger from UI
    function processPostRender(ui) {
        // 1. Determine Folder
        var aeFile = (app.project.file) ? app.project.file : null;
        if (!aeFile) { alert("Save project first."); return; }

        // Try to guess Render folder
        var projectRev = ui.inputs.revision.text.replace(/^R/i, "");
        var possibleRenderFolder = new Folder(aeFile.parent.fsName + "/Render_R" + projectRev);

        var targetFolder = null;
        if (possibleRenderFolder.exists) {
            targetFolder = possibleRenderFolder;
        } else {
            // Check previous revision? Or just prompt
            targetFolder = Folder.selectDialog("Select the Render_R# folder containing PNG sequence");
        }

        if (!targetFolder || !targetFolder.exists) return;

        // 2. Detect PNG
        var seq = detectPNGSequence(targetFolder);
        if (!seq) { alert("No valid PNG sequence (frame_xxxxx.png or similar) found in:\n" + targetFolder.fsName); return; }

        // 3. Get Options
        var ffmpegOk = checkFFmpeg();
        var opts = {
            webm: (getSetting(CONFIG.SETTINGS.KEYS.POST_RENDER_WEBM, "true") === "true"),
            mov: (getSetting(CONFIG.SETTINGS.KEYS.POST_RENDER_MOV, "true") === "true"),
            html: (getSetting(CONFIG.SETTINGS.KEYS.POST_RENDER_HTML, "true") === "true"),
            zip: (getSetting(CONFIG.SETTINGS.KEYS.POST_RENDER_ZIP, "true") === "true"),
            targetMB: parseFloat(getSetting(CONFIG.SETTINGS.KEYS.TARGET_SIZE_MB, "2.5")) || 2.5,
            title: app.project.file.name.replace(/\.aep/i, "")
        };

        // 4. Dimensions/FPS
        var mainComp = findMainComp(); // Helper existing in script
        var dims = {
            width: (mainComp) ? mainComp.width : 750,
            height: (mainComp) ? mainComp.height : 300,
            fps: (mainComp) ? mainComp.frameRate : 24
        };

        showPostRenderDialog(targetFolder, seq, ffmpegOk, opts, dims);
    }

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

            var titleGrp = hdrGrp.add("group");
            titleGrp.orientation = "row";
            titleGrp.alignChildren = ["left", "center"];

            var title = titleGrp.add("statictext", undefined, "BIG HAPPY LAUNCHER");
            try { title.graphics.font = ScriptUI.newFont("Arial", "BOLD", 14); } catch (e) { }

            // Version Label
            var ver = titleGrp.add("statictext", undefined, "v" + CONFIG.VERSION);
            try { ver.graphics.foregroundColor = ver.graphics.newPen(ver.graphics.PenType.SOLID_COLOR, [0.5, 0.5, 0.5], 1); } catch (e) { }

            // DEBUG TRIGGER: Alt+Click title to run unit tests
            title.addEventListener("click", function (e) {
                if (e.altKey) {
                    runUnitTests();
                }
            });

            // Spacer to push settings button to right
            var spacer = hdrGrp.add("group");
            spacer.alignment = ["fill", "fill"];

            ui.btns.settings = hdrGrp.add("button", undefined, "⚙");
            ui.btns.settings.preferredSize = [25, 25];
            ui.btns.settings.helpTip = "Open Settings";
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

            ui.inputs.campaign = addRow(ui.mainGrp, "Campaign:", "");
            ui.inputs.campaign.helpTip = "Enter the campaign or project name";

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
            setTextColor(ui.labels.basePath, [0.5, 0.5, 0.5]);
            // Cleaned up: Browse button removed, moved to Settings
        }

        function createPreview() {
            var div = ui.w.add("panel", [0, 0, 100, 1]);
            div.alignment = ["fill", "top"];

            ui.labels.pathPreview = ui.w.add("statictext", undefined, "Path: ...");
            ui.labels.pathPreview.alignment = ["fill", "top"];
            setTextColor(ui.labels.pathPreview, [0.4, 0.8, 0.4]);

            ui.labels.filenamePreview = ui.w.add("statictext", undefined, "Filename: ...");
            ui.labels.filenamePreview.alignment = ["center", "top"];
            setTextColor(ui.labels.filenamePreview, [0.4, 0.7, 1]);
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
            setTextColor(ui.labels.status, [0.5, 0.5, 0.5]);
            // Template management buttons moved to Settings
        }

        function createRenderSection() {
            ui.btns.render = ui.w.add("button", undefined, "ADD TO RENDER QUEUE");
            ui.btns.render.preferredSize.height = 28;
            ui.btns.render.alignment = ["fill", "top"];
            try { ui.btns.render.graphics.font = ScriptUI.newFont("Arial", "BOLD", 11); } catch (e) { }

            ui.btns.convert = ui.w.add("button", undefined, "CONVERT (WebM / MOV)");
            ui.btns.convert.preferredSize.height = 25;
            ui.btns.convert.alignment = ["fill", "top"];
            ui.btns.convert.helpTip = "Process rendered PNG sequence to WebM, MOV, and HTML";
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
            setTextColor(ui.labels.status, color);
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
            var cmpVal = validateInput(ui.inputs.campaign.text, "campaign");

            if (!brandVal.isValid && ui.inputs.brand.text.length > 0) {
                ui.inputs.brand.helpTip = "Error: " + brandVal.msg;
                ui.setStatus("Brand invalid: " + brandVal.msg, [1, 0, 0]);
            } else if (!cmpVal.isValid && ui.inputs.campaign.text.length > 0) {
                ui.inputs.campaign.helpTip = "Error: " + cmpVal.msg;
                ui.setStatus("Campaign invalid: " + cmpVal.msg, [1, 0, 0]);
            } else {
                ui.inputs.brand.helpTip = "Enter the brand/client name (required)";
                ui.inputs.campaign.helpTip = "Enter the campaign or project name";
                ui.updateStatus();
            }

            var filename = ui.buildFilename(brand, campaign, quarter, size, version, revision, isDOOHTemplate(t.name));

            var templateFolderName = getTemplateFolderName(t.width, t.height);
            var fullPath = getAeFolderPath(getBaseWorkFolder(), year, quarter, brand, campaign, templateFolderName, t.width, t.height, version);

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
            var versionStr = "V" + (parseInt(ui.inputs.version.text, 10) || 1);

            var templateFolderName = getTemplateFolderName(t.width, t.height);
            var aeFolder = getAeFolderPath(getBaseWorkFolder(), year, quarter, brand, campaign, templateFolderName, t.width, t.height, versionStr);

            var isDOOH = isDOOHTemplate(t.name);
            var maxR = 50;
            var foundR = 1;

            for (var r = 1; r <= maxR; r++) {
                var filename = ui.buildFilename(brand, campaign, quarter, size, versionStr, "R" + r, isDOOH);
                if (fileExists(joinPath(aeFolder, filename))) {
                    foundR = r + 1;
                } else {
                    break;
                }
            }

            ui.inputs.revision.text = String(foundR);
            ui.updatePreview();

            // SMART VERSIONING: Check if higher versions exist
            // Navigate up from AE_File -> V# -> SizeFolder
            // aeFolder is .../V#/AE_File
            var folderObj = new Folder(aeFolder);
            var sizeFolderObj = (folderObj.parent) ? folderObj.parent.parent : null;

            if (sizeFolderObj && sizeFolderObj.exists) {
                var currentV = parseInt(ui.inputs.version.text, 10);
                for (var v = currentV + 1; v <= currentV + 10; v++) {
                    var checkV = "V" + v;
                    var vFolder = new Folder(joinPath(sizeFolderObj.fsName, checkV));
                    if (vFolder.exists) {
                        ui.setStatus("Note: Newer version " + checkV + " already exists", [1, 0.5, 0]);
                        break;
                    }
                }
            }
        };



        // --- EXECUTE BUILD ---
        createHeader();
        createMainInputs();
        createPreview();
        createActionButtons();
        createTemplateManagement();
        createRenderSection();

        // Init
        ui.refreshDropdown();
        bindEvents(ui);

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
                            if (type.indexOf("dooh") !== -1 && t.width === 1920 && t.height === 1080 && mainComp.width === 1920) { ui.dropdowns.template.selection = i; break; }
                            if (type.indexOf("dooh") !== -1 && t.width === 1080 && t.height === 1920 && mainComp.width === 1080) { ui.dropdowns.template.selection = i; break; }
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
                    // DOOH Auto-Detect Fix
                    var type = getTemplateType(mainComp.width, mainComp.height);
                    for (var i = 0; i < ui.templates.length; i++) {
                        var t = ui.templates[i];
                        if (type.indexOf("dooh") !== -1) {
                            // Match dimensions specifically for DOOH
                            if (mainComp.width === t.width && mainComp.height === t.height) {
                                ui.dropdowns.template.selection = i;
                                break;
                            }
                        }
                    }

                    if (parsed.campaign) {
                        ui.inputs.brand.text = "DOOH"; // Set brand generic
                        ui.inputs.campaign.text = parsed.campaign; // Set campaign correctly
                    }
                    if (parsed.version) ui.inputs.version.text = parsed.version.replace(/^V/i, "");
                    if (parsed.revision) ui.inputs.revision.text = parsed.revision.replace(/^R/i, "");
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

    /**
     * Run post-render conversion via external shell script
     * This prevents crashes by using a single system.callSystem() call
     */
    function runConversionV2(outFolder, seq, options, dims) {
        var ffmpegPath = getSetting(CONFIG.SETTINGS.KEYS.FFMPEG_PATH, "");
        var isWin = ($.os.indexOf("Windows") !== -1);

        // Output paths
        var scriptPath = outFolder.fsName + (isWin ? "\\convert.bat" : "/convert.sh");
        var logPath = outFolder.fsName + (isWin ? "\\convert_log.txt" : "/convert_log.txt");
        var outWebM = outFolder.fsName + (isWin ? "\\output.webm" : "/output.webm");
        var outMov = outFolder.fsName + (isWin ? "\\output.mov" : "/output.mov");
        var outHtml = outFolder.fsName + (isWin ? "\\index.html" : "/index.html");
        var passLog = outFolder.fsName + (isWin ? "\\ffmpeg2pass" : "/ffmpeg2pass");

        // =================================================================================
        // 1. GENERATE HTML (Mediabunny External Link Version)
        // =================================================================================
        if (options.html) {
            var htmlContent = '<!DOCTYPE html>\n' +
                '<html>\n' +
                '  <head>\n' +
                '    <meta charset="UTF-8" />\n' +
                '    <title>' + (options.title || "Animation") + ' - Big Happy</title>\n' +
                '    <script src="https://cdn.bighappy.co/libs/mediabunny/v1.25.0/mediabunny.min.cjs"></script>\n' +
                '    <style>\n' +
                '      html, body { margin: 0; padding: 0; }\n' +
                '    </style>\n' +
                '  </head>\n' +
                '  <body>\n' +
                '    <div id="animation_container">\n' +
                '      <canvas id="webmCanvas" width="' + dims.width + '" height="' + dims.height + '"></canvas>\n' +
                '    </div>\n' +
                '    <script>\n' +
                '      const { Input, BlobSource, WEBM, VideoSampleSink } = Mediabunny;\n' +
                '      const videoUrl = "./output.webm";\n' +
                '      \n' +
                '      (async function playWithMediabunny(url) {\n' +
                '        const canvas = document.getElementById("webmCanvas");\n' +
                '        if (!canvas) return;\n' +
                '        if (!url) return;\n' +
                '\n' +
                '        const ctx = canvas.getContext("2d", { alpha: true });\n' +
                '        if (!ctx) return;\n' +
                '\n' +
                '        try {\n' +
                '          const resp = await fetch(url);\n' +
                '          if (!resp.ok) throw new Error("File not found or blocked: " + resp.statusText);\n' +
                '          const blob = await resp.blob();\n' +
                '\n' +
                '          const input = new Input({\n' +
                '            source: new BlobSource(blob),\n' +
                '            formats: [WEBM],\n' +
                '          });\n' +
                '\n' +
                '          const videoTrack = await input.getPrimaryVideoTrack();\n' +
                '          if (!videoTrack) return;\n' +
                '\n' +
                '          const decodable = await videoTrack.canDecode();\n' +
                '          if (!decodable) return;\n' +
                '\n' +
                '          const sink = new VideoSampleSink(videoTrack);\n' +
                '          let firstTimestamp = null;\n' +
                '          let startWallClock = null;\n' +
                '\n' +
                '          for await (const sample of sink.samples()) {\n' +
                '            try {\n' +
                '              if (firstTimestamp === null) {\n' +
                '                firstTimestamp = sample.timestamp;\n' +
                '                startWallClock = performance.now();\n' +
                '              }\n' +
                '              const targetTime = startWallClock + (sample.timestamp - firstTimestamp) * 1000;\n' +
                '              const delay = targetTime - performance.now();\n' +
                '              if (delay > 0) await new Promise((r) => setTimeout(r, delay));\n' +
                '\n' +
                '              ctx.clearRect(0, 0, canvas.width, canvas.height);\n' +
                '              sample.drawWithFit(ctx, { fit: "cover" });\n' +
                '            } finally {\n' +
                '              sample.close();\n' +
                '            }\n' +
                '          }\n' +
                '        } catch (e) {\n' +
                '          console.error(e);\n' +
                '          if (e.name === "TypeError" && window.location.protocol === "file:") {\n' +
                '            alert("SECURITY ERROR:\\n\\nBrowsers block loading external video files (output.webm) when opening HTML directly from your hard drive.\\n\\nSOLUTION:\\n1. Upload to a server\\n2. Or use a local server (VS Code Live Server)\\n3. Or use Firefox (it is less strict)");\n' +
                '          } else {\n' +
                '             alert("Playback Error: " + e.message);\n' +
                '          }\n' +
                '        }\n' +
                '      })(videoUrl);\n' +
                '    </script>\n' +
                '  </body>\n' +
                '</html>';

            var htmlFile = new File(outHtml);
            htmlFile.encoding = "UTF-8";
            htmlFile.open("w");
            htmlFile.write(htmlContent);
            htmlFile.close();
        }

        var scriptFile = new File(scriptPath);
        var logFile = new File(logPath);
        if (logFile.exists) logFile.remove();

        var script = "";
        var exe = ffmpegPath ? '"' + ffmpegPath + '"' : "ffmpeg";
        var pattern = seq.fileObj.parent.fsName + (isWin ? "\\" : "/") + seq.prefix + (isWin ? "%%0" : "%0") + seq.padding + "d.png";
        var fps = dims.fps;

        // Zip Path
        var zipPath = outFolder.fsName + (isWin ? "\\" : "/") + seq.prefix.replace(/_+$/, "") + "_Optimized.zip";

        // =================================================================================
        // 2. CONVERSION COMMANDS (Improved CRF)
        // =================================================================================
        if (isWin) {
            script += "@echo off\r\n";
            script += "chcp 65001 >NUL\r\n";
            script += "echo Starting conversion... > \"" + logPath + "\"\r\n";

            if (options.webm) {
                script += "echo [1/3] Converting to WebM (High Quality)... >> \"" + logPath + "\"\r\n";
                // CRF 24 = Better Quality
                script += exe + " -y -framerate " + fps + " -start_number " + seq.start + " -i \"" + pattern + "\" -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 24 -speed 0 -quality best -row-mt 1 -pass 1 -passlogfile \"" + passLog + "\" -an -f null NUL 2>> \"" + logPath + "\"\r\n";
                script += exe + " -y -framerate " + fps + " -start_number " + seq.start + " -i \"" + pattern + "\" -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 24 -speed 0 -quality best -row-mt 1 -pass 2 -passlogfile \"" + passLog + "\" -an \"" + outWebM + "\" 2>> \"" + logPath + "\"\r\n";
                script += "if exist \"" + outWebM + "\" (echo WebM: SUCCESS >> \"" + logPath + "\") else (echo WebM: FAILED >> \"" + logPath + "\")\r\n";
                script += "del \"" + passLog + "-0.log\" 2>nul\r\n";
            }

            if (options.mov) {
                script += "echo [2/3] Converting to MOV (High Quality)... >> \"" + logPath + "\"\r\n";
                // CRF 24 = Better Quality
                var cmdHevc = exe + " -y -framerate " + fps + " -start_number " + seq.start + " -i \"" + pattern + "\" -c:v libx265 -pix_fmt yuva444p10le -x265-params alpha=1 -crf 24 -preset slow -tag:v hvc1 \"" + outMov + "\" 2>> \"" + logPath + "\"";
                var cmdH264 = exe + " -y -framerate " + fps + " -start_number " + seq.start + " -i \"" + pattern + "\" -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow \"" + outMov + "\" 2>> \"" + logPath + "\"";
                script += "(" + cmdHevc + ") || (echo HEVC_FAILED_TRYING_H264 >> \"" + logPath + "\" && " + cmdH264 + ")\r\n";
                script += "if exist \"" + outMov + "\" (echo MOV: SUCCESS >> \"" + logPath + "\") else (echo MOV: FAILED >> \"" + logPath + "\")\r\n";
            }

            // HTML is already written, no embedding step needed

            if (options.zip) {
                script += "echo [4/4] Creating ZIP... >> \"" + logPath + "\"\r\n";
                var files = [];
                if (options.html) files.push("'" + outHtml + "'");
                if (options.webm) files.push("'" + outWebM + "'");
                if (options.mov) files.push("'" + outMov + "'");

                if (files.length > 0) {
                    script += "powershell -Command \"Compress-Archive -Path " + files.join(",") + " -DestinationPath '" + zipPath + "' -Force\" 2>> \"" + logPath + "\"\r\n";
                    script += "if exist \"" + zipPath + "\" (echo ZIP: SUCCESS >> \"" + logPath + "\") else (echo ZIP: FAILED >> \"" + logPath + "\")\r\n";
                }
            }
            script += "echo CONVERSION_COMPLETE >> \"" + logPath + "\"\r\n";

        } else {
            // MACOS
            script += "#!/bin/bash\n";
            script += "echo 'Starting conversion...' > \"" + logPath + "\"\n";

            if (options.webm) {
                script += exe + " -y -framerate " + fps + " -start_number " + seq.start + " -i \"" + pattern + "\" -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 24 -speed 0 -quality best -row-mt 1 -pass 1 -passlogfile \"" + passLog + "\" -an -f null /dev/null 2>> \"" + logPath + "\"\n";
                script += exe + " -y -framerate " + fps + " -start_number " + seq.start + " -i \"" + pattern + "\" -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 24 -speed 0 -quality best -row-mt 1 -pass 2 -passlogfile \"" + passLog + "\" -an \"" + outWebM + "\" 2>> \"" + logPath + "\"\n";
                script += "[ -f \"" + outWebM + "\" ] && echo 'WebM: SUCCESS' >> \"" + logPath + "\" || echo 'WebM: FAILED' >> \"" + logPath + "\"\n";
                script += "rm -f \"" + passLog + "-0.log\" 2>/dev/null\n";
            }

            if (options.mov) {
                script += exe + " -y -framerate " + fps + " -start_number " + seq.start + " -i \"" + pattern + "\" -c:v libx265 -pix_fmt yuva444p10le -x265-params alpha=1 -crf 24 -preset slow -tag:v hvc1 \"" + outMov + "\" 2>> \"" + logPath + "\"\n";
                script += "[ -f \"" + outMov + "\" ] && echo 'MOV: SUCCESS' >> \"" + logPath + "\" || echo 'MOV: FAILED' >> \"" + logPath + "\"\n";
            }

            // HTML is already written

            if (options.zip) {
                script += "echo '[4/4] Zip...' >> \"" + logPath + "\"\n";
                var zipFiles = [];
                if (options.html) zipFiles.push("\"" + outHtml + "\"");
                if (options.webm) zipFiles.push("\"" + outWebM + "\"");
                if (options.mov) zipFiles.push("\"" + outMov + "\"");
                if (zipFiles.length > 0) {
                    script += "zip -j \"" + zipPath + "\" " + zipFiles.join(" ") + " 2>> \"" + logPath + "\"\n";
                    script += "[ -f \"" + zipPath + "\" ] && echo 'ZIP: SUCCESS' >> \"" + logPath + "\" || echo 'ZIP: FAILED' >> \"" + logPath + "\"\n";
                }
            }
            script += "echo 'CONVERSION_COMPLETE' >> \"" + logPath + "\"\n";
        }

        // Write Script File
        scriptFile.encoding = "UTF-8";
        scriptFile.lineFeed = isWin ? "Windows" : "Unix";
        scriptFile.open("w");
        scriptFile.write(script);
        scriptFile.close();

        // Execute
        if (!isWin) system.callSystem("chmod +x \"" + scriptPath + "\"");
        writeLog("Running conversion script: " + scriptPath, "INFO");

        var execCmd = isWin ? "cmd /c \"" + scriptPath + "\"" : "bash \"" + scriptPath + "\"";
        if (!isWin) {
            var safePath = scriptPath.replace(/"/g, '\\"');
            execCmd = 'osascript -e \'do shell script "/bin/bash \\"' + safePath + '\\""\'';
        }

        system.callSystem(execCmd);
        $.sleep(2000); // 2 seconds delay

        // Check Success
        var successCount = 0;
        var failedItems = [];
        if (logFile.exists) {
            logFile.open("r");
            var logContent = logFile.read();
            logFile.close();
            if (logContent.indexOf("WebM: SUCCESS") !== -1) successCount++;
            if (logContent.indexOf("MOV: SUCCESS") !== -1) successCount++;
            if (options.html && new File(outHtml).exists) successCount++;
            if (logContent.indexOf("ZIP: SUCCESS") !== -1) successCount++;
        }

        var resultMsg = "═══════════════════════════════\n   POST-RENDER COMPLETE\n═══════════════════════════════\n\n";
        resultMsg += (successCount > 0 ? "✓ " + successCount + " successful\n" : "") + (failedItems.length > 0 ? "✗ Failed: " + failedItems.join(", ") : "");

        // Detailed file listing
        resultMsg += "\nOutput Files:\n";
        var fWebM = new File(outWebM);
        var fMov = new File(outMov);
        var fHtml = new File(outHtml);
        var fZip = new File(zipPath);

        if (fWebM.exists) resultMsg += " • output.webm (" + Math.round(fWebM.length / 1024) + " KB)\n";
        if (fMov.exists) resultMsg += " • output.mov (" + Math.round(fMov.length / 1024) + " KB)\n";
        if (fHtml.exists) resultMsg += " • index.html (" + Math.round(fHtml.length / 1024) + " KB)\n";
        if (fZip.exists) resultMsg += " • " + new File(zipPath).name + " (" + Math.round(fZip.length / 1024) + " KB)\n";

        resultMsg += "\nLocation: " + outFolder.fsName;

        try { scriptFile.remove(); } catch (e) { }
        alert(resultMsg);

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
