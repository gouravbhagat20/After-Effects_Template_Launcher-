/*
    BHFpsGuard — keeps imported footage on the Main comp's frame rate.

    When new footage appears in the open project:
      * an image sequence (PNG, EXR, TIFF, …) whose frame rate differs from
        Main's is conformed to it, and the panel says what it changed;
      * a video whose frame rate differs is only reported — conforming a
        video changes its speed and duration, so that stays a human decision.

    How it differs from a timer script inside After Effects:
      - The comp is always the project's Main comp, never "whichever comp was
        looked at last" (opening a 12 fps precomp must not conform to 12).
      - Footage is known by its item id, so renaming or relinking an item
        does not make it "new" again.
      - It rides on the panel's existing project poll and only scans when the
        number of project items changed, instead of walking the project
        every couple of seconds.
      - It stands down while the panel is busy (collect, optimize, creating a
        project): those switch projects and relink footage themselves.
      - Host calls from a panel simply wait while a dialog is open in After
        Effects; they cannot raise "cannot run a script while a modal dialog
        is waiting".
*/
(function (global) {
    "use strict";

    var TOL = 0.001;

    function fmt(n) { return String(Math.round(n * 1000) / 1000); }

    function init(core) {
        var $ = core.$;
        var ui = core.ui;
        var host = core.host;
        var toast = core.toast;

        var ready = false;        // settings loaded — until then we do not know if the guard is on
        var seen = null;          // item ids already looked at, for the project in `seenKey`
        var seenKey = null;
        var lastCount = -1;
        var scanning = false;
        var noMainToldFor = null; // project we already said "no Main comp" about

        function enabled() { return ready && core.S.fps_guard !== "false"; }

        function projectKey(p) { return p.path || "untitled"; }

        /**
         * Conform the mismatched sequences, list what was left alone, and
         * tell the user. `manual` also reports when there was nothing to do.
         *
         * A sequence that is already a layer in a comp is NOT conformed:
         * that changes its length under the layer (slowed down, the layer
         * keeps its old out point and the tail is cut off). It is reported.
         *
         * The returned promise settles once After Effects has been changed —
         * it does not wait for the dialog. A dialog nobody answers (the panel
         * is behind another tab) must not stop later imports being checked.
         */
        function handle(items, main, manual) {
            var seqs = [], videos = [], inUse = [];
            items.forEach(function (it) {
                if (Math.abs(it.fps - main.fps) <= TOL) return;
                if (!it.seq) videos.push(it);
                else if (it.used) inUse.push(it.name + "  (" + fmt(it.fps) + " fps)");
                else seqs.push(it);
            });

            var conform = seqs.length
                ? host("conformFrameRates", seqs.map(function (s) { return s.id; }), main.fps)
                : Promise.resolve({ fixed: [], failed: [] });

            return conform.then(function (res) {
                var fixed = (res && res.fixed) || [];
                var failed = (res && res.failed) || [];
                ((res && res.inUse) || []).forEach(function (n) { inUse.push(n); });
                var msg = "";
                if (fixed.length) {
                    msg += "Image sequences conformed to \"" + main.name + "\" (" + fmt(main.fps) + " fps):\n" +
                        fixed.map(function (f) {
                            return "• " + f.name + "  (" + fmt(f.from) + " → " + fmt(main.fps) + " fps)";
                        }).join("\n") + "\n\n";
                }
                if (videos.length) {
                    msg += "Video frame rate does not match \"" + main.name + "\" (" + fmt(main.fps) + " fps):\n" +
                        videos.map(function (v) { return "• " + v.name + "  (" + fmt(v.fps) + " fps)"; }).join("\n") +
                        "\n\nNot changed — conforming a video alters its speed and duration. " +
                        "Re-render it at " + fmt(main.fps) + " fps, or conform it yourself in Interpret Footage.\n\n";
                }
                if (inUse.length) {
                    msg += "Image sequences already used in a comp — not changed:\n" +
                        inUse.map(function (n) { return "• " + n; }).join("\n") +
                        "\n\nConforming these would change their length under the layers that use them. " +
                        "Set them to " + fmt(main.fps) + " fps in Interpret Footage, then check those layers.\n\n";
                }
                if (failed.length) {
                    msg += "Could not be changed:\n" +
                        failed.map(function (n) { return "• " + n; }).join("\n") + "\n\n";
                }

                if (msg) {
                    if (fixed.length) toast("✓ " + fixed.length + " sequence(s) conformed to " + fmt(main.fps) + " fps");
                    else toast("Frame rate mismatch — see the panel", true);
                    core.refreshProject();
                    ui.alert(msg.replace(/\n+$/, ""), "Frame Rate Guard");
                    return;
                }
                if (manual) {
                    ui.alert("All " + items.length + " footage item(s) already match \"" + main.name +
                        "\" (" + fmt(main.fps) + " fps).", "Frame Rate Guard");
                }
            });
        }

        /** Called on every project poll. Cheap unless something was imported. */
        function onProject(p) {
            if (!p || !p.open) { seen = null; seenKey = null; lastCount = -1; return; }
            if (!enabled() || scanning) return;
            // Collect, optimize and project creation switch projects and
            // relink footage; nothing they do is a user import.
            if (core.isBusy()) return;

            var key = projectKey(p);
            var count = p.numItems;
            if (key === seenKey && count === lastCount) return;
            if (count === 0) {
                // An empty project is a fresh start. After Effects numbers
                // items from 1 again in every new project, so ids remembered
                // from the last (untitled) one would hide the first imports.
                seen = {}; seenKey = key; lastCount = 0;
                return;
            }

            scanning = true;
            host("frameRateScan").then(function (res) {
                var items = (res && res.items) || [];
                if (key !== seenKey || !seen) {
                    // A project we have not looked at yet: what is already in
                    // it is its own business. Only later imports are checked.
                    seen = {};
                    items.forEach(function (it) { seen[it.id] = true; });
                    seenKey = key;
                    lastCount = count;
                    return;
                }
                lastCount = count;
                var fresh = items.filter(function (it) { return !seen[it.id]; });
                if (!fresh.length) return;

                if (!res.main) {
                    // Leave them unseen: they are checked once a Main comp exists.
                    lastCount = -1;
                    if (noMainToldFor !== key) {
                        noMainToldFor = key;
                        toast("New footage not checked — this project has no Main comp", true);
                    }
                    return;
                }
                fresh.forEach(function (it) { seen[it.id] = true; });
                return handle(fresh, res.main, false);
            }).catch(function () {
                /* host busy or down — the next poll tries again */
            }).then(function () { scanning = false; });
        }

        core.onProject(onProject);

        /** The "Check now" button: every footage item, not just new ones. */
        function checkAll() {
            return host("frameRateScan").then(function (res) {
                if (!res || !res.main) {
                    return ui.alert("This project has no Main comp to compare frame rates against.", "Frame Rate Guard");
                }
                var items = res.items || [];
                if (seen && seenKey !== null) items.forEach(function (it) { seen[it.id] = true; });
                if (!items.length) {
                    return ui.alert("There are no image sequences or videos in this project.", "Frame Rate Guard");
                }
                return handle(items, res.main, true);
            }, function (e) {
                return ui.alert("Could not check frame rates:\n" + e.message, "Frame Rate Guard");
            });
        }

        $("fps-guard").addEventListener("change", function () {
            core.setSetting("fps_guard", this.checked ? "true" : "false");
            // Turned back on: start from what is in the project now, so
            // footage imported while it was off is not conformed after the fact.
            seen = null; seenKey = null; lastCount = -1;
            toast(this.checked ? "Frame rate guard on" : "Frame rate guard off");
        });
        $("btn-fps-check").addEventListener("click", function () {
            var btn = this;
            btn.disabled = true;
            checkAll().then(function () { btn.disabled = false; }, function () { btn.disabled = false; });
        });

        function applySettings() {
            $("fps-guard").checked = core.S.fps_guard !== "false";
            ready = true;
            onProject(core.project());      // take stock of the open project now, not at the next poll
        }

        return { applySettings: applySettings, checkAll: checkAll };
    }

    global.BHFpsGuard = { init: init };
})(window);
