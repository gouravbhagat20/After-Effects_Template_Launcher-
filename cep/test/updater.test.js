"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const { U } = require("./_load.js");

// ---------------- helpers ----------------

function tmpdir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "bh-updater-"));
}
function cleanup(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}

/** Lay down a minimal complete extension at `root` with the given version. */
function makeExtensionDir(root, version, marker) {
    fs.mkdirSync(path.join(root, "js"), { recursive: true });
    fs.mkdirSync(path.join(root, "jsx"), { recursive: true });
    fs.mkdirSync(path.join(root, "CSXS"), { recursive: true });
    fs.writeFileSync(path.join(root, "index.html"), marker || "<html></html>");
    fs.writeFileSync(path.join(root, "js", "main.js"), "// main");
    fs.writeFileSync(path.join(root, "jsx", "host.jsx"), "// host");
    fs.writeFileSync(path.join(root, "CSXS", "manifest.xml"),
        '<ExtensionManifest ExtensionBundleVersion="' + version + '"></ExtensionManifest>');
}

// ---------------- versionNewer ----------------

test("versionNewer: basic ordering", () => {
    assert.strictEqual(U.versionNewer("0.4.5", "0.4.4"), true);
    assert.strictEqual(U.versionNewer("0.4.4", "0.4.5"), false);
    assert.strictEqual(U.versionNewer("1.0.0", "0.9.9"), true);
});

test("versionNewer: equal versions are not newer", () => {
    assert.strictEqual(U.versionNewer("0.4.4", "0.4.4"), false);
    assert.strictEqual(U.versionNewer("1.0", "1.0"), false);
});

test("versionNewer: unequal segment counts", () => {
    assert.strictEqual(U.versionNewer("0.5", "0.4.9"), true);
    assert.strictEqual(U.versionNewer("1.0.1", "1.0"), true);
    assert.strictEqual(U.versionNewer("1.0.0", "1.0"), false);   // 1.0.0 == 1.0
    assert.strictEqual(U.versionNewer("1.0", "1.0.1"), false);
});

test("versionNewer: numeric, not lexicographic", () => {
    assert.strictEqual(U.versionNewer("0.4.10", "0.4.9"), true);
    assert.strictEqual(U.versionNewer("0.10.0", "0.9.9"), true);
});

// ---------------- sha256 text parsing ----------------

test("parseShaText: '<hash>  <filename>' shape", () => {
    const hash = "a".repeat(32) + "b".repeat(32);
    assert.strictEqual(U.parseShaText(hash + "  BigHappyLauncher_v1.zxp\n"), hash);
});

test("parseShaText: bare hash and uppercase are normalized", () => {
    const hash = "AbCdEf0123456789".repeat(4);
    assert.strictEqual(U.parseShaText(hash), hash.toLowerCase());
});

test("parseShaText: garbage / too-short input yields null", () => {
    assert.strictEqual(U.parseShaText("not a checksum"), null);
    assert.strictEqual(U.parseShaText("abcdef0123456789"), null);  // 16 hex, not 64
    assert.strictEqual(U.parseShaText(""), null);
    assert.strictEqual(U.parseShaText(null), null);
});

// ---------------- package sanity + checksum ----------------

test("looksLikeZip: PK header and plausible size required", () => {
    const good = Buffer.concat([Buffer.from("PK"), Buffer.alloc(11 * 1024)]);
    const wrongHeader = Buffer.concat([Buffer.from("XX"), Buffer.alloc(11 * 1024)]);
    const tooSmall = Buffer.from("PK\x03\x04tiny");
    assert.strictEqual(U.looksLikeZip(good), true);
    assert.strictEqual(U.looksLikeZip(wrongHeader), false);
    assert.strictEqual(U.looksLikeZip(tooSmall), false);
    assert.strictEqual(U.looksLikeZip(null), false);
});

test("verifyPackage: accepts a matching published checksum", () => {
    const data = Buffer.concat([Buffer.from("PK"), Buffer.alloc(11 * 1024, 7)]);
    const sha = crypto.createHash("sha256").update(data).digest("hex");
    assert.doesNotThrow(() => U.verifyPackage(data, sha + "  pkg.zxp"));
});

test("verifyPackage: rejects checksum mismatch and non-zip data", () => {
    const data = Buffer.concat([Buffer.from("PK"), Buffer.alloc(11 * 1024, 7)]);
    assert.throws(() => U.verifyPackage(data, "f".repeat(64)), /Checksum mismatch/);
    assert.throws(() => U.verifyPackage(data, "no hash here"), /Checksum mismatch/);
    assert.throws(() => U.verifyPackage(Buffer.from("PKxx"), "f".repeat(64)), /not a valid package/);
});

test("sha256Hex matches node crypto", () => {
    const data = Buffer.from("hello");
    assert.strictEqual(U.sha256Hex(data),
        crypto.createHash("sha256").update(data).digest("hex"));
});

// ---------------- manifest version parsing ----------------

test("parseBundleVersion extracts ExtensionBundleVersion", () => {
    assert.strictEqual(U.parseBundleVersion('x ExtensionBundleVersion="0.4.4" y'), "0.4.4");
    assert.strictEqual(U.parseBundleVersion("no version here"), null);
    assert.strictEqual(U.parseBundleVersion(null), null);
});

// ---------------- validateExtracted ----------------

test("validateExtracted: complete package at expected version passes", () => {
    const dir = tmpdir();
    try {
        makeExtensionDir(dir, "9.9.9");
        assert.doesNotThrow(() => U.validateExtracted(dir, "9.9.9"));
    } finally { cleanup(dir); }
});

test("validateExtracted: missing required file fails", () => {
    const dir = tmpdir();
    try {
        makeExtensionDir(dir, "9.9.9");
        fs.unlinkSync(path.join(dir, "js", "main.js"));
        assert.throws(() => U.validateExtracted(dir, "9.9.9"), /incomplete.*main\.js/);
    } finally { cleanup(dir); }
});

test("validateExtracted: missing manifest fails", () => {
    const dir = tmpdir();
    try {
        makeExtensionDir(dir, "9.9.9");
        fs.unlinkSync(path.join(dir, "CSXS", "manifest.xml"));
        assert.throws(() => U.validateExtracted(dir, "9.9.9"), /incomplete.*manifest\.xml/);
    } finally { cleanup(dir); }
});

test("validateExtracted: manifest version mismatch fails", () => {
    const dir = tmpdir();
    try {
        makeExtensionDir(dir, "1.0.0");
        assert.throws(() => U.validateExtracted(dir, "9.9.9"),
            /version mismatch.*expected 9\.9\.9.*got 1\.0\.0/);
    } finally { cleanup(dir); }
});

// ---------------- swapInstall / rollbackFromBackup / cleanupBackupAt ----------------

test("swapInstall: live -> .backup, staging -> live", () => {
    const dir = tmpdir();
    try {
        const target = path.join(dir, "ext");
        makeExtensionDir(target, "1.0.0", "OLD");
        makeExtensionDir(target + ".staging", "2.0.0", "NEW");
        U.swapInstall(target, target + ".staging", target + ".backup");
        assert.strictEqual(fs.readFileSync(path.join(target, "index.html"), "utf8"), "NEW");
        assert.strictEqual(fs.readFileSync(path.join(target + ".backup", "index.html"), "utf8"), "OLD");
        assert.ok(!fs.existsSync(target + ".staging"), "staging renamed away");
    } finally { cleanup(dir); }
});

test("swapInstall: first install (no live folder) still lands", () => {
    const dir = tmpdir();
    try {
        const target = path.join(dir, "ext");
        makeExtensionDir(target + ".staging", "2.0.0", "NEW");
        U.swapInstall(target, target + ".staging", target + ".backup");
        assert.strictEqual(fs.readFileSync(path.join(target, "index.html"), "utf8"), "NEW");
        assert.ok(!fs.existsSync(target + ".backup"), "nothing to back up");
    } finally { cleanup(dir); }
});

test("swapInstall: rolls the old version back when staging cannot move in", () => {
    const dir = tmpdir();
    try {
        const target = path.join(dir, "ext");
        makeExtensionDir(target, "1.0.0", "OLD");
        const missingStaging = path.join(dir, "does_not_exist");
        assert.throws(() => U.swapInstall(target, missingStaging, target + ".backup"));
        // the live install must be back in place, not stranded as .backup
        assert.strictEqual(fs.readFileSync(path.join(target, "index.html"), "utf8"), "OLD");
        assert.ok(!fs.existsSync(target + ".backup"), "backup restored to live");
    } finally { cleanup(dir); }
});

test("rollbackFromBackup: restores backup when live install is broken", () => {
    const dir = tmpdir();
    try {
        const target = path.join(dir, "ext");
        fs.mkdirSync(target, { recursive: true });           // broken: no manifest
        makeExtensionDir(target + ".backup", "1.0.0", "OLD");
        assert.strictEqual(U.rollbackFromBackup(target, target + ".backup"), true);
        assert.strictEqual(fs.readFileSync(path.join(target, "index.html"), "utf8"), "OLD");
        assert.ok(!fs.existsSync(target + ".backup"));
    } finally { cleanup(dir); }
});

test("rollbackFromBackup: leaves an intact live install untouched", () => {
    const dir = tmpdir();
    try {
        const target = path.join(dir, "ext");
        makeExtensionDir(target, "2.0.0", "LIVE");
        makeExtensionDir(target + ".backup", "1.0.0", "OLD");
        assert.strictEqual(U.rollbackFromBackup(target, target + ".backup"), false);
        assert.strictEqual(fs.readFileSync(path.join(target, "index.html"), "utf8"), "LIVE");
        assert.ok(fs.existsSync(target + ".backup"), "backup kept");
    } finally { cleanup(dir); }
});

test("cleanupBackupAt: retires an older backup after a good boot", () => {
    const dir = tmpdir();
    try {
        const install = path.join(dir, "ext");
        makeExtensionDir(install + ".backup", "0.4.3");
        U.cleanupBackupAt(install, "0.4.4");
        assert.ok(!fs.existsSync(install + ".backup"), "old backup removed");
    } finally { cleanup(dir); }
});

test("cleanupBackupAt: never touches a NEWER backup (rollback source)", () => {
    const dir = tmpdir();
    try {
        const install = path.join(dir, "ext");
        makeExtensionDir(install + ".backup", "0.5.0");
        U.cleanupBackupAt(install, "0.4.4");
        assert.ok(fs.existsSync(install + ".backup"), "newer backup kept");
    } finally { cleanup(dir); }
});

test("cleanupBackupAt: unreadable backup is left for manual recovery; missing is a no-op", () => {
    const dir = tmpdir();
    try {
        const install = path.join(dir, "ext");
        fs.mkdirSync(install + ".backup", { recursive: true }); // no manifest inside
        U.cleanupBackupAt(install, "0.4.4");
        assert.ok(fs.existsSync(install + ".backup"), "unreadable backup kept");
        assert.doesNotThrow(() => U.cleanupBackupAt(path.join(dir, "nothing_here"), "0.4.4"));
    } finally { cleanup(dir); }
});

// ---------------- isDevInstall ----------------

test("isDevInstall: sibling .git marks a dev install; plain dir does not", () => {
    const dir = tmpdir();
    try {
        const repo = path.join(dir, "repo");
        fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
        fs.mkdirSync(path.join(repo, "cep"), { recursive: true });
        assert.strictEqual(U.isDevInstall(path.join(repo, "cep")), true);

        const plain = path.join(dir, "plain", "ext");
        fs.mkdirSync(plain, { recursive: true });
        assert.strictEqual(U.isDevInstall(plain), false);
    } finally { cleanup(dir); }
});

// ---------------- mkdirp / dirWritable ----------------

test("mkdirp: creates nested paths and is idempotent", () => {
    const dir = tmpdir();
    try {
        const deep = path.join(dir, "a", "b", "c");
        U.mkdirp(deep);
        assert.ok(fs.statSync(deep).isDirectory());
        assert.doesNotThrow(() => U.mkdirp(deep));  // already exists
    } finally { cleanup(dir); }
});

test("mkdirp: refuses runaway recursion via depth cap", () => {
    const dir = tmpdir();
    try {
        let deep = dir;
        for (let i = 0; i < 60; i++) deep = path.join(deep, "d" + i);
        assert.throws(() => U.mkdirp(deep), /mkdirp/);
    } finally { cleanup(dir); }
});

test("dirWritable: true for a writable dir and leaves no probe litter", () => {
    const dir = tmpdir();
    try {
        assert.strictEqual(U.dirWritable(dir), true);
        assert.ok(!fs.existsSync(path.join(dir, ".bh_write_test")), "probe cleaned up");
    } finally { cleanup(dir); }
});

test("dirWritable: false for a read-only dir", { skip: process.platform === "win32" }, () => {
    const dir = tmpdir();
    try {
        const ro = path.join(dir, "ro");
        fs.mkdirSync(ro, { mode: 0o555 });
        assert.strictEqual(U.dirWritable(ro), false);
    } finally {
        try { fs.chmodSync(path.join(dir, "ro"), 0o755); } catch (e) { }
        cleanup(dir);
    }
});

// ---------------- fetchWithTimeout ----------------

test("fetchWithTimeout: aborts a hung request with a clear timeout error", async () => {
    function hangingFetch(url, opts) {
        return new Promise((resolve, reject) => {
            if (opts && opts.signal) {
                opts.signal.addEventListener("abort", () => {
                    const e = new Error("The operation was aborted");
                    e.name = "AbortError";
                    reject(e);
                });
            }
            // never resolves otherwise
        });
    }
    // The abort timer is unref'd, and a never-settling promise holds nothing
    // open — without this, Node 20/22 end the event loop before it fires.
    const keepAlive = setInterval(() => { }, 1000);
    try {
        await assert.rejects(
            U.fetchWithTimeout("https://example.invalid/x", 50, hangingFetch),
            /Network timeout after \d+s/);
    } finally {
        clearInterval(keepAlive);
    }
});

// ---------------- fetchRemoteVersion ----------------

const MANIFEST_OK = '<ExtensionManifest ExtensionBundleVersion="9.9.9"></ExtensionManifest>';
const okResponse = (body) => ({ ok: true, status: 200, text: () => Promise.resolve(body) });

test("fetchRemoteVersion: one transient failure is retried", async () => {
    let calls = 0;
    const flaky = () => (++calls === 1
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(okResponse(MANIFEST_OK)));
    assert.equal(await U.fetchRemoteVersion(flaky, 0), "9.9.9");
    assert.equal(calls, 2);
});

test("fetchRemoteVersion: a persistent HTTP error rejects with the status", async () => {
    let calls = 0;
    const down = () => { calls++; return Promise.resolve({ ok: false, status: 503 }); };
    await assert.rejects(U.fetchRemoteVersion(down, 0), /HTTP 503/);
    assert.equal(calls, 2);
});

test("fetchRemoteVersion: a manifest without a version rejects with a reason", async () => {
    await assert.rejects(
        U.fetchRemoteVersion(() => Promise.resolve(okResponse("<html>oops</html>")), 0),
        /no version/);
});

test("fetchWithTimeout: passes a fast response straight through", async () => {
    const fake = { ok: true, status: 200 };
    const r = await U.fetchWithTimeout("https://example.invalid/x", 1000,
        () => Promise.resolve(fake));
    assert.strictEqual(r, fake);
});

test("fetchWithTimeout: non-abort network errors propagate unchanged", async () => {
    await assert.rejects(
        U.fetchWithTimeout("https://example.invalid/x", 1000,
            () => Promise.reject(new Error("ECONNREFUSED"))),
        /ECONNREFUSED/);
});

// ---------------- downloadAndInstall (failure paths, injected fetch) ----------------

function bufToArrayBuffer(buf) {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

test("downloadAndInstall: checksum mismatch leaves the live install untouched", async () => {
    const dir = tmpdir();
    try {
        const target = path.join(dir, "ext");
        makeExtensionDir(target, "1.0.0", "OLD");
        const bogusZip = Buffer.concat([Buffer.from("PK"), Buffer.alloc(11 * 1024, 3)]);
        const fetchImpl = (url) => Promise.resolve(/\.sha256/.test(url)
            ? { ok: true, text: () => Promise.resolve("f".repeat(64) + "  pkg.zxp") }
            : { ok: true, arrayBuffer: () => Promise.resolve(bufToArrayBuffer(bogusZip)) });

        await assert.rejects(
            U.downloadAndInstall("9.9.9", target, { fetchImpl, tmpDir: dir }),
            /Checksum mismatch/);
        assert.strictEqual(fs.readFileSync(path.join(target, "index.html"), "utf8"), "OLD");
        assert.ok(!fs.existsSync(target + ".staging"), "no staging left behind");
        assert.ok(!fs.existsSync(path.join(dir, "bh_update_9.9.9.zip")), "tmp zip cleaned up");
    } finally { cleanup(dir); }
});

test("downloadAndInstall: missing release file rejects before touching disk", async () => {
    const dir = tmpdir();
    try {
        const target = path.join(dir, "ext");
        makeExtensionDir(target, "1.0.0", "OLD");
        const fetchImpl = (url) => Promise.resolve(/\.sha256/.test(url)
            ? { ok: true, text: () => Promise.resolve("f".repeat(64)) }
            : { ok: false, status: 404 });

        await assert.rejects(
            U.downloadAndInstall("9.9.9", target, { fetchImpl, tmpDir: dir }),
            /Download failed \(404\)/);
        assert.strictEqual(fs.readFileSync(path.join(target, "index.html"), "utf8"), "OLD");
    } finally { cleanup(dir); }
});

// ---------------- downloadAndInstall (full happy path, real zip + unzip) ----------------

function haveCli(cmd, args) {
    try { cp.execFileSync(cmd, args, { stdio: "ignore" }); return true; }
    catch (e) { return false; }
}
const canZip = process.platform !== "win32" && haveCli("zip", ["-v"]) && haveCli("unzip", ["-v"]);

test("downloadAndInstall: verified package swaps in, old version kept as .backup",
    { skip: !canZip }, async () => {
    const dir = tmpdir();
    try {
        // build a real zxp-shaped zip of a v9.9.9 extension (padded past the
        // 10 KB plausibility floor)
        const src = path.join(dir, "src");
        makeExtensionDir(src, "9.9.9", "NEW".repeat(8000));
        const zipPath = path.join(dir, "pkg.zip");
        cp.execFileSync("zip", ["-r", "-X", "-0", zipPath, "index.html", "js", "jsx", "CSXS"],
            { cwd: src, stdio: "ignore" });   // -0: stored, keeps it over the 10 KB size floor
        const zipBuf = fs.readFileSync(zipPath);
        const sha = crypto.createHash("sha256").update(zipBuf).digest("hex");
        const fetchImpl = (url) => Promise.resolve(/\.sha256/.test(url)
            ? { ok: true, text: () => Promise.resolve(sha + "  pkg.zxp") }
            : { ok: true, arrayBuffer: () => Promise.resolve(bufToArrayBuffer(zipBuf)) });

        const target = path.join(dir, "ext");
        makeExtensionDir(target, "1.0.0", "OLD");

        await U.downloadAndInstall("9.9.9", target, { fetchImpl, tmpDir: dir });

        assert.strictEqual(U.parseBundleVersion(
            fs.readFileSync(path.join(target, "CSXS", "manifest.xml"), "utf8")), "9.9.9");
        assert.strictEqual(fs.readFileSync(path.join(target + ".backup", "index.html"), "utf8"), "OLD",
            "previous version kept for rollback");
        assert.ok(!fs.existsSync(target + ".staging"), "staging cleaned up");
        assert.ok(!fs.existsSync(path.join(dir, "bh_update_9.9.9.zip")), "tmp zip cleaned up");
    } finally { cleanup(dir); }
});
