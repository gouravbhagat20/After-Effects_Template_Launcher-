#!/usr/bin/env node
/*
    Release signing for the BigHappy Launcher panel.

    The panel's updater only installs a package whose detached Ed25519
    signature (<zxp>.sig) verifies against a public key pinned in
    js/updater.js (RELEASE_PUBLIC_KEYS). The checksum beside the zxp proves
    the download was not corrupted; the signature proves it was built by
    someone holding the private key — which lives OUTSIDE the repository, so
    push access to GitHub alone is not enough to ship code to users.

        node cep/sign-release.js --init          create the private key (once)
        node cep/sign-release.js <file.zxp>      write <file.zxp>.sig   (build-zxp.sh does this)
        node cep/sign-release.js --verify <zxp>  check the .sig against the pinned keys (CI)

    Private key: $BH_SIGNING_KEY, else ~/.config/bighappy-launcher/release-signing-key.pem
    BACK IT UP. If it is lost, no installed panel will accept another update
    until users reinstall by hand a build that pins a new key. To rotate
    safely, add the new public key to RELEASE_PUBLIC_KEYS in a release signed
    with the old one, and retire the old key a release later.
*/
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const KEY_PATH = process.env.BH_SIGNING_KEY ||
    path.join(os.homedir(), ".config", "bighappy-launcher", "release-signing-key.pem");

/** The updater module itself, so signing and CI use the panel's own check. */
function updater() {
    if (!globalThis.window) globalThis.window = { require: require };
    require(path.join(__dirname, "js", "updater.js"));
    return globalThis.window.BHUpdater;
}

function die(msg) { console.error(msg); process.exit(1); }

function publicPem(privateKey) {
    return crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" }).trim();
}

function init() {
    if (fs.existsSync(KEY_PATH)) die("A signing key already exists at " + KEY_PATH + " — not overwriting it.");
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true, mode: 0o700 });
    fs.writeFileSync(KEY_PATH, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    console.log("Private key written to " + KEY_PATH + " (back it up somewhere safe).");
    console.log("Add this public key to RELEASE_PUBLIC_KEYS in cep/js/updater.js:\n");
    console.log(publicPem(privateKey));
}

function sign(zxp) {
    if (!fs.existsSync(zxp)) die("No such file: " + zxp);
    if (!fs.existsSync(KEY_PATH)) {
        die("No release signing key at " + KEY_PATH + ".\n" +
            "Releases must be signed or installed panels will refuse them.\n" +
            "Restore your backup of the key there (or set BH_SIGNING_KEY).");
    }
    const key = crypto.createPrivateKey(fs.readFileSync(KEY_PATH));
    const data = fs.readFileSync(zxp);
    const sig = crypto.sign(null, data, key).toString("base64");
    // Signing with a key the panel does not pin would ship an update nobody can install.
    try { updater().verifySignature(data, sig); }
    catch (e) { die("The key at " + KEY_PATH + " is not one of RELEASE_PUBLIC_KEYS in cep/js/updater.js.\n" + e.message); }
    fs.writeFileSync(zxp + ".sig", sig + "\n");
    console.log("Signed: " + path.basename(zxp) + ".sig");
}

function verify(zxp) {
    if (!fs.existsSync(zxp + ".sig")) die(zxp + ".sig not found — build with cep/build-zxp.sh so the release is signed.");
    try { updater().verifySignature(fs.readFileSync(zxp), fs.readFileSync(zxp + ".sig", "utf8")); }
    catch (e) { die(path.basename(zxp) + ": " + e.message); }
    console.log("Signature OK: " + path.basename(zxp));
}

const args = process.argv.slice(2);
if (args[0] === "--init") init();
else if (args[0] === "--verify" && args[1]) verify(args[1]);
else if (args[0] && args[0].indexOf("--") !== 0) sign(args[0]);
else die("Usage: sign-release.js --init | <file.zxp> | --verify <file.zxp>");
