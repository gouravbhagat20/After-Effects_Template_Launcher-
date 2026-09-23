/*
    BHCore — everything the panel's four tabs share.

    The tabs used to live in one 1800-line closure alongside this, which meant
    the host bridge, the settings cache and the project poller could only be
    reached by being in that same closure. They are here instead, and each tab
    module (tab-launcher, tab-render, tab-optimizer, tab-settings, update-ui)
    receives this object in its init().

    Shared MUTABLE state — the open project and the template list — lives here
    behind subscribe/notify, because more than one tab renders from each: the
    Render tab's output card follows the open project, and Diagnostics counts
    the templates the Templates tab edits.
*/
(function (global) {
    "use strict";

    var cs = new CSInterface();
    var nodeRequire = (global.cep_node && global.cep_node.require) || global.require;
    var cp = nodeRequire("child_process");
    var pathMod = nodeRequire("path");
    var fsMod = nodeRequire("fs");
    var osMod = nodeRequire("os");
    var T = global.BHTemplates;
    var ui = global.BHDialog;

    var BH_VERSION = "0.4.5";   // keep in sync with CSXS/manifest.xml
    var REPO_URL = "https://github.com/gouravbhagat20/After-Effects_Template_Launcher-";

    // ---------------- host bridge ----------------

    /**
     * How long to wait for each BH.* call before giving up, in ms.
     *
     * evalScript has no timeout of its own: if ExtendScript wedges — AE
     * showing a modal dialog, a huge project, a script error that never
     * calls back — the promise stays pending forever and whatever awaited it
     * hangs with no way out but reopening the panel.
     *
     * IMPORTANT: a timeout abandons the call, it does NOT cancel it. AE may
     * still be working. So the budget per call is generous, and anything that
     * legitimately runs long gets its own entry rather than the default.
     */
    var HOST_TIMEOUT_DEFAULT = 30 * 1000;
    var HOST_TIMEOUTS = {
        collectProject:     30 * 60 * 1000,   // hundreds of assets over a network share
        createFromTemplate:  5 * 60 * 1000,   // opens a template + imports global assets
        generateTemplate:    5 * 60 * 1000,
        preFlightCheck:      5 * 60 * 1000,
        openProject:         5 * 60 * 1000,
        saveProject:         5 * 60 * 1000,
        saveProjectAs:       5 * 60 * 1000,
        queueToAME:          2 * 60 * 1000,
        recoverPlaceholders: 2 * 60 * 1000
    };

    function host(fn) {
        var args = Array.prototype.slice.call(arguments, 1)
            .map(function (a) { return JSON.stringify(a); })
            .join(",");
        var script = "BH." + fn + "(" + args + ")";
        var budget = HOST_TIMEOUTS[fn] || HOST_TIMEOUT_DEFAULT;
        return new Promise(function (resolve, reject) {
            var settled = false;
            var timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                reject(new Error("After Effects did not respond to " + fn + " within " +
                    Math.round(budget / 1000) + "s. It may be busy or waiting on a dialog — " +
                    "check AE, then try again."));
            }, budget);

            cs.evalScript(script, function (res) {
                if (settled) return;          // timed out already; ignore the late reply
                settled = true;
                clearTimeout(timer);
                if (res === "EvalScript error.") {
                    return reject(new Error("Host error running " + fn));
                }
                try {
                    var parsed = JSON.parse(res);
                    parsed.ok ? resolve(parsed.data) : reject(new Error(parsed.error));
                } catch (e) {
                    reject(new Error("Bad host response from " + fn + ": " + res));
                }
            });
        });
    }

    // ---------------- AE-shared settings (same keys as the script) ----------------

    var S = {};   // in-memory cache, loaded at boot

    var SETTING_KEYS = ["templates_data", "templates_folder", "base_work_folder", "nas_root",
                        "ffmpeg_path", "recent_files", "ame_enabled", "dooh_target_mb",
                        "target_size_mb",
                        "post_render_webm", "post_render_mov", "post_render_html", "post_render_zip",
                        "seed_expandable", "pending_relink"];

    function loadSettings() {
        return Promise.all(SETTING_KEYS.map(function (k) { return host("getSetting", k, null); }))
            .then(function (vals) {
                SETTING_KEYS.forEach(function (k, i) { S[k] = vals[i]; });
            });
    }

    function setSetting(key, value) {
        S[key] = value === null ? null : String(value);
        return host("setSetting", key, value === null ? "" : String(value))
            .catch(function (err) {
                // The in-memory cache already holds the new value, but AE
                // failed to persist it — say so instead of failing silently.
                console.error('Failed to save setting "' + key + '" to AE preferences:', err);
                toast('Could not save setting "' + key + '" — it will reset when AE restarts', true);
            });
    }

    function baseWorkFolder() { return S.base_work_folder || ""; }
    function templatesFolder() { return S.templates_folder || T.defaultTemplatesFolder(); }

    // ---------------- tiny helpers ----------------

    function $(id) { return document.getElementById(id); }

    function setPill(state, text) {
        var pill = $("ae-status");
        pill.textContent = text;
        pill.className = "pill " + (state === "ok" ? "pill-ok" : state === "err" ? "pill-err" : "pill-dim");
    }

    function escapeHtml(s) {
        var div = document.createElement("div");
        div.textContent = String(s);
        return div.innerHTML;
    }

    function pickFiles(multi, title, exts) {
        var res = global.cep.fs.showOpenDialogEx(multi, false, title, null, exts);
        return (res && res.err === 0 && res.data && res.data.length) ? res.data : null;
    }

    function pickFolder(title) {
        var res = global.cep.fs.showOpenDialogEx(false, true, title, null, []);
        return (res && res.err === 0 && res.data && res.data.length) ? res.data[0] : null;
    }

    function revealInOS(folderPath) {
        if (!folderPath) return;
        if (global.BHFFmpeg.isWin) cp.spawn("explorer", [folderPath], { detached: true });
        else cp.spawn("open", [folderPath], { detached: true });
    }

    /** Reveal a specific file selected in Finder/Explorer. */
    function revealFile(filePath) {
        if (!filePath) return;
        if (global.BHFFmpeg.isWin) cp.spawn("explorer", ["/select," + filePath], { detached: true });
        else cp.spawn("open", ["-R", filePath], { detached: true });
    }

    /**
     * Compare two filesystem paths the way the host OS does.
     *
     * Windows paths are case-insensitive, so C:\A.mp4 and c:\a.mp4 are one
     * file. Elsewhere they can be two, so lower-casing before comparing (as
     * this used to do everywhere) silently merged distinct files.
     */
    function samePath(a, b) {
        if (a == null || b == null) return false;
        return global.BHFFmpeg.isWin
            ? String(a).toLowerCase() === String(b).toLowerCase()
            : String(a) === String(b);
    }

    /** Drop repeats from a list of paths, keeping first-seen order. */
    function dedupePaths(paths) {
        var kept = [];
        (paths || []).forEach(function (p) {
            var already = kept.some(function (q) { return samePath(p, q); });
            if (!already) kept.push(p);
        });
        return kept;
    }

    /** Unsaved-changes guard: resolves true to proceed (saving first if asked). */
    function guardUnsaved(actionLabel) {
        return host("getProjectInfo").then(function (info) {
            if (!info || !info.open || !info.dirty) return true;
            return ui.confirm("The current project has UNSAVED changes.\n\nAbout to: " + actionLabel +
                              "\n\nSave the current project first?", "Unsaved Changes")
                .then(function (doSave) {
                    if (doSave && info.path) {
                        return host("saveProject").then(function () { return true; });
                    }
                    if (doSave && !info.path) {
                        return ui.alert("The current project has never been saved — save it manually in AE first, or discard.")
                            .then(function () {
                                return ui.confirm("Continue WITHOUT saving?\n\nUnsaved changes will be LOST.", "Discard Changes?");
                            });
                    }
                    return ui.confirm("Continue WITHOUT saving?\n\nUnsaved changes will be LOST.", "Discard Changes?");
                });
        }).catch(function () { return true; });
    }

    // ---------------- theme (follows AE's appearance) ----------------

    function applyTheme() {
        try {
            var skin = cs.getHostEnvironment().appSkinInfo;
            var c = skin.panelBackgroundColor.color;
            document.body.classList.toggle("light", c.red > 128);
        } catch (e) { /* keep dark default */ }
    }

    // ---------------- activity indicator (real background work only) ----------------

    var busyCount = 0;
    function busy(on) {
        busyCount = Math.max(0, busyCount + (on ? 1 : -1));
        $("activity").classList.toggle("hidden", busyCount === 0);
    }

    // ---------------- toast + screen-reader announcements ----------------

    var toastEl = document.createElement("div");
    toastEl.className = "bh-toast";
    // Toasts are how the panel reports that long work finished or failed.
    // Without a live region a screen-reader user gets no announcement at all:
    // the text appears and disappears with nothing to move focus to.
    toastEl.setAttribute("role", "status");
    toastEl.setAttribute("aria-live", "polite");
    toastEl.setAttribute("aria-atomic", "true");
    document.body.appendChild(toastEl);
    var toastTimer = null;

    function toast(msg, isError) {
        toastEl.textContent = msg;
        toastEl.classList.toggle("err", !!isError);
        // Failures interrupt; successes wait for a pause in speech.
        toastEl.setAttribute("aria-live", isError ? "assertive" : "polite");
        toastEl.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2600);
    }

    /**
     * Off-screen announcer for progress milestones.
     *
     * Deliberately separate from the visible progress text: that updates on
     * every ffmpeg tick, and piping percentages into a live region would talk
     * over the user continuously. Only meaningful changes land here — a new
     * file starting, a step changing, a batch ending.
     */
    var liveEl = document.createElement("div");
    liveEl.className = "sr-only";
    liveEl.setAttribute("role", "status");
    liveEl.setAttribute("aria-live", "polite");
    liveEl.setAttribute("aria-atomic", "true");
    document.body.appendChild(liveEl);
    var lastAnnounced = "";

    function announce(msg) {
        if (!msg || msg === lastAnnounced) return;   // no repeats, no chatter
        lastAnnounced = msg;
        liveEl.textContent = msg;
    }

    function setProgress(id, pct) {
        var value = Math.max(0, Math.min(100, Number(pct) || 0));
        $(id).style.transform = "scaleX(" + (value / 100) + ")";
    }

    var reduceMotion = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)");

    // ---------------- shared state: templates ----------------

    var templates = [];
    var templateSubs = [];

    function loadTemplates() {
        var list = null;
        if (S.templates_data) {
            try {
                var arr = JSON.parse(S.templates_data);
                if (arr && arr.length) list = arr;
            } catch (e) { }
        }
        if (!list) {
            list = T.DEFAULT_TEMPLATES.map(function (t) {
                return { name: t.name, width: t.width, height: t.height, fps: t.fps, duration: t.duration, path: t.path };
            });
        }
        return seedExpandable(list);
    }

    /** One-time: add the Expandable default to template lists saved before it
        existed. Guarded by a persisted flag (shared with the ScriptUI tool) so a
        user who later deletes it won't have it resurrected on the next launch. */
    function seedExpandable(list) {
        if (S.seed_expandable === "1") return list;
        var has = list.some(function (t) {
            return (t.width === 750 && t.height === 1334) ||
                   String(t.name).toLowerCase() === "expandable";
        });
        if (!has) {
            var def = T.DEFAULT_TEMPLATES.filter(function (t) { return t.name === "Expandable"; })[0];
            if (def) {
                var entry = { name: def.name, width: def.width, height: def.height, fps: def.fps, duration: def.duration, path: def.path };
                var at = list.length;
                for (var i = 0; i < list.length; i++) {
                    if (String(list[i].name).toLowerCase() === "interscroller") { at = i + 1; break; }
                }
                list.splice(at, 0, entry);
                saveTemplates(list);
            }
        }
        setSetting("seed_expandable", "1");
        return list;
    }

    function saveTemplates(list) {
        return setSetting("templates_data", JSON.stringify(list || templates));
    }

    function getTemplates() { return templates; }

    /** Replace the shared list and tell every tab that renders from it. */
    function setTemplates(list, persist) {
        templates = list || [];
        if (persist) saveTemplates(templates);
        templateSubs.forEach(function (fn) {
            try { fn(templates); } catch (e) { console.error("template subscriber failed:", e); }
        });
    }

    function onTemplates(fn) { templateSubs.push(fn); }

    // ---------------- shared state: the open project ----------------

    var currentProject = null;
    var projectSubs = [];

    function getProject() { return currentProject; }

    function onProject(fn) { projectSubs.push(fn); }

    /**
     * Re-read the open project and fan the result out. Polled every few
     * seconds, so subscribers must be cheap and tolerate being handed null.
     */
    function refreshProject() {
        return host("getProjectInfo").then(function (info) {
            publishProject(info && info.open ? info : null);
        }).catch(function () {
            publishProject(null);
        });
    }

    function publishProject(info) {
        currentProject = info;
        projectSubs.forEach(function (fn) {
            try { fn(currentProject); } catch (e) { console.error("project subscriber failed:", e); }
        });
    }

    // ---------------- ffmpeg availability ----------------
    // Shared by the optimizer, post-render, and the Settings detect button.

    /** Install ffmpeg with progress in the Settings status line; resolves the path. */
    function installFFmpegFlow() {
        var status = $("ffmpeg-status");
        busy(true);
        return global.BHFFmpeg.install(function (line) {
            status.textContent = line.length > 90 ? line.slice(0, 90) + "…" : line;
        }).then(function (exePath) {
            busy(false);
            setSetting("ffmpeg_path", exePath);
            $("set-ffmpeg").value = exePath;
            status.textContent = "✓ Installed: " + exePath;
            toast("✓ FFmpeg installed");
            return exePath;
        }, function (err) {
            busy(false);
            status.textContent = "✗ Install failed.";
            ui.alert("FFmpeg install failed:\n\n" + err.message);
            throw new Error("no ffmpeg");
        });
    }

    function getFFmpegOrExplain() {
        return global.BHFFmpeg.detect(S.ffmpeg_path || null).then(function (found) {
            if (found) {
                if (found !== "ffmpeg" && found !== S.ffmpeg_path) setSetting("ffmpeg_path", found);
                return found;
            }
            return ui.confirm("FFmpeg is required but was not found on this computer.\n\n" +
                              "Install it automatically now?" +
                              (global.BHFFmpeg.isWin ? "\n(Downloads ~90 MB)" : "\n(Uses Homebrew — takes a few minutes)"),
                              "Install FFmpeg?")
                .then(function (yes) {
                    if (!yes) throw new Error("no ffmpeg");
                    return installFFmpegFlow();
                });
        });
    }

    // ---------------- interrupted-optimize recovery ----------------
    // Optimizing an MP4 means asking AE to let go of the file (footage items
    // are parked as BH_RELINK_* placeholders), replacing it, then relinking.
    // If the panel or AE dies in between, the footage stays a placeholder and
    // the user is left to find and relink it by hand. These functions leave a
    // breadcrumb across that window so the next boot can finish the job.

    /** Note that `path` is mid-swap. Called before the release and again with tokens. */
    function markPendingRelink(path, tokens) {
        try {
            setSetting("pending_relink", JSON.stringify({
                path: path,
                project: (currentProject && currentProject.path) || null,
                tokens: tokens || null,
                ts: Date.now()
            }));
        } catch (e) { /* a lost breadcrumb must never fail the optimize */ }
    }

    function clearPendingRelink() {
        if (!S.pending_relink) return;
        setSetting("pending_relink", "");
    }

    /**
     * Boot sweep: finish a swap that was interrupted.
     *
     * Only acts when AE actually has stranded placeholders, so a normal boot
     * costs one host call and does nothing. The record is cleared before the
     * repair is attempted — a file that somehow cannot be recovered must not
     * re-prompt on every single launch.
     */
    function recoverStrandedFootage() {
        var raw = S.pending_relink;
        var rec = null;
        if (raw) {
            try { rec = JSON.parse(raw); } catch (e) { rec = null; }
        }
        return host("findRelinkPlaceholders").then(function (orphans) {
            if (!orphans || !orphans.length) {
                clearPendingRelink();       // nothing stranded; drop a stale record
                return;
            }
            if (!rec || !rec.path) {
                // Placeholders with no breadcrumb — we cannot know which file
                // they came from, so say what is wrong rather than guess.
                return ui.alert(orphans.length + " footage item(s) are still placeholders from an " +
                    "interrupted optimize:\n\n" +
                    orphans.map(function (o) { return "• " + o.name; }).join("\n") +
                    "\n\nRelink them to their source files in After Effects.",
                    "Unfinished Optimize");
            }
            clearPendingRelink();
            return host("recoverPlaceholders", rec.path, rec.tokens || null)
                .then(function (res) {
                    if (!res || !res.restored) return;
                    toast("✓ Recovered " + res.restored + " footage item(s) from an interrupted optimize");
                    if (res.failed && res.failed.length) {
                        return ui.alert("Recovered " + res.restored + " footage item(s) after an " +
                            "interrupted optimize, but " + res.failed.length + " could not be relinked:\n\n" +
                            res.failed.map(function (n) { return "• " + n; }).join("\n") +
                            "\n\nRelink those manually in After Effects.", "Partial Recovery");
                    }
                }, function (e) {
                    return ui.alert("Footage is still placeholdered from an interrupted optimize, and " +
                        "automatic recovery failed:\n" + e.message +
                        "\n\nRelink it to:\n" + rec.path, "Recovery Failed");
                });
        }).catch(function () { /* host down — boot already reports that */ });
    }

    // ---------------- tabs (sliding thumb) ----------------

    function initTabs() {
        var tabsBar = document.querySelector(".tabs");
        var tabThumb = document.createElement("div");
        tabThumb.className = "tab-thumb";
        tabsBar.insertBefore(tabThumb, tabsBar.firstChild);

        function moveThumb(tab, immediate) {
            if (immediate) tabThumb.classList.add("is-static");
            tabThumb.style.width = tab.offsetWidth + "px";
            tabThumb.style.transform = "translateX(" + tab.offsetLeft + "px)";
            if (immediate) requestAnimationFrame(function () { tabThumb.classList.remove("is-static"); });
        }

        var activeTabAnimation = null;

        function animateTabPage(page, event) {
            // Keyboard navigation should respond instantly; pointer changes get one
            // small, interruptible transition for continuity.
            if (!page.animate || (event && event.detail === 0) || (reduceMotion && reduceMotion.matches)) return;
            if (activeTabAnimation) activeTabAnimation.cancel();
            var animation = page.animate([
                { opacity: 0, transform: "translateY(7px)" },
                { opacity: 1, transform: "translateY(0)" }
            ], {
                duration: 220,
                easing: "cubic-bezier(0.23, 1, 0.32, 1)"
            });
            activeTabAnimation = animation;
            animation.onfinish = animation.oncancel = function () {
                if (activeTabAnimation === animation) activeTabAnimation = null;
            };
        }

        Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (tab) {
            tab.addEventListener("click", function (event) {
                var keyboardSwitch = event.detail === 0;
                if (keyboardSwitch) tabsBar.classList.add("keyboard-switch");
                var previousTab = document.querySelector(".tab.active");
                var previousPage = document.querySelector(".tab-page.active");
                previousTab.classList.remove("active");
                previousTab.setAttribute("aria-selected", "false");
                previousTab.setAttribute("tabindex", "-1");
                previousPage.classList.remove("active");
                tab.classList.add("active");
                tab.setAttribute("aria-selected", "true");
                tab.setAttribute("tabindex", "0");
                var page = $("tab-" + tab.dataset.tab);
                page.classList.add("active");
                moveThumb(tab, keyboardSwitch);
                animateTabPage(page, event);
                if (keyboardSwitch) requestAnimationFrame(function () { tabsBar.classList.remove("keyboard-switch"); });
            });
        });
        tabsBar.addEventListener("keydown", function (event) {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
            var tabs = Array.prototype.slice.call(tabsBar.querySelectorAll(".tab"));
            var current = tabs.indexOf(document.activeElement);
            if (current < 0) current = tabs.indexOf(document.querySelector(".tab.active"));
            var next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
                (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
            event.preventDefault();
            tabs[next].focus();
            tabs[next].click();
        });
        global.addEventListener("resize", function () {
            moveThumb(document.querySelector(".tab.active"), true);
        });
        // position after first layout
        requestAnimationFrame(function () { moveThumb(document.querySelector(".tab.active"), true); });
    }

    // ---------------- collapsible cards ----------------

    function initCollapsibles() {
        Array.prototype.forEach.call(document.querySelectorAll(".card.collapsible"), function (card) {
            var section = card.dataset.section;
            var title = card.querySelector(".card-title");
            var saved = localStorage.getItem("bh.collapse." + section);
            if (saved === "1") card.classList.add("collapsed");
            else if (saved === "0") card.classList.remove("collapsed");
            title.setAttribute("role", "button");
            title.setAttribute("tabindex", "0");
            title.setAttribute("aria-expanded", card.classList.contains("collapsed") ? "false" : "true");
            title.addEventListener("click", function (event) {
                var instant = event.detail === 0;
                if (instant) card.classList.add("is-static");
                var collapsed = card.classList.toggle("collapsed");
                title.setAttribute("aria-expanded", collapsed ? "false" : "true");
                localStorage.setItem("bh.collapse." + section, collapsed ? "1" : "0");
                if (instant) requestAnimationFrame(function () { card.classList.remove("is-static"); });
            });
            title.addEventListener("keydown", function (event) {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                title.click();
            });
        });
    }

    global.BHCore = {
        // environment
        cs: cs, version: BH_VERSION, repoUrl: REPO_URL,
        node: { cp: cp, path: pathMod, fs: fsMod, os: osMod },
        T: T, ui: ui, reduceMotion: reduceMotion,

        // host bridge
        host: host, hostTimeouts: HOST_TIMEOUTS,

        // settings
        S: S, settingKeys: SETTING_KEYS, loadSettings: loadSettings, setSetting: setSetting,
        baseWorkFolder: baseWorkFolder, templatesFolder: templatesFolder,

        // dom helpers
        $: $, setPill: setPill, escapeHtml: escapeHtml,
        pickFiles: pickFiles, pickFolder: pickFolder,
        revealInOS: revealInOS, revealFile: revealFile,
        samePath: samePath, dedupePaths: dedupePaths,
        toast: toast, announce: announce, busy: busy, setProgress: setProgress,
        guardUnsaved: guardUnsaved, applyTheme: applyTheme,
        initTabs: initTabs, initCollapsibles: initCollapsibles,

        // shared state
        templates: getTemplates, setTemplates: setTemplates, onTemplates: onTemplates,
        loadTemplates: loadTemplates, saveTemplates: saveTemplates,
        project: getProject, onProject: onProject, refreshProject: refreshProject,

        // ffmpeg
        getFFmpegOrExplain: getFFmpegOrExplain, installFFmpegFlow: installFFmpegFlow,

        // interrupted-optimize recovery
        markPendingRelink: markPendingRelink, clearPendingRelink: clearPendingRelink,
        recoverStrandedFootage: recoverStrandedFootage
    };
})(window);
