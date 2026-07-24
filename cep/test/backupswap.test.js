"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { FF } = require("./_load.js");

const backupSwap = FF._internals.backupSwap;

function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-swap-"));
    const orig = path.join(dir, "clip.mp4");
    const opt = path.join(dir, "clip_Optimized.mp4");
    fs.writeFileSync(orig, "ORIGINAL");
    fs.writeFileSync(opt, "OPTIMIZED");
    return { dir, orig, opt };
}
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

test("happy path: optimized replaces original, no .bak left behind", () => {
    const { dir, orig, opt } = setup();
    try {
        backupSwap(orig, opt);
        assert.strictEqual(fs.readFileSync(orig, "utf8"), "OPTIMIZED");
        assert.ok(!fs.existsSync(opt), "temp output should be gone");
        assert.ok(!fs.existsSync(orig + ".bak"), "backup should be cleaned up");
    } finally { cleanup(dir); }
});

test("never clobbers an existing .bak — picks a unique suffix", () => {
    const { dir, orig, opt } = setup();
    try {
        // a stale recovery backup from a previous failed run
        fs.writeFileSync(orig + ".bak", "PRECIOUS_RECOVERY");
        backupSwap(orig, opt);
        assert.strictEqual(fs.readFileSync(orig, "utf8"), "OPTIMIZED");
        assert.strictEqual(fs.readFileSync(orig + ".bak", "utf8"), "PRECIOUS_RECOVERY",
            "pre-existing .bak must be untouched");
    } finally { cleanup(dir); }
});

test("rolls back when the optimized file cannot move in", () => {
    const { dir, orig } = setup();
    try {
        const missingOpt = path.join(dir, "does_not_exist.mp4");
        assert.throws(() => backupSwap(orig, missingOpt));
        // original must be restored, not left renamed away
        assert.ok(fs.existsSync(orig), "original restored after failed swap");
        assert.strictEqual(fs.readFileSync(orig, "utf8"), "ORIGINAL");
    } finally { cleanup(dir); }
});
