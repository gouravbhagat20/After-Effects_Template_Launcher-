"use strict";
/*
    Collision-adjacent behaviors that exist in CEP today:
    - PNG sequence detection must sort numerically (mixed padding would
      otherwise interleave frames -> corrupted video)
    - existingOutputs must flag files a new conversion would overwrite
    NOTE: full asset-name collision handling lives in the ScriptUI
    collect/upload routine, which is not ported to CEP yet; extend this file
    when that port lands.
*/
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { Post } = require("./_load.js");

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), "bh-seq-")); }
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

test("detectPNGSequence sorts numerically across mixed padding", () => {
    const dir = tmpdir();
    try {
        // frame 2 padded shorter than frame 10 — lexicographic sort would put 10 first
        for (const f of ["shot_2.png", "shot_10.png", "shot_0001.png"]) {
            fs.writeFileSync(path.join(dir, f), "x");
        }
        const seq = Post.detectPNGSequence(dir);
        assert.ok(seq);
        assert.strictEqual(seq.start, 1, "lowest frame number wins regardless of padding");
        assert.strictEqual(seq.count, 3);
    } finally { rmrf(dir); }
});

test("detectPNGSequence parses prefix/padding/start", () => {
    const dir = tmpdir();
    try {
        for (let i = 5; i < 8; i++) fs.writeFileSync(path.join(dir, "Brand_CTA_000" + i + ".png"), "x");
        const seq = Post.detectPNGSequence(dir);
        assert.strictEqual(seq.prefix, "Brand_CTA_");
        assert.strictEqual(seq.padding, 4);
        assert.strictEqual(seq.start, 5);
        assert.strictEqual(seq.count, 3);
    } finally { rmrf(dir); }
});

test("detectPNGSequence returns null for empty or missing folders", () => {
    const dir = tmpdir();
    try {
        assert.strictEqual(Post.detectPNGSequence(dir), null);
        assert.strictEqual(Post.detectPNGSequence(path.join(dir, "nope")), null);
    } finally { rmrf(dir); }
});

test("existingOutputs reports exactly the files a new run would clobber", () => {
    const dir = tmpdir();
    try {
        fs.writeFileSync(path.join(dir, "output.webm"), "x");
        fs.writeFileSync(path.join(dir, "index.html"), "x");
        // output.mov absent
        const hits = Post.existingOutputs(dir).map((p) => path.basename(p)).sort();
        assert.deepStrictEqual(hits, ["index.html", "output.webm"]);
    } finally { rmrf(dir); }
});
