/*
    BigHappy Launcher — panel boot.

    The panel talks to After Effects via the BH.* ExtendScript API
    (jsx/host.jsx) and runs all filesystem/ffmpeg work in Node. Shared plumbing
    lives in js/core.js; each tab is its own module and is wired up here:

        core.js           host bridge, settings, shared state, toasts, tabs
        tab-launcher.js   project status, recents, new project, templates
        tab-render.js     render queue, Sunrise post-render, collect
        tab-optimizer.js  MP4 size-capping and the AE file-lock dance
        tab-settings.js   preferences and diagnostics
        update-ui.js      self-update prompts and What's New

    All persistent settings live in AE preferences (section "BigHappyLauncher"),
    the SAME store the ScriptUI version uses — templates, base folder, ffmpeg
    path, and recents stay in sync between both tools.
*/
(function () {
    "use strict";

    var core = window.BHCore;

    core.applyTheme();
    try {
        core.cs.addEventListener(CSInterface.THEME_COLOR_CHANGED_EVENT, core.applyTheme);
    } catch (e) { }

    core.initTabs();
    core.initCollapsibles();

    // Each module attaches its own listeners and subscribes to shared state.
    var launcher = window.BHLauncher.init(core);
    var render = window.BHRender.init(core);
    var optimizer = window.BHOptimizer.init(core);
    var settings = window.BHSettings.init(core);
    var updates = window.BHUpdateUI.init(core);

    // ---------------- boot ----------------

    core.host("ping").then(function (info) {
        core.setPill("ok", "AE " + info.version);
    }).catch(function () {
        core.setPill("err", "host offline");
    });

    launcher.populateYears();

    core.loadSettings().then(function () {
        core.setTemplates(core.loadTemplates());
        launcher.adoptExistingTemplateFiles();
        launcher.renderTemplateList();     // also fills the New Project dropdown + preview
        launcher.renderRecents();

        settings.applySettings();
        render.applySettings();
        optimizer.applySettings();

        updates.showWhatsNew();
        updates.checkForUpdate();
        updates.cleanupUpdateBackup();     // this version booted fine — retire the rollback copy
        core.recoverStrandedFootage();     // finish any optimize that was cut short
    }).catch(function (err) {
        // Settings could not be loaded (host bridge down / prefs error).
        // Without this the panel rendered empty with no explanation — surface
        // the failure and fall back to defaults so it stays usable.
        console.error("Boot failed — settings could not be loaded:", err);
        core.setPill("err", "settings error");
        try {
            core.setTemplates(core.loadTemplates());   // defaults (settings cache is empty)
            launcher.renderTemplateList();
            launcher.renderRecents();
            core.$("set-tplfolder").placeholder = core.T.defaultTemplatesFolder();
        } catch (e2) { console.error("Boot fallback failed:", e2); }
        core.ui.alert("Could not load settings from After Effects:\n" + err.message +
                 "\n\nThe panel is running with defaults — saved templates, recents and " +
                 "preferences are unavailable. Try reopening the panel or restarting After Effects.",
                 "Settings Unavailable");
    });

    // Tooltips remain visible on focus and expose their description to screen readers.
    Array.prototype.forEach.call(document.querySelectorAll("[data-tip]"), function (el) {
        el.setAttribute("tabindex", "0");
        el.setAttribute("aria-label", el.textContent + ". " + el.getAttribute("data-tip"));
    });

    core.refreshProject();
    setInterval(core.refreshProject, 4000); // keep the status card in sync

    // Panels stay open for days — re-check for updates hourly, not just at boot.
    setInterval(function () { updates.checkForUpdate(); }, 60 * 60 * 1000);
})();
