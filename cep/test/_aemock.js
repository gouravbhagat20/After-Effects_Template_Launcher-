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
 *   sortByName       - true to index items in name order, re-sorted after
 *                      every rename, the way the Project panel orders them.
 *                      Off by default so tests can address ae.items[n]
 *                      directly; turn it on to catch code that trusts an
 *                      index across a rename.
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

    // Persistent ids, like AE's item.id: unrelated to position, never reused.
    items.forEach((it, i) => { if (it.id == null) it.id = 100 + i * 7; });

    /** Items in the order AE would index them right now. */
    function ordered() {
        if (!spec.sortByName) return items;
        return items.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }

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
        items: {
            add: () => {
                // Like AE: the output file is named after the format the
                // module will really write, and a template that is not
                // installed (spec.missingOMTemplates) throws. The default
                // format is H.264, as in current After Effects.
                const missing = spec.missingOMTemplates || [];
                let fmt = "mp4", outFile = null;
                const om = {
                    applyTemplate(name) {
                        if (missing === "all" || missing.indexOf(name) !== -1) throw new Error("no such template: " + name);
                        log.push({ op: "applyTemplate", name });
                        fmt = /PNG/.test(name) ? "png" : "mp4";
                    },
                    setSettings(s) {
                        if (spec.setSettingsThrows) throw new Error("setSettings refused");
                        log.push({ op: "setSettings", format: s && s.Format });
                        if (s && s.Format) fmt = /PNG/.test(s.Format) ? "png" : "mp4";
                    },
                    get file() { return outFile; },
                    set file(f) {
                        outFile = new MFile(f.fsName + (fmt === "png" ? "_[#####].png" : ".mp4"));
                    }
                };
                return { outputModule: () => om };
            }
        }
    };

    const settings = Object.assign({}, spec.settings || {});
    const project = {
        get numItems() { return items.length; },
        item(i) {
            const it = ordered()[i - 1];
            if (!it) throw new Error("no item at index " + i);
            return it;
        },
        itemByID(id) {
            const it = items.filter((x) => x.id === id)[0];
            if (!it) throw new Error("no item with id " + id);
            return it;
        },
        items: itemsCollection,
        file: spec.projectFile ? new MFile(spec.projectFile) : null,
        dirty: !!spec.dirty,
        renderQueue,
        /** save() in place, or save(file) = Save As: AE then works on that file. */
        save(file) {
            if (spec.saveThrows && spec.saveThrows(file)) throw new Error("save failed");
            if (file) { vfs.addFile(file.fsName); project.file = file; }
            log.push({ op: "save", to: file ? file.fsName : null });
        },
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
        open(file) {
            if (file) project.file = file;
            log.push({ op: "open", file: file ? file.fsName : null });
            return project;
        },
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
            CloseOptions: { DO_NOT_SAVE_CHANGES: "DO_NOT_SAVE_CHANGES" },
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
