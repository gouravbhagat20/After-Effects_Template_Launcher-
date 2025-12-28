/*
================================================================================
  BigHappyLauncher_Templates.jsx
  After Effects ScriptUI Panel - Template Project Launcher (Protected)
  Native AE Dark UI Style
================================================================================

  INSTALLATION:
  -------------
  1. Save this file to your After Effects ScriptUI Panels folder:
     - Windows: C:\Program Files\Adobe\Adobe After Effects 2024\Support Files\Scripts\ScriptUI Panels\
     - macOS: /Applications/Adobe After Effects 2024/Scripts/ScriptUI Panels/

  2. Restart After Effects

  3. Open the panel: Window > BigHappyLauncher_Templates.jsx

  4. Dock the panel, then: Window > Workspace > Save as New Workspace...

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
    // UI COLORS (AE Native Dark Theme)
    // =========================================================================

    var UI_COLORS = {
        panelBg: [0.2, 0.2, 0.2],
        groupBg: [0.25, 0.25, 0.25],
        buttonBg: [0.31, 0.31, 0.31],
        buttonHover: [0.4, 0.4, 0.4],
        accent: [0.25, 0.5, 0.85],
        textLight: [0.85, 0.85, 0.85],
        textDim: [0.6, 0.6, 0.6],
        success: [0.4, 0.75, 0.4],
        warning: [0.9, 0.7, 0.3],
        error: [0.9, 0.4, 0.4]
    };

    // =========================================================================
    // HELPER FUNCTIONS
    // =========================================================================

    function getTemplatePath(key) {
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, key)) {
                return app.settings.getSetting(SETTINGS_SECTION, key);
            }
        } catch (e) { }
        return "";
    }

    function setTemplatePath(key, path) {
        try {
            app.settings.saveSetting(SETTINGS_SECTION, key, path);
            return true;
        } catch (e) {
            return false;
        }
    }

    function fileExists(path) {
        if (!path || path.length === 0) return false;
        var f = new File(path);
        return f.exists;
    }

    function getParentFolder(filePath) {
        var f = new File(filePath);
        return f.parent ? f.parent.fsName : "";
    }

    function sanitizeFilename(name) {
        var result = "";
        var invalid = "<>:\"/\\|?*";
        for (var i = 0; i < name.length; i++) {
            var c = name.charAt(i);
            if (invalid.indexOf(c) === -1 && name.charCodeAt(i) >= 32) {
                result += c;
            } else {
                result += "_";
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

    function isSameFolder(path1, path2) {
        return getParentFolder(path1).toLowerCase() === getParentFolder(path2).toLowerCase();
    }

    // =========================================================================
    // BUILD UI PANEL
    // =========================================================================

    function buildUI(thisObj) {
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

        // Draw panel background
        panel.graphics.backgroundColor = panel.graphics.newBrush(panel.graphics.BrushType.SOLID_COLOR, UI_COLORS.panelBg);

        // =====================================================================
        // HEADER
        // =====================================================================

        var headerGroup = panel.add("group");
        headerGroup.alignment = ["fill", "top"];
        headerGroup.alignChildren = ["center", "center"];
        headerGroup.margins = [0, 5, 0, 5];

        var titleText = headerGroup.add("statictext", undefined, "BIG HAPPY LAUNCHER");
        titleText.graphics.font = ScriptUI.newFont("Arial", "BOLD", 13);
        titleText.graphics.foregroundColor = titleText.graphics.newPen(titleText.graphics.PenType.SOLID_COLOR, UI_COLORS.textLight, 1);

        // =====================================================================
        // TEMPLATE SELECTION GROUP
        // =====================================================================

        var templatePanel = panel.add("panel", undefined, "Template");
        templatePanel.alignment = ["fill", "top"];
        templatePanel.alignChildren = ["fill", "top"];
        templatePanel.margins = 10;
        templatePanel.spacing = 8;

        var templateLabels = [];
        for (var i = 0; i < TEMPLATES.length; i++) {
            templateLabels.push(TEMPLATES[i].label);
        }

        var templateDropdown = templatePanel.add("dropdownlist", undefined, templateLabels);
        templateDropdown.selection = 0;
        templateDropdown.alignment = ["fill", "center"];
        templateDropdown.preferredSize.height = 25;

        // =====================================================================
        // PATH STATUS GROUP
        // =====================================================================

        var pathPanel = panel.add("panel", undefined, "Template Path");
        pathPanel.alignment = ["fill", "top"];
        pathPanel.alignChildren = ["fill", "top"];
        pathPanel.margins = 10;
        pathPanel.spacing = 4;

        var statusIcon = pathPanel.add("statictext", undefined, "");
        statusIcon.alignment = ["fill", "top"];

        var pathText = pathPanel.add("statictext", undefined, "", { truncate: "middle" });
        pathText.alignment = ["fill", "top"];
        pathText.preferredSize.height = 18;

        function updatePathDisplay() {
            var idx = templateDropdown.selection ? templateDropdown.selection.index : 0;
            var template = TEMPLATES[idx];
            var path = getTemplatePath(template.key);

            if (!path || path.length === 0) {
                statusIcon.text = "[ Not Configured ]";
                pathText.text = "Click 'Set Path' to configure";
                try {
                    statusIcon.graphics.foregroundColor = statusIcon.graphics.newPen(statusIcon.graphics.PenType.SOLID_COLOR, UI_COLORS.warning, 1);
                } catch (e) { }
            } else if (fileExists(path)) {
                statusIcon.text = "Ready";
                pathText.text = path;
                try {
                    statusIcon.graphics.foregroundColor = statusIcon.graphics.newPen(statusIcon.graphics.PenType.SOLID_COLOR, UI_COLORS.success, 1);
                } catch (e) { }
            } else {
                statusIcon.text = "File Not Found";
                pathText.text = path;
                try {
                    statusIcon.graphics.foregroundColor = statusIcon.graphics.newPen(statusIcon.graphics.PenType.SOLID_COLOR, UI_COLORS.error, 1);
                } catch (e) { }
            }
        }

        templateDropdown.onChange = updatePathDisplay;
        updatePathDisplay();

        // =====================================================================
        // ACTION BUTTONS
        // =====================================================================

        var actionPanel = panel.add("panel", undefined, "Actions");
        actionPanel.alignment = ["fill", "top"];
        actionPanel.alignChildren = ["fill", "top"];
        actionPanel.margins = 10;
        actionPanel.spacing = 6;

        var newProjectBtn = actionPanel.add("button", undefined, "New Project from Template");
        newProjectBtn.preferredSize.height = 32;
        newProjectBtn.alignment = ["fill", "center"];

        var setPathBtn = actionPanel.add("button", undefined, "Set Template Path...");
        setPathBtn.preferredSize.height = 26;
        setPathBtn.alignment = ["fill", "center"];

        // =====================================================================
        // FOOTER / STATUS
        // =====================================================================

        var footerGroup = panel.add("group");
        footerGroup.alignment = ["fill", "bottom"];
        footerGroup.margins = [0, 5, 0, 0];

        var statusText = footerGroup.add("statictext", undefined, "Templates are protected from overwrite");
        statusText.alignment = ["fill", "center"];
        try {
            statusText.graphics.foregroundColor = statusText.graphics.newPen(statusText.graphics.PenType.SOLID_COLOR, UI_COLORS.textDim, 1);
        } catch (e) { }

        // =====================================================================
        // BUTTON HANDLERS
        // =====================================================================

        setPathBtn.onClick = function () {
            var idx = templateDropdown.selection ? templateDropdown.selection.index : 0;
            var template = TEMPLATES[idx];

            var file = File.openDialog("Select " + template.defaultName + ".aep", "After Effects Project:*.aep");

            if (file) {
                if (setTemplatePath(template.key, file.fsName)) {
                    statusText.text = "Path saved: " + template.defaultName;
                    updatePathDisplay();
                }
            }
        };

        newProjectBtn.onClick = function () {
            var idx = templateDropdown.selection ? templateDropdown.selection.index : 0;
            var template = TEMPLATES[idx];
            var templatePath = getTemplatePath(template.key);

            if (!templatePath || templatePath.length === 0) {
                alert("Template path not configured.\n\nClick 'Set Template Path...' first.");
                return;
            }

            if (!fileExists(templatePath)) {
                alert("Template file not found:\n" + templatePath + "\n\nClick 'Set Template Path...' to update.");
                return;
            }

            try {
                var templateFile = new File(templatePath);
                var project = app.open(templateFile);

                if (!project) {
                    statusText.text = "Failed to open template";
                    return;
                }

                statusText.text = "Save to a new location...";

                var saveFile = null;
                var validSave = false;

                while (!validSave) {
                    saveFile = File.saveDialog("Save New Project As", "After Effects Project:*.aep");

                    if (!saveFile) {
                        var closeConfirm = confirm(
                            "You must save to a new location.\n\n" +
                            "OK = Close without saving\n" +
                            "Cancel = Choose location"
                        );

                        if (closeConfirm) {
                            app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
                            statusText.text = "Cancelled - template protected";
                            return;
                        }
                        continue;
                    }

                    var savePath = saveFile.fsName;
                    if (savePath.toLowerCase().indexOf(".aep") === -1) {
                        savePath = savePath + ".aep";
                        saveFile = new File(savePath);
                    }

                    if (isSameFolder(savePath, templatePath)) {
                        alert("Cannot save to template folder.\nChoose a different location.");
                        continue;
                    }

                    if (savePath.toLowerCase() === templatePath.toLowerCase()) {
                        alert("Cannot overwrite the template file.");
                        continue;
                    }

                    validSave = true;
                }

                app.project.save(saveFile);
                statusText.text = "Created: " + saveFile.name;

            } catch (e) {
                statusText.text = "Error";
                alert("Error:\n" + e.toString());
            }
        };

        // =====================================================================
        // RESIZE HANDLING
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

    buildUI(thisObj);

})(this);
