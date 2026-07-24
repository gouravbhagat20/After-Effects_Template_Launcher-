"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { Calc } = require("./_load.js");

// --- computeTargetKbps: the MP4 optimizer profile (ffmpeg.js) ---

test("optimizer profile matches the historical inline math", () => {
    // 6.8 MB, 15 s, 6% overhead margin: floor(6.8*8192*0.94/15) = 3490
    const k = Calc.computeTargetKbps(6.8, 15, { overhead: 0.94, floor: 300, minDuration: 0.5 });
    assert.strictEqual(k, Math.floor((6.8 * 8192 * 0.94) / 15));
});

test("optimizer floor clamps tiny targets / long clips", () => {
    assert.strictEqual(
        Calc.computeTargetKbps(0.5, 600, { overhead: 0.94, floor: 300, minDuration: 0.5 }),
        300);
});

test("optimizer minDuration guards zero/absurd durations", () => {
    const k = Calc.computeTargetKbps(6.8, 0, { overhead: 0.94, floor: 300, minDuration: 0.5 });
    assert.strictEqual(k, Math.floor((6.8 * 8192 * 0.94) / 0.5));
});

// --- computeTargetKbps: the DOOH WebM profile (postrender.js) ---

test("DOOH WebM profile: subtract 128, floor 1000, minDuration 1", () => {
    const k = Calc.computeTargetKbps(6.8, 15, { subtract: 128, floor: 1000, minDuration: 1 });
    assert.strictEqual(k, Math.floor((6.8 * 8192) / 15) - 128);
});

test("DOOH WebM floor is 1000", () => {
    assert.strictEqual(
        Calc.computeTargetKbps(1, 120, { subtract: 128, floor: 1000, minDuration: 1 }),
        1000);
});

// --- retryKbps ---

test("retry scales proportionally with 3% margin", () => {
    // 3000 kbps produced 8 MB against a 6.8 MB target
    assert.strictEqual(Calc.retryKbps(3000, 6.8, 8), Math.floor(3000 * (6.8 / 8) * 0.97));
});

test("retry always lowers the bitrate when over target", () => {
    const k = Calc.retryKbps(3000, 6.8, 6.9);
    assert.ok(k < 3000);
});

test("retry respects an optional floor", () => {
    assert.strictEqual(Calc.retryKbps(400, 1, 10, 300), 300);
});

// --- getResolutionScale ---

test("resolution scale buckets", () => {
    assert.strictEqual(Calc.getResolutionScale(0), 1.0);            // unknown
    assert.strictEqual(Calc.getResolutionScale(1280 * 720), 0.6);   // SD
    assert.strictEqual(Calc.getResolutionScale(1920 * 1080), 1.0);  // HD
    assert.strictEqual(Calc.getResolutionScale(2560 * 1440), 1.4);  // 2K
    assert.strictEqual(Calc.getResolutionScale(3840 * 2160), 2.0);  // 4K
});

test("bucket edges are inclusive", () => {
    assert.strictEqual(Calc.getResolutionScale(921600), 0.6);
    assert.strictEqual(Calc.getResolutionScale(921601), 1.0);
    assert.strictEqual(Calc.getResolutionScale(2073600), 1.0);
    assert.strictEqual(Calc.getResolutionScale(2073601), 1.4);
});
