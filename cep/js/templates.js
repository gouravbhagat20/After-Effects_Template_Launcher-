/*
    BHTemplates — template data + naming + project structure.
    EXACT ports of the corresponding functions in
    BigHappyLauncher_Templates.jsx so both tools behave identically and
    share the same AE settings store (section "BigHappyLauncher").
*/
(function (global) {
    "use strict";

    var nodeRequire = (global.cep_node && global.cep_node.require) || global.require;
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var os = nodeRequire("os");

    // Mirrors CONFIG.DEFAULTS.TEMPLATES (paths resolved on generate)
    var DEFAULT_TEMPLATES = [
        { name: "Sunrise", width: 750, height: 300, fps: 24, duration: 15, path: "" },
        { name: "InterScroller", width: 880, height: 1912, fps: 24, duration: 15, path: "" },
        { name: "DOOH Horizontal", width: 1920, height: 1080, fps: 29.97, duration: 15, path: "" },
        { name: "DOOH Vertical", width: 1080, height: 1920, fps: 29.97, duration: 15, path: "" }
    ];

    // Mirrors CONFIG.TEMPLATE_FOLDERS
    var TEMPLATE_FOLDERS = {
        sunrise: ["Image", "Screen"],
        interscroller: ["Image", "Screen", "GIF"],
        dooh_horizontal: ["Image", "Screen", "PNG"],
        dooh_vertical: ["Image", "Screen", "PNG"],
        "default": ["Image", "Screen"]
    };

    var PATH_MAX = 240;           // CONFIG.LIMITS.PATH_MAX
    var FOLDER_AE = "AE_File";    // CONFIG.PATHS.FOLDER_AE
    var RENDER_PREFIX = "Render_";
    var LIMITS = { BRAND_MIN: 2, BRAND_MAX: 50, CAMPAIGN_MAX: 50 };

    // ---------------- naming (exact ports) ----------------

    function sanitizeName(str) {
        if (!str) return "";
        var s = String(str).replace(/^\s+|\s+$/g, "");
        s = s.replace(/[<>:"\/\\|?*]/g, "");
        s = s.replace(/\s+/g, "_");
        s = s.replace(/_+/g, "_");
        if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(s)) s += "_";
        return s;
    }

    function getTemplateType(width, height) {
        if (width === 750 && height === 300) return "sunrise";
        if (width === 880 && height === 1912) return "interscroller";
        if (width === 1920 && height === 1080) return "dooh_horizontal";
        if (width === 1080 && height === 1920) return "dooh_vertical";
        return "default";
    }

    function getTemplateFolderName(width, height) {
        if (width === 750 && height === 300) return "Sunrise";
        if (width === 880 && height === 1912) return "InterScroller";
        if (width === 1920 && height === 1080) return "DOOH-Horizontal";
        if (width === 1080 && height === 1920) return "DOOH-Vertical";
        return "Custom";
    }

    function isDOOHTemplate(name) {
        return String(name).toLowerCase().indexOf("dooh") !== -1;
    }

    function getTemplateLabel(t) {
        return t.name + " (" + t.width + "x" + t.height + " | " + t.fps + "fps)";
    }

    function buildProjectFolderName(brand, campaign) {
        return campaign && campaign.length > 0 ? brand + "_" + campaign : brand;
    }

    function buildFilename(brand, campaign, quarter, size, version, revision, isDOOH) {
        if (isDOOH) {
            return "DOOH_" + (campaign || brand) + "_" + size + "_" + version + "_" + revision + ".aep";
        }
        if (campaign && campaign.length > 0) {
            return brand + "_" + campaign + "_" + quarter + "_" + size + "_" + version + "_" + revision + ".aep";
        }
        return brand + "_" + quarter + "_" + size + "_" + version + "_" + revision + ".aep";
    }

    function validate(brand, campaign) {
        if (!brand) return "Brand name is required. (BH-4001)";
        if (brand.length < LIMITS.BRAND_MIN || brand.length > LIMITS.BRAND_MAX) {
            return "Brand must be " + LIMITS.BRAND_MIN + "-" + LIMITS.BRAND_MAX + " characters. (BH-4007)";
        }
        if (campaign && campaign.length > LIMITS.CAMPAIGN_MAX) {
            return "Campaign must be under " + LIMITS.CAMPAIGN_MAX + " characters. (BH-4008)";
        }
        return null;
    }

    // ---------------- project structure (Node port of createProjectStructure) ----------------

    /**
     * Base/Year/Quarter/Brand_Campaign/TemplateName_WxH/V#/AE_File/Render_R#
     * plus Assets/<subfolders>/<R#> — identical layout to the ScriptUI version.
     * Returns { aeFolder, ... } or throws with a user-readable message.
     */
    function createProjectStructure(basePath, year, quarter, projectName, size, revision, templateType, version) {
        if (!basePath || !fs.existsSync(basePath)) {
            throw new Error("Base work folder does not exist: " + basePath + " (BH-1005 — set it in Settings)");
        }

        var projectRoot = path.join(basePath, String(year), quarter, projectName);
        var sizeFolder = path.join(projectRoot, size);
        var versionFolder = path.join(sizeFolder, version);
        var aeFolder = path.join(versionFolder, FOLDER_AE);
        var publishedFolder = path.join(aeFolder, RENDER_PREFIX + revision);
        var assetsFolder = path.join(versionFolder, "Assets");

        if (publishedFolder.length + 50 > PATH_MAX) {
            throw new Error("File path too long (BH-1006): ~" + (publishedFolder.length + 50) +
                " chars, limit " + PATH_MAX + ".\n" + publishedFolder);
        }

        var folders = [projectRoot, sizeFolder, versionFolder, aeFolder, publishedFolder, assetsFolder];
        var subs = TEMPLATE_FOLDERS[templateType] || TEMPLATE_FOLDERS["default"];
        subs.forEach(function (sub) {
            folders.push(path.join(assetsFolder, sub));
            folders.push(path.join(assetsFolder, sub, revision));
        });

        folders.forEach(function (f) { fs.mkdirSync(f, { recursive: true }); });

        return {
            projectRoot: projectRoot,
            sizeFolder: sizeFolder,
            versionFolder: versionFolder,
            aeFolder: aeFolder,
            publishedFolder: publishedFolder,
            assetsFolder: assetsFolder
        };
    }

    function defaultTemplatesFolder() {
        return path.join(os.homedir(), "Documents", "BH_Templates");
    }

    global.BHTemplates = {
        DEFAULT_TEMPLATES: DEFAULT_TEMPLATES,
        sanitizeName: sanitizeName,
        getTemplateType: getTemplateType,
        getTemplateFolderName: getTemplateFolderName,
        isDOOHTemplate: isDOOHTemplate,
        getTemplateLabel: getTemplateLabel,
        buildProjectFolderName: buildProjectFolderName,
        buildFilename: buildFilename,
        validate: validate,
        createProjectStructure: createProjectStructure,
        defaultTemplatesFolder: defaultTemplatesFolder,
        fileExists: function (p) { return !!p && fs.existsSync(p); }
    };
})(window);
