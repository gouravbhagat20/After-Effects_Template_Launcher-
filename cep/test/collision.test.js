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

test("detectPNGSequence ignores stray PNGs beside the frames", () => {
    const dir = tmpdir();
    try {
        // poster.png has no frame number and sorts first; logo2.png is numbered
        // but belongs to no sequence. Neither is a frame.
        ["poster.png", "logo2.png", "frame_0001.png", "frame_0002.png", "frame_0003.png"]
            .forEach((f) => fs.writeFileSync(path.join(dir, f), "x"));
        const seq = Post.detectPNGSequence(dir);
        assert.ok(seq, "a stray PNG must not hide the sequence");
        assert.strictEqual(seq.prefix, "frame_");
        assert.strictEqual(seq.start, 1);
        assert.strictEqual(seq.count, 3, "strays must not inflate the frame count");
    } finally { rmrf(dir); }
});

test("detectPNGSequence returns null when no PNG is numbered", () => {
    const dir = tmpdir();
    try {
        fs.writeFileSync(path.join(dir, "poster.png"), "x");
        assert.strictEqual(Post.detectPNGSequence(dir), null);
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

test("existingOutputs includes the ZIP when given the sequence", () => {
    const dir = tmpdir();
    try {
        fs.writeFileSync(path.join(dir, "frame_Optimized.zip"), "x");
        const seq = { folder: dir, prefix: "frame_" };
        assert.deepStrictEqual(Post.existingOutputs(dir), [], "no sequence, no ZIP name to check");
        assert.deepStrictEqual(Post.existingOutputs(dir, seq).map((p) => path.basename(p)),
            ["frame_Optimized.zip"], "the ZIP is deleted and rebuilt, so the prompt must list it");
    } finally { rmrf(dir); }
});

test("the generated index.html escapes the project name", () => {
    const dir = tmpdir();
    try {
        const out = path.join(dir, "index.html");
        Post._internals.makeHTML(out, 'A&B <script>"x"</script>', 750, 300);
        const html = fs.readFileSync(out, "utf8");
        assert.ok(html.includes("<title>A&amp;B &lt;script&gt;&quot;x&quot;&lt;/script&gt; - Big Happy</title>"));
        assert.ok(html.includes('width="750" height="300"'));
    } finally { rmrf(dir); }
});

/** A stand-in ffmpeg: fails unless its arguments name an allowed codec. */
function fakeFFmpeg(dir, allowedCodecs) {
    const exe = path.join(dir, "fake-ffmpeg.sh");
    fs.writeFileSync(exe, "#!/bin/sh\nfor last; do :; done\ncase \"$*\" in\n" +
        allowedCodecs.map((c) => "  *" + c + "*) echo x > \"$last\"; exit 0;;\n").join("") +
        "esac\nexit 1\n");
    fs.chmodSync(exe, 0o755);
    return exe;
}

test("a MOV that fell back to H.264 is reported as having no alpha",
    { skip: process.platform === "win32" }, async () => {
    const dir = tmpdir();
    try {
        const log = [];
        const seq = { folder: dir, prefix: "f_", padding: 4, start: 1, count: 2 };
        const res = await Post._internals.makeMOV(fakeFFmpeg(dir, ["libx264"]), seq, 24, 1,
            path.join(dir, "output.mov"), () => { }, (msg, cls) => log.push({ msg, cls }));
        assert.strictEqual(res.alpha, false);
        const last = log[log.length - 1];
        assert.match(last.msg, /NO alpha/);
        assert.strictEqual(last.cls, "err", "it must not be logged as a plain success");
        assert.ok(!log.some((l) => /SUCCESS/.test(l.msg)));
    } finally { rmrf(dir); }
});

test("a MOV encoded with alpha is a plain success",
    { skip: process.platform === "win32" }, async () => {
    const dir = tmpdir();
    try {
        const log = [];
        const seq = { folder: dir, prefix: "f_", padding: 4, start: 1, count: 2 };
        const res = await Post._internals.makeMOV(fakeFFmpeg(dir, ["libx265"]), seq, 24, 1,
            path.join(dir, "output.mov"), () => { }, (msg, cls) => log.push({ msg, cls }));
        assert.strictEqual(res.alpha, true);
        assert.match(log[0].msg, /SUCCESS via HEVC/);
    } finally { rmrf(dir); }
});

/* ------------------------------------ outputs are replaced atomically --- */

function seqDir() {
    const dir = tmpdir();
    ["f_0001.png", "f_0002.png"].forEach((f) => fs.writeFileSync(path.join(dir, f), "x"));
    fs.writeFileSync(path.join(dir, "output.webm"), "PREVIOUS GOOD");
    return dir;
}
const convertWebM = (dir, exe) => Post.convert(
    { ffmpegPath: exe, seq: Post.detectPNGSequence(dir), fps: 24, width: 750, height: 300, webm: true },
    () => { }, () => { });

test("a failed conversion leaves the previous output.webm intact",
    { skip: process.platform === "win32" }, async () => {
    const dir = seqDir();
    try {
        await assert.rejects(convertWebM(dir, fakeFFmpeg(dir, [])));
        assert.strictEqual(fs.readFileSync(path.join(dir, "output.webm"), "utf8"), "PREVIOUS GOOD");
        assert.ok(!fs.existsSync(path.join(dir, "output.partial.webm")), "no partial file left behind");
    } finally { rmrf(dir); }
});

test("a successful conversion replaces output.webm",
    { skip: process.platform === "win32" }, async () => {
    const dir = seqDir();
    try {
        const res = await convertWebM(dir, fakeFFmpeg(dir, ["libvpx-vp9"]));
        assert.deepStrictEqual(res.outputs.map((p) => path.basename(p)), ["output.webm"]);
        assert.notStrictEqual(fs.readFileSync(path.join(dir, "output.webm"), "utf8"), "PREVIOUS GOOD");
        assert.ok(!fs.existsSync(path.join(dir, "output.partial.webm")));
    } finally { rmrf(dir); }
});
