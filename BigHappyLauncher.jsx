/*
================================================================================
  BigHappyLauncher.jsx
  After Effects ScriptUI Panel - Template Composition Creator
================================================================================

  INSTALLATION:
  -------------
  1. Save this file to your After Effects ScriptUI Panels folder:
     - Windows: C:\Program Files\Adobe\Adobe After Effects 2024\Support Files\Scripts\ScriptUI Panels\
     - macOS: /Applications/Adobe After Effects 2024/Scripts/ScriptUI Panels/

  2. Restart After Effects

  3. Open the panel: Window > BigHappyLauncher.jsx

  4. Dock the panel where you like, then save your workspace:
     Window > Workspace > Save as New Workspace...
     The panel will appear automatically next time you use that workspace.

  HOW TO USE:
  -----------
  1. Select a Preset (Sunrise, InterScroller, DOOH)
  2. Select Size (available sizes depend on preset)
  3. Enter a Base Name (e.g., "Pepsi", "CocaCola")
  4. Click "Create Template" to create folders + comps
     OR click "Create Folders Only" for just the folder structure

================================================================================
*/

(function (thisObj) {

    // =========================================================================
    // CONFIGURATION - Based on actual template files
    // =========================================================================

    var PRESETS = {
        "Sunrise": {
            fps: 24,
            duration: 15,
            sizes: [
                { label: "750x300", width: 750, height: 300, key: "H" }
            ]
        },
        "InterScroller": {
            fps: 24,
            duration: 15,
            sizes: [
                { label: "880x1912", width: 880, height: 1912, key: "V" }
            ]
        },
        "DOOH": {
            fps: 29.97,
            duration: 15,
            sizes: [
                { label: "Horizontal 1920x1080", width: 1920, height: 1080, key: "H" },
                { label: "Vertical 1080x1920", width: 1080, height: 1920, key: "V" }
            ]
        }
    };

    var PRESET_NAMES = ["Sunrise", "InterScroller", "DOOH"];

    var FOLDER_STRUCTURE = [
        "00_BH",
        "00_BH/01_Comps",
        "00_BH/02_Footage",
        "00_BH/03_Precomps",
        "00_BH/04_Exports",
        "00_BH/05_Refs"
    ];

    // =========================================================================
    // HELPER FUNCTIONS
    // =========================================================================

    /**
     * Sanitize filename - remove invalid characters
     */
    function sanitizeName(name) {
        var result = "";
        var invalid = "<>:\"/\\|?*";
        for (var i = 0; i < name.length; i++) {
            var c = name.charAt(i);
            var code = name.charCodeAt(i);
            if (invalid.indexOf(c) === -1 && code >= 32) {
                if (c === " ") {
                    result += "_";
                } else {
                    result += c;
                }
            } else {
                result += "_";
            }
        }
        return result;
    }

    /**
     * Find or create a folder in the project
     */
    function findOrCreateFolder(folderName, parentFolder) {
        var searchIn = parentFolder || app.project.rootFolder;

        for (var i = 1; i <= searchIn.numItems; i++) {
            var item = searchIn.item(i);
            if (item instanceof FolderItem && item.name === folderName) {
                return item;
            }
        }

        return searchIn.items.addFolder(folderName);
    }

    /**
     * Create the folder structure
     */
    function createFolders() {
        var createdFolders = [];
        var parentFolder = null;

        for (var i = 0; i < FOLDER_STRUCTURE.length; i++) {
            var path = FOLDER_STRUCTURE[i];
            var parts = path.split("/");

            if (parts.length === 1) {
                parentFolder = findOrCreateFolder(parts[0], null);
                createdFolders.push(parts[0]);
            } else {
                var folder = findOrCreateFolder(parts[1], parentFolder);
                createdFolders.push(parts[1]);
            }
        }

        return createdFolders;
    }

    /**
     * Find a folder by path
     */
    function getFolderByPath(path) {
        var parts = path.split("/");
        var currentFolder = app.project.rootFolder;

        for (var i = 0; i < parts.length; i++) {
            var found = false;
            for (var j = 1; j <= currentFolder.numItems; j++) {
                var item = currentFolder.item(j);
                if (item instanceof FolderItem && item.name === parts[i]) {
                    currentFolder = item;
                    found = true;
                    break;
                }
            }
            if (!found) return null;
        }

        return currentFolder;
    }

    /**
     * Create template compositions
     */
    function createTemplate(baseName, presetName, sizeIndex) {
        var preset = PRESETS[presetName];

        if (!preset) {
            alert("ERROR: Invalid preset selection.");
            return null;
        }

        var size = preset.sizes[sizeIndex];
        if (!size) {
            alert("ERROR: Invalid size selection.");
            return null;
        }

        var sanitizedName = sanitizeName(baseName);

        // Build comp names
        var masterName = sanitizedName + "_" + presetName + "_" + size.key + "_" +
            size.width + "x" + size.height + "_15s";
        var assetsName = sanitizedName + "_ASSETS";
        var endframeName = sanitizedName + "_ENDFRAME";

        // Get target folders
        var compsFolder = getFolderByPath("00_BH/01_Comps");
        var precompsFolder = getFolderByPath("00_BH/03_Precomps");

        if (!compsFolder || !precompsFolder) {
            alert("ERROR: Folder structure not found. Please create folders first.");
            return null;
        }

        // Check if MASTER comp already exists
        for (var i = 1; i <= compsFolder.numItems; i++) {
            if (compsFolder.item(i).name === masterName) {
                alert("WARNING: A comp named '" + masterName + "' already exists.");
                return null;
            }
        }

        // Create ASSETS precomp
        var assetsComp = app.project.items.addComp(
            assetsName,
            size.width,
            size.height,
            1,
            preset.duration,
            preset.fps
        );
        assetsComp.parentFolder = precompsFolder;

        // Create ENDFRAME precomp
        var endframeComp = app.project.items.addComp(
            endframeName,
            size.width,
            size.height,
            1,
            preset.duration,
            preset.fps
        );
        endframeComp.parentFolder = precompsFolder;

        // Create MASTER comp
        var masterComp = app.project.items.addComp(
            masterName,
            size.width,
            size.height,
            1,
            preset.duration,
            preset.fps
        );
        masterComp.parentFolder = compsFolder;

        // Add precomps to MASTER
        var assetsLayer = masterComp.layers.add(assetsComp);
        assetsLayer.name = "ASSETS_PRECOMP";

        var endframeLayer = masterComp.layers.add(endframeComp);
        endframeLayer.name = "ENDFRAME_PRECOMP";

        // Open MASTER comp in viewer
        masterComp.openInViewer();

        return {
            master: masterName,
            assets: assetsName,
            endframe: endframeName
        };
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
        panel.spacing = 10;
        panel.margins = 16;

        // Title
        var titleGroup = panel.add("group");
        titleGroup.alignment = ["center", "top"];
        var title = titleGroup.add("statictext", undefined, "Big Happy Launcher");
        try {
            title.graphics.font = ScriptUI.newFont("Arial", "BOLD", 16);
        } catch (e) { }

        // Preset dropdown
        var presetGroup = panel.add("group");
        presetGroup.alignment = ["fill", "top"];
        presetGroup.add("statictext", undefined, "Preset:");
        var presetDropdown = presetGroup.add("dropdownlist", undefined, PRESET_NAMES);
        presetDropdown.selection = 0;
        presetDropdown.alignment = ["fill", "center"];

        // Size dropdown
        var sizeGroup = panel.add("group");
        sizeGroup.alignment = ["fill", "top"];
        sizeGroup.add("statictext", undefined, "Size:");
        var sizeDropdown = sizeGroup.add("dropdownlist", undefined, []);
        sizeDropdown.alignment = ["fill", "center"];

        // Function to update size dropdown based on preset
        function updateSizeDropdown() {
            sizeDropdown.removeAll();
            var presetName = presetDropdown.selection.text;
            var preset = PRESETS[presetName];
            if (preset && preset.sizes) {
                for (var i = 0; i < preset.sizes.length; i++) {
                    sizeDropdown.add("item", preset.sizes[i].label);
                }
                sizeDropdown.selection = 0;
            }
        }

        // Initialize size dropdown
        updateSizeDropdown();

        // Update sizes when preset changes
        presetDropdown.onChange = function () {
            updateSizeDropdown();
        };

        // Base Name input
        var nameGroup = panel.add("group");
        nameGroup.alignment = ["fill", "top"];
        nameGroup.add("statictext", undefined, "Base Name:");
        var nameInput = nameGroup.add("edittext", undefined, "Project");
        nameInput.alignment = ["fill", "center"];
        nameInput.characters = 20;

        // Separator
        var sep1 = panel.add("panel", undefined, "");
        sep1.alignment = ["fill", "center"];

        // Buttons
        var buttonGroup = panel.add("group");
        buttonGroup.alignment = ["fill", "top"];
        buttonGroup.orientation = "column";
        buttonGroup.alignChildren = ["fill", "center"];
        buttonGroup.spacing = 8;

        var createTemplateBtn = buttonGroup.add("button", undefined, "Create Template");
        createTemplateBtn.preferredSize.height = 36;

        var createFoldersBtn = buttonGroup.add("button", undefined, "Create Folders Only");
        createFoldersBtn.preferredSize.height = 28;

        // Status line
        var sep2 = panel.add("panel", undefined, "");
        sep2.alignment = ["fill", "center"];
        var statusText = panel.add("statictext", undefined, "Ready.");
        statusText.alignment = ["fill", "bottom"];

        // =====================================================================
        // BUTTON HANDLERS
        // =====================================================================

        createFoldersBtn.onClick = function () {
            try {
                app.beginUndoGroup("Create BH Folder Structure");

                var folders = createFolders();
                statusText.text = "Created folders: " + folders.join(", ");

                app.endUndoGroup();
            } catch (e) {
                app.endUndoGroup();
                statusText.text = "Error: " + e.toString();
                alert("ERROR creating folders:\n" + e.toString());
            }
        };

        createTemplateBtn.onClick = function () {
            // Trim whitespace from base name
            var baseName = nameInput.text;
            while (baseName.charAt(0) === " ") baseName = baseName.substring(1);
            while (baseName.charAt(baseName.length - 1) === " ") baseName = baseName.substring(0, baseName.length - 1);

            if (baseName.length === 0) {
                alert("Please enter a Base Name.");
                return;
            }

            var presetName = presetDropdown.selection.text;
            var sizeIndex = sizeDropdown.selection ? sizeDropdown.selection.index : 0;

            try {
                app.beginUndoGroup("Create BH Template");

                // Create folders first
                createFolders();

                // Create template comps
                var result = createTemplate(baseName, presetName, sizeIndex);

                if (result) {
                    statusText.text = "Created: " + result.master;
                } else {
                    statusText.text = "Template creation failed.";
                }

                app.endUndoGroup();
            } catch (e) {
                app.endUndoGroup();
                statusText.text = "Error: " + e.toString();
                alert("ERROR creating template:\n" + e.toString());
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
