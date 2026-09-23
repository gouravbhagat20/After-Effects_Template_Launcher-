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
    assert.equal(ae.items[0].name, "BH_RELINK_1", "item is parked as a placeholder");
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
    assert.equal(ae.items[1].name, "BH_RELINK_2");
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
        replaceThrowsFor: (it) => it.name === "BH_RELINK_1"
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
    assert.equal(orphans[0].name, "BH_RELINK_1");
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
    assert.deepEqual(res.failed, ["BH_RELINK_1"]);
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
