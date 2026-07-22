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
        { name: "Expandable", width: 750, height: 1334, fps: 24, duration: 15, path: "" },
        { name: "DOOH Horizontal", width: 1920, height: 1080, fps: 29.97, duration: 15, path: "" },
        { name: "DOOH Vertical", width: 1080, height: 1920, fps: 29.97, duration: 15, path: "" }
    ];

    // Mirrors CONFIG.TEMPLATE_FOLDERS
    var TEMPLATE_FOLDERS = {
        sunrise: ["Images", "Screens"],
        interscroller: ["Images", "Screens", "GIF"],
        expandable: ["Images", "Screens", "GIF"],
        dooh_horizontal: ["Images", "Screens", "PNG"],
        dooh_vertical: ["Images", "Screens", "PNG"],
        "default": ["Images", "Screens"]
    };

    var FOLDER_COLLECT = "Collect_Files";      // AE_File/Collect_Files
    var RENDER_SUBS = ["MP4", "PNG_Sequence"]; // AE_File/Render_R#/{MP4,PNG_Sequence}

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
        if (width === 750 && height === 1334) return "expandable";
        if (width === 1920 && height === 1080) return "dooh_horizontal";
        if (width === 1080 && height === 1920) return "dooh_vertical";
        return "default";
    }

    function getTemplateFolderName(width, height) {
        if (width === 750 && height === 300) return "Sunrise";
        if (width === 880 && height === 1912) return "InterScroller";
        if (width === 750 && height === 1334) return "Expandable";
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

    /** Exact port of the script's end-anchored project name parser.
        Pattern: Brand_Campaign_Q#_WxH_V#_R# (V and Q optional, DOOH_ prefix variant). */
    function parseProjectName(projectName) {
        if (!projectName) return null;
        var result = { quarter: null };
        var remaining = projectName;

        var versionMatch = remaining.match(/(?:_V(\d+))?_R(\d+)$/i);
        if (!versionMatch) return null;
        result.version = versionMatch[1] ? ("V" + versionMatch[1]) : "V1";
        result.revision = "R" + versionMatch[2];
        remaining = remaining.replace(/(?:_V\d+)?_R\d+$/i, "");

        var sizeMatch = remaining.match(/_(\d+x\d+)$/i);
        if (!sizeMatch) return null;
        result.size = sizeMatch[1];
        remaining = remaining.replace(/_\d+x\d+$/i, "");

        if (remaining.match(/^DOOH/i)) {
            result.isDOOH = true;
            result.brand = "DOOH";
            result.campaign = remaining.replace(/^DOOH_?/i, "") || "";
            return result;
        }

        var quarterMatch = remaining.match(/_Q([1-4])$/i);
        if (quarterMatch) {
            result.quarter = "Q" + quarterMatch[1];
            remaining = remaining.replace(/_Q[1-4]$/i, "");
        }

        var firstUnderscore = remaining.indexOf("_");
        if (firstUnderscore > 0) {
            result.brand = remaining.substring(0, firstUnderscore);
            result.campaign = remaining.substring(firstUnderscore + 1);
        } else {
            result.brand = remaining;
            result.campaign = "";
        }
        return result;
    }

    /** MMDDYYYY, same as the script's getDateString. */
    function getDateString() {
        var d = new Date();
        var pad = function (n) { return n < 10 ? "0" + n : String(n); };
        return pad(d.getMonth() + 1) + pad(d.getDate()) + d.getFullYear();
    }

    /** Render output base name — exact port of the script's render naming. */
    function buildRenderName(projectName, mainW, mainH) {
        var type = getTemplateType(mainW, mainH);
        var parsed = parseProjectName(projectName);
        if (parsed && parsed.isDOOH) type = "dooh";
        if (type === "default" && projectName.toLowerCase().indexOf("interscroller") !== -1) type = "interscroller";

        var renderName = projectName + "_" + getDateString();
        if (type === "sunrise" && parsed && parsed.brand) {
            renderName = parsed.brand + "_" + (parsed.campaign || "Campaign") +
                "_CTA_AnimatedSunrise_" + parsed.version + "_" + parsed.revision;
        } else if (parsed && parsed.isDOOH) {
            renderName = "DOOH_" + (parsed.campaign || "Campaign") + "_" +
                (parsed.size || (mainW + "x" + mainH)) + "_" + getDateString();
        }
        return { name: renderName, type: type, parsed: parsed };
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
        var collectFolder = path.join(aeFolder, FOLDER_COLLECT);
        var assetsFolder = path.join(versionFolder, "Assets");

        // deepest path is now Render_R#/PNG_Sequence — check against that
        var deepest = path.join(publishedFolder, "PNG_Sequence");
        if (deepest.length + 50 > PATH_MAX) {
            throw new Error("File path too long (BH-1006): ~" + (deepest.length + 50) +
                " chars, limit " + PATH_MAX + ".\n" + deepest);
        }

        var folders = [projectRoot, sizeFolder, versionFolder, aeFolder,
            publishedFolder, collectFolder, assetsFolder];
        RENDER_SUBS.forEach(function (sub) { folders.push(path.join(publishedFolder, sub)); });
        var subs = TEMPLATE_FOLDERS[templateType] || TEMPLATE_FOLDERS["default"];
        subs.forEach(function (sub) { folders.push(path.join(assetsFolder, sub)); });

        folders.forEach(function (f) { fs.mkdirSync(f, { recursive: true }); });

        return {
            projectRoot: projectRoot,
            sizeFolder: sizeFolder,
            versionFolder: versionFolder,
            aeFolder: aeFolder,
            publishedFolder: publishedFolder,
            collectFolder: collectFolder,
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
        parseProjectName: parseProjectName,
        getDateString: getDateString,
        buildRenderName: buildRenderName,
        validate: validate,
        createProjectStructure: createProjectStructure,
        defaultTemplatesFolder: defaultTemplatesFolder,
        fileExists: function (p) { return !!p && fs.existsSync(p); }
    };
})(window);
