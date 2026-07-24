"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { T } = require("./_load.js");

// The same vectors the ScriptUI's built-in self-test uses.
const VECTORS = [
    ["Nike_AirMax_Q3_750x300_V1_R1",
        { brand: "Nike", campaign: "AirMax", quarter: "Q3", size: "750x300", version: "V1", revision: "R1" }],
    ["TechCorp_Q4_1920x1080_V1_R15",
        { brand: "TechCorp", campaign: "", quarter: "Q4", size: "1920x1080", version: "V1", revision: "R15" }],
    ["DOOH_Generic_1920x1080_V1_R1",
        { brand: "DOOH", campaign: "Generic", quarter: null, size: "1920x1080", version: "V1", revision: "R1", isDOOH: true }],
    ["DOOH_1920x1080_V1_R1",
        { brand: "DOOH", campaign: "", quarter: null, size: "1920x1080", version: "V1", revision: "R1", isDOOH: true }],
    ["SimpleBrand_300x600_V1_R1",
        { brand: "SimpleBrand", campaign: "", quarter: null, size: "300x600", version: "V1", revision: "R1" }]
];

for (const [input, expected] of VECTORS) {
    test("parseProjectName: " + input, () => {
        const p = T.parseProjectName(input);
        assert.ok(p, "should parse");
        for (const k of Object.keys(expected)) {
            assert.strictEqual(p[k], expected[k], k);
        }
    });
}

test("V is optional and defaults to V1", () => {
    const p = T.parseProjectName("Brand_Camp_Q2_750x300_R4");
    assert.strictEqual(p.version, "V1");
    assert.strictEqual(p.revision, "R4");
});

test("multi-word campaign keeps its underscores", () => {
    const p = T.parseProjectName("Brand_Big_Summer_Sale_Q1_750x300_V2_R1");
    assert.strictEqual(p.brand, "Brand");
    assert.strictEqual(p.campaign, "Big_Summer_Sale");
});

test("unparseable names return null", () => {
    assert.strictEqual(T.parseProjectName("random_file"), null);
    assert.strictEqual(T.parseProjectName(""), null);
    assert.strictEqual(T.parseProjectName(null), null);
    assert.strictEqual(T.parseProjectName("NoSize_V1_R1"), null);
});

test("round-trip: buildFilename output parses back to its parts", () => {
    const name = T.buildFilename("Acme", "Launch", "Q2", "880x1912", "V3", "R7", false)
        .replace(/\.aep$/, "");
    const p = T.parseProjectName(name);
    assert.strictEqual(p.brand, "Acme");
    assert.strictEqual(p.campaign, "Launch");
    assert.strictEqual(p.quarter, "Q2");
    assert.strictEqual(p.size, "880x1912");
    assert.strictEqual(p.version, "V3");
    assert.strictEqual(p.revision, "R7");
});

test("round-trip: DOOH filename parses back as DOOH", () => {
    const name = T.buildFilename("X", "CityTakeover", "Q1", "1080x1920", "V1", "R2", true)
        .replace(/\.aep$/, "");
    const p = T.parseProjectName(name);
    assert.strictEqual(p.isDOOH, true);
    assert.strictEqual(p.campaign, "CityTakeover");
    assert.strictEqual(p.size, "1080x1920");
    assert.strictEqual(p.revision, "R2");
});

test("buildRenderName: sunrise uses CTA_AnimatedSunrise pattern", () => {
    const r = T.buildRenderName("Nike_AirMax_Q3_750x300_V1_R1", 750, 300);
    assert.strictEqual(r.type, "sunrise");
    assert.strictEqual(r.name, "Nike_AirMax_CTA_AnimatedSunrise_V1_R1");
});

test("buildRenderName: DOOH pattern includes size and date", () => {
    const r = T.buildRenderName("DOOH_Metro_1920x1080_V1_R1", 1920, 1080);
    assert.strictEqual(r.type, "dooh");
    assert.match(r.name, /^DOOH_Metro_1920x1080_\d{8}$/);
});

test("validate: brand required and length-limited", () => {
    assert.match(T.validate("", ""), /required/i);
    assert.match(T.validate("A", ""), /2-50/);
    assert.strictEqual(T.validate("OK", ""), null);
    assert.match(T.validate("OK", "x".repeat(51)), /under 50/i);
});
