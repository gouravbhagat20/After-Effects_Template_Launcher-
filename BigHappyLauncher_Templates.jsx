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
    // SECTION 0: CORE UTILITIES (Moved to top for Config dependency)
    // =========================================================================

    // FIX P0-1: Define path utilities BEFORE Config to avoid "undefined" errors
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

    // =========================================================================
    // SECTION 1: CONFIGURATION & SETTINGS
    // =========================================================================

    var CONFIG = {
        VERSION: "2.1", // FIX P1-6: Match header version
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
                TARGET_SIZE_MB: "target_size_mb",
                GDRIVE_ROOT: "gdrive_root"
            },
            MAX_RECENT_FILES: 10
        },
        PATHS: {
            LOG_FILE: joinPath(Folder.myDocuments.fsName, "BigHappyLauncher_Log.txt"),
            GLOBAL_ASSETS: "_GlobalAssets",
            FOLDER_AE: "AE_File",
            FOLDER_ASSETS: "Assets",
            FOLDER_RENDER_PREFIX: "Render_", // Prefix for Render_R1, Render_R2...
            FOLDER_FOOTAGE: "(Footage)"
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
    // SECTION 1B.1: GOOGLE DRIVE SYNC LOGIC
    // =========================================================================

    function copyFolderRecursive(sourceFolder, destFolder) {
        if (!sourceFolder.exists) return false;
        if (!destFolder.exists) destFolder.create();

        var files = sourceFolder.getFiles();
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            if (f instanceof File) {
                f.copy(joinPath(destFolder.fsName, f.name));
            } else if (f instanceof Folder) {
                var newDest = new Folder(joinPath(destFolder.fsName, f.name));
                copyFolderRecursive(f, newDest);
            }
        }
        return true;
    }

    /**
     * Get or create a numbered project folder in the target directory.
     * Scans for existing "##.FolderName" patterns and reuses if found, otherwise increments.
     * @param {string} quarterFolderPath - Path to the quarter folder (e.g., "Drive/2026/Q1")
     * @param {string} projectName - The project name without number prefix (e.g., "Brand_Campaign")
     * @returns {string} The full numbered folder name (e.g., "03.Brand_Campaign")
     */
    function getOrCreateNumberedFolder(quarterFolderPath, projectName) {
        var quarterFolder = new Folder(quarterFolderPath);
        if (!quarterFolder.exists) {
            // First project in this quarter
            return "01." + projectName;
        }

        var subFolders = quarterFolder.getFiles(function (f) { return f instanceof Folder; });
        var highestNumber = 0;
        var existingFolder = null;

        // Pattern: "##.FolderName" where ## is 2-digit number
        var pattern = /^(\d{2})\.(.+)$/;

        for (var i = 0; i < subFolders.length; i++) {
            var folderName = subFolders[i].name;
            var match = folderName.match(pattern);
            if (match) {
                var num = parseInt(match[1], 10);
                var name = match[2];

                // Track highest number
                if (num > highestNumber) {
                    highestNumber = num;
                }

                // Check if this folder matches our project name (case-insensitive)
                if (name.toLowerCase() === projectName.toLowerCase()) {
                    existingFolder = folderName;
                }
            }
        }

        // If we found an existing folder with the same name, reuse it
        if (existingFolder) {
            return existingFolder;
        }

        // Otherwise, create a new incremented number
        var nextNumber = highestNumber + 1;
        var paddedNumber = (nextNumber < 10 ? "0" : "") + nextNumber;
        return paddedNumber + "." + projectName;
    }

    function collectAndUpload(ui) {
        // 1. Validation
        if (!app.project || !app.project.file) { showError("BH-2003"); return; }

        var driveRoot = getSetting(CONFIG.SETTINGS.KEYS.GDRIVE_ROOT, "");
        if (!driveRoot || !new Folder(driveRoot).exists) {
            alert("Google Drive Root path is not set or invalid.\n\nPlease go to Settings > System > Google Drive Root.");
            return;
        }

        // --- PROGRESS UI ---
        var w = new Window("palette", "Collect & Upload", undefined, { closeButton: false });
        w.orientation = "column"; w.alignChildren = ["fill", "top"]; w.spacing = 10; w.margins = 15;
        var stText = w.add("statictext", undefined, "Initializing...", { truncate: "middle" });
        stText.preferredSize.width = 300;
        var pb = w.add("progressbar", undefined, 0, 100);
        pb.preferredSize.width = 300;
        w.center(); w.show(); w.update();

        // Step-based progress tracking (more accurate than hardcoded percentages)
        var TOTAL_STEPS = 10; // Total workflow steps
        var currentStep = 0;

        function updateProgress(msg, stepNum) {
            if (typeof stepNum === "number") currentStep = stepNum;
            else currentStep++;
            var pct = Math.round((currentStep / TOTAL_STEPS) * 100);
            stText.text = msg;
            pb.value = Math.min(pct, 100);
            w.update();
        }

        try {
            // 2. Prepare Local Collect
            updateProgress("Preparing local folders...", 1);

            var currentFile = app.project.file;
            var currentName = currentFile.name.replace(/\.aep$/i, "");
            var projectFolder = currentFile.parent;

            // FIX: Prevent Recursive Collection
            // Check if we are already inside a collection folder
            if (projectFolder.name === "Collected_Files" || projectFolder.parent.name === "Collected_Files" ||
                projectFolder.name === "_Collected" || projectFolder.parent.name === "_Collected") {
                w.close();
                alert("Cannot Collect a project that is already inside a 'Collected_Files' folder.\n\nPlease open the original source project and try again.");
                return;
            }

            // Create "Collected_Files" folder in current project directory
            var localCollectRoot = new Folder(joinPath(projectFolder.fsName, "Collected_Files"));
            if (!localCollectRoot.exists) localCollectRoot.create();

            // Unique folder for this collect action: Brand_Campaign_V#_R#
            var parsed = parseProjectName(currentName);
            var collectFolderName = currentName; // Fallback

            // Use parsed info to ensure proper naming if possible, otherwise use filename
            if (parsed) {
                // Reconstruct clean name for folder
                collectFolderName = ui.buildFilename(parsed.brand, parsed.campaign, parsed.quarter || "QX", parsed.size, parsed.version, parsed.revision, parsed.isDOOH);
                collectFolderName = collectFolderName.replace(/\.aep$/i, "");
            }

            // SHARED ASSETS: Create Shared Library Folder
            var localCommonAssets = new Folder(joinPath(localCollectRoot.fsName, "_Common_Assets"));
            if (!localCommonAssets.exists) localCommonAssets.create();

            var destFolder = new Folder(joinPath(localCollectRoot.fsName, collectFolderName));
            if (!destFolder.exists) destFolder.create();

            // ==============================
            // PRE-FLIGHT CHECK
            // ==============================
            updateProgress("Running Pre-Flight Check...", 2);
            var missingFiles = preFlightCheck();
            if (missingFiles.length > 0) {
                var preview = missingFiles.slice(0, 5).join("\n");
                if (missingFiles.length > 5) preview += "\n... and " + (missingFiles.length - 5) + " more.";
                var proceed = confirm("⚠️ PRE-FLIGHT WARNING\n\n" + missingFiles.length + " file(s) are MISSING:\n\n" + preview + "\n\nContinue anyway?");
                if (!proceed) {
                    w.close();
                    return;
                }
            }

            // ==============================
            // REMOVE UNUSED FOOTAGE
            // ==============================
            updateProgress("Removing unused footage...", 3);
            removeUnusedFootage();

            // 3. Save Copy & Collect Assets LOCALLY
            updateProgress("Saving local copy...", 4);

            // Step 3a: Save ORIGINAL first to ensure changes are safe
            if (app.project.file) app.project.save();
            var localAepPath = joinPath(destFolder.fsName, currentName + ".aep");
            app.project.save(new File(localAepPath)); // Save project As copy

            // Collect Assets (Use Shared Folder)
            updateProgress("Collecting assets to Shared Library...", 5);
            // Pass localCommonAssets to collectAssets to force it to use this folder
            var assetsCount = collectAssets(destFolder, localCommonAssets);

            // Step 3b: Save COLLECTED project to persist the asset relinks made by collectAssets
            app.project.save();

            // ==============================
            // GENERATE PACK REPORT
            // ==============================
            updateProgress("Generating Pack Report...", 6);
            generatePackReport(destFolder, missingFiles);

            writeLog("Locally Collected: " + localAepPath, "INFO");

            // 4. UPLOAD TO DRIVE (Smart Mirroring)
            updateProgress("Connecting to Drive...", 7);

            var year = ui.dropdowns.year.selection ? ui.dropdowns.year.selection.text : String(getCurrentYear());
            var quarter = "Q1";
            var projectFolderName = "Brand_Project"; // Fallback

            // Try to derive better structure from parsed data or current UI
            if (parsed) {
                quarter = parsed.quarter || (ui.dropdowns.quarter.selection ? ui.dropdowns.quarter.selection.text : "Q1");

                var bName = parsed.brand;
                var cName = parsed.campaign;
                if (parsed.isDOOH && bName === "DOOH") {
                    bName = "DOOH";
                }

                projectFolderName = bName;
                if (cName) projectFolderName += "_" + cName;
            }

            // Construct Drive Paths
            var pYear = joinPath(driveRoot, year);
            var pQuarter = joinPath(pYear, quarter);

            // Use incremental numbering helper
            var brandFolder = getOrCreateNumberedFolder(pQuarter, projectFolderName);
            var pBrand = joinPath(pQuarter, brandFolder);

            var pAE = joinPath(pBrand, "AE");

            // Define Drive Path for Shared Assets
            var driveCommonAssets = new Folder(joinPath(pAE, "_Common_Assets"));

            // Create Drive Structure
            updateProgress("Creating Drive structure...", 8);
            if (!createFolderRecursive(pAE)) {
                w.close();
                alert("Failed to create Drive folders:\n" + pAE + "\n\nCheck permissions.");
                return;
            }

            // 5. UPLOAD SHARED ASSETS
            updateProgress("Syncing Shared Assets...", 9);

            if (localCommonAssets.exists) {
                // Ensure drive common folder exists
                if (!createFolderRecursive(driveCommonAssets.fsName)) {
                    // Try standard create if recursive fails or returns false
                    driveCommonAssets.create();
                }

                var commonFiles = localCommonAssets.getFiles();
                for (var cf = 0; cf < commonFiles.length; cf++) {
                    var cFile = commonFiles[cf];
                    if (cFile instanceof File) {
                        var driveFile = new File(joinPath(driveCommonAssets.fsName, cFile.name));
                        if (!driveFile.exists) {
                            cFile.copy(driveFile); // Only copy if missing
                        }
                    }
                }
                writeLog("Synced Shared Assets to: " + driveCommonAssets.fsName, "INFO");
            }

            // Project File Destination
            var driveRevisionFolder = new Folder(joinPath(pAE, collectFolderName));
            if (!driveRevisionFolder.exists) driveRevisionFolder.create();

            var driveAepPath = joinPath(driveRevisionFolder.fsName, currentName + ".aep");

            // Copy AEP with Retry
            updateProgress("Uploading Project File...", 10);
            var localFile = new File(localAepPath);
            var uploadSuccess = false;
            var maxRetries = 3;

            for (var attempt = 1; attempt <= maxRetries; attempt++) {
                if (localFile.copy(driveAepPath)) {
                    uploadSuccess = true;
                    writeLog("Uploaded Project: " + driveAepPath, "INFO");
                    break;
                } else {
                    writeLog("Upload attempt " + attempt + " failed. Retrying...", "WARN");
                    $.sleep(1000); // Wait 1 second before retry
                }
            }

            if (!uploadSuccess) {
                w.close();
                alert("Failed to copy project file to Drive after " + maxRetries + " attempts.");
                return;
            }

            updateProgress("Done!", 10);
            $.sleep(200);
            w.close();

            var resultMsg = "Pack & Upload Complete: " + driveAepPath;
            ui.setStatus(resultMsg, [0, 0.8, 0]); // GREEN Status
            // alert(resultMsg); // Disabled per user request


            // 6. RETURN TO ORIGINAL PROJECT
            // Since we did 'Save As', the user is currently looking at the _Collected file.
            // We should return them to the original working file to prevent confusion and recursion errors.
            if (currentFile && currentFile.exists) {
                app.open(currentFile);
            }

        } catch (e) {
            if (w) w.close();
            alert("Error during Collection/Upload:\n" + e.toString());
        }
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

    // (Utilities moved to top - FIX P0-1)

    function fileExists(path) {
        if (!path) return false;
        return new File(path).exists;
    }

    // Removed Duplicate folderExists and createFolderRecursive
    // They are defined fully in SECTION 2 (lines 355-371) to avoid duplication. The code below now just relies on those definitions or standard objects.

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

    // FIX P0-3: True recursive folder creation
    function createFolderRecursive(path) {
        try {
            var folder = new Folder(path);
            if (folder.exists) return true;

            // Ensure parent exists first
            if (folder.parent && !folder.parent.exists) {
                if (!createFolderRecursive(folder.parent.fsName)) {
                    return false;
                }
            }
            return folder.create();
        } catch (e) {
            return false;
        }
    }

    // =========================================================================
    // SECTION 2B.2: COLLECT & UPLOAD HELPERS
    // =========================================================================

    /**
     * Remove unused footage from project before collecting.
     * Uses app.project.reduceProject() which keeps only items used in specified comps.
     */
    function removeUnusedFootage() {
        try {
            var mainComp = findMainComp();
            if (mainComp) {
                app.project.reduceProject([mainComp]);
                writeLog("Removed unused footage (reduceProject)", "INFO");
                return true;
            }
            return false;
        } catch (e) {
            writeLog("removeUnusedFootage failed: " + e.toString(), "WARN");
            return false;
        }
    }

    /**
     * Pre-flight check: scan for missing files before upload.
     * @returns {Array} List of missing file descriptions
     */
    function preFlightCheck() {
        var missing = [];
        try {
            var items = app.project.items;
            for (var i = 1; i <= items.length; i++) {
                var item = items[i];
                if (item instanceof FootageItem && item.file && !item.file.exists) {
                    missing.push(item.name + " → " + item.file.fsName);
                }
            }
        } catch (e) {
            writeLog("preFlightCheck error: " + e.toString(), "WARN");
        }
        return missing;
    }

    /**
     * Get list of fonts used in text layers across all comps.
     * @returns {Array} Unique font names
     */
    function getFontsUsed() {
        var fonts = {};
        try {
            for (var i = 1; i <= app.project.numItems; i++) {
                var item = app.project.item(i);
                if (item instanceof CompItem) {
                    for (var j = 1; j <= item.numLayers; j++) {
                        var layer = item.layer(j);
                        if (layer instanceof TextLayer) {
                            try {
                                var textDoc = layer.property("Source Text").value;
                                if (textDoc && textDoc.font) {
                                    fonts[textDoc.font] = true;
                                }
                            } catch (e) { /* ignore */ }
                        }
                    }
                }
            }
        } catch (e) { /* ignore */ }
        var result = [];
        for (var f in fonts) result.push(f);
        return result;
    }

    /**
     * Get list of effects/plugins used across all layers.
     * @returns {Array} Unique effect names
     */
    function getEffectsUsed() {
        var effects = {};
        try {
            for (var i = 1; i <= app.project.numItems; i++) {
                var item = app.project.item(i);
                if (item instanceof CompItem) {
                    for (var j = 1; j <= item.numLayers; j++) {
                        var layer = item.layer(j);
                        try {
                            var effectsGroup = layer.property("Effects");
                            if (effectsGroup) {
                                for (var e = 1; e <= effectsGroup.numProperties; e++) {
                                    var eff = effectsGroup.property(e);
                                    if (eff && eff.matchName) {
                                        effects[eff.name + " (" + eff.matchName + ")"] = true;
                                    }
                                }
                            }
                        } catch (e) { /* ignore */ }
                    }
                }
            }
        } catch (e) { /* ignore */ }
        var result = [];
        for (var f in effects) result.push(f);
        return result;
    }

    /**
     * Generate pack report with fonts, effects, and missing files.
     * @param {Folder} destFolder - Destination folder for report
     * @param {Array} missingList - List of missing files from preFlightCheck
     */
    function generatePackReport(destFolder, missingList) {
        try {
            var report = "=== PACK REPORT ===\n";
            report += "Generated: " + new Date().toLocaleString() + "\n";
            report += "Project: " + (app.project.file ? app.project.file.name : "Untitled") + "\n\n";

            // Missing Files
            report += "--- MISSING FILES (" + missingList.length + ") ---\n";
            if (missingList.length === 0) {
                report += "(None - All files found!)\n";
            } else {
                for (var i = 0; i < missingList.length; i++) {
                    report += "• " + missingList[i] + "\n";
                }
            }

            // Fonts Used
            var fonts = getFontsUsed();
            report += "\n--- FONTS USED (" + fonts.length + ") ---\n";
            if (fonts.length === 0) {
                report += "(No text layers found)\n";
            } else {
                for (var j = 0; j < fonts.length; j++) {
                    report += "• " + fonts[j] + "\n";
                }
            }

            // Effects Used
            var effects = getEffectsUsed();
            report += "\n--- EFFECTS/PLUGINS (" + effects.length + ") ---\n";
            if (effects.length === 0) {
                report += "(No effects applied)\n";
            } else {
                for (var k = 0; k < effects.length; k++) {
                    report += "• " + effects[k] + "\n";
                }
            }

            // Write File
            var reportPath = joinPath(destFolder.fsName, "_Pack_Report.txt");
            var reportFile = new File(reportPath);
            reportFile.open("w");
            reportFile.write(report);
            reportFile.close();

            writeLog("Generated Pack Report: " + reportPath, "INFO");
            return true;
        } catch (e) {
            writeLog("generatePackReport error: " + e.toString(), "WARN");
            return false;
        }
    }

    function collectAssets(targetFolder, targetFolderOverride) {
        var w = null;
        try {
            // SHARED ASSET LOGIC: 
            // If targetFolderOverride is passed, use it directly (e.g. _Common_Assets).
            // Otherwise, create standard "(Footage)" folder inside targetFolder.
            var footageFolder;
            if (targetFolderOverride) {
                footageFolder = targetFolderOverride;
            } else {
                footageFolder = new Folder(joinPath(targetFolder.fsName, CONFIG.PATHS.FOLDER_FOOTAGE));
                if (!footageFolder.exists) footageFolder.create();
            }

            var items = app.project.items;
            var totalItems = items.length;
            var count = 0;

            w = new Window("palette", "Importing Project...", undefined, { closeButton: false });
            w.orientation = "column"; w.alignChildren = ["fill", "top"]; w.margins = 15; w.spacing = 10;
            w.add("statictext", undefined, "Collection Mode: " + (targetFolderOverride ? "Shared Assets" : "Standard"));
            var pb = w.add("progressbar", [0, 0, 300, 15], 0, totalItems);
            var lbl = w.add("statictext", undefined, "Scanning...");
            try { lbl.graphics.font = ScriptUI.newFont("Arial", "REGULAR", 10); } catch (e) { }
            w.center(); w.show(); w.update();

            for (var i = 1; i <= items.length; i++) {
                // Update Progress
                if (i % 5 === 0) { // Throttle updates
                    pb.value = i;
                    lbl.text = "Item " + i + " of " + totalItems;
                    w.update();
                }

                var item = items[i];
                if (!item) continue;

                if (item instanceof FootageItem && item.file && item.mainSource && !(item.mainSource instanceof SolidSource)) {
                    var sourceFile = item.file;
                    if (sourceFile.exists) {
                        var destName = sanitizeName(sourceFile.name);
                        var destPath = joinPath(footageFolder.fsName, destName);
                        var destFile = new File(destPath); // Target for the main file (or first frame)

                        // Check if it is a sequence
                        var isSequence = false;
                        if (!item.mainSource.isStill) {
                            var ext = sourceFile.name.split(".").pop().toLowerCase();
                            // If not still, and has image extension, treat as sequence
                            if (ext.match(/^(png|jpg|jpeg|tif|tiff|tga|exr|psd)$/i)) {
                                isSequence = true;
                            }
                        }

                        if (isSequence) {
                            // SEQUENCE COPY LOGIC
                            // Robust approach to find all files in the sequence
                            var seqFolder = sourceFile.parent;
                            if (seqFolder && seqFolder.exists) {
                                // Regex to find the number part at end of filename
                                // e.g. "Seq.0001.png" -> prefix "Seq.", digits "0001"
                                var namePart = sourceFile.name.replace(/\.[^\.]+$/, ""); // strip extension
                                var match = namePart.match(/^(.*?)(\d+)$/);

                                var foundFiles = false;

                                if (match) {
                                    var prefix = match[1];
                                    var fileExt = sourceFile.name.split(".").pop();

                                    // Robust Case-Insensitive Search
                                    var lowerPrefix = prefix.toLowerCase();
                                    var lowerExt = fileExt.toLowerCase();

                                    var seqFiles = seqFolder.getFiles(function (f) {
                                        if (f instanceof Folder) return false;
                                        var fName = f.name.toLowerCase();
                                        // Match prefix AND extension
                                        return (fName.indexOf(lowerPrefix) === 0 && fName.indexOf("." + lowerExt) !== -1);
                                    });

                                    if (seqFiles && seqFiles.length > 0) {
                                        foundFiles = true;
                                        var allCopied = true;
                                        for (var s = 0; s < seqFiles.length; s++) {
                                            var sf = seqFiles[s];
                                            var df = new File(joinPath(footageFolder.fsName, sf.name));
                                            if (!df.exists) {
                                                if (!sf.copy(df.fsName)) allCopied = false;
                                            }
                                        }

                                        // Update item to point to the new location of the representative file
                                        // Use replaceWithSequence to force AE to detect it as a sequence
                                        if (allCopied) {
                                            destFile = new File(joinPath(footageFolder.fsName, sourceFile.name));

                                            // Safe check for sequence replacement approach
                                            var replaced = false;
                                            try {
                                                if (typeof item.replaceWithSequence === "function") {
                                                    item.replaceWithSequence(destFile, false); // false = trust numbering
                                                    replaced = true;
                                                }
                                            } catch (errSeq) {
                                                // Fallback if method fails or not supported
                                            }

                                            if (!replaced) {
                                                item.replace(destFile);
                                            }
                                            count++;
                                        }
                                    }
                                }

                                // Fallback: If logic matches failed or no files found,
                                // revert to single file copy to ensure at least something is copied.
                                if (!foundFiles) {
                                    if (!destFile.exists) sourceFile.copy(destFile);
                                    item.replace(destFile);
                                    count++;
                                }
                            }
                        } else {
                            // STANDARD SINGLE FILE COPY (Images, Movies, Audio)
                            // Smart Link Logic:
                            var dupIdx = 1;
                            var parts = destName.split(".");
                            var fileExt = parts.pop();
                            var base = parts.join(".");

                            while (destFile.exists && destFile.length !== sourceFile.length) {
                                destFile = new File(joinPath(footageFolder.fsName, base + "_" + dupIdx + "." + fileExt));
                                dupIdx++;
                            }

                            if (!destFile.exists) {
                                sourceFile.copy(destFile);
                            }

                            item.replace(destFile);
                            count++;
                        }
                    }
                }
            }
            if (w) w.close();
            return count;
        } catch (e) {
            if (w) w.close();
            // writeLog("Collection Error: " + e.toString(), "ERROR");
            return 0;
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
        // Fix 2: Campaign is optional - allow empty
        if (type === "campaign" && (!text || text.length === 0)) {
            return { isValid: true, msg: "OK" };
        }

        if (!text || text.length === 0) return { isValid: false, msg: "Required" };

        if (type === "brand") {
            if (text.length < CONFIG.LIMITS.BRAND_MIN) return { isValid: false, msg: "Too short (<" + CONFIG.LIMITS.BRAND_MIN + ")" };
            if (text.length > CONFIG.LIMITS.BRAND_MAX) return { isValid: false, msg: "Too long (>" + CONFIG.LIMITS.BRAND_MAX + ")" };
        }

        if (type === "campaign") {
            if (text.length > CONFIG.LIMITS.CAMPAIGN_MAX) return { isValid: false, msg: "Too long (>" + CONFIG.LIMITS.CAMPAIGN_MAX + ")" };
        }

        // Fix: Add Numeric Validations
        if (type === "width" || type === "height" || type === "fps" || type === "duration") {
            var num = parseFloat(text);
            if (isNaN(num)) return { isValid: false, msg: "Not a number" };
            if (num <= 0) return { isValid: false, msg: "Must be positive" };

            if (type === "width" && (num < CONFIG.LIMITS.WIDTH_MIN || num > CONFIG.LIMITS.WIDTH_MAX)) return { isValid: false, msg: "Width out of range" };
            if (type === "height" && (num < CONFIG.LIMITS.HEIGHT_MIN || num > CONFIG.LIMITS.HEIGHT_MAX)) return { isValid: false, msg: "Height out of range" };
            if (type === "fps" && (num < CONFIG.LIMITS.FPS_MIN || num > CONFIG.LIMITS.FPS_MAX)) return { isValid: false, msg: "FPS out of range" };
            if (type === "duration" && (num < CONFIG.LIMITS.DURATION_MIN || num > CONFIG.LIMITS.DURATION_MAX)) return { isValid: false, msg: "Duration out of range" };

            return { isValid: true, msg: "OK" };
        }

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
    // FIX P1-7: Secure JSON parsing with fallback
    function jsonParse(str, defaultValue) {
        if (!str || typeof str !== "string") return defaultValue;

        // Trim whitespace
        str = str.replace(/^\s+|\s+$/g, "");

        // 1. Try Native JSON if available (AE CC 2014+)
        if (typeof JSON !== "undefined" && typeof JSON.parse === "function") {
            try {
                return JSON.parse(str);
            } catch (e) {
                return defaultValue;
            }
        }

        // 2. Legacy Fallback (ES3)
        // Basic validation: must start with [ or {
        if (str.charAt(0) !== "[" && str.charAt(0) !== "{") {
            return defaultValue;
        }

        // Security check: reject strings containing dangerous patterns
        var dangerous = /\b(function|eval|new\s+Function|setTimeout|setInterval|execScript|document|window|alert|this\.)\b/i;
        if (dangerous.test(str)) {
            return defaultValue;
        }

        // Block assignment operators and semicolons
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

        var result = {
            quarter: null // Initialize to null to match tests/expectations
        };
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
            result.brand = "DOOH"; // Fix 4: Ensure brand is set for DOOH
            // prefix = everything before suffix was removed
            // We need to reconstruct the prefix since we've been stripping from 'remaining'
            // The logic below for DOOH parsing needs to just look at what's left in 'remaining'

            // campaign = everything after "DOOH_"
            var doohContent = remaining.replace(/^DOOH_?/i, "");
            result.campaign = doohContent || "";
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
            // FIX P0-4: Unit tests match parser behavior (isDOOH=true -> brand="DOOH")
            { input: "DOOH_Spotify_Wrapped_1080x1920_V3_R2", expected: { brand: "DOOH", campaign: "Spotify_Wrapped", quarter: null, size: "1080x1920", version: "V3", revision: "R2", isDOOH: true } },
            { input: "DOOH_Generic_1920x1080_V1_R1", expected: { brand: "DOOH", campaign: "Generic", quarter: null, size: "1920x1080", version: "V1", revision: "R1", isDOOH: true } },
            { input: "DOOH_1920x1080_V1_R1", expected: { brand: "DOOH", campaign: "", quarter: null, size: "1920x1080", version: "V1", revision: "R1", isDOOH: true } },
            { input: "SimpleBrand_300x600_V1_R1", expected: { brand: "SimpleBrand", campaign: "", quarter: null, size: "300x600", version: "V1", revision: "R1", isDOOH: false } }
        ];

        var passed = 0;
        var failed = 0;
        var log = "Running Unit Tests (v2.1)...\n\n";

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

    // ===================================
    // TEST 2: COMPREHENSIVE SYSTEM CHECK
    // ===================================
    function runStressTests() {
        var log = "Running Comprehensive System Check...\n";
        var passed = 0;
        var failed = 0;

        function runTest(name, result) {
            if (result) {
                passed++;
            } else {
                failed++;
                log += "[FAIL] " + name + "\n";
            }
        }

        // --- 1. Sanitization Logic ---
        runTest("Sanitize: Basic", sanitizeName("Hello World") === "Hello_World");
        runTest("Sanitize: Illegal Chars", sanitizeName("A/B\\C:D*E?F\"G<H>I|J") === "ABCDEFGHIJ");
        runTest("Sanitize: Reserved Windows", sanitizeName("CON") === "CON_");
        runTest("Sanitize: Reserved (Lower)", sanitizeName("prn") === "prn_");
        runTest("Sanitize: Trim & Collapse", sanitizeName("   A   B   ") === "A_B");
        runTest("Sanitize: Empty", sanitizeName("") === "");
        runTest("Sanitize: Null", sanitizeName(null) === "");

        // --- 2. Validation Logic ---
        runTest("Valid: Brand OK", validateInput("Nike", "brand").isValid === true);
        runTest("Valid: Brand Short", validateInput("A", "brand").isValid === false);
        runTest("Valid: Brand Long", validateInput(new Array(52).join("A"), "brand").isValid === false);
        runTest("Valid: Width OK", validateInput("1920", "width").isValid === true);
        runTest("Valid: Width Text", validateInput("abc", "width").isValid === false);
        runTest("Valid: Width Neg", validateInput("-100", "width").isValid === false);
        runTest("Valid: FPS OK", validateInput("24", "fps").isValid === true);
        runTest("Valid: FPS Huge", validateInput("999", "fps").isValid === false);

        // --- 3. Path Logic ---
        var s = SEP;
        runTest("Path: Join Basic", joinPath("Video", "File.mov") === "Video" + s + "File.mov");
        runTest("Path: Join Empty A", joinPath("", "File.mov") === "File.mov");
        runTest("Path: Join Empty B", joinPath("Folder", "") === "Folder");
        runTest("Path: Join Slash Fix", joinPath("A/", "/B").replace(/\\/g, "/") === "A/B"); // Normalize for test

        // --- 4. Project Parsing (Edge Cases) ---
        var p1 = parseProjectName("Brand_Camp_100x100_V1_R1");
        runTest("Parse: Standard", p1 && p1.brand === "Brand" && p1.size === "100x100");

        var p2 = parseProjectName("JustBrand_1920x1080_V2_R5");
        runTest("Parse: No Campaign", p2 && p2.brand === "JustBrand" && p2.campaign === "");

        var p3 = parseProjectName("DOOH_Huge_Campaign_1080x1920_R99");
        runTest("Parse: DOOH (No Q)", p3 && p3.isDOOH === true && p3.version === "V1");

        var p4 = parseProjectName("Bad_Format_File");
        runTest("Parse: Invalid", p4 === null);

        // --- 5. JSON Safety ---
        runTest("JSON: Valid", jsonParse('{"a":1}', null).a === 1);
        runTest("JSON: Malformed", jsonParse('{a:1', "fail") === "fail");
        runTest("JSON: Injection", jsonParse('(function(){return 1})()', "safe") === "safe");

        var total = passed + failed;
        var resultMsg = "COMPREHENSIVE CHECK COMPLETED\n\n";
        resultMsg += "Total Tests: " + total + "\n";
        resultMsg += "PASSED: " + passed + "\n";
        resultMsg += "FAILED: " + failed + "\n\n";

        if (failed > 0) {
            resultMsg += "Failures Details:\n" + log;
        } else {
            resultMsg += "ALL SYSTEMS GO. Logic is robust.";
        }

        alert(resultMsg);
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
            var aeFolder = joinPath(versionFolder, CONFIG.PATHS.FOLDER_AE);
            var publishedFolder = joinPath(aeFolder, CONFIG.PATHS.FOLDER_RENDER_PREFIX + revision);
            var assetsFolder = joinPath(versionFolder, CONFIG.PATHS.FOLDER_ASSETS);

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
                    // FIX P1-5: Safe cleanup - only delete if empty, ignore errors
                    for (var j = createdFolders.length - 1; j >= 0; j--) {
                        try {
                            var cleanupFolder = new Folder(createdFolders[j]);
                            // Only attempt remove if exists. remove() on folder only works if empty.
                            if (cleanupFolder.exists) cleanupFolder.remove();
                        } catch (cleanupErr) {
                            // Silently ignore cleanup failures
                        }
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
            // FIX P1-5: Cleanup on exception
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
                    // Force PNG Sequence + Alpha for Sunrise
                    var pngSettings = {
                        "Format": "PNG Sequence",
                        "Video Output": {
                            "Channels": "RGB + Alpha",
                            "Depth": "Millions of Colors+",
                            "Color": "Straight (Unmatted)"
                        }
                    };

                    // Fallback for older AE versions that might use different key names
                    try { om.setSettings(pngSettings); }
                    catch (e1) {
                        // Try simpler "Straight"
                        pngSettings["Video Output"]["Color"] = "Straight";
                        om.setSettings(pngSettings);
                    }

                } catch (e) {
                    writeLog("Failed to auto-set Sunrise PNG settings: " + e.toString(), "WARN");
                }
            } else if (templateType === "dooh" || templateType === "interscroller" || templateType.indexOf("dooh") !== -1 || templateType.indexOf("dooh_horizontal") !== -1 || templateType.indexOf("dooh_vertical") !== -1) {
                try {
                    // Force H.264 (MP4)
                    var mp4Settings = {
                        "Format": "H.264",
                        "Video Output": {
                            "Format Options": {
                                "Profile": "High",
                                "Level": "5.1",
                                "Target Bitrate (Mbps)": 15
                            }
                        }
                    };
                    om.setSettings(mp4Settings);
                } catch (e) {
                    // Fallback to QuickTime if H.264 is unavailable as a direct Format (older AE)
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

        // Google Drive
        var driveGrp = sysTab.add("panel", undefined, "Google Drive Sync");
        driveGrp.alignChildren = ["left", "top"];
        driveGrp.add("statictext", undefined, "Google Drive Root Folder:");
        var driveRow = driveGrp.add("group");
        var driveInput = driveRow.add("edittext", undefined, getSetting(CONFIG.SETTINGS.KEYS.GDRIVE_ROOT, ""));
        driveInput.preferredSize.width = 250;
        var driveBtn = driveRow.add("button", undefined, "...");
        driveBtn.onClick = function () {
            var f = Folder.selectDialog("Select Google Drive Root (e.g. G:/My Drive)");
            if (f) driveInput.text = f.fsName;
        };
        driveGrp.add("statictext", undefined, "Structure: Root / Year / Quarter / 00.Brand_Campaign / AE");


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
            // Bulk check for missing templates
            var check = ensureTemplatesExist(ui.templates, ui.templatesFolder, false); // false = only missing

            if (check.generated.length > 0) {
                ui.templates = check.templates;
                saveTemplates(ui.templates);
                alert("Auto-repaired " + check.generated.length + " missing template(s):\n\n" + check.generated.join("\n"));
            } else {
                // If none missing, offer Factory Reset
                if (confirm("All templates are present.\n\nForce Regenerate ALL templates (Factory Reset)?\nThis will overwrite any manual changes to .aep files.")) {
                    check = ensureTemplatesExist(ui.templates, ui.templatesFolder, true); // true = force all
                    ui.templates = check.templates;
                    saveTemplates(ui.templates);
                    alert("Success: All templates have been reset to factory defaults.");
                }
            }
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

            // Save System Settings
            setSetting(CONFIG.SETTINGS.KEYS.GDRIVE_ROOT, driveInput.text);

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
        // Inputs
        // CRASH FIX: Removed onChanging entirely. ScriptUI instability.
        // Updates will happen on commit (Enter or click away).

        // Update labels only on change (done typing)
        ui.inputs.brand.onChange = ui.inputs.campaign.onChange = function () {
            ui.updatePreview();
            ui.checkRevision();
        };

        ui.inputs.version.onChanging = ui.inputs.revision.onChanging = ui.updatePreview;
        ui.dropdowns.quarter.onChange = ui.dropdowns.year.onChange = function () { ui.checkRevision(); };

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
        if (ui.btns.open) {
            ui.btns.open.onClick = function () {
                ui.openProject();
            };
        }

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

        ui.btns.vPlus.onClick = function () {
            if (!app.project || !app.project.file) { showError("BH-2003"); return; }
            try {
                var currentName = app.project.file.name.replace(/\.aep$/i, "");
                var parsed = parseProjectName(currentName);
                if (!parsed) { alert("Cannot parse project name format."); return; }

                // 1. Calculate New Version (Bump V, Reset R)
                var currentVerNum = parseInt(parsed.version.replace(/^V/i, ""), 10) || 1;
                var newVerNum = currentVerNum + 1;
                var version = "V" + newVerNum;
                var revision = "R1"; // Reset to R1

                // 2. Initial Guess for Year/Quarter
                var currentPath = app.project.file.parent.fsName;
                var yearMatch = currentPath.match(/[\/\\](\d{4})[\/\\]/);
                var quarterMatch = currentPath.match(/[\/\\](Q[1-4])[\/\\]/);

                var year = yearMatch ? yearMatch[1] : String(getCurrentYear());
                var quarter = parsed.quarter || (quarterMatch ? quarterMatch[1] : (ui.dropdowns.quarter.selection ? ui.dropdowns.quarter.selection.text : "Q1"));

                // 3. Confirm Dialog
                var confirmWin = new Window("dialog", "Major Version Up");
                confirmWin.add("statictext", undefined, "Create New Version: " + version + "?");

                var grp = confirmWin.add("group");
                grp.add("statictext", undefined, "Year: " + year + " | Quarter: " + quarter);

                var btnGrp = confirmWin.add("group");
                btnGrp.alignment = ["center", "bottom"];
                var okBtn = btnGrp.add("button", undefined, "OK", { name: "ok" });
                var cnclBtn = btnGrp.add("button", undefined, "Cancel", { name: "cancel" });

                if (confirmWin.show() !== 1) return;

                // 4. Structure
                var dims = parsed.size.split("x");
                var width = parseInt(dims[0], 10);
                var height = parseInt(dims[1], 10);
                var templateType = getTemplateType(width, height);
                var templateFolderName = getTemplateFolderName(width, height);
                var sizeFolderName = templateFolderName + "_" + parsed.size;
                var brand = parsed.brand;
                if (parsed.isDOOH && !brand) brand = "DOOH";
                var campaign = parsed.campaign || "";
                var projectName = buildProjectFolderName(brand, campaign);
                var basePath = getBaseWorkFolder();

                var folders = createProjectStructure(basePath, year, quarter, projectName, sizeFolderName, revision, templateType, version);
                if (!folders) return;

                // 5. Filename
                var newFilename;
                if (parsed.isDOOH) {
                    newFilename = "DOOH_" + (campaign || brand) + "_" + parsed.size + "_" + version + "_" + revision + ".aep";
                } else {
                    newFilename = brand + "_" + campaign + "_" + quarter + "_" + parsed.size + "_" + version + "_" + revision + ".aep";
                }

                // 6. Save
                var savePath = joinPath(folders.aeFolder, newFilename);
                var saveFile = new File(savePath);

                if (saveFile.exists) {
                    if (!confirm("File already exists:\n" + newFilename + "\n\nOverwrite?")) return;
                }

                app.project.save(saveFile);

                // Update UI
                ui.inputs.version.text = String(newVerNum);
                ui.inputs.revision.text = "1";
                ui.updatePreview();
                addToRecentFiles(savePath);

                alert("Version Up Successful!\n\nNew Version: " + version + "\nReset to: R1\nSaved to: " + folders.aeFolder);

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
            var revision = (parsed && parsed.revision) ? parsed.revision : ("R" + ui.inputs.revision.text);
            var renderFolder = joinPath(aeFolder, "Render_" + revision);
            createFolderRecursive(renderFolder);
            var outputPath = joinPath(renderFolder, renderName);

            var rqItem = addToRenderQueue(mainComp, outputPath, type);
            if (!rqItem) return;

            writeLog("Queued render: " + renderName + " [" + type + "] -> " + outputPath, "INFO");

            var useAME = (getSetting(CONFIG.SETTINGS.KEYS.AME_ENABLED, "false") === "true");
            var notified = false;

            if (useAME) {
                if (canQueueInAME()) {
                    if (queueToAME()) {
                        alert("Sent to Adobe Media Encoder.\nRender started in AME.");
                        notified = true;
                    } else {
                        showWarning("BH-3004");
                        notified = true;
                    }
                } else {
                    showWarning("BH-3003");
                    notified = true;
                }
            }

            if (!notified) {
                alert("Added to Render Queue!");
            }
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
            runConversion(outFolder, seq, options, dims);
        }
    }



    // Main Function to trigger from UI
    function processPostRender(ui) {
        // 1. Determine Folder
        var aeFile = (app.project.file) ? app.project.file : null;
        if (!aeFile) { alert("Save project first."); return; }

        // Try to guess Render folder
        var projectRev = ui.inputs.revision.text.replace(/^R/i, "");
        var possibleRenderFolder = new Folder(aeFile.parent.fsName + "/" + CONFIG.PATHS.FOLDER_RENDER_PREFIX + "R" + projectRev);

        var targetFolder = null;
        if (possibleRenderFolder.exists) {
            targetFolder = possibleRenderFolder;
        } else {
            // Check previous revision? Or just prompt
            targetFolder = Folder.selectDialog("Select the " + CONFIG.PATHS.FOLDER_RENDER_PREFIX + "R# folder containing PNG sequence");
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

    // --- EXTRACTED UI HELPERS ---

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

    function createHeader(ui) {
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

        // Hidden Unit Tests trigger (Alt+Click / Shift+Click on Title)
        title.addEventListener("click", function (k) {
            // Check modifier keys using event object if available, or environment fallback
            var isAlt = (k.altKey) || (typeof ScriptUI.environment !== "undefined" && ScriptUI.environment.keyboardState && ScriptUI.environment.keyboardState.altKey);
            var isShift = (k.shiftKey) || (typeof ScriptUI.environment !== "undefined" && ScriptUI.environment.keyboardState && ScriptUI.environment.keyboardState.shiftKey);

            if (isAlt) {
                runUnitTests();
            } else if (isShift) {
                runStressTests();
            }
        });

        // Spacer to push buttons to right
        var spacer = hdrGrp.add("group");
        spacer.alignment = ["fill", "fill"];

        // HEADER TOOLBAR (Open, Import, Recent, Settings)
        var toolBar = hdrGrp.add("group");
        toolBar.orientation = "row";
        toolBar.spacing = 2;

        ui.btns.open = toolBar.add("button", undefined, "📂");
        ui.btns.open.preferredSize = [30, 25];
        ui.btns.open.helpTip = "Open Project";
        ui.btns.open.onClick = function () { ui.openProject(); };

        ui.btns.importBtn = toolBar.add("button", undefined, "📥");
        ui.btns.importBtn.preferredSize = [30, 25];
        ui.btns.importBtn.helpTip = "Import & Standardize";
        // onClick assigned in createActionButtons originally, needs to be here or reassigned?
        // Better to assign purely logic later or inline here if simple. 
        // Logic for import is "ui.importProject()" but it is defined via "ui.importProject = ..." in buildUI.
        // So we assign the click handler LATER in buildUI or wrapper.
        // Actually, we can just assign a proxy or keep the ref clearly.
        // We will assign the click handler in the main logic block (createActionButtons section usually does logic binding).

        ui.btns.recent = toolBar.add("button", undefined, "🕒");
        ui.btns.recent.preferredSize = [30, 25];
        ui.btns.recent.helpTip = "Recent Files";
        ui.btns.recent.onClick = function () { ui.showRecentDialog(); };

        ui.btns.settings = toolBar.add("button", undefined, "⚙");
        ui.btns.settings.preferredSize = [30, 25];
        ui.btns.settings.helpTip = "Settings";
    }

    function createMainInputs(ui) {
        ui.mainGrp = ui.w.add("panel", undefined, "Project Details");
        ui.mainGrp.orientation = "column";
        ui.mainGrp.alignChildren = ["fill", "top"];
        ui.mainGrp.spacing = 8;
        ui.mainGrp.margins = 15;

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

        // META ROW: Time & Versioning (Icon-based Groups)
        var metaGrp = ui.mainGrp.add("group");
        metaGrp.orientation = "row";
        metaGrp.alignChildren = ["fill", "center"];
        metaGrp.spacing = 10;

        // GROUP 1: Time (Calendar Icon)
        var dateGrp = metaGrp.add("group");
        dateGrp.orientation = "row";
        dateGrp.spacing = 2; // Tighter spacing within group
        dateGrp.alignChildren = ["left", "center"];

        var dateIcon = dateGrp.add("statictext", undefined, "📅");
        dateIcon.preferredSize.width = 65; // MATCH LABEL WIDTH (65px) for vertical alignment
        dateIcon.helpTip = "Period (Quarter & Year)";

        ui.dropdowns.quarter = dateGrp.add("dropdownlist", undefined, ["Q1", "Q2", "Q3", "Q4"]);
        ui.dropdowns.quarter.selection = getCurrentQuarter();
        ui.dropdowns.quarter.preferredSize = [55, 25]; // Restore reasonable width
        ui.dropdowns.quarter.helpTip = "Quarter";

        var currentYear = getCurrentYear();
        ui.dropdowns.year = dateGrp.add("dropdownlist", undefined, [
            String(currentYear - 1),
            String(currentYear),
            String(currentYear + 1),
            String(currentYear + 2)
        ]);
        ui.dropdowns.year.selection = 1;
        ui.dropdowns.year.preferredSize = [65, 25];
        ui.dropdowns.year.helpTip = "Year";


        // Spacer between groups
        var spacer = metaGrp.add("group");
        spacer.preferredSize.width = 10; // Explicit spacer


        // GROUP 2: Versioning (Tag Icon)
        var verGrp = metaGrp.add("group");
        verGrp.orientation = "row";
        verGrp.spacing = 2; // Tighter spacing within group
        verGrp.alignChildren = ["left", "center"];

        var verIcon = verGrp.add("statictext", undefined, "🏷️");
        verIcon.preferredSize.width = 25; // This is inside the row, can stay small
        verIcon.helpTip = "Versioning (V = Version, R = Revision)";

        var vLbl = verGrp.add("statictext", undefined, "V");
        ui.inputs.version = verGrp.add("edittext", undefined, "1");
        ui.inputs.version.preferredSize = [35, 25];
        ui.inputs.version.helpTip = "Version Number";

        var rLbl = verGrp.add("statictext", undefined, "R");
        ui.inputs.revision = verGrp.add("edittext", undefined, "1");
        ui.inputs.revision.preferredSize = [35, 25];
        ui.inputs.revision.helpTip = "Revision Number";


        // BASE ROW (Folder Icon)
        var baseGrp = ui.mainGrp.add("group");
        baseGrp.orientation = "row";
        baseGrp.alignChildren = ["left", "center"];
        baseGrp.spacing = 2; // Match group spacing above

        var baseIcon = baseGrp.add("statictext", undefined, "📂");
        baseIcon.preferredSize.width = 65; // MATCH LABEL WIDTH (65px)
        baseIcon.helpTip = "Base Work Folder";

        ui.labels.basePath = baseGrp.add("edittext", undefined, getBaseWorkFolder(), { readonly: true });
        ui.labels.basePath.alignment = ["fill", "center"];
        ui.labels.basePath.preferredSize.height = 25;
        ui.labels.basePath.enabled = false;

        var openBaseBtn = baseGrp.add("button", undefined, "...");
        openBaseBtn.preferredSize = [30, 25];
        openBaseBtn.helpTip = "Browse / Open Base Folder";
        openBaseBtn.onClick = function () {
            var f = new Folder(ui.labels.basePath.text);
            if (f.exists) f.execute();
            else {
                var newFolder = Folder.selectDialog("Select Base Work Folder");
                if (newFolder) {
                    setBaseWorkFolder(newFolder.fsName);
                    ui.labels.basePath.text = newFolder.fsName;
                }
            }
        };
    }

    function createPreview(ui) {
        var div = ui.w.add("panel", [0, 0, 100, 1]);
        div.alignment = ["fill", "top"];

        // Structured Information Group
        var infoGrp = ui.w.add("group");
        infoGrp.orientation = "column";
        infoGrp.alignChildren = ["left", "center"];
        infoGrp.spacing = 2;
        infoGrp.margins = [10, 5, 0, 5];

        // Path Row
        var pRow = infoGrp.add("group");
        pRow.orientation = "row";
        pRow.alignChildren = ["left", "center"];
        pRow.spacing = 5;

        var pIcon = pRow.add("statictext", undefined, "📂");
        pIcon.helpTip = "Target Folder: This is where the project will be saved";

        ui.labels.pathPreview = pRow.add("statictext", undefined, "Path: ...", { truncate: "middle" });
        ui.labels.pathPreview.preferredSize.width = 380;
        ui.labels.pathPreview.helpTip = "Target Folder Path (Click Create to save here)";
        setTextColor(ui.labels.pathPreview, [0.4, 0.8, 0.4]);

        // File Row
        var fRow = infoGrp.add("group");
        fRow.orientation = "row";
        fRow.alignChildren = ["left", "center"];
        fRow.spacing = 5;

        var fIcon = fRow.add("statictext", undefined, "📄");
        fIcon.helpTip = "Target Filename: The standardized name for your project";

        ui.labels.filenamePreview = fRow.add("statictext", undefined, "Filename: ...");
        ui.labels.filenamePreview.helpTip = "Final Filename (Standardized)";
        setTextColor(ui.labels.filenamePreview, [0.4, 0.7, 1]);
    }

    function createActionButtons(ui) {
        var actionsGrp = ui.w.add("group");
        actionsGrp.orientation = "column";
        actionsGrp.alignChildren = ["fill", "top"];
        actionsGrp.spacing = 5;

        // 1. Primary Action: CREATE
        ui.btns.create = actionsGrp.add("button", undefined, "CREATE PROJECT");
        ui.btns.create.preferredSize.height = 40;
        try { ui.btns.create.graphics.font = ScriptUI.newFont("Arial", "BOLD", 14); } catch (e) { }
        ui.btns.create.helpTip = "Create a new project from the selected template";
        ui.btns.create.onClick = function () { ui.createProject(); };

        // 2. Active Project Tools (Row below Create)
        var toolsRow = actionsGrp.add("group");
        toolsRow.orientation = "row";
        toolsRow.alignChildren = ["fill", "center"];
        toolsRow.spacing = 5;

        // Save As
        ui.btns.saveAs = toolsRow.add("button", undefined, "Save As...");
        ui.btns.saveAs.preferredSize.height = 30;
        ui.btns.saveAs.helpTip = "Save current project as new copy";

        // Versioning Group
        ui.btns.quickDup = toolsRow.add("button", undefined, "R+");
        ui.btns.quickDup.preferredSize.height = 30;
        ui.btns.quickDup.preferredSize.width = 40;
        ui.btns.quickDup.helpTip = "Quick Save: Increment Revision";
        try { ui.btns.quickDup.graphics.font = ScriptUI.newFont("Arial", "BOLD", 12); } catch (e) { }

        ui.btns.vPlus = toolsRow.add("button", undefined, "V+");
        ui.btns.vPlus.preferredSize.height = 30;
        ui.btns.vPlus.preferredSize.width = 40;
        ui.btns.vPlus.helpTip = "Version Up: Increment V# & Reset to R1";
        try { ui.btns.vPlus.graphics.font = ScriptUI.newFont("Arial", "BOLD", 12); } catch (e) { }

        // Collect
        ui.btns.collect = toolsRow.add("button", undefined, "☁ Collect");
        ui.btns.collect.preferredSize.height = 30;
        ui.btns.collect.helpTip = "Local Collect + Upload to Google Drive";
        ui.btns.collect.onClick = function () {
            collectAndUpload(ui);
        };
    }

    function createTemplateManagement(ui) {
        ui.labels.status = ui.w.add("statictext", undefined, "Ready");
        ui.labels.status.alignment = ["center", "top"];
        try { ui.labels.status.graphics.font = ScriptUI.newFont("Arial", "REGULAR", 10); } catch (e) { }
        setTextColor(ui.labels.status, [0.5, 0.5, 0.5]);
    }

    function createRenderSection(ui) {
        var rPanel = ui.w.add("panel", undefined, "Output");
        rPanel.orientation = "column";
        rPanel.alignChildren = ["fill", "top"];
        rPanel.spacing = 5;
        rPanel.margins = 10;

        ui.btns.render = rPanel.add("button", undefined, "ADD TO RENDER QUEUE");
        ui.btns.render.preferredSize.height = 30;
        try { ui.btns.render.graphics.font = ScriptUI.newFont("Arial", "BOLD", 11); } catch (e) { }

        ui.btns.convert = rPanel.add("button", undefined, "OPTIMIZE RENDER");
        ui.btns.convert.preferredSize.height = 25;
        ui.btns.convert.helpTip = "Process rendered PNG sequence to WebM, MOV, and HTML";
    }

    function buildUI(thisObj) {
        writeLog("Starting BigHappyLauncher UI...", "INFO");

        // Scope object to hold UI elements and data
        var tData = loadTemplates();
        var tFolder = getTemplatesFolder();

        // [FIX P0] Ensure physical template files exist for defaults
        if (!folderExists(tFolder)) new Folder(tFolder).create();
        var check = ensureTemplatesExist(tData, tFolder, false);
        if (check.generated.length > 0) {
            tData = check.templates; // Reload with new paths
            saveTemplates(tData);
        }

        var ui = {
            // Data
            templates: tData,
            templatesFolder: tFolder,

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
                open: null,
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
                },
                collect: null
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





        ui.btns.settings = null;















        // --- LOGIC FUNCTIONS (Methods attached to UI object) ---

        ui.showRecentDialog = function () {
            var recent = loadRecentFiles();
            if (!recent || recent.length === 0) {
                alert("No recent history found.");
                return;
            }

            var d = new Window("dialog", "Recent Projects");
            d.orientation = "column";
            d.alignChildren = ["fill", "top"];
            d.spacing = 10;
            d.margins = 15;

            var list = d.add("listbox", undefined, [], { multiselect: false });
            list.preferredSize = [450, 250];

            for (var i = 0; i < recent.length; i++) {
                var f = new File(recent[i]);
                var item = list.add("item", f.name);
                item.subItems[0] = f.parent.fsName; // Store path hinted if needed
            }

            var btnGrp = d.add("group");
            btnGrp.alignment = ["center", "bottom"];
            var openBtn = btnGrp.add("button", undefined, "Open", { name: "ok" });
            var cancelBtn = btnGrp.add("button", undefined, "Cancel", { name: "cancel" });

            list.onDoubleClick = function () {
                openBtn.notify("onClick");
            };

            openBtn.onClick = function () {
                if (list.selection) {
                    var selectedPath = recent[list.selection.index];
                    d.close();
                    ui.openProject(selectedPath);
                }
            };
            cancelBtn.onClick = function () { d.close(); };

            d.center();
            d.show();
        };

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
                var separator = (campaign && campaign.length > 0) ? "_" : "";
                var campaignPart = (campaign && campaign.length > 0) ? campaign : "";
                // If campaign is empty, we don't want trailing/double underscores
                // Pattern: Brand_Quarter... OR Brand_Campaign_Quarter...
                // Actually user requested strict specific fallback removal.
                // Re-reading logic: folder structure is Brand_Campaign (or just Brand if empty).
                // Filename was: brand + "_" + campaignName + "_" + quarter...
                // If we remove fallback, it becomes brand + "__" + quarter if we are not careful.

                // Let's match the folder logic:
                if (campaign && campaign.length > 0) {
                    return brand + "_" + campaign + "_" + quarter + "_" + size + "_" + version + "_" + revision + ".aep";
                } else {
                    return brand + "_" + quarter + "_" + size + "_" + version + "_" + revision + ".aep";
                }
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

            // SMART VERSIONING
            var folderObj = new Folder(aeFolder);
            // Fix 6: Safe parent check
            var sizeFolderObj = (folderObj.parent && folderObj.parent.parent) ? folderObj.parent.parent : null;

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

        // --- NEW: IMPORT WORKFLOW ---



        function showMetadataDialog(dims, prefill) {
            var dlg = new Window("dialog", "Standardize Project Details");
            dlg.orientation = "column";
            dlg.alignChildren = ["fill", "top"];
            dlg.spacing = 10;
            dlg.margins = 20;

            var info = dlg.add("statictext", undefined, "File dimensions: " + dims.width + "x" + dims.height);
            info.alignment = ["center", "top"];

            // Inputs
            var grp = dlg.add("group"); grp.orientation = "column"; grp.alignChildren = ["fill", "top"];

            // Brand
            var bRow = grp.add("group"); bRow.add("statictext", undefined, "Brand (Req):").preferredSize.width = 90;
            var defBrand = (prefill && prefill.brand) ? prefill.brand : "";
            var dBrand = bRow.add("edittext", undefined, defBrand); dBrand.preferredSize.width = 200;

            // Campaign
            var cRow = grp.add("group"); cRow.add("statictext", undefined, "Campaign:").preferredSize.width = 90;
            var defCamp = (prefill && prefill.campaign) ? prefill.campaign : "";
            var dCamp = cRow.add("edittext", undefined, defCamp); dCamp.preferredSize.width = 200;

            // Quarter
            var qRow = grp.add("group"); qRow.add("statictext", undefined, "Quarter:").preferredSize.width = 90;
            var dQuart = qRow.add("dropdownlist", undefined, ["Q1", "Q2", "Q3", "Q4"]);
            var qSel = getCurrentQuarter();
            if (prefill && prefill.quarter) {
                // Try to match prefill quarter "Q1", "Q2" etc
                for (var i = 0; i < dQuart.items.length; i++) {
                    if (dQuart.items[i].text === prefill.quarter) { qSel = i; break; }
                }
            }
            dQuart.selection = qSel;

            // Year
            var yRow = grp.add("group"); yRow.add("statictext", undefined, "Year:").preferredSize.width = 90;
            var curY = getCurrentYear();
            var dYear = yRow.add("dropdownlist", undefined, [String(curY - 1), String(curY), String(curY + 1)]);
            dYear.selection = 1; // Default to current
            if (prefill && prefill.year) {
                for (var i = 0; i < dYear.items.length; i++) {
                    if (dYear.items[i].text === prefill.year) { dYear.selection = i; break; }
                }
            }

            // Version
            var vRow = grp.add("group"); vRow.add("statictext", undefined, "Version:").preferredSize.width = 90;
            var defVer = (prefill && prefill.version) ? prefill.version.replace(/^V/i, "") : "1";
            var dVer = vRow.add("edittext", undefined, defVer); dVer.preferredSize.width = 50;

            vRow.add("statictext", undefined, "(V2, V3 etc)");

            // Revision
            var rRow = grp.add("group"); rRow.add("statictext", undefined, "Revision:").preferredSize.width = 90;
            var defRev = (prefill && prefill.revision) ? prefill.revision.replace(/^R/i, "") : "1";
            var dRev = rRow.add("edittext", undefined, defRev); dRev.preferredSize.width = 50;

            var helpTxt = rRow.add("statictext", undefined, "(R1, R2 etc)");
            setTextColor(helpTxt, [0.5, 0.5, 0.5]);

            // Buttons
            var btnRow = dlg.add("group"); btnRow.alignment = ["center", "bottom"];
            var okBtn = btnRow.add("button", undefined, "OK", { name: "ok" });
            var cancelBtn = btnRow.add("button", undefined, "Cancel", { name: "cancel" });

            okBtn.onClick = function () {
                if (!dBrand.text || dBrand.text.length < 2) {
                    alert("Brand name is required.");
                    return;
                }
                dlg.close(1);
            };
            cancelBtn.onClick = function () { dlg.close(0); };

            if (dlg.show() === 1) {
                return {
                    brand: sanitizeName(dBrand.text),
                    campaign: sanitizeName(dCamp.text),
                    quarter: dQuart.selection.text,
                    year: dYear.selection.text,
                    version: "V" + (parseInt(dVer.text) || 1),
                    revision: "R" + (parseInt(dRev.text) || 1)
                };
            }
            return null;
        }

        function syncUIFromProject(ui) {
            try {
                if (!app.project || !app.project.file) return false;

                var currentName = app.project.file.name.replace(/\.aep$/i, "");
                var parsed = parseProjectName(currentName);
                var mainComp = findMainComp();

                if (parsed && parsed.brand) {
                    if (mainComp && ui.templates && ui.templates.length) {
                        for (var i = 0; i < ui.templates.length; i++) {
                            var t = ui.templates[i];
                            if (t.width === mainComp.width && t.height === mainComp.height) {
                                ui.dropdowns.template.selection = i;
                                break;
                            }
                        }
                    }

                    ui.inputs.brand.text = parsed.brand;
                    if (parsed.campaign) ui.inputs.campaign.text = parsed.campaign;
                    if (parsed.version) ui.inputs.version.text = parsed.version.replace(/^V/i, "");
                    if (parsed.revision) ui.inputs.revision.text = parsed.revision.replace(/^R/i, "");

                    if (parsed.quarter) {
                        for (var q = 0; q < ui.dropdowns.quarter.items.length; q++) {
                            if (ui.dropdowns.quarter.items[q].text === parsed.quarter) {
                                ui.dropdowns.quarter.selection = q;
                                break;
                            }
                        }
                    }
                    return true;
                } else if (parsed && parsed.isDOOH && mainComp) {
                    var type = getTemplateType(mainComp.width, mainComp.height);
                    for (var j = 0; j < ui.templates.length; j++) {
                        var t2 = ui.templates[j];
                        if (type.indexOf("dooh") !== -1 && mainComp.width === t2.width && mainComp.height === t2.height) {
                            ui.dropdowns.template.selection = j;
                            break;
                        }
                    }

                    if (parsed.campaign) {
                        ui.inputs.brand.text = "DOOH";
                        ui.inputs.campaign.text = parsed.campaign;
                    }
                    if (parsed.version) ui.inputs.version.text = parsed.version.replace(/^V/i, "");
                    if (parsed.revision) ui.inputs.revision.text = parsed.revision.replace(/^R/i, "");
                    return true;
                } else if (mainComp && ui.templates && ui.templates.length) {
                    for (var k = 0; k < ui.templates.length; k++) {
                        var t3 = ui.templates[k];
                        if (t3.width === mainComp.width && t3.height === mainComp.height) {
                            ui.dropdowns.template.selection = k;
                            break;
                        }
                    }
                }
            } catch (e) {
                // writeLog("Auto-detect failed: " + e.toString(), "WARN");
            }
            return false;
        }

        ui.collectAndUpload = function () { collectAndUpload(ui); };

        ui.openProject = function (pathOrFile) {
            var file = null;
            if (pathOrFile) {
                file = (pathOrFile instanceof File) ? pathOrFile : new File(pathOrFile);
                if (!file.exists) { alert("File not found:\n" + file.fsName); return; }
            } else {
                file = File.openDialog("Open After Effects Project", "*.aep");
            }
            if (!file) return;

            try {
                app.open(file);
                addToRecentFiles(file.fsName);
                syncUIFromProject(ui);
                ui.updateStatus();
                ui.updatePreview();
            } catch (e) {
                showError("BH-2004", e.toString());
            }
        };

        ui.importProject = function () {
            var file = File.openDialog("Select .aep file to import", "*.aep");
            if (!file) return;

            // 1. Open
            if (app.project && app.project.numItems > 0 && !app.project.saved) {
                // If dirty, just let user decide via app (or simpler: assume they want to proceed)
                // For safety, force close warning if needed, but app.open usually prompts
            }
            app.open(file);

            // 2. Detect
            var mainComp = findMainComp();
            if (!mainComp) {
                showError("BH-3001");
                return;
            }

            var width = mainComp.width;
            var height = mainComp.height;
            var templateType = getTemplateType(width, height);
            var templateFolderName = getTemplateFolderName(width, height);
            var sizeStr = templateFolderName + "_" + width + "x" + height;
            var sizeForFilename = width + "x" + height;

            // 3. Parse Metadata (for Prefill)
            var oldName = file.name.replace(/\.aep$/i, "");
            var parsed = parseProjectName(oldName);
            var prefill = {};

            if (parsed && parsed.brand) {
                prefill.brand = parsed.isDOOH ? "DOOH" : parsed.brand;
                prefill.campaign = parsed.campaign || "";
                prefill.quarter = parsed.quarter || "Q" + (getCurrentQuarter() + 1);
                prefill.version = parsed.version || "V1";
                prefill.revision = parsed.revision || "R1"; // Prefill Revision
            }

            // ALWAYS SHOW DIALOG to allow user to confirm/edit logic
            var meta = showMetadataDialog({ width: width, height: height }, prefill);

            if (!meta) return; // Cancelled

            // 4. Structure & Save
            var basePath = getBaseWorkFolder();

            var projectName = buildProjectFolderName(meta.brand, meta.campaign);
            var folders = createProjectStructure(basePath, meta.year, meta.quarter, projectName, sizeStr, meta.revision, templateType, meta.version);

            if (!folders) return;

            // 5. Smart Collect Assets
            // We want assets next to the AE file in a (Footage) folder
            // folders.aeFolder is the folder where the .aep will live
            var collectedCount = collectAssets(new Folder(folders.aeFolder));
            var isDOOH = (templateType.indexOf("dooh") !== -1 || meta.brand === "DOOH");

            // Build Target Filename
            var finalVer = meta.version;
            var finalRev = meta.revision;
            var stdName = ui.buildFilename(meta.brand, meta.campaign, meta.quarter, sizeForFilename, finalVer, finalRev, isDOOH);
            var savePath = joinPath(folders.aeFolder, stdName);

            // OVERWRITE SAFETY CHECK
            if (fileExists(savePath)) {
                var confirmOverwrite = confirm("File already exists:\n" + stdName + "\n\nOverwrite?");
                if (!confirmOverwrite) {
                    // Auto-bump instead
                    var safeR = parseInt(finalRev.replace(/^R/, "")) || 1;
                    while (fileExists(savePath) && safeR < 50) {
                        safeR++;
                        finalRev = "R" + safeR;
                        stdName = ui.buildFilename(meta.brand, meta.campaign, meta.quarter, sizeForFilename, finalVer, finalRev, isDOOH);
                        savePath = joinPath(folders.aeFolder, stdName);
                    }
                    ui.setStatus("File existed. Auto-bumped to " + finalRev, [1, 0.5, 0]);
                }
                // If confirmed overwrite, we use original savePath logic below
            }

            app.project.save(new File(savePath));
            addToRecentFiles(savePath);

            // Update UI to reflect new file
            ui.inputs.brand.text = meta.brand;
            ui.inputs.campaign.text = meta.campaign;
            ui.inputs.revision.text = finalRev.replace(/^R/, ""); // Update Revision in UI
            if (!meta.isSimple) {
                // Try to match dropdowns if possible, though if simple they were ignored
                if (meta.quarter) {
                    for (var q = 0; q < ui.dropdowns.quarter.items.length; q++) {
                        if (ui.dropdowns.quarter.items[q].text === meta.quarter) {
                            ui.dropdowns.quarter.selection = q;
                            break;
                        }
                    }
                }
            }

            // Trigger UI update
            ui.checkRevision();

            writeLog("Imported & Standardized: " + file.fsName + " -> " + savePath + " (Assets: " + collectedCount + ")", "INFO");

            // Auto-open the folder
            var saveFile = new File(savePath);
            if (saveFile.parent) saveFile.parent.execute();

            var statusMsg = "Imported: " + stdName + " (Assets: " + collectedCount + ")";
            ui.setStatus(statusMsg, [0, 0.8, 0]); // Green Success
            // alert("Import Successful!\n\nStandardized: " + stdName + "\nAssets Collected: " + collectedCount + "\n\nFolder opened.");
        };

        // --- EXECUTE BUILD ---
        createHeader(ui);
        createMainInputs(ui);
        createPreview(ui);
        createActionButtons(ui);
        createTemplateManagement(ui);
        createRenderSection(ui);

        // Init
        ui.refreshDropdown();
        bindEvents(ui);

        // Bind Import
        if (ui.btns.importBtn) {
            ui.btns.importBtn.onClick = ui.importProject;
        }

        // Auto-detect project logic
        if (app.project && app.project.file) {
            syncUIFromProject(ui);
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
    /**
     * Run post-render conversion via external shell script
     * This prevents crashes by using a single system.callSystem() call
     */
    function runConversion(outFolder, seq, options, dims) {
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

        // Show "Busy" UI
        var w = new Window("palette", "Processing...", undefined, { closeButton: false });
        w.orientation = "column";
        w.alignChildren = ["center", "center"];
        w.margins = 20;

        // Icon/Text
        var t1 = w.add("statictext", undefined, "Optimizing & Converting...");
        t1.graphics.font = ScriptUI.newFont("Arial", "BOLD", 14);

        var t2 = w.add("statictext", undefined, "This may take a moment. After Effects will pause.");
        t2.graphics.font = ScriptUI.newFont("Arial", "REGULAR", 11);
        setTextColor(t2, [0.4, 0.4, 0.4]);

        w.center();
        w.show();
        w.update(); // Force paint

        // Execute (Blocking)
        var execCmd = isWin ? "cmd /c \"" + scriptPath + "\"" : "bash \"" + scriptPath + "\"";
        if (!isWin) {
            // Safe execution for Mac
            var safePath = scriptPath.replace(/"/g, '\\"');
            execCmd = 'osascript -e \'do shell script "/bin/bash \\"' + safePath + '\\""\'';
        }

        try {
            system.callSystem(execCmd);
        } catch (e) {
            alert("Error executing conversion script:\n" + e.toString());
        }

        w.close();

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
