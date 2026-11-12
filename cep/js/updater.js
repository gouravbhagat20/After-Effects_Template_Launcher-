/*
    BHUpdater — auto-update engine for the BigHappy Launcher panel.

    All the non-UI update logic extracted from main.js so it can be
    unit-tested headlessly (see cep/test/updater.test.js):

      versionNewer(remote, local)      pure semver-ish comparison
      fetchRemoteVersion()             latest published version (30s timeout)
      downloadAndInstall(ver, target)  download zxp + .sha256, verify SHA-256,
                                       extract to <target>.staging, validate,
                                       atomic-swap keeping <target>.backup,
                                       best-effort rollback on any failure
      cleanupBackups(paths, current)   retire rollback backups after a good boot
      gitPull(repoRoot)                dev-install update (git pull --ff-only)

    main.js keeps only the UI wiring (pill, dialogs, busy state) around these.
    Loaded both as a <script> in the panel and via require() in Node tests
    (same window-IIFE pattern as calc.js / templates.js).
*/
(function (global) {
    "use strict";

    var nodeRequire = (global.cep_node && global.cep_node.require) || global.require;
    var fs = nodeRequire("fs");
    var path = nodeRequire("path");
    var os = nodeRequire("os");
    var cp = nodeRequire("child_process");
    var crypto = nodeRequire("crypto");

    var IS_WIN = os.platform() === "win32";

    var RAW_BASE = "https://raw.githubusercontent.com/gouravbhagat20/After-Effects_Template_Launcher-/main/";
    var META_TIMEOUT_MS = 30 * 1000;       // manifest / checksum fetches
    var DOWNLOAD_TIMEOUT_MS = 120 * 1000;  // the zxp package itself
    var MKDIRP_MAX_DEPTH = 40;             // sanity cap — see mkdirp

    // ---------------- pure helpers ----------------

    /** True when `remote` is a strictly newer dotted version than `local`.
        Tolerates unequal segment counts ("0.5" vs "0.4.9"). */
    function versionNewer(remote, local) {
        var a = String(remote).split(".").map(Number);
        var b = String(local).split(".").map(Number);
        for (var i = 0; i < Math.max(a.length, b.length); i++) {
            var d = (a[i] || 0) - (b[i] || 0);
            if (d !== 0) return d > 0;
        }
        return false;
    }

    /** Extract the 64-hex SHA-256 from a published .sha256 file's text
        ("<hash>  <filename>" or bare). Returns lowercase hex or null. */
    function parseShaText(text) {
        var m = String(text || "").match(/[a-f0-9]{64}/i);
        return m ? m[0].toLowerCase() : null;
    }

    function sha256Hex(data) {
        return crypto.createHash("sha256").update(data).digest("hex");
    }

    /** Sanity check: real zip (PK header) of plausible size. */
    function looksLikeZip(data) {
        return !!data && data.length >= 10 * 1024 && data[0] === 0x50 && data[1] === 0x4b;
    }

    /** ExtensionBundleVersion="x.y.z" out of a CSXS manifest, or null. */
    function parseBundleVersion(manifestXml) {
        var m = String(manifestXml || "").match(/ExtensionBundleVersion="([\d.]+)"/);
        return m ? m[1] : null;
    }

    /** Throws unless the downloaded buffer matches the published checksum. */
    function verifyPackage(data, shaText) {
        if (!looksLikeZip(data)) {
            throw new Error("Downloaded file is not a valid package.");
        }
        var expected = parseShaText(shaText);
        var actual = sha256Hex(data);
        if (!expected || actual !== expected) {
            throw new Error("Checksum mismatch — download discarded.\nExpected " + expected + "\nGot      " + actual);
        }
    }

    /**
     * Public halves of the keys allowed to sign a release (Ed25519, SPKI PEM).
     *
     * The checksum beside a package is published in the same repository as
     * the package, so it only proves the download arrived intact — anyone who
     * can push there can publish a matching pair. The signature is made with
     * a private key that is NOT in the repository (see cep/sign-release.js),
     * so a package is only installed if whoever built it held that key.
     *
     * More than one entry is allowed so a key can be rotated: add the new key
     * in a release signed by the old one, drop the old one a release later.
     */
    var RELEASE_PUBLIC_KEYS = [
        "-----BEGIN PUBLIC KEY-----\n" +
        "MCowBQYDK2VwAyEA8tPvbxyAZDJ2wzXZpfMgA1+MhlHs9SNZZjJEUkcqvTI=\n" +
        "-----END PUBLIC KEY-----"
    ];

    /**
     * Throw unless `sigText` (base64, the contents of <package>.sig) is a
     * valid signature of `data` by one of the pinned keys. Fails closed: a
     * malformed signature, an unreadable key or a runtime without Ed25519
     * all refuse the package.
     */
    function verifySignature(data, sigText, publicKeys) {
        var keys = publicKeys || RELEASE_PUBLIC_KEYS;
        var b64 = String(sigText == null ? "" : sigText).replace(/\s+/g, "");
        if (!b64 || !/^[A-Za-z0-9+\/]+=*$/.test(b64)) {
            throw new Error("Signature file is missing or malformed — refusing to install an unsigned package.");
        }
        var B = (global.cep_node && global.cep_node.Buffer) || global.Buffer ||
            (typeof Buffer !== "undefined" ? Buffer : null);
        var sig = B.from(b64, "base64");
        for (var i = 0; i < keys.length; i++) {
            try {
                if (crypto.verify(null, data, crypto.createPublicKey(keys[i]), sig)) return;
            } catch (e) { /* unusable key or signature — try the next key */ }
        }
        throw new Error("Signature check failed — this package was not signed with the BigHappy release key. Download discarded.");
    }

    // ---------------- filesystem helpers ----------------

    /** Dev installs are symlinked/copied from the git repo — never self-overwrite those. */
    function isDevInstall(extPath) {
        try {
            if (fs.existsSync(path.join(extPath, "..", ".git"))) return true;   // extPath = repo/cep
            if (fs.lstatSync(extPath).isSymbolicLink()) return true;
        } catch (e) { }
        return false;
    }

    function dirWritable(dir) {
        var probe = path.join(dir, ".bh_write_test");
        try {
            fs.writeFileSync(probe, "x");
            return true;
        } catch (e) {
            return false;
        } finally {
            // always attempt cleanup — a crash between write and unlink must
            // not leave probe litter behind
            try { fs.unlinkSync(probe); } catch (e2) { }
        }
    }

    /** Recursive mkdir with a root stop AND a depth cap (a malformed path must
        never recurse forever). */
    function mkdirp(dir, _depth) {
        var depth = _depth || 0;
        if (depth > MKDIRP_MAX_DEPTH) {
            throw new Error("mkdirp: refusing to create a path more than " +
                MKDIRP_MAX_DEPTH + " levels deep: " + dir);
        }
        if (!dir || fs.existsSync(dir)) return;
        var parent = path.dirname(dir);
        if (parent && parent !== dir) mkdirp(parent, depth + 1);  // dirname(root) === root → stop
        fs.mkdirSync(dir);
    }

    /** CEP 11 ships Node 12 — fs.rmSync (14.14+) may not exist. */
    function rmDirRecursive(p) {
        try {
            if (fs.rmSync) fs.rmSync(p, { recursive: true, force: true });
            else if (fs.existsSync(p)) fs.rmdirSync(p, { recursive: true });
        } catch (e) { }
    }

    function userExtensionsDir() {
        return IS_WIN
            ? path.join(os.homedir(), "AppData", "Roaming", "Adobe", "CEP", "extensions")
            : path.join(os.homedir(), "Library", "Application Support", "Adobe", "CEP", "extensions");
    }

    /** Throws unless dir contains a complete extension at expectedVersion. */
    function validateExtracted(dir, expectedVersion) {
        ["index.html", path.join("js", "main.js"), path.join("jsx", "host.jsx")].forEach(function (f) {
            if (!fs.existsSync(path.join(dir, f))) {
                throw new Error("Package is incomplete (missing " + f + ").");
            }
        });
        var manifestPath = path.join(dir, "CSXS", "manifest.xml");
        if (!fs.existsSync(manifestPath)) {
            throw new Error("Package is incomplete (missing " + path.join("CSXS", "manifest.xml") + ").");
        }
        var v = parseBundleVersion(fs.readFileSync(manifestPath, "utf8"));
        if (!v || v !== expectedVersion) {
            throw new Error("Package version mismatch (expected " + expectedVersion + ", got " + (v || "none") + ").");
        }
    }

    /**
     * Atomic swap: live -> .backup, staging -> live. If the second rename
     * fails the old version is put back before the error propagates, so the
     * live install is never left missing.
     */
    function swapInstall(targetPath, stagingPath, backupPath) {
        rmDirRecursive(backupPath);
        var swappedOut = false;
        try {
            if (fs.existsSync(targetPath)) {
                fs.renameSync(targetPath, backupPath);
                swappedOut = true;
            }
            fs.renameSync(stagingPath, targetPath);
        } catch (swapErr) {
            if (swappedOut) {
                try { fs.renameSync(backupPath, targetPath); } catch (rbErr) { }
            }
            throw swapErr;
        }
    }

    /**
     * Best-effort rollback after a failed update: if the live folder is
     * gone/broken but a backup exists, restore it so the panel still loads
     * on next launch. Returns true when a rollback actually happened.
     */
    function rollbackFromBackup(targetPath, backupPath) {
        try {
            if (fs.existsSync(backupPath) &&
                !fs.existsSync(path.join(targetPath, "CSXS", "manifest.xml"))) {
                rmDirRecursive(targetPath);
                fs.renameSync(backupPath, targetPath);
                return true;
            }
        } catch (rbErr) { }
        return false;
    }

    /** Copy a directory tree, overwriting files already at the destination.
        Hand-rolled: CEP's Node predates fs.cpSync. */
    function copyDirRecursive(src, dest) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest);
        fs.readdirSync(src).forEach(function (name) {
            var from = path.join(src, name);
            var to = path.join(dest, name);
            if (fs.statSync(from).isDirectory()) copyDirRecursive(from, to);
            else fs.copyFileSync(from, to);
        });
    }

    /**
     * Undo a failed IN-PLACE extract by copying the backup's files back over
     * the live folder. rollbackFromBackup cannot do this job: it renames the
     * backup into place, and the in-place path is only taken because the live
     * folder could not be renamed — and it only acts when the manifest is
     * missing, which a half-finished extract does not guarantee.
     */
    function restoreInPlace(targetPath, backupPath) {
        try {
            if (!fs.existsSync(path.join(backupPath, "CSXS", "manifest.xml"))) return false;
            copyDirRecursive(backupPath, targetPath);
            return true;
        } catch (e) { return false; }
    }

    /**
     * This panel version booted successfully, so pre-update backups are no
     * longer needed. Never touches a backup NEWER than currentVersion — that
     * would be the rollback source after a failed update, not a leftover.
     */
    function cleanupBackupAt(installPath, currentVersion) {
        var bak = installPath + ".backup";
        try {
            if (!fs.existsSync(bak)) return;
            var v = parseBundleVersion(fs.readFileSync(path.join(bak, "CSXS", "manifest.xml"), "utf8"));
            if (v && versionNewer(v, currentVersion)) return; // rollback source, keep
            rmDirRecursive(bak);
        } catch (e) { /* unreadable backup: leave it for manual recovery */ }
    }

    function cleanupBackups(installPaths, currentVersion) {
        installPaths.forEach(function (p) { cleanupBackupAt(p, currentVersion); });
    }

    // ---------------- network ----------------

    /**
     * fetch with a hard deadline (AbortController — CEP's Chromium has no
     * AbortSignal.timeout). The timer is deliberately NOT cleared when the
     * headers arrive: the same signal governs the body read, so a stalled
     * download is aborted too; aborting an already-finished request is a
     * no-op. The timer is unref'd under Node so tests don't hang on it.
     */
    function fetchWithTimeout(url, timeoutMs, fetchImpl) {
        var f = fetchImpl ||
            (global.fetch ? global.fetch.bind(global) : null) ||
            (typeof fetch !== "undefined" ? fetch : null);
        if (!f) return Promise.reject(new Error("fetch is not available."));
        var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
        if (ctrl) {
            var timer = setTimeout(function () { try { ctrl.abort(); } catch (e) { } }, timeoutMs);
            if (timer && timer.unref) timer.unref();
        }
        return f(url, ctrl ? { signal: ctrl.signal } : undefined).then(
            function (r) { return r; },
            function (err) {
                if (err && err.name === "AbortError") {
                    throw new Error("Network timeout after " + Math.round(timeoutMs / 1000) + "s: " + url);
                }
                throw err;
            }
        );
    }

    function packageUrl(version) {
        return RAW_BASE + "dist/BigHappyLauncher_v" + version + ".zxp";
    }

    /**
     * Latest published version from the repo manifest (cache-busted — raw
     * branch URLs sit behind a ~5-min CDN cache). Resolves the version string;
     * rejects with a readable reason (HTTP status, network error, unparsable
     * manifest). One retry absorbs transient network / CDN blips.
     */
    function fetchRemoteVersion(fetchImpl, retryDelayMs) {
        function attempt() {
            return fetchWithTimeout(RAW_BASE + "cep/CSXS/manifest.xml?t=" + Date.now(),
                META_TIMEOUT_MS, fetchImpl)
                .then(function (r) {
                    if (!r.ok) throw new Error("GitHub returned HTTP " + r.status);
                    return r.text();
                })
                .then(function (xml) {
                    var v = parseBundleVersion(xml);
                    if (!v) throw new Error("the published manifest has no version");
                    return v;
                });
        }
        var delay = retryDelayMs == null ? 2000 : retryDelayMs;
        return attempt().catch(function () {
            return new Promise(function (resolve) { setTimeout(resolve, delay); }).then(attempt);
        });
    }

    // ---------------- full update pipeline ----------------

    function extractTo(tmpZip, dest) {
        return new Promise(function (resolve, reject) {
            var proc = IS_WIN
                ? cp.spawn("tar", ["-xf", tmpZip, "-C", dest], { windowsHide: true })
                : cp.spawn("unzip", ["-o", tmpZip, "-d", dest]);
            var errTail = "";
            proc.stderr.on("data", function (c) { errTail += String(c); });
            proc.on("error", reject);
            proc.on("close", function (code) {
                code === 0 ? resolve() : reject(new Error("Extract failed: " + errTail.slice(-300)));
            });
        });
    }

    /**
     * Download the signed package + its published .sha256, verify, extract
     * into <targetPath>.staging, validate, atomic-swap into targetPath
     * (previous version kept as <targetPath>.backup for rollback). On any
     * failure: best-effort rollback, cleanup, reject — the live install is
     * left working.
     * The package must pass BOTH checks before anything is extracted: the
     * published checksum (intact download) and the release signature (built
     * by a holder of the release key).
     * opts (tests only): { fetchImpl, tmpDir, extractImpl, swapImpl, publicKeys }
     */
    function downloadAndInstall(remoteVersion, targetPath, opts) {
        opts = opts || {};
        var baseUrl = packageUrl(remoteVersion);
        var tmpZip = path.join(opts.tmpDir || os.tmpdir(), "bh_update_" + remoteVersion + ".zip");
        var stagingPath = targetPath + ".staging";
        var backupPath = targetPath + ".backup";
        var extract = opts.extractImpl || extractTo;
        var swap = opts.swapImpl || swapInstall;
        var inPlace = false;   // true once the live folder is being overwritten directly

        return Promise.all([
            fetchWithTimeout(baseUrl, DOWNLOAD_TIMEOUT_MS, opts.fetchImpl).then(function (r) {
                if (!r.ok) throw new Error("Download failed (" + r.status + "). The release file may not be published yet.");
                return r.arrayBuffer();
            }),
            fetchWithTimeout(baseUrl + ".sha256", META_TIMEOUT_MS, opts.fetchImpl).then(function (r) {
                if (!r.ok) throw new Error("Checksum file missing (" + r.status + ") — refusing to install an unverifiable package.");
                return r.text();
            }),
            fetchWithTimeout(baseUrl + ".sig", META_TIMEOUT_MS, opts.fetchImpl).then(function (r) {
                if (!r.ok) throw new Error("Signature file missing (" + r.status + ") — refusing to install an unsigned package.");
                return r.text();
            })
        ])
            .then(function (results) {
                var B = (global.cep_node && global.cep_node.Buffer) || global.Buffer ||
                    (typeof Buffer !== "undefined" ? Buffer : null);
                var data = B.from(results[0]);
                verifyPackage(data, results[1]);
                verifySignature(data, results[2], opts.publicKeys);
                fs.writeFileSync(tmpZip, data);

                // staged extraction: never touch the live install until the
                // package is fully extracted AND validated
                rmDirRecursive(stagingPath);
                fs.mkdirSync(stagingPath, { recursive: true });
                return extract(tmpZip, stagingPath);
            })
            .then(function () {
                validateExtracted(stagingPath, remoteVersion);
                try {
                    swap(targetPath, stagingPath, backupPath);
                } catch (swapErr) {
                    // Windows can refuse directory renames while AE holds a file
                    // open. Staged files are already checksum-verified and
                    // validated, so an in-place extract is a safe last resort.
                    //
                    // The failed swap leaves no backup behind (it clears the
                    // old one first), so take one by COPY — reading works where
                    // renaming did not — before the live files are overwritten.
                    // No backup, no in-place extract: fail with the install intact.
                    rmDirRecursive(backupPath);
                    try { copyDirRecursive(targetPath, backupPath); }
                    catch (copyErr) { rmDirRecursive(backupPath); throw copyErr; }
                    inPlace = true;
                    return extract(tmpZip, targetPath);
                }
            })
            .then(function () {
                validateExtracted(targetPath, remoteVersion); // post-swap confirmation
                try { fs.unlinkSync(tmpZip); } catch (e) { }
                rmDirRecursive(stagingPath);
            })
            .catch(function (err) {
                if (inPlace) restoreInPlace(targetPath, backupPath);
                else rollbackFromBackup(targetPath, backupPath);
                rmDirRecursive(stagingPath);
                try { fs.unlinkSync(tmpZip); } catch (e) { }
                if (err && err.name === "AbortError") {
                    err = new Error("Network timeout — the download was aborted.");
                }
                throw err;
            });
    }

    // ---------------- dev installs ----------------

    /** git pull --ff-only in the repo root. Resolves the combined output;
        rejects with err.spawnFailed=true when git could not start, or
        err.output carrying the tail when the pull itself failed. */
    function gitPull(repoRoot, spawnImpl) {
        var spawn = spawnImpl || cp.spawn;
        return new Promise(function (resolve, reject) {
            var proc = spawn("git", ["-C", repoRoot, "pull", "--ff-only"], { windowsHide: true });
            var out = "";
            proc.stdout.on("data", function (c) { out += String(c); });
            proc.stderr.on("data", function (c) { out += String(c); });
            proc.on("error", function (e) { e.spawnFailed = true; reject(e); });
            proc.on("close", function (code) {
                if (code === 0) return resolve(out);
                var err = new Error("git pull exited " + code);
                err.output = out;
                reject(err);
            });
        });
    }

    global.BHUpdater = {
        // pure
        versionNewer: versionNewer,
        parseShaText: parseShaText,
        sha256Hex: sha256Hex,
        looksLikeZip: looksLikeZip,
        parseBundleVersion: parseBundleVersion,
        verifyPackage: verifyPackage,
        verifySignature: verifySignature,
        RELEASE_PUBLIC_KEYS: RELEASE_PUBLIC_KEYS,
        // fs
        isDevInstall: isDevInstall,
        dirWritable: dirWritable,
        mkdirp: mkdirp,
        rmDirRecursive: rmDirRecursive,
        userExtensionsDir: userExtensionsDir,
        validateExtracted: validateExtracted,
        swapInstall: swapInstall,
        rollbackFromBackup: rollbackFromBackup,
        cleanupBackups: cleanupBackups,
        cleanupBackupAt: cleanupBackupAt,
        // network / pipeline
        fetchWithTimeout: fetchWithTimeout,
        fetchRemoteVersion: fetchRemoteVersion,
        downloadAndInstall: downloadAndInstall,
        gitPull: gitPull
    };
})(window);
