"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { T } = require("./_load.js");

test("over-long project path throws BH-1006 and creates nothing", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "bh-len-"));
    try {
        const longBrand = "B".repeat(200); // pushes deepest path far past 240
        assert.throws(
            () => T.createProjectStructure(base, 2026, "Q1", longBrand, "Sunrise_750x300", "R1", "sunrise", "V1"),
            /BH-1006/);
        // nothing should have been created for the project
        assert.ok(!fs.existsSync(path.join(base, "2026", "Q1", longBrand)),
            "no partial tree on path-limit failure");
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("limit accounts for the deepest folder (Render_R#/PNG_Sequence)", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "bh-len2-"));
    try {
        // Craft a brand so the V1 folder itself is fine but deepest+50 crosses 240.
        // deepest = <base>/2026/Q1/<brand>/S/V1/AE_File/Render_R1/PNG_Sequence
        const fixed = path.join(base, "2026", "Q1").length +
            "/S/V1/AE_File/Render_R1/PNG_Sequence".length + 2; // separators approx
        const brandLen = Math.max(1, 240 - fixed - 45); // ends up within 50 of the cap
        const brand = "B".repeat(brandLen + 20);
        let threw = false;
        try {
            T.createProjectStructure(base, 2026, "Q1", brand, "S", "R1", "sunrise", "V1");
        } catch (e) {
            threw = true;
            assert.match(e.message, /BH-1006/);
            assert.match(e.message, /PNG_Sequence/, "error should cite the deepest path");
        }
        assert.ok(threw, "expected BH-1006 for near-limit path");
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
