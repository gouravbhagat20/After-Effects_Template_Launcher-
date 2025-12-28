/*
================================================================================
  BigHappyLauncher_Templates.jsx
  After Effects ScriptUI Panel - Template Project Launcher (Protected)
================================================================================

  INSTALLATION:
  -------------
  1. Save this file to your After Effects ScriptUI Panels folder:
     - Windows: C:\Program Files\Adobe\Adobe After Effects 2024\Support Files\Scripts\ScriptUI Panels\
     - macOS: /Applications/Adobe After Effects 2024/Scripts/ScriptUI Panels/

  2. Restart After Effects

  3. Open the panel: Window > BigHappyLauncher_Templates.jsx

  4. Dock the panel where you like, then save your workspace:
     Window > Workspace > Save as New Workspace...
     The panel will appear automatically next time you use that workspace.

  FIRST TIME SETUP:
  -----------------
  1. Select each template from the dropdown
  2. Click "Set/Change Template Path"
  3. Browse to the .aep file location and select it
  4. Repeat for all 4 templates

  HOW TO USE:
  -----------
  1. Select a template from the dropdown
  2. Click "New Project from Template" - opens template and forces Save As

  TEMPLATE PROTECTION:
  --------------------
  - Original template files are NEVER modified
  - You MUST save to a new location before working
  - Saving to the same folder as template is blocked

================================================================================
*/

(function (thisObj) {

    // =========================================================================
    // CONFIGURATION
    // =========================================================================

    var SETTINGS_SECTION = "BigHappyLauncher";

    var TEMPLATES = [
        {
            label: "Sunrise (750x300 | 24fps | 15s)",
            key: "template_sunrise",
            defaultName: "Sunrise_750x300"
        },
        {
            label: "InterScroller (880x1912 | 24fps | 15s)",
            key: "template_interscroller",
            defaultName: "InterScroller_880x1912"
        },
        {
            label: "DOOH Horizontal (1920x1080 | 29.97fps | 15s)",
            key: "template_dooh_h",
            defaultName: "DOOH_Horizontal_1920x1080"
        },
        {
            label: "DOOH Vertical (1080x1920 | 29.97fps | 15s)",
            key: "template_dooh_v",
            defaultName: "DOOH_Vertical_1080x1920"
        }
    ];

    // =========================================================================
    // HELPER FUNCTIONS
    // =========================================================================

    /**
     * Get saved template path from settings
     */
    function getTemplatePath(key) {
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, key)) {
                return app.settings.getSetting(SETTINGS_SECTION, key);
            }
        } catch (e) { }
        return "";
    }

    /**
     * Save template path to settings
     */
    function setTemplatePath(key, path) {
        try {
            app.settings.saveSetting(SETTINGS_SECTION, key, path);
            return true;
        } catch (e) {
            alert("ERROR: Could not save setting.\n" + e.toString());
            return false;
        }
    }

    /**
     * Check if file exists
     */
    function fileExists(path) {
        if (!path || path.length === 0) return false;
        var f = new File(path);
        return f.exists;
    }

    /**
     * Get parent folder path from file path
     */
    function getParentFolder(filePath) {
        var f = new File(filePath);
        if (f.parent) {
            return f.parent.fsName;
        }
        return "";
    }

    /**
     * Sanitize filename - remove invalid characters
     */
    function sanitizeFilename(name) {
        var result = "";
        var invalid = "<>:\"/\\|?*";
        for (var i = 0; i < name.length; i++) {
            var c = name.charAt(i);
            var code = name.charCodeAt(i);
            if (invalid.indexOf(c) === -1 && code >= 32) {
                result += c;
            } else {
                result += "_";
            }
        }
        return result;
    }

    /**
     * Get current date string for default filename
     */
    function getDateString() {
        var d = new Date();
        var year = d.getFullYear();
        var month = d.getMonth() + 1;
        var day = d.getDate();
        if (month < 10) month = "0" + month;
        if (day < 10) day = "0" + day;
        return year + "-" + month + "-" + day;
    }

    /**
     * Check if two paths are in the same folder
     */
    function isSameFolder(path1, path2) {
        var folder1 = getParentFolder(path1);
        var folder2 = getParentFolder(path2);
        return folder1.toLowerCase() === folder2.toLowerCase();
    }

    // =========================================================================
    // BUILD UI PANEL
    // =========================================================================

    function buildUI(thisObj) {
        var panel;
        if (thisObj instanceof Panel) {
            panel = thisObj;
        } else {
            panel = new Window("palette", "Big Happy Launcher (Templates)", undefined, { resizeable: true });
        }

        panel.orientation = "column";
        panel.alignChildren = ["fill", "top"];
        panel.spacing = 10;
        panel.margins = 16;

        // Title
        var titleGroup = panel.add("group");
        titleGroup.alignment = ["center", "top"];
        var title = titleGroup.add("statictext", undefined, "Big Happy Launcher");
        try {
            title.graphics.font = ScriptUI.newFont("Arial", "BOLD", 14);
        } catch (e) { }

        var subtitle = panel.add("statictext", undefined, "Template Launcher (Protected)");
        subtitle.alignment = ["center", "top"];

        // Separator
        panel.add("panel", undefined, "").alignment = ["fill", "center"];

        // Template dropdown
        var templateGroup = panel.add("group");
        templateGroup.alignment = ["fill", "top"];
        templateGroup.add("statictext", undefined, "Template:");

        var templateLabels = [];
        for (var i = 0; i < TEMPLATES.length; i++) {
            templateLabels.push(TEMPLATES[i].label);
        }

        var templateDropdown = templateGroup.add("dropdownlist", undefined, templateLabels);
        templateDropdown.selection = 0;
        templateDropdown.alignment = ["fill", "center"];

        // Path status display
        var pathGroup = panel.add("group");
        pathGroup.alignment = ["fill", "top"];
        pathGroup.orientation = "column";
        pathGroup.alignChildren = ["fill", "top"];

        var pathLabel = pathGroup.add("statictext", undefined, "Path:");
        var pathStatus = pathGroup.add("statictext", undefined, "Loading...", { truncate: "middle" });
        pathStatus.alignment = ["fill", "top"];

        // Function to update path display
        function updatePathDisplay() {
            var idx = templateDropdown.selection ? templateDropdown.selection.index : 0;
            var template = TEMPLATES[idx];
            var path = getTemplatePath(template.key);

            if (!path || path.length === 0) {
                pathStatus.text = "[ Not Set ]";
                pathLabel.text = "Path: (not configured)";
            } else if (fileExists(path)) {
                pathStatus.text = "OK: " + path;
                pathLabel.text = "Path: (file exists)";
            } else {
                pathStatus.text = "MISSING: " + path;
                pathLabel.text = "Path: (file not found!)";
            }
        }

        // Update display when template changes
        templateDropdown.onChange = function () {
            updatePathDisplay();
        };

        // Initialize display
        updatePathDisplay();

        // Separator
        panel.add("panel", undefined, "").alignment = ["fill", "center"];

        // Protection notice
        var noticeGroup = panel.add("group");
        noticeGroup.alignment = ["center", "top"];
        var notice = noticeGroup.add("statictext", undefined, "Templates are protected from overwrite");
        try {
            notice.graphics.foregroundColor = notice.graphics.newPen(notice.graphics.PenType.SOLID_COLOR, [0.4, 0.7, 0.4], 1);
        } catch (e) { }

        // Buttons
        var buttonGroup = panel.add("group");
        buttonGroup.alignment = ["fill", "top"];
        buttonGroup.orientation = "column";
        buttonGroup.alignChildren = ["fill", "center"];
        buttonGroup.spacing = 8;

        var newProjectBtn = buttonGroup.add("button", undefined, "New Project from Template");
        newProjectBtn.preferredSize.height = 40;

        var setPathBtn = buttonGroup.add("button", undefined, "Set/Change Template Path");
        setPathBtn.preferredSize.height = 28;

        // Separator
        panel.add("panel", undefined, "").alignment = ["fill", "center"];

        // Status line
        var statusText = panel.add("statictext", undefined, "Ready. Select a template to begin.");
        statusText.alignment = ["fill", "bottom"];

        // =====================================================================
        // BUTTON HANDLERS
        // =====================================================================

        /**
         * Set/Change Template Path button
         */
        setPathBtn.onClick = function () {
            var idx = templateDropdown.selection ? templateDropdown.selection.index : 0;
            var template = TEMPLATES[idx];

            var file = File.openDialog("Select " + template.defaultName + ".aep", "After Effects Project:*.aep");

            if (file) {
                if (setTemplatePath(template.key, file.fsName)) {
                    statusText.text = "Path saved for: " + template.label.split(" (")[0];
                    updatePathDisplay();
                }
            } else {
                statusText.text = "Path selection cancelled.";
            }
        };

        /**
         * New Project from Template button (Protected)
         */
        newProjectBtn.onClick = function () {
            var idx = templateDropdown.selection ? templateDropdown.selection.index : 0;
            var template = TEMPLATES[idx];
            var templatePath = getTemplatePath(template.key);

            // Check if path is set
            if (!templatePath || templatePath.length === 0) {
                alert("Template path not configured!\n\nPlease click 'Set/Change Template Path' first to select the .aep file for:\n" + template.label);
                return;
            }

            // Check if file exists
            if (!fileExists(templatePath)) {
                alert("Template file not found!\n\nThe saved path does not exist:\n" + templatePath + "\n\nPlease click 'Set/Change Template Path' to update.");
                return;
            }

            try {
                // Open the template
                var templateFile = new File(templatePath);
                var project = app.open(templateFile);

                if (!project) {
                    statusText.text = "Failed to open template.";
                    return;
                }

                statusText.text = "Template opened. Please save to a new location...";

                // Generate default save name
                var defaultName = sanitizeFilename(template.defaultName + "_" + getDateString());
                var saveFile = null;
                var validSave = false;

                // Keep prompting until user saves to a valid location or cancels
                while (!validSave) {
                    saveFile = File.saveDialog("Save New Project As (cannot save to template folder)", "After Effects Project:*.aep");

                    if (!saveFile) {
                        // User cancelled - close project without saving
                        var closeConfirm = confirm(
                            "You must save to a new location to protect the template.\n\n" +
                            "Cancel = Go back and save\n" +
                            "OK = Close project without saving"
                        );

                        if (closeConfirm) {
                            app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
                            statusText.text = "Project closed (template protected)";
                            return;
                        }
                        // User wants to try saving again
                        continue;
                    }

                    // Ensure .aep extension
                    var savePath = saveFile.fsName;
                    if (savePath.toLowerCase().indexOf(".aep") === -1) {
                        savePath = savePath + ".aep";
                        saveFile = new File(savePath);
                    }

                    // Check if trying to save to template folder
                    if (isSameFolder(savePath, templatePath)) {
                        alert(
                            "PROTECTED: Cannot save to the template folder!\n\n" +
                            "Template folder:\n" + getParentFolder(templatePath) + "\n\n" +
                            "Please choose a different location to protect the original template."
                        );
                        continue;
                    }

                    // Check if trying to overwrite the template file itself
                    if (savePath.toLowerCase() === templatePath.toLowerCase()) {
                        alert(
                            "PROTECTED: Cannot overwrite the template file!\n\n" +
                            "Please choose a different name or location."
                        );
                        continue;
                    }

                    // Valid save location
                    validSave = true;
                }

                // Save the project
                app.project.save(saveFile);
                statusText.text = "Created: " + saveFile.name;

            } catch (e) {
                statusText.text = "Error: " + e.toString();
                alert("ERROR:\n" + e.toString());
            }
        };

        // =====================================================================
        // PANEL RESIZE HANDLING
        // =====================================================================

        panel.onResizing = panel.onResize = function () {
            this.layout.resize();
        };

        if (panel instanceof Window) {
            panel.center();
            panel.show();
        } else {
            panel.layout.layout(true);
        }

        return panel;
    }

    // =========================================================================
    // LAUNCH PANEL
    // =========================================================================

    buildUI(thisObj);

})(this);
