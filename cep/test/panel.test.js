/*
    Tests for the panel's browser half — boot, the host bridge, and the
    recovery/accessibility behaviour wired through main.js.

    These run the REAL js/*.js against the REAL index.html on the DOM stub in
    _dom.js, so a missing element id or a broken listener fails here rather
    than in After Effects.
*/
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { bootPanel } = require("./_panel.js");

/** Boot, run a body, and always stop the panel's polling timers. */
async function withPanel(opts, body) {
    const panel = await bootPanel(opts);
    try { return await body(panel); }
    finally { panel.stop(); }
}

/* --------------------------------------------------------------- boot --- */

test("every script index.html references loads and boots", async () => {
    // The loader throws if index.html points at a file that is not there, so
    // this also catches a script tag added without its module.
    await withPanel({}, (p) => {
        ["core.js", "tab-launcher.js", "tab-render.js", "tab-optimizer.js",
         "tab-settings.js", "update-ui.js", "main.js"].forEach((f) => {
            assert.ok(p.loaded.includes(f), "index.html must load " + f);
        });
        assert.equal(p.loaded[p.loaded.length - 1], "main.js",
            "main.js boots last — every module must be defined before it runs");
        assert.equal(p.$("ae-status").textContent, "AE 24.0");
    });
});

test("each tab module exposes an init() the boot file can call", async () => {
    await withPanel({}, (p) => {
        ["BHCore", "BHLauncher", "BHRender", "BHOptimizer", "BHSettings", "BHUpdateUI"]
            .forEach((ns) => assert.ok(p.window[ns], ns + " is defined"));
        ["BHLauncher", "BHRender", "BHOptimizer", "BHSettings", "BHUpdateUI"]
            .forEach((ns) => assert.equal(typeof p.window[ns].init, "function", ns + ".init"));
    });
});

test("boot loads settings and renders the template list", async () => {
    await withPanel({}, (p) => {
        assert.ok(p.$("tpl-list").children.length > 0, "template list is populated");
        assert.ok(p.$("np-template").children.length > 0, "new-project dropdown is populated");
    });
});

test("the destination preview is built from the saved base folder", async () => {
    // The panel joins with the host's path module, so the separator differs
    // between the macOS and Windows CI runners — normalize before comparing.
    const nodePath = require("node:path");
    const base = "/Volumes/Work";
    await withPanel({ settings: { base_work_folder: base } }, (p) => {
        const dest = p.$("np-destination").textContent;
        assert.ok(dest.startsWith(nodePath.normalize(base)),
            "base folder feeds the path: " + dest);
        assert.ok(dest.includes(nodePath.sep + "AE_File" + nodePath.sep),
            "project lands in AE_File: " + dest);
        assert.ok(dest.endsWith(".aep"), "path ends in a project file: " + dest);
    });
});

test("with no base folder the panel says what to do instead of building a bad path", async () => {
    await withPanel({ settings: {} }, (p) => {
        assert.match(p.$("np-destination").textContent, /Settings/);
    });
});

/* -------------------------------------------------- host bridge timeout - */

test("a host call that never answers rejects instead of hanging forever", async () => {
    // evalScript has no timeout of its own: before this, the promise stayed
    // pending and every awaiting caller hung with no route to recovery.
    await withPanel({
        compressTimers: true,
        evalScript(script, cb) {
            if (/^BH\.ping\(/.test(script)) return;        // never calls back
            cb(JSON.stringify({ ok: true, data: null }));
        }
    }, async (p) => {
        await p.settle(120);
        assert.equal(p.$("ae-status").textContent, "host offline",
            "the timeout must surface as a visible state, not a silent hang");
        assert.ok(p.$("ae-status").classList.contains("pill-err"));
    });
});

test("a late reply after a timeout is ignored, not double-resolved", async () => {
    let late = null;
    await withPanel({
        compressTimers: true,
        evalScript(script, cb) {
            if (/^BH\.ping\(/.test(script)) { late = cb; return; }
            cb(JSON.stringify({ ok: true, data: null }));
        }
    }, async (p) => {
        await p.settle(120);
        assert.equal(p.$("ae-status").textContent, "host offline");
        late(JSON.stringify({ ok: true, data: { app: "AfterFX", version: "24.0" } }));
        await p.settle(40);
        assert.equal(p.$("ae-status").textContent, "host offline",
            "a reply that arrives after the timeout must not revive the promise");
    });
});

test("slow operations get a longer budget than the default", async () => {
    // collectProject can legitimately run for many minutes over a network
    // share; sharing the 30s default would abort real work.
    const src = require("node:fs").readFileSync(
        require("node:path").join(__dirname, "..", "js", "core.js"), "utf8");
    assert.match(src, /collectProject:\s*30 \* 60 \* 1000/);
    assert.match(src, /HOST_TIMEOUT_DEFAULT = 30 \* 1000/);
});

/* ------------------------------------------------- accessibility -------- */

test("toasts are announced to screen readers", async () => {
    await withPanel({}, (p) => {
        const toast = p.document.querySelector(".bh-toast");
        assert.ok(toast, "toast element exists");
        assert.equal(toast.getAttribute("role"), "status");
        assert.equal(toast.getAttribute("aria-live"), "polite");
        assert.equal(toast.getAttribute("aria-atomic"), "true");
    });
});

test("an off-screen live region exists for progress milestones", async () => {
    await withPanel({}, (p) => {
        const live = p.document.querySelector(".sr-only");
        assert.ok(live, "live region exists");
        assert.equal(live.getAttribute("aria-live"), "polite");
    });
});

test("the modal identifies itself as a dialog and names its own title", async () => {
    await withPanel({}, async (p) => {
        p.window.BHDialog.alert("hello", "A Title");
        await p.settle(20);
        const modal = p.document.querySelector(".bh-modal");
        assert.equal(modal.getAttribute("role"), "dialog");
        assert.equal(modal.getAttribute("aria-modal"), "true");
        assert.equal(modal.getAttribute("aria-labelledby"), "bh-modal-title");
        assert.equal(modal.getAttribute("aria-describedby"), "bh-modal-msg");
        assert.equal(p.$("bh-modal-title").textContent, "A Title");
    });
});

test("Tab stays inside an open confirm dialog", async () => {
    await withPanel({}, async (p) => {
        const done = p.window.BHDialog.confirm("sure?", "Confirm");
        await p.settle(20);
        const yes = p.document.querySelector(".bh-modal-yes");
        const no = p.document.querySelector(".bh-modal-no");
        assert.equal(p.document.activeElement, yes, "focus starts on the primary action");

        // Tab from the last stop wraps to the first, never out to the panel.
        p.document.dispatchEvent({ type: "keydown", key: "Tab", shiftKey: false });
        assert.equal(p.document.activeElement, no);
        p.document.dispatchEvent({ type: "keydown", key: "Tab", shiftKey: false });
        assert.equal(p.document.activeElement, yes,
            "focus must wrap within the dialog, not escape behind the overlay");

        p.document.dispatchEvent({ type: "keydown", key: "Escape" });
        assert.equal(await done, false);
    });
});

test("closing a dialog returns focus to where it was", async () => {
    await withPanel({}, async (p) => {
        const opener = p.$("btn-open");
        opener.focus();
        const done = p.window.BHDialog.confirm("sure?");
        await p.settle(20);
        assert.notEqual(p.document.activeElement, opener, "dialog took focus");
        p.document.dispatchEvent({ type: "keydown", key: "Escape" });
        await done;
        assert.equal(p.document.activeElement, opener,
            "focus goes back to the control that opened the dialog");
    });
});

/* ------------------------------------------------- optimizer queue ------ */

/** Replace ffmpeg's real probe/detect so queueing does not shell out. */
function stubFFmpeg(p, probe) {
    p.window.BHFFmpeg.detect = () => Promise.resolve("/usr/bin/ffmpeg");
    p.window.BHFFmpeg.probe = (exe, f) => Promise.resolve(probe ? probe(f) : {
        path: f, sizeMB: 10, width: 750, height: 300, duration: 5
    });
}

/** Drop a list of paths onto the optimizer dropzone. */
async function drop(p, paths) {
    stubFFmpeg(p);
    p.fire("btn-pick-files", "drop", {
        dataTransfer: { files: paths.map((path) => ({ path })) }
    });
    await p.settle(60);
}

test("dropping MP4s queues one row per file", async () => {
    await withPanel({}, async (p) => {
        await drop(p, ["/w/a.mp4", "/w/b.mp4"]);
        assert.equal(p.$("opt-file-list").children.length, 2);
    });
});

test("the same file dropped twice is queued once", async () => {
    // Queuing it twice would run a second optimize against the file the
    // first pass had already replaced.
    await withPanel({}, async (p) => {
        await drop(p, ["/w/a.mp4", "/w/a.mp4", "/w/b.mp4"]);
        assert.equal(p.$("opt-file-list").children.length, 2);
        assert.match(p.document.querySelector(".bh-toast").textContent, /duplicate/i,
            "the user is told a duplicate was skipped rather than it vanishing silently");
    });
});

test("non-MP4 drops are rejected with an explanation", async () => {
    await withPanel({}, async (p) => {
        await drop(p, ["/w/notes.txt"]);
        assert.equal(p.$("opt-file-list").children.length, 0);
        assert.match(p.document.querySelector(".bh-toast").textContent, /Only MP4/i);
    });
});

/* ------------------------------------------- interrupted-run recovery --- */

const ORPHAN = [{ index: 1, name: "BH_RELINK_1" }];

test("a clean boot does not attempt recovery", async () => {
    await withPanel({}, (p) => {
        assert.equal(p.callsTo("findRelinkPlaceholders").length, 1, "it checks");
        assert.equal(p.callsTo("recoverPlaceholders").length, 0, "and finds nothing to do");
    });
});

test("stranded footage is relinked at boot using the saved breadcrumb", async () => {
    const tokens = { items: [{ index: 1, name: "Hero Clip" }], oms: [] };
    await withPanel({
        settings: { pending_relink: JSON.stringify({ path: "/w/clip.mp4", tokens }) },
        hostImpl: {
            findRelinkPlaceholders: () => ORPHAN,
            recoverPlaceholders: () => ({ restored: 1, failed: [] })
        }
    }, async (p) => {
        await p.settle(60);
        const call = p.callsTo("recoverPlaceholders")[0];
        assert.ok(call, "recovery ran");
        assert.equal(call.args[0], "/w/clip.mp4", "it relinks to the recorded file");
        assert.deepEqual(call.args[1], tokens, "and passes the tokens that carry the original names");
        assert.match(p.document.querySelector(".bh-toast").textContent, /Recovered/);
    });
});

test("the breadcrumb is cleared so recovery cannot loop on every launch", async () => {
    await withPanel({
        settings: { pending_relink: JSON.stringify({ path: "/w/clip.mp4" }) },
        hostImpl: {
            findRelinkPlaceholders: () => ORPHAN,
            recoverPlaceholders: () => ({ restored: 1, failed: [] })
        }
    }, async (p) => {
        await p.settle(60);
        assert.equal(p.settings.pending_relink, "", "the record is consumed");
    });
});

test("a stale breadcrumb with nothing stranded is discarded quietly", async () => {
    await withPanel({
        settings: { pending_relink: JSON.stringify({ path: "/w/clip.mp4" }) },
        hostImpl: { findRelinkPlaceholders: () => [] }
    }, async (p) => {
        await p.settle(60);
        assert.equal(p.callsTo("recoverPlaceholders").length, 0);
        assert.equal(p.settings.pending_relink, "");
    });
});

test("placeholders with no breadcrumb are reported rather than guessed at", async () => {
    await withPanel({
        settings: {},
        hostImpl: { findRelinkPlaceholders: () => ORPHAN }
    }, async (p) => {
        await p.settle(60);
        assert.equal(p.callsTo("recoverPlaceholders").length, 0,
            "without a recorded path, relinking would point footage at the wrong file");
        assert.match(p.document.querySelector(".bh-modal-msg").textContent, /interrupted optimize/i);
    });
});

test("a partial recovery names the items the user still has to fix", async () => {
    await withPanel({
        settings: { pending_relink: JSON.stringify({ path: "/w/clip.mp4" }) },
        hostImpl: {
            findRelinkPlaceholders: () => ORPHAN,
            recoverPlaceholders: () => ({ restored: 1, failed: ["Stubborn Clip"] })
        }
    }, async (p) => {
        await p.settle(60);
        assert.match(p.document.querySelector(".bh-modal-msg").textContent, /Stubborn Clip/);
    });
});

test("a failed recovery tells the user which file to relink to", async () => {
    await withPanel({
        settings: { pending_relink: JSON.stringify({ path: "/w/clip.mp4" }) },
        hostImpl: {
            findRelinkPlaceholders: () => ORPHAN,
            recoverPlaceholders: () => new Error("AE said no")
        }
    }, async (p) => {
        await p.settle(60);
        const msg = p.document.querySelector(".bh-modal-msg").textContent;
        assert.match(msg, /AE said no/);
        assert.match(msg, /\/w\/clip\.mp4/, "the path is the one thing the user needs here");
    });
});

/* ----------------------------------------------------------- settings --- */

test("editing a settings field persists it to AE preferences", async () => {
    await withPanel({}, async (p) => {
        p.$("set-basefolder").value = "/Volumes/New";
        p.fire("set-basefolder", "change");
        await p.settle(20);
        assert.equal(p.settings.base_work_folder, "/Volumes/New");
    });
});

test("the NAS folder is shared with the ScriptUI launcher's nas_root setting", async () => {
    await withPanel({ settings: { nas_root: "/Volumes/Projects" } }, async (p) => {
        assert.equal(p.$("set-nasroot").value, "/Volumes/Projects");
        p.$("set-nasroot").value = "/Volumes/NAS2";
        p.fire("set-nasroot", "change");
        await p.settle(20);
        assert.equal(p.settings.nas_root, "/Volumes/NAS2");
    });
});

test("the optimizer target is shared with the DOOH setting", async () => {
    await withPanel({ settings: { dooh_target_mb: "5.5" } }, (p) => {
        assert.equal(p.$("opt-target").value, "5.5");
    });
});
