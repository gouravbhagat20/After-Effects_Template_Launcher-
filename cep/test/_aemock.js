/*
    Minimal After Effects DOM mock for testing jsx/host.jsx headlessly.

    host.jsx is ExtendScript: it runs inside AE and talks to `app`, `File`,
    `Folder`, `FootageItem` and friends. None of that exists under Node, so
    CI could only ever syntax-check it — the riskiest file in the project had
    no behavioural tests at all.

    This module builds an in-memory stand-in for the parts of the AE DOM that
    host.jsx actually touches (an inventory of ~8 globals), then evaluates
    host.jsx inside a vm context wired to them. It is deliberately NOT a
    faithful AE emulator: it models the contracts host.jsx depends on
    (1-based item collections, case-preserving `fsName`, `replace()` throwing
    on a missing file) so that the logic around them can be exercised.

    Usage:
        const { buildAE, loadHost } = require("./_aemock.js");
        const ae = buildAE({ items: [...] });
        const BH = loadHost(ae);
        const res = JSON.parse(BH.releaseFileLock("/x/clip.mp4"));
*/
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const HOST_SRC = path.join(__dirname, "..", "jsx", "host.jsx");

/* ---------------------------------------------------------------- vfs --- */

/** Case-insensitive lookup key — mirrors Windows/macOS filesystem behaviour. */
function key(p) {
    return String(p).replace(/\\/g, "/").toLowerCase();
}

function basename(p) {
    return String(p).replace(/\\/g, "/").split("/").pop();
}

function dirname(p) {
    const parts = String(p).replace(/\\/g, "/").split("/");
    parts.pop();
    return parts.join("/") || "/";
}

class VFS {
    constructor(paths) {
        this.files = new Map();     // key -> { path, content }
        this.dirs = new Set();
        (paths || []).forEach((p) => this.addFile(p));
    }
    addFile(p, content) {
        this.files.set(key(p), { path: p, content: content == null ? "" : String(content) });
        let d = dirname(p);
        while (d && d !== "/" && !this.dirs.has(key(d))) {
            this.dirs.add(key(d));
            d = dirname(d);
        }
    }
    hasFile(p) { return this.files.has(key(p)); }
    hasDir(p) { return this.dirs.has(key(p)); }
    /** Real (case-preserved) path as stored, or the requested one. */
    real(p) {
        const hit = this.files.get(key(p));
        return hit ? hit.path : p;
    }
    listDir(p) {
        const prefix = key(p).replace(/\/$/, "") + "/";
        const out = [];
        for (const rec of this.files.values()) {
            const k = key(rec.path);
            if (k.startsWith(prefix) && !k.slice(prefix.length).includes("/")) out.push(rec.path);
        }
        return out;
    }
}

/* ------------------------------------------------------- File / Folder --- */

function makeFileClasses(vfs, log) {
    class MFolder {
        constructor(p) { this.fsName = String(p).replace(/\\/g, "/"); }
        get name() { return basename(this.fsName); }
        get exists() { return vfs.hasDir(this.fsName); }
        get parent() { return new MFolder(dirname(this.fsName)); }
        create() { vfs.dirs.add(key(this.fsName)); return true; }
        getFiles(filter) {
            const out = vfs.listDir(this.fsName).map((p) => new MFile(p));
            return filter ? out.filter((f) => !!filter(f)) : out;
        }
    }

    class MFile {
        constructor(p) { this.fsName = String(p).replace(/\\/g, "/"); }
        get name() { return basename(this.fsName); }
        get exists() { return vfs.hasFile(this.fsName); }
        get parent() { return new MFolder(dirname(this.fsName)); }
        copy(destPath) {
            if (!this.exists) return false;
            if (vfs.copyFails && vfs.copyFails(this.fsName)) return false;
            vfs.addFile(String(destPath), vfs.files.get(key(this.fsName)).content);
            log.push({ op: "copy", from: this.fsName, to: String(destPath) });
            return true;
        }
        open() { this._buf = ""; return true; }
        write(s) { this._buf = (this._buf || "") + String(s); return true; }
        close() { vfs.addFile(this.fsName, this._buf || ""); return true; }
        remove() { vfs.files.delete(key(this.fsName)); return true; }
    }

    MFolder.temp = new MFolder("/tmp");
    vfs.dirs.add(key("/tmp"));
    return { MFile, MFolder };
}

/* -------------------------------------------------------- project items --- */

class MItem {
    constructor(spec) { Object.assign(this, spec); }
}
class MCompItem extends MItem { }
class MFootageItem extends MItem {
    constructor(spec, ctx) {
        super(spec);
        this._ctx = ctx;
        this.width = spec.width == null ? 1920 : spec.width;
        this.height = spec.height == null ? 1080 : spec.height;
        this.frameRate = spec.frameRate == null ? 30 : spec.frameRate;
        this.duration = spec.duration == null ? 5 : spec.duration;
        this.mainSource = spec.mainSource || { isStill: false };
    }
    /** AE throws when the replacement file is not on disk. */
    replace(file) {
        if (this._ctx.replaceThrowsFor && this._ctx.replaceThrowsFor(this)) {
            throw new Error("replace() refused for " + this.name);
        }
        if (!file || !file.exists) throw new Error("File not found: " + (file && file.fsName));
        this.file = file;
        this.name = basename(file.fsName);
        this._ctx.log.push({ op: "replace", item: this.name, to: file.fsName });
    }
    replaceWithSequence(file) {
        if (!file || !file.exists) throw new Error("File not found");
        this.file = file;
        this._ctx.log.push({ op: "replaceWithSequence", to: file.fsName });
    }
    replaceWithPlaceholder(name, w, h, fps, dur) {
        if (this._ctx.placeholderThrowsFor && this._ctx.placeholderThrowsFor(this)) {
            throw new Error("replaceWithPlaceholder() refused for " + this.name);
        }
        // AE's documented limits — the mock enforces them so that a regression
        // in host.jsx's clamping shows up as a thrown error, like in AE.
        if (w < 4 || w > 30000) throw new Error("placeholder width out of range: " + w);
        if (h < 4 || h > 30000) throw new Error("placeholder height out of range: " + h);
        if (fps < 1 || fps > 99) throw new Error("placeholder fps out of range: " + fps);
        if (dur > 10800) throw new Error("placeholder duration out of range: " + dur);
        this.name = name;
        this.file = null;
        this.placeholder = { name, w, h, fps, dur };
        this._ctx.log.push({ op: "placeholder", name, w, h, fps, dur });
    }
}
class MSolidSource { }

/* -------------------------------------------------------------- app ----- */

/**
 * @param {object} spec
 *   items            - array of item specs ({kind:'comp'|'footage', ...})
 *   files            - extra paths that exist on the virtual disk
 *   projectFile      - path of the open .aep, or null
 *   settings         - preloaded AE settings map
 *   outputModules    - [{ rq, om, file }] render-queue output modules
 *   replaceThrowsFor - fn(item) -> true to simulate a locked item
 */
function buildAE(spec) {
    spec = spec || {};
    const log = [];
    const vfs = new VFS(spec.files || []);
    const ctx = {
        log,
        replaceThrowsFor: spec.replaceThrowsFor,
        placeholderThrowsFor: spec.placeholderThrowsFor
    };
    const { MFile, MFolder } = makeFileClasses(vfs, log);

    const items = (spec.items || []).map((s) => {
        if (s.kind === "comp") return new MCompItem(s);
        const f = new MFootageItem(s, ctx);
        if (s.path) {
            if (s.onDisk !== false) vfs.addFile(s.path);
            f.file = new MFile(s.path);
        }
        return f;
    });

    // AE collections are 1-based; `items` also exposes .length.
    const itemsCollection = { length: items.length };
    // host.jsx reads app.project.items[i] for i in 1..length
    items.forEach((it, i) => { itemsCollection[i + 1] = it; });

    const oms = (spec.outputModules || []).map((o) => ({
        rq: o.rq, om: o.om,
        file: o.file ? new MFile(o.file) : null,
        locked: !!o.locked,
        applyTemplate() { },
        get _file() { return this.file; }
    }));
    const rqItemCount = oms.reduce((m, o) => Math.max(m, o.rq), 0);
    const renderQueue = {
        numItems: rqItemCount,
        item(i) {
            const mine = oms.filter((o) => o.rq === i);
            return {
                numOutputModules: mine.reduce((m, o) => Math.max(m, o.om), 0),
                outputModule(j) {
                    const hit = mine.filter((o) => o.om === j)[0];
                    if (!hit) throw new Error("no output module " + j);
                    if (hit.locked) throw new Error("output module locked");
                    return hit;
                }
            };
        },
        items: { add: () => ({ outputModule: () => ({ applyTemplate() { } }) }) }
    };

    const settings = Object.assign({}, spec.settings || {});
    const project = {
        get numItems() { return items.length; },
        item(i) {
            const it = items[i - 1];
            if (!it) throw new Error("no item at index " + i);
            return it;
        },
        items: itemsCollection,
        file: spec.projectFile ? new MFile(spec.projectFile) : null,
        dirty: !!spec.dirty,
        renderQueue,
        save() { log.push({ op: "save" }); },
        close() { log.push({ op: "close" }); }
    };

    const app = {
        appName: "AfterFX",
        version: "24.0",
        project,
        settings: {
            haveSetting: (sec, k) => Object.prototype.hasOwnProperty.call(settings, sec + "/" + k),
            getSetting: (sec, k) => settings[sec + "/" + k],
            saveSetting: (sec, k, v) => { settings[sec + "/" + k] = String(v); }
        },
        beginUndoGroup() { },
        endUndoGroup() { },
        open() { log.push({ op: "open" }); return project; },
        newProject() { log.push({ op: "newProject" }); return project; },
        executeCommand() { },
        findMenuCommandId: () => 1
    };

    return {
        app, project, items, log, vfs, settings,
        globals: {
            app,
            File: MFile,
            Folder: MFolder,
            CompItem: MCompItem,
            FootageItem: MFootageItem,
            SolidSource: MSolidSource,
            ImportOptions: function (f) { this.file = f; },
            ImportAsType: { FOOTAGE: "footage" }
        }
    };
}

/** Evaluate jsx/host.jsx against a mock AE and return its BH namespace. */
function loadHost(ae) {
    const src = fs.readFileSync(HOST_SRC, "utf8");
    // Only the AE globals go in. The vm context supplies its own natives —
    // injecting the outer realm's Array/Object would break host.jsx's
    // `v instanceof Array` check in stringify(), since arrays built inside
    // the context descend from the context's own Array.
    const sandbox = Object.assign({}, ae.globals);
    vm.createContext(sandbox);
    vm.runInContext(src + "\n;BH;", sandbox, { filename: "host.jsx" });
    return sandbox.BH;
}

/** Parse a BH.* JSON envelope, asserting success. */
function unwrap(raw) {
    const parsed = JSON.parse(raw);
    if (!parsed.ok) throw new Error("host call failed: " + parsed.error);
    return parsed.data;
}

module.exports = { buildAE, loadHost, unwrap, VFS };
