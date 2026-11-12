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
        const live = p.document.querySelector(".bh-live");
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

test("Enter answers with the focused button, so Enter on Cancel cancels", async () => {
    await withPanel({}, async (p) => {
        const done = p.window.BHDialog.confirm("Continue WITHOUT saving?", "Discard Changes?");
        await p.settle(20);
        p.document.dispatchEvent({ type: "keydown", key: "Tab", shiftKey: false });
        assert.equal(p.document.activeElement, p.document.querySelector(".bh-modal-no"));
        p.document.dispatchEvent({ type: "keydown", key: "Enter" });
        assert.equal(await done, false, "Enter on Cancel must not confirm");
    });
});

test("Enter on the primary button still confirms", async () => {
    await withPanel({}, async (p) => {
        const done = p.window.BHDialog.confirm("sure?");
        await p.settle(20);
        p.document.dispatchEvent({ type: "keydown", key: "Enter" });
        assert.equal(await done, true);
    });
});

/* ---------------------------------------------- unsaved-changes guard --- */

const DIRTY = { open: true, dirty: true, path: "/p/work.aep", name: "work", folder: "/p" };

/** Start the guard, then press Enter on each dialog it raises, in order. */
async function runGuard(p, answers) {
    const done = p.window.BHCore.guardUnsaved("Open project: next.aep");
    for (const key of answers) {
        await p.settle(30);
        p.document.dispatchEvent({ type: "keydown", key });
    }
    return done;
}

test("a failed save stops the action instead of discarding the changes", async () => {
    await withPanel({
        projectInfo: DIRTY,
        hostImpl: { saveProject: () => new Error("disk full") }
    }, async (p) => {
        // Enter = "Save first"; Enter again dismisses the failure alert.
        const go = await runGuard(p, ["Enter", "Enter"]);
        assert.equal(go, false, "callers force-open on true, which would lose the unsaved work");
        assert.equal(p.callsTo("saveProject").length, 1);
    });
});

test("a successful save lets the action proceed", async () => {
    await withPanel({ projectInfo: DIRTY, hostImpl: { saveProject: () => ({ saved: "/p/work.aep" }) } },
        async (p) => {
            assert.equal(await runGuard(p, ["Enter"]), true);
        });
});

test("a clean project needs no prompt", async () => {
    await withPanel({ projectInfo: Object.assign({}, DIRTY, { dirty: false }) }, async (p) => {
        assert.equal(await p.window.BHCore.guardUnsaved("x"), true);
    });
});

test("when the project state cannot be read the user decides, not the panel", async () => {
    await withPanel({ hostImpl: { getProjectInfo: () => new Error("host busy") } }, async (p) => {
        assert.equal(await runGuard(p, ["Escape"]), false);
    });
});

/* ------------------------------------------------ dashboard layout ------ */

test("the template picker draws one tile per template and drives the select", async () => {
    await withPanel({}, async (p) => {
        const tiles = p.document.querySelectorAll(".tpl-tile");
        const options = p.$("np-template").children.length;
        assert.ok(options > 1);
        assert.equal(tiles.length, options, "one tile per template");
        assert.equal(tiles[0].getAttribute("aria-pressed"), "true", "the first template starts selected");

        tiles[2].click();
        await p.settle(10);
        assert.equal(String(p.$("np-template").value), "2", "a tile sets the select the rest of the code reads");
        assert.equal(tiles[2].getAttribute("aria-pressed"), "true");
        assert.equal(tiles[0].getAttribute("aria-pressed"), "false");
    });
});

test("the target-size stepper moves in 0.1 MB steps and saves the setting", async () => {
    await withPanel({ settings: { dooh_target_mb: "6.8" } }, async (p) => {
        p.$("btn-target-up").click();
        await p.settle(10);
        assert.equal(p.$("opt-target").value, "6.9");
        assert.equal(p.settings.dooh_target_mb, "6.9");
        p.$("btn-target-down").click();
        p.$("btn-target-down").click();
        await p.settle(10);
        assert.equal(p.$("opt-target").value, "6.7");
    });
});

test("Open file stays reachable when there are no recent projects", async () => {
    await withPanel({}, async (p) => {
        assert.ok(!p.$("recents-card").classList.contains("hidden"),
            "the Recent section holds the Open file action, so it is never hidden");
        assert.ok(p.$("btn-open"));
    });
});

test("the connection dot carries its wording as a tooltip and label", async () => {
    await withPanel({}, async (p) => {
        assert.match(p.$("ae-status").title, /AE 24\.0/);
        assert.match(p.$("ae-status").getAttribute("aria-label"), /After Effects: AE/);
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

test("Cancel pressed while AE releases a file stops before that file is encoded", async () => {
    let panel;
    await withPanel({
        hostImpl: {
            // The user hits Cancel while the host call is still in flight.
            releaseFileLock: () => {
                panel.$("btn-cancel").click();
                return { items: [], oms: [], failed: [] };
            }
        }
    }, async (p) => {
        panel = p;
        await drop(p, ["/w/a.mp4", "/w/b.mp4"]);
        const encoded = [];
        p.window.BHFFmpeg.optimize = (file) => {
            encoded.push(file);
            return Promise.resolve({ path: file, before: 10, after: 5, met: true, attempts: 1, replaced: true, output: file });
        };
        p.$("btn-optimize").click();
        await p.settle(80);
        assert.deepEqual(encoded, [], "no encode may start after Cancel");
        assert.equal(p.callsTo("releaseFileLock").length, 1, "the rest of the batch is skipped");
        assert.match(p.$("opt-log").textContent, /Cancelled/);
    });
});

test("optimizing a file with sound warns that the audio will be dropped", async () => {
    await withPanel({}, async (p) => {
        p.window.BHFFmpeg.detect = () => Promise.resolve("/usr/bin/ffmpeg");
        p.window.BHFFmpeg.probe = (exe, f) => Promise.resolve(
            { path: f, sizeMB: 10, width: 1920, height: 1080, duration: 5, hasAudio: /sound/.test(f) });
        p.fire("btn-pick-files", "drop",
            { dataTransfer: { files: [{ path: "/w/sound.mp4" }, { path: "/w/silent.mp4" }] } });
        await p.settle(60);
        p.window.BHFFmpeg.optimize = (file) => Promise.resolve(
            { path: file, before: 10, after: 5, met: true, attempts: 1, replaced: true, output: file });
        p.$("btn-optimize").click();
        await p.settle(80);
        const log = p.$("opt-log").textContent;
        assert.match(log, /sound\.mp4 has an audio track/);
        assert.doesNotMatch(log, /silent\.mp4 has an audio track/);
    });
});

/* -------------------------------------------------- render queue ------- */

test("a wrong render format is flagged and never sent to Media Encoder", async () => {
    const os = require("node:os"), fs = require("node:fs"), path = require("node:path");
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "bh-rq-"));
    try {
        await withPanel({
            settings: { ame_enabled: "true" },
            projectInfo: { open: true, dirty: false, path: path.join(folder, "Nike_Q1_750x300_V1_R1.aep"),
                           name: "Nike_Q1_750x300_V1_R1", folder,
                           mainComp: { name: "Main", width: 750, height: 300, duration: 15, fps: 24 } },
            hostImpl: { addMainToRenderQueue: () => ({ comp: "Main", canAME: true, expected: "png", actual: "mp4", formatOk: false }) }
        }, async (p) => {
            p.$("btn-rq-add").click();
            await p.settle(60);
            assert.match(p.$("bh-modal-msg").textContent, /\.mp4 instead of a PNG sequence/);
            assert.equal(p.callsTo("queueToAME").length, 0);
        });
    } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

/* ------------------------------------------------------- collect ------- */

const SAVED = { open: true, dirty: false, path: "/p/Nike_Q1_750x300_V1_R1.aep",
                name: "Nike_Q1_750x300_V1_R1", folder: "/p",
                mainComp: { name: "Main", width: 750, height: 300, duration: 15, fps: 24 } };

/** Boot with a saved project and a host that collects 3 items, one per step. */
function collectPanel(overrides) {
    const os = require("node:os"), fs = require("node:fs"), path = require("node:path");
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "bh-collect-"));
    let done = 0;
    const hostImpl = Object.assign({
        preFlightCheck: () => [],
        collectBegin: () => ({ total: 3, missing: 0 }),
        collectStep: () => { done++; return { done, total: 3, finished: done >= 3 }; },
        collectFinish: () => ({ assets: 3, missing: 0, reopened: true }),
        collectAbort: () => ({ reopened: true })
    }, overrides || {});
    return { dest, opts: { projectInfo: SAVED, hostImpl }, cleanup: () => fs.rmSync(dest, { recursive: true, force: true }) };
}

async function startCollect(p, dest) {
    p.window.cep.fs.showOpenDialogEx = () => ({ err: 0, data: [dest] });
    p.window.BHCore.revealFile = () => { };
    p.$("btn-collect").click();
    await p.settle(120);
}

test("collect runs in steps and reports the result", async () => {
    const c = collectPanel();
    try {
        await withPanel(c.opts, async (p) => {
            await startCollect(p, c.dest);
            assert.equal(p.callsTo("collectStep").length, 3, "one host call per slice of work");
            assert.equal(p.callsTo("collectFinish").length, 1);
            assert.equal(p.callsTo("collectProject").length, 0, "the one-shot call would freeze AE");
            assert.match(p.$("collect-status").textContent, /Collected 3 asset/);
            assert.ok(p.$("btn-collect-cancel").classList.contains("hidden"), "Cancel goes away when done");
            assert.equal(p.$("btn-collect").disabled, false);
        });
    } finally { c.cleanup(); }
});

test("Cancel during a collect aborts it instead of finishing", async () => {
    let panel;
    const c = collectPanel({
        collectStep: () => {
            panel.$("btn-collect-cancel").click();      // pressed while a slice is running
            return { done: 1, total: 3, finished: false };
        }
    });
    try {
        await withPanel(c.opts, async (p) => {
            panel = p;
            await startCollect(p, c.dest);
            assert.equal(p.callsTo("collectStep").length, 1, "no further slices after Cancel");
            assert.equal(p.callsTo("collectAbort").length, 1);
            assert.equal(p.callsTo("collectFinish").length, 0);
            assert.match(p.$("collect-status").textContent, /cancelled/i);
        });
    } finally { c.cleanup(); }
});

test("a collect that could not return to the original says so", async () => {
    const c = collectPanel({ collectFinish: () => ({ assets: 3, missing: 0, reopened: false }) });
    try {
        await withPanel(c.opts, async (p) => {
            await startCollect(p, c.dest);
            assert.match(p.$("bh-modal-msg").textContent, /collected COPY/);
        });
    } finally { c.cleanup(); }
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
