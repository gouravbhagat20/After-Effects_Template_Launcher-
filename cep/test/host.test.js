/*
    Behavioural tests for jsx/host.jsx — the ExtendScript half of the panel.

    host.jsx mutates real project files inside After Effects, which made it the
    riskiest file in the repo and, until now, the only one CI merely
    syntax-checked. These run it against the in-memory AE mock in _aemock.js.

    Focus is the file-lock round trip (release -> encode -> restore), because
    that is where a failure strands a user's footage as a placeholder.
*/
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { buildAE, loadHost, unwrap } = require("./_aemock.js");

/* --------------------------------------------------- JSON envelope ------ */

test("stringify emits real arrays, not index objects", () => {
    const ae = buildAE({ items: [{ kind: "footage", name: "a.mp4", path: "/w/a.mp4" }] });
    const BH = loadHost(ae);
    const raw = BH.releaseFileLock("/w/a.mp4");
    assert.match(raw, /"items":\[/, "items must serialize as a JSON array");
    assert.match(raw, /"failed":\[\]/, "empty arrays must serialize as []");
});

test("fail() envelopes carry the message and ok:false", () => {
    const ae = buildAE({ items: [] });
    const BH = loadHost(ae);
    const parsed = JSON.parse(BH.recoverPlaceholders("/w/missing.mp4"));
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /File not found/);
});

test("control characters in names do not break the JSON envelope", () => {
    const ae = buildAE({
        items: [{ kind: "footage", name: 'we"ird\n\tname.mp4', path: "/w/a.mp4" }]
    });
    const BH = loadHost(ae);
    const data = unwrap(BH.releaseFileLock("/w/a.mp4"));
    assert.equal(data.items[0].name, 'we"ird\n\tname.mp4');
});

/* ------------------------------------------------- releaseFileLock ------ */

test("releaseFileLock parks matching footage and records its original name", () => {
    const ae = buildAE({
        items: [
            { kind: "footage", name: "Hero Clip", path: "/w/clip.mp4" },
            { kind: "footage", name: "Other", path: "/w/other.mp4" }
        ]
    });
    const BH = loadHost(ae);
    const tokens = unwrap(BH.releaseFileLock("/w/clip.mp4"));

    assert.equal(tokens.items.length, 1);
    assert.equal(tokens.items[0].index, 1);
    assert.equal(tokens.items[0].name, "Hero Clip", "original name must survive for restore");
    assert.equal(tokens.items[0].id, ae.items[0].id, "the token identifies the item by its persistent id");
    assert.equal(ae.items[0].name, "BH_RELINK_" + ae.items[0].id, "item is parked as a placeholder");
    assert.equal(ae.items[1].name, "Other", "unrelated footage is untouched");
});

test("releaseFileLock matches paths case-insensitively (Windows)", () => {
    const ae = buildAE({
        items: [{ kind: "footage", name: "clip.mp4", path: "/W/Clip.MP4" }]
    });
    const BH = loadHost(ae);
    const tokens = unwrap(BH.releaseFileLock("/w/clip.mp4"));
    assert.equal(tokens.items.length, 1, "a case-only path difference must still release the lock");
});

test("releaseFileLock clamps placeholder dimensions to AE's limits", () => {
    // The mock throws if host.jsx hands AE an out-of-range placeholder, which
    // is what AE itself does. Zero/oversized footage must be clamped, not passed through.
    const ae = buildAE({
        items: [{
            kind: "footage", name: "weird", path: "/w/clip.mp4",
            width: 0, height: 99999, frameRate: 0, duration: 99999
        }]
    });
    const BH = loadHost(ae);
    const tokens = unwrap(BH.releaseFileLock("/w/clip.mp4"));
    assert.equal(tokens.items.length, 1);
    assert.equal(tokens.failed.length, 0, "clamping must succeed, not land in failed[]");
    const ph = ae.items[0].placeholder;
    assert.ok(ph.w >= 4 && ph.w <= 30000, "width clamped");
    assert.ok(ph.h >= 4 && ph.h <= 30000, "height clamped");
    assert.ok(ph.fps >= 1 && ph.fps <= 99, "fps clamped");
    assert.ok(ph.dur <= 10800, "duration clamped");
});

test("releaseFileLock reports items it could not park, and keeps going", () => {
    const ae = buildAE({
        items: [
            { kind: "footage", name: "Locked One", path: "/w/clip.mp4" },
            { kind: "footage", name: "Fine One", path: "/w/clip.mp4" }
        ],
        placeholderThrowsFor: (it) => it.name === "Locked One"
    });
    const BH = loadHost(ae);
    const tokens = unwrap(BH.releaseFileLock("/w/clip.mp4"));
    assert.deepEqual(tokens.failed, ["Locked One"], "the failing item is named for the user");
    assert.equal(tokens.items.length, 1, "one bad item must not abort the rest");
    assert.equal(ae.items[1].name, "BH_RELINK_" + ae.items[1].id);
});

test("releaseFileLock never reports unrelated items as failed", () => {
    // An item that throws but does NOT reference the target file is not our
    // problem; naming it would send the user chasing the wrong footage.
    const ae = buildAE({
        items: [
            { kind: "footage", name: "Unrelated", path: "/w/other.mp4" },
            { kind: "footage", name: "Target", path: "/w/clip.mp4" }
        ],
        placeholderThrowsFor: (it) => it.name === "Unrelated"
    });
    const BH = loadHost(ae);
    const tokens = unwrap(BH.releaseFileLock("/w/clip.mp4"));
    assert.deepEqual(tokens.failed, [], "an unrelated failure must stay out of failed[]");
});

test("releaseFileLock redirects matching render-queue output modules", () => {
    const ae = buildAE({
        items: [],
        outputModules: [
            { rq: 1, om: 1, file: "/w/clip.mp4" },
            { rq: 1, om: 2, file: "/w/elsewhere.mp4" }
        ]
    });
    const BH = loadHost(ae);
    const tokens = unwrap(BH.releaseFileLock("/w/clip.mp4"));
    assert.deepEqual(tokens.oms, [{ rq: 1, om: 1 }]);
});

/* ------------------------------------------------- restoreFileLock ------ */

test("restoreFileLock relinks footage and puts the original name back", () => {
    const ae = buildAE({
        items: [{ kind: "footage", name: "Hero Clip", path: "/w/clip.mp4" }],
        files: ["/w/clip.mp4"]
    });
    const BH = loadHost(ae);
    const tokens = unwrap(BH.releaseFileLock("/w/clip.mp4"));
    const res = unwrap(BH.restoreFileLock(tokens, "/w/clip.mp4"));

    assert.equal(res.restored, 1);
    assert.deepEqual(res.failed, []);
    assert.equal(ae.items[0].name, "Hero Clip",
        "AE renames an item on replace(); host.jsx must rename it back");
});

test("restoreFileLock tolerates the legacy bare-index token shape", () => {
    // A panel page left open across an update can still send {items:[3]}.
    const ae = buildAE({
        items: [{ kind: "footage", name: "clip.mp4", path: "/w/clip.mp4" }],
        files: ["/w/clip.mp4"]
    });
    const BH = loadHost(ae);
    const res = unwrap(BH.restoreFileLock({ items: [1], oms: [] }, "/w/clip.mp4"));
    assert.equal(res.restored, 1);
});

test("restoreFileLock names every item it could not relink", () => {
    const ae = buildAE({
        items: [{ kind: "footage", name: "Hero Clip", path: "/w/clip.mp4" }],
        files: ["/w/clip.mp4"],
        replaceThrowsFor: (it) => String(it.name).indexOf("BH_RELINK_") === 0
    });
    const BH = loadHost(ae);
    const tokens = unwrap(BH.releaseFileLock("/w/clip.mp4"));
    const res = unwrap(BH.restoreFileLock(tokens, "/w/clip.mp4"));
    assert.equal(res.restored, 0);
    assert.deepEqual(res.failed, ["Hero Clip"],
        "the user needs the ORIGINAL name to find the item, not the placeholder name");
});

test("restoreFileLock reports failed output modules too", () => {
    const ae = buildAE({
        items: [],
        files: ["/w/clip.mp4"],
        outputModules: [{ rq: 2, om: 3, file: "/w/clip.mp4" }]
    });
    const BH = loadHost(ae);
    const res = unwrap(BH.restoreFileLock({ items: [], oms: [{ rq: 9, om: 9 }] }, "/w/clip.mp4"));
    assert.deepEqual(res.failed, ["render queue item 9 output 9"]);
});

/* ------------------------------------------- interrupted-run recovery --- */

test("a completed round trip leaves nothing to recover", () => {
    const ae = buildAE({
        items: [{ kind: "footage", name: "Hero Clip", path: "/w/clip.mp4" }],
        files: ["/w/clip.mp4"]
    });
    const BH = loadHost(ae);
    const tokens = unwrap(BH.releaseFileLock("/w/clip.mp4"));
    unwrap(BH.restoreFileLock(tokens, "/w/clip.mp4"));
    assert.deepEqual(unwrap(BH.findRelinkPlaceholders()), [],
        "no orphans after a clean run — recovery must not fire on every boot");
});

test("findRelinkPlaceholders spots footage stranded by an interrupted run", () => {
    const ae = buildAE({
        items: [
            { kind: "footage", name: "Hero Clip", path: "/w/clip.mp4" },
            { kind: "footage", name: "Untouched", path: "/w/other.mp4" }
        ],
        files: ["/w/clip.mp4"]
    });
    const BH = loadHost(ae);
    unwrap(BH.releaseFileLock("/w/clip.mp4"));   // ...and then the panel dies

    const orphans = unwrap(BH.findRelinkPlaceholders());
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0].index, 1);
    assert.equal(orphans[0].name, "BH_RELINK_" + ae.items[0].id);
});

test("recoverPlaceholders relinks orphans and restores names from the saved tokens", () => {
    const ae = buildAE({
        items: [{ kind: "footage", name: "Hero Clip", path: "/w/clip.mp4" }],
        files: ["/w/clip.mp4"]
    });
    const BH = loadHost(ae);
    const tokens = unwrap(BH.releaseFileLock("/w/clip.mp4"));   // panel dies here

    const res = unwrap(BH.recoverPlaceholders("/w/clip.mp4", tokens));
    assert.equal(res.restored, 1);
    assert.deepEqual(res.failed, []);
    assert.equal(ae.items[0].name, "Hero Clip", "the saved tokens carry the original name back");
    assert.deepEqual(unwrap(BH.findRelinkPlaceholders()), []);
});

test("recoverPlaceholders still rescues footage when the token record is lost", () => {
    // AE quit before the panel could persist the tokens. The footage is
    // relinked anyway; only the original name is gone.
    const ae = buildAE({
        items: [{ kind: "footage", name: "Hero Clip", path: "/w/clip.mp4" }],
        files: ["/w/clip.mp4"]
    });
    const BH = loadHost(ae);
    unwrap(BH.releaseFileLock("/w/clip.mp4"));

    const res = unwrap(BH.recoverPlaceholders("/w/clip.mp4", null));
    assert.equal(res.restored, 1, "recoverable footage beats a pristine name");
    assert.equal(ae.items[0].file.fsName, "/w/clip.mp4");
    assert.deepEqual(unwrap(BH.findRelinkPlaceholders()), []);
});

test("recoverPlaceholders leaves non-placeholder footage alone", () => {
    const ae = buildAE({
        items: [
            { kind: "footage", name: "Hero Clip", path: "/w/clip.mp4" },
            { kind: "footage", name: "Innocent", path: "/w/other.mp4" }
        ],
        files: ["/w/clip.mp4", "/w/other.mp4"]
    });
    const BH = loadHost(ae);
    unwrap(BH.releaseFileLock("/w/clip.mp4"));
    unwrap(BH.recoverPlaceholders("/w/clip.mp4", null));
    assert.equal(ae.items[1].name, "Innocent");
    assert.equal(ae.items[1].file.fsName, "/w/other.mp4",
        "recovery must not repoint unrelated footage at the recovered file");
});

test("recoverPlaceholders refuses a path that is not on disk", () => {
    const ae = buildAE({ items: [{ kind: "footage", name: "c", path: "/w/clip.mp4" }] });
    const BH = loadHost(ae);
    unwrap(BH.releaseFileLock("/w/clip.mp4"));
    const parsed = JSON.parse(BH.recoverPlaceholders("/w/gone.mp4", null));
    assert.equal(parsed.ok, false, "relinking to a missing file would strand the item again");
});

test("recoverPlaceholders reports orphans it could not relink", () => {
    const ae = buildAE({
        items: [{ kind: "footage", name: "Hero Clip", path: "/w/clip.mp4" }],
        files: ["/w/clip.mp4"],
        replaceThrowsFor: (it) => String(it.name).indexOf("BH_RELINK_") === 0
    });
    const BH = loadHost(ae);
    unwrap(BH.releaseFileLock("/w/clip.mp4"));
    const res = unwrap(BH.recoverPlaceholders("/w/clip.mp4", null));
    assert.equal(res.restored, 0);
    assert.deepEqual(res.failed, ["BH_RELINK_" + ae.items[0].id]);
});

/* ------------------------------------- indices that move on rename ------ */

// AE indexes project items in Project-panel (name) order. Parking an item
// renames it to BH_RELINK_*, which can move it — and everything it passes —
// to a different index. `sortByName` makes the mock do the same.

test("restore relinks the parked item, not whatever now sits at its old index", () => {
    const ae = buildAE({
        sortByName: true,
        items: [
            { kind: "footage", name: "Cherry", path: "/w/cherry.mp4" },
            { kind: "footage", name: "Zebra", path: "/w/clip.mp4" }
        ],
        files: ["/w/clip.mp4"]
    });
    const BH = loadHost(ae);
    const [cherry, zebra] = ae.items;

    const tokens = unwrap(BH.releaseFileLock("/w/clip.mp4"));
    assert.equal(tokens.items[0].index, 2, "Zebra was item 2 when it was released");
    assert.equal(ae.project.item(2), cherry, "…and the rename has since moved Cherry into slot 2");

    const res = unwrap(BH.restoreFileLock(tokens, "/w/clip.mp4"));
    assert.equal(res.restored, 1);
    assert.equal(zebra.name, "Zebra");
    assert.equal(zebra.file.fsName, "/w/clip.mp4");
    assert.equal(cherry.name, "Cherry", "unrelated footage must not be renamed");
    assert.equal(cherry.file.fsName, "/w/cherry.mp4", "unrelated footage must not be repointed");
});

test("release parks every match even though each rename reshuffles the list", () => {
    const ae = buildAE({
        sortByName: true,
        items: [
            { kind: "footage", name: "Mango", path: "/w/clip.mp4" },
            { kind: "footage", name: "Nectarine", path: "/w/clip.mp4" },
            { kind: "footage", name: "Apple", path: "/w/other.mp4" }
        ],
        files: ["/w/clip.mp4"]
    });
    const BH = loadHost(ae);
    const tokens = unwrap(BH.releaseFileLock("/w/clip.mp4"));
    assert.equal(tokens.items.length, 2, "both items on the file are released");
    unwrap(BH.restoreFileLock(tokens, "/w/clip.mp4"));
    assert.deepEqual(ae.items.map((i) => i.name), ["Mango", "Nectarine", "Apple"]);
});

test("an index-only token from an older panel is not trusted once the index has drifted", () => {
    const ae = buildAE({
        items: [
            { kind: "footage", name: "Cherry", path: "/w/cherry.mp4" },
            { kind: "footage", name: "BH_RELINK_5", path: null }
        ],
        files: ["/w/clip.mp4"]
    });
    const BH = loadHost(ae);
    // Saved as "item 1", but item 1 is not the placeholder that index named.
    const res = unwrap(BH.restoreFileLock({ items: [{ index: 1, name: "Hero" }], oms: [] }, "/w/clip.mp4"));
    assert.equal(res.restored, 0);
    assert.deepEqual(res.failed, ["Hero"]);
    assert.equal(ae.items[0].file.fsName, "/w/cherry.mp4", "the wrong item is reported, never relinked");
});

test("recovery restores original names by id after the indices have moved", () => {
    const ae = buildAE({
        sortByName: true,
        items: [
            { kind: "footage", name: "Cherry", path: "/w/cherry.mp4" },
            { kind: "footage", name: "Zebra", path: "/w/clip.mp4" }
        ],
        files: ["/w/clip.mp4"]
    });
    const BH = loadHost(ae);
    const tokens = unwrap(BH.releaseFileLock("/w/clip.mp4"));   // panel dies here
    const res = unwrap(BH.recoverPlaceholders("/w/clip.mp4", tokens));
    assert.equal(res.restored, 1);
    assert.equal(ae.items[1].name, "Zebra");
    assert.equal(ae.items[0].name, "Cherry");
});

/* ---------------------------------------------------- render queue ------ */

function queuedFormat(type) {
    const ae = buildAE({ items: [{ kind: "comp", name: "Main" }] });
    const BH = loadHost(ae);
    unwrap(BH.addMainToRenderQueue("/out/render", type));
    return ae.log.filter((l) => l.op === "applyTemplate")[0].name;
}

test("Expandable is queued as H.264, matching the MP4 folder the panel routes it to", () => {
    assert.equal(queuedFormat("expandable"), "H.264");
});

test("the other template types keep their formats", () => {
    assert.equal(queuedFormat("sunrise"), "PNG Sequence with Alpha");
    assert.equal(queuedFormat("default"), "PNG Sequence with Alpha");
    assert.equal(queuedFormat("interscroller"), "H.264");
    assert.equal(queuedFormat("dooh"), "H.264");
    assert.equal(queuedFormat("dooh_vertical"), "H.264");
});

test("a unit that ends up in the wrong format is reported, not silently queued", () => {
    // No PNG output-module template installed and setSettings refusing —
    // what After Effects 26.5 does on a machine without the custom template.
    const ae = buildAE({ items: [{ kind: "comp", name: "Main" }], missingOMTemplates: "all", setSettingsThrows: true });
    const res = unwrap(loadHost(ae).addMainToRenderQueue("/out/render", "sunrise"));
    assert.equal(res.expected, "png");
    assert.equal(res.actual, "mp4");
    assert.equal(res.formatOk, false);
});

test("with no custom PNG template, Sunrise falls back to After Effects' built-in one", () => {
    // A clean AE install: neither studio-made PNG template exists, and
    // setSettings cannot change the format.
    const ae = buildAE({
        items: [{ kind: "comp", name: "Main" }],
        missingOMTemplates: ["PNG Sequence with Alpha", "PNG Sequence", "H.264"],
        setSettingsThrows: true
    });
    const BH = loadHost(ae);
    const sunrise = unwrap(BH.addMainToRenderQueue("/out/render", "sunrise"));
    assert.equal(sunrise.actual, "png");
    assert.equal(sunrise.formatOk, true);
    const dooh = unwrap(BH.addMainToRenderQueue("/out/render", "dooh"));
    assert.equal(dooh.formatOk, true, "H.264 falls back to the stock 15 Mbps template");
    assert.deepEqual(ae.log.filter((l) => l.op === "applyTemplate").map((l) => l.name),
        ["_HIDDEN X-Factor 8", "H.264 - Match Render Settings - 15 Mbps"]);
});

test("a correctly formatted queue item reports formatOk", () => {
    const ae = buildAE({ items: [{ kind: "comp", name: "Main" }] });
    const BH = loadHost(ae);
    assert.equal(unwrap(BH.addMainToRenderQueue("/out/render", "sunrise")).formatOk, true);
    assert.equal(unwrap(BH.addMainToRenderQueue("/out/render", "expandable")).formatOk, true);
});

/* --------------------------------------------------------- collect ------ */

test("collect ends back in the original project, not the collected copy", () => {
    const ae = buildAE({
        projectFile: "/p/orig.aep",
        files: ["/p/orig.aep"],
        items: [{ kind: "footage", name: "clip.mp4", path: "/src/clip.mp4" }]
    });
    const BH = loadHost(ae);
    const res = unwrap(BH.collectProject("/dest/orig.aep", "/dest/(Footage)"));

    assert.equal(res.assets, 1);
    assert.equal(res.reopened, true);
    assert.equal(ae.project.file.fsName, "/p/orig.aep",
        "Save As moved AE onto the copy; later edits and renders must not land there");
    const ops = ae.log.map((l) => l.op);
    assert.ok(ops.lastIndexOf("open") > ops.lastIndexOf("save"),
        "the original is reopened only after the copy's relinks are saved");
});

test("a collect that fails part-way still returns to the original", () => {
    const ae = buildAE({
        projectFile: "/p/orig.aep",
        files: ["/p/orig.aep"],
        items: [{ kind: "footage", name: "clip.mp4", path: "/src/clip.mp4" }],
        replaceThrowsFor: () => true
    });
    const BH = loadHost(ae);
    const parsed = JSON.parse(BH.collectProject("/dest/orig.aep", "/dest/(Footage)"));

    assert.equal(parsed.ok, false);
    assert.equal(ae.project.file.fsName, "/p/orig.aep");
    assert.ok(ae.log.some((l) => l.op === "close"), "the half-relinked copy is closed without saving");
});

test("collect reports when the original could not be reopened", () => {
    const ae = buildAE({
        projectFile: "/p/orig.aep",
        files: ["/p/orig.aep"],
        items: []
    });
    ae.app.open = () => { throw new Error("AE refused"); };
    const BH = loadHost(ae);
    const res = unwrap(BH.collectProject("/dest/orig.aep", "/dest/(Footage)"));
    assert.equal(res.reopened, false, "the panel needs to know AE is still on the copy");
});

/* ------------------------------------------- collect: name clashes ------ */

const SEQ = { isStill: false };
const STILL = { isStill: true };

function collect(spec) {
    const ae = buildAE(Object.assign({ projectFile: "/p/orig.aep" }, spec,
        { files: ["/p/orig.aep"].concat(spec.files || []) }));
    const BH = loadHost(ae);
    const res = unwrap(BH.collectProject("/dest/orig.aep", "/dest/(Footage)"));
    return { ae, res };
}

test("two sequences with the same frame names are not merged into one", () => {
    const { ae, res } = collect({
        items: [
            { kind: "footage", name: "A", path: "/src/shotA/frame_0001.png", mainSource: SEQ },
            { kind: "footage", name: "B", path: "/src/shotB/frame_0001.png", mainSource: SEQ }
        ],
        files: ["/src/shotA/frame_0002.png", "/src/shotB/frame_0002.png"]
    });
    assert.equal(res.assets, 2);
    const [a, b] = ae.items.map((i) => i.file.fsName);
    assert.equal(a, "/dest/(Footage)/frame_0001.png");
    assert.equal(b, "/dest/(Footage)/shotB_2/frame_0001.png",
        "the second sequence gets its own folder instead of the first one's frames");
    assert.ok(ae.vfs.hasFile("/dest/(Footage)/shotB_2/frame_0002.png"), "all of its frames are copied");
    const copiedFromB = ae.log.filter((l) => l.op === "copy" && l.from.indexOf("/src/shotB/") === 0);
    assert.equal(copiedFromB.length, 2);
});

test("one sequence used by two items is copied once and shared", () => {
    const { ae, res } = collect({
        items: [
            { kind: "footage", name: "A", path: "/src/shot/frame_0001.png", mainSource: SEQ },
            { kind: "footage", name: "A again", path: "/src/shot/frame_0001.png", mainSource: SEQ }
        ],
        files: ["/src/shot/frame_0002.png"]
    });
    assert.equal(res.assets, 2);
    assert.equal(ae.items[1].file.fsName, "/dest/(Footage)/frame_0001.png");
    assert.equal(ae.log.filter((l) => l.op === "copy").length, 2, "two frames, copied once each");
});

test("a sequence only takes its own numbered frames from the folder", () => {
    const { ae } = collect({
        items: [{ kind: "footage", name: "A", path: "/src/shot/frame_0001.png", mainSource: SEQ }],
        files: ["/src/shot/frame_0002.png", "/src/shot/frame_notes.png", "/src/shot/frame_0001.png.bak"]
    });
    const copied = ae.log.filter((l) => l.op === "copy").map((l) => l.from).sort();
    assert.deepEqual(copied, ["/src/shot/frame_0001.png", "/src/shot/frame_0002.png"]);
});

test("the same file used by two items is copied once", () => {
    const { ae, res } = collect({
        items: [
            { kind: "footage", name: "logo", path: "/src/logo.png", mainSource: STILL },
            { kind: "footage", name: "logo 2", path: "/src/logo.png", mainSource: STILL }
        ]
    });
    assert.equal(res.assets, 2);
    assert.equal(ae.log.filter((l) => l.op === "copy").length, 1);
    assert.equal(ae.items[0].file.fsName, "/dest/(Footage)/logo.png");
    assert.equal(ae.items[1].file.fsName, "/dest/(Footage)/logo.png");
});

test("different files with the same name still get separate copies", () => {
    const { ae } = collect({
        items: [
            { kind: "footage", name: "logo", path: "/src/a/logo.png", mainSource: STILL },
            { kind: "footage", name: "logo", path: "/src/b/logo.png", mainSource: STILL }
        ]
    });
    assert.equal(ae.items[0].file.fsName, "/dest/(Footage)/logo.png");
    assert.equal(ae.items[1].file.fsName, "/dest/(Footage)/logo_1.png");
});

/* ------------------------------------------------ stepped collect ------ */

function steppedAE(extra) {
    return buildAE(Object.assign({
        projectFile: "/p/orig.aep",
        files: ["/p/orig.aep"],
        items: [
            { kind: "footage", name: "a", path: "/src/a.png", mainSource: STILL },
            { kind: "footage", name: "b", path: "/src/b.png", mainSource: STILL },
            { kind: "footage", name: "gone", path: "/src/gone.png", mainSource: STILL, onDisk: false },
            { kind: "footage", name: "c", path: "/src/c.png", mainSource: STILL }
        ]
    }, extra || {}));
}

test("a stepped collect reports progress and ends like the one-call form", () => {
    const ae = steppedAE();
    const BH = loadHost(ae);
    const begin = unwrap(BH.collectBegin("/dest/orig.aep", "/dest/(Footage)"));
    assert.deepEqual(begin, { total: 3, missing: 1 }, "missing footage is counted, not queued");

    const seen = [];
    let p;
    do {
        p = unwrap(BH.collectStep(-1));     // no time budget in a test: one call may do it all
        seen.push(p.done);
    } while (!p.finished);
    assert.equal(seen[seen.length - 1], 3);

    const res = unwrap(BH.collectFinish());
    assert.deepEqual(res, { assets: 3, missing: 1, reopened: true });
    assert.equal(ae.project.file.fsName, "/p/orig.aep");
    assert.ok(ae.vfs.hasFile("/dest/(Footage)/c.png"));
    assert.equal(JSON.parse(BH.collectStep(250)).ok, false, "nothing is left in progress afterwards");
});

test("a step stops after its time budget so the panel can show progress", () => {
    const ae = steppedAE();
    const BH = loadHost(ae);
    unwrap(BH.collectBegin("/dest/orig.aep", "/dest/(Footage)"));
    // Make every copy take a few real milliseconds, then allow 1 ms per step.
    ae.vfs.copyFails = () => {
        const until = Date.now() + 3;
        while (Date.now() < until) { /* spin */ }
        return false;
    };
    const p = unwrap(BH.collectStep(1));
    assert.equal(p.done, 1, "one item, then control goes back to the panel");
    assert.equal(p.total, 3);
    assert.equal(p.finished, false);
});

test("cancelling a stepped collect discards the copy and reopens the original", () => {
    const ae = steppedAE();
    const BH = loadHost(ae);
    unwrap(BH.collectBegin("/dest/orig.aep", "/dest/(Footage)"));
    assert.equal(ae.project.file.fsName, "/dest/orig.aep", "Save As put AE on the copy");

    const res = unwrap(BH.collectAbort());
    assert.equal(res.reopened, true);
    assert.equal(ae.project.file.fsName, "/p/orig.aep");
    assert.ok(ae.log.some((l) => l.op === "close"), "the copy is closed without saving");
    assert.equal(JSON.parse(BH.collectStep(250)).ok, false);
});

test("a step refuses to touch a different project opened mid-collect", () => {
    const ae = steppedAE();
    const BH = loadHost(ae);
    unwrap(BH.collectBegin("/dest/orig.aep", "/dest/(Footage)"));
    ae.vfs.addFile("/elsewhere/other.aep");
    ae.app.open(new ae.globals.File("/elsewhere/other.aep"));   // the user switched projects

    const before = ae.log.length;
    const parsed = JSON.parse(BH.collectStep(250));
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /changed in After Effects/);
    assert.equal(ae.log.length, before, "nothing was copied, relinked, closed or opened");
    assert.equal(ae.project.file.fsName, "/elsewhere/other.aep");
});

test("a failure inside a step abandons the collect and returns to the original", () => {
    const ae = steppedAE({ replaceThrowsFor: () => true });
    const BH = loadHost(ae);
    unwrap(BH.collectBegin("/dest/orig.aep", "/dest/(Footage)"));
    assert.equal(JSON.parse(BH.collectStep(250)).ok, false);
    assert.equal(ae.project.file.fsName, "/p/orig.aep");
});

/* ------------------------------------------------- comp / folder match --- */

test("the Main fallback needs 'Main' as a whole word", () => {
    const main = (names) => {
        const ae = buildAE({
            projectFile: "/p/x.aep",
            items: names.map((name) => ({ kind: "comp", name, width: 1, height: 1, duration: 1, frameRate: 24 }))
        });
        const info = unwrap(loadHost(ae).getProjectInfo());
        return info.mainComp && info.mainComp.name;
    };
    assert.equal(main(["Remaining", "Domain_Intro"]), null, "a substring is not a Main comp");
    assert.equal(main(["Remaining", "Main_v2"]), "Main_v2");
    assert.equal(main(["01 Main"]), "01 Main");
    assert.equal(main(["Main_v2", "main"]), "main", "an exact match still wins");
});

test("getFootageIn does not claim a sibling folder with the same prefix", () => {
    const ae = buildAE({
        items: [
            { kind: "footage", name: "in", path: "/work/job/a.mp4" },
            { kind: "footage", name: "out", path: "/work/job2/b.mp4" }
        ]
    });
    const hits = unwrap(loadHost(ae).getFootageIn("/work/job")).map((h) => h.name);
    assert.deepEqual(hits, ["in"]);
});

/* ------------------------------------------------------ getSetting ------ */

test("getSetting returns the default when the key is absent", () => {
    const ae = buildAE({ items: [] });
    const BH = loadHost(ae);
    assert.equal(unwrap(BH.getSetting("nope", "fallback")), "fallback");
});

test("setSetting then getSetting round-trips through AE preferences", () => {
    const ae = buildAE({ items: [] });
    const BH = loadHost(ae);
    unwrap(BH.setSetting("base_work_folder", "/Volumes/Work"));
    assert.equal(unwrap(BH.getSetting("base_work_folder", null)), "/Volumes/Work");
});
