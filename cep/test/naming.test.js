"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { T } = require("./_load.js");

test("sanitizeName strips illegal filesystem characters", () => {
    assert.strictEqual(T.sanitizeName('Br<a>nd:"/\\|?*X'), "BrandX");
});

test("sanitizeName collapses whitespace and underscores", () => {
    assert.strictEqual(T.sanitizeName("  My   Brand  "), "My_Brand");
    assert.strictEqual(T.sanitizeName("a__b___c"), "a_b_c");
});

test("sanitizeName guards reserved Windows device names", () => {
    assert.strictEqual(T.sanitizeName("CON"), "CON_");
    assert.strictEqual(T.sanitizeName("com1"), "com1_");
    assert.strictEqual(T.sanitizeName("Console"), "Console"); // only exact matches
});

test("sanitizeName handles empty/null", () => {
    assert.strictEqual(T.sanitizeName(""), "");
    assert.strictEqual(T.sanitizeName(null), "");
});

test("buildFilename standard with campaign", () => {
    assert.strictEqual(
        T.buildFilename("Nike", "AirMax", "Q3", "750x300", "V1", "R2", false),
        "Nike_AirMax_Q3_750x300_V1_R2.aep");
});

test("buildFilename standard without campaign omits it", () => {
    assert.strictEqual(
        T.buildFilename("Nike", "", "Q3", "750x300", "V1", "R1", false),
        "Nike_Q3_750x300_V1_R1.aep");
});

test("buildFilename DOOH variant uses DOOH_ prefix and no quarter", () => {
    assert.strictEqual(
        T.buildFilename("DOOH", "Summer", "Q1", "1920x1080", "V2", "R3", true),
        "DOOH_Summer_1920x1080_V2_R3.aep");
    // campaign falls back to brand when empty
    assert.strictEqual(
        T.buildFilename("BrandOnly", "", "Q1", "1080x1920", "V1", "R1", true),
        "DOOH_BrandOnly_1080x1920_V1_R1.aep");
});

test("template type map covers every default template", () => {
    assert.strictEqual(T.getTemplateType(750, 300), "sunrise");
    assert.strictEqual(T.getTemplateType(880, 1912), "interscroller");
    assert.strictEqual(T.getTemplateType(750, 1334), "expandable");
    assert.strictEqual(T.getTemplateType(1920, 1080), "dooh_horizontal");
    assert.strictEqual(T.getTemplateType(1080, 1920), "dooh_vertical");
    assert.strictEqual(T.getTemplateType(300, 250), "default");
});

test("template folder names match types", () => {
    assert.strictEqual(T.getTemplateFolderName(750, 300), "Sunrise");
    assert.strictEqual(T.getTemplateFolderName(750, 1334), "Expandable");
    assert.strictEqual(T.getTemplateFolderName(880, 1912), "InterScroller");
    assert.strictEqual(T.getTemplateFolderName(1920, 1080), "DOOH-Horizontal");
    assert.strictEqual(T.getTemplateFolderName(1080, 1920), "DOOH-Vertical");
    assert.strictEqual(T.getTemplateFolderName(1, 1), "Custom");
});

test("every DEFAULT_TEMPLATE resolves to a non-default type and folder", () => {
    T.DEFAULT_TEMPLATES.forEach((t) => {
        assert.notStrictEqual(T.getTemplateType(t.width, t.height), "default",
            t.name + " should have a dedicated type");
        assert.notStrictEqual(T.getTemplateFolderName(t.width, t.height), "Custom",
            t.name + " should have a dedicated folder name");
    });
});

test("isDOOHTemplate is name-based and case-insensitive", () => {
    assert.strictEqual(T.isDOOHTemplate("DOOH Horizontal"), true);
    assert.strictEqual(T.isDOOHTemplate("my dooh thing"), true);
    assert.strictEqual(T.isDOOHTemplate("Sunrise"), false);
});
