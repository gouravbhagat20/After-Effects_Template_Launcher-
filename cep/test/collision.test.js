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
        assert.match(seq.problem, /padded differently/,
            "ffmpeg reads one pattern: it would encode shot_0001 alone and call that a success");
    } finally { rmrf(dir); }
});

test("a sequence ffmpeg could not read in full says why, and is refused", async () => {
    const cases = [
        [["f_0001.png", "f_0002.png", "f_0004.png"], /Frame 3 is missing.*only the first 2 of 3/],
        [["f_1.png", "f_01.png", "f_02.png"], /padded differently/],
        [["f_0001.png", "f_0002.png", "f_0003.png"], null],
        [["f_8.png", "f_9.png", "f_10.png", "f_11.png"], null]       // no padding at all is consistent
    ];
    for (const [files, problem] of cases) {
        const dir = tmpdir();
        try {
            files.forEach((f) => fs.writeFileSync(path.join(dir, f), "x"));
            const seq = Post.detectPNGSequence(dir);
            if (!problem) { assert.strictEqual(seq.problem, null, files.join(" ")); continue; }
            assert.match(seq.problem, problem);
            await assert.rejects(
                Post.convert({ ffmpegPath: "ffmpeg", seq, fps: 24, width: 1, height: 1, webm: true }, () => { }, () => { }),
                /cannot be converted/);
            assert.ok(!fs.existsSync(path.join(dir, "output.webm")), "nothing is encoded from part of a sequence");
        } finally { rmrf(dir); }
    }
});

test("an unpadded sequence is read with %d, not a zero-padded pattern", () => {
    const dir = tmpdir();
    try {
        ["f_8.png", "f_9.png", "f_10.png"].forEach((f) => fs.writeFileSync(path.join(dir, f), "x"));
        const seq = Post.detectPNGSequence(dir);
        assert.strictEqual(seq.padding, 0);
        const args = Post._internals.inputArgs(seq, 24);
        assert.strictEqual(args[args.length - 1], path.join(dir, "f_%d.png"));
        assert.strictEqual(args[args.indexOf("-start_number") + 1], "8");
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

const cp = require("node:child_process");
const { EventEmitter } = require("node:events");

/**
 * Run `body` with child_process.spawn replaced by a stand-in ffmpeg that
 * succeeds (writing its output file, the last argument) only when its
 * arguments name one of `allowedCodecs`. postrender.js calls cp.spawn at
 * call time, so this reaches it — and unlike a fake shell script it behaves
 * the same on Windows.
 */
async function withFakeFFmpeg(allowedCodecs, body, framesWritten) {
    const real = cp.spawn;
    cp.spawn = (exe, args) => {
        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = () => { };
        setImmediate(() => {
            const ok = allowedCodecs.some((c) => args.indexOf(c) !== -1);
            const out = args[args.length - 1];
            if (ok && !/^(NUL|\/dev\/null)$/.test(out)) fs.writeFileSync(out, "ENCODED");
            if (ok && framesWritten != null) proc.stdout.emit("data", "frame=" + framesWritten + "\nprogress=end\n");
            proc.emit("close", ok ? 0 : 1);
        });
        return proc;
    };
    try { return await body("ffmpeg"); }
    finally { cp.spawn = real; }
}

test("a MOV that fell back to H.264 is reported as having no alpha", async () => {
    const dir = tmpdir();
    try {
        const log = [];
        const seq = { folder: dir, prefix: "f_", padding: 4, start: 1, count: 2 };
        const res = await withFakeFFmpeg(["libx264"], (exe) => Post._internals.makeMOV(exe, seq, 24, 1,
            path.join(dir, "output.mov"), () => { }, (msg, cls) => log.push({ msg, cls })));
        assert.strictEqual(res.alpha, false);
        const last = log[log.length - 1];
        assert.match(last.msg, /NO alpha/);
        assert.strictEqual(last.cls, "err", "it must not be logged as a plain success");
        assert.ok(!log.some((l) => /SUCCESS/.test(l.msg)));
    } finally { rmrf(dir); }
});

test("a MOV encoded with alpha is a plain success", async () => {
    const dir = tmpdir();
    try {
        const log = [];
        const seq = { folder: dir, prefix: "f_", padding: 4, start: 1, count: 2 };
        const res = await withFakeFFmpeg(["libx265"], (exe) => Post._internals.makeMOV(exe, seq, 24, 1,
            path.join(dir, "output.mov"), () => { }, (msg, cls) => log.push({ msg, cls })));
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

test("a failed conversion leaves the previous output.webm intact", async () => {
    const dir = seqDir();
    try {
        await assert.rejects(withFakeFFmpeg([], (exe) => convertWebM(dir, exe)));
        assert.strictEqual(fs.readFileSync(path.join(dir, "output.webm"), "utf8"), "PREVIOUS GOOD");
        assert.ok(!fs.existsSync(path.join(dir, "output.partial.webm")), "no partial file left behind");
    } finally { rmrf(dir); }
});

test("an encode that came out short of the sequence is a failure, not a success", async () => {
    const dir = seqDir();
    try {
        // ffmpeg exits 0 after writing 1 of the 2 frames
        await assert.rejects(withFakeFFmpeg(["libvpx-vp9"], (exe) => convertWebM(dir, exe), 1),
            /WebM has 1 frame\(s\) but the sequence has 2/);
        assert.strictEqual(fs.readFileSync(path.join(dir, "output.webm"), "utf8"), "PREVIOUS GOOD",
            "the short file never replaces the previous good one");
        const full = await withFakeFFmpeg(["libvpx-vp9"], (exe) => convertWebM(dir, exe), 2);
        assert.strictEqual(full.outputs.length, 1);
    } finally { rmrf(dir); }
});

test("a successful conversion replaces output.webm", async () => {
    const dir = seqDir();
    try {
        const res = await withFakeFFmpeg(["libvpx-vp9"], (exe) => convertWebM(dir, exe));
        assert.deepStrictEqual(res.outputs.map((p) => path.basename(p)), ["output.webm"]);
        assert.notStrictEqual(fs.readFileSync(path.join(dir, "output.webm"), "utf8"), "PREVIOUS GOOD");
        assert.ok(!fs.existsSync(path.join(dir, "output.partial.webm")));
    } finally { rmrf(dir); }
});
