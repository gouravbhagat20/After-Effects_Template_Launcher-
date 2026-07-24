"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { T } = require("./_load.js");

function tmpBase() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "bh-test-"));
}
function rmrf(p) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { }
}

test("createProjectStructure builds the full v0.3 layout", () => {
    const base = tmpBase();
    try {
        const r = T.createProjectStructure(
            base, 2026, "Q3", "Nike_AirMax", "Sunrise_750x300", "R1", "sunrise", "V1");

        const v1 = path.join(base, "2026", "Q3", "Nike_AirMax", "Sunrise_750x300", "V1");
        assert.strictEqual(r.versionFolder, v1);

        // AE side: AE_File / { Collect_Files, Render_R1/{MP4, PNG_Sequence} }
        for (const p of [
            path.join(v1, "AE_File"),
            path.join(v1, "AE_File", "Collect_Files"),
            path.join(v1, "AE_File", "Render_R1"),
            path.join(v1, "AE_File", "Render_R1", "MP4"),
            path.join(v1, "AE_File", "Render_R1", "PNG_Sequence"),
            // Assets: flat Images/Screens, no per-revision nesting
            path.join(v1, "Assets", "Images"),
            path.join(v1, "Assets", "Screens")
        ]) {
            assert.ok(fs.existsSync(p), "missing: " + p);
        }

        // no legacy folders
        assert.ok(!fs.existsSync(path.join(v1, "Assets", "Image")), "legacy Image folder");
        assert.ok(!fs.existsSync(path.join(v1, "Assets", "Images", "R1")), "legacy per-revision nesting");

        assert.strictEqual(r.collectFolder, path.join(v1, "AE_File", "Collect_Files"));
        assert.strictEqual(r.publishedFolder, path.join(v1, "AE_File", "Render_R1"));
    } finally { rmrf(base); }
});

test("createProjectStructure is idempotent (re-run over existing tree)", () => {
    const base = tmpBase();
    try {
        const args = [base, 2026, "Q1", "Acme", "DOOH-Horizontal_1920x1080", "R2", "dooh_horizontal", "V2"];
        const a = T.createProjectStructure.apply(null, args);
        // drop a file in, then re-run — must not throw or clobber
        const marker = path.join(a.aeFolder, "existing.aep");
        fs.writeFileSync(marker, "x");
        const b = T.createProjectStructure.apply(null, args);
        assert.strictEqual(b.aeFolder, a.aeFolder);
        assert.ok(fs.existsSync(marker), "existing file must survive re-run");
    } finally { rmrf(base); }
});

test("unknown template type falls back to default asset folders", () => {
    const base = tmpBase();
    try {
        const r = T.createProjectStructure(
            base, 2026, "Q2", "B", "Custom_300x250", "R1", "no_such_type", "V1");
        assert.ok(fs.existsSync(path.join(r.assetsFolder, "Images")));
        assert.ok(fs.existsSync(path.join(r.assetsFolder, "Screens")));
    } finally { rmrf(base); }
});

test("missing base folder throws BH-1005", () => {
    assert.throws(
        () => T.createProjectStructure("/no/such/base/dir", 2026, "Q1", "B", "S", "R1", "sunrise", "V1"),
        /BH-1005/);
});
