/*
    Boots the panel's browser half headlessly, on top of the DOM stub in
    _dom.js, so the wiring in js/*.js can be tested.

    Every panel script is an IIFE that hangs its namespace off `window`
    (window.BHCalc, window.BHFFmpeg, …) and then reads those namespaces as
    bare globals. To reproduce that, all scripts are evaluated in ONE vm
    context whose global object IS `window` — so `global.BHCalc = …` inside
    calc.js makes a bare `BHCalc` visible to main.js, exactly as in a browser.

    Usage:
        const { bootPanel } = require("./_panel.js");
        const panel = await bootPanel({ settings: { base_work_folder: "/w" } });
        panel.$("btn-optimize").click();
*/
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { installDOM } = require("./_dom.js");

const JS_DIR = path.join(__dirname, "..", "js");
const INDEX_HTML = path.join(__dirname, "..", "index.html");

/** Script tags from index.html, in document order, minus CSInterface. */
function panelScripts() {
    const html = fs.readFileSync(INDEX_HTML, "utf8");
    const out = [];
    const re = /<script\s+src="js\/([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) {
        if (m[1] === "CSInterface.js") continue;   // replaced by the stub
        out.push(m[1]);
    }
    return out;
}

/**
 * @param {object} [opts]
 *   settings   - AE settings the fake host bridge should return
 *   hostImpl   - { [fnName]: (args) => data | Error } overrides per BH.* call
 *   projectInfo- value for BH.getProjectInfo
 *   waitMs     - how long to let boot promises settle (default 60)
 */
async function bootPanel(opts) {
    opts = opts || {};
    const settings = Object.assign({}, opts.settings || {});
    const calls = [];

    /** Stands in for host.jsx: parses `BH.fn(jsonArgs)` and answers it. */
    function defaultEvalScript(script, cb) {
        const m = /^BH\.([a-zA-Z]+)\((.*)\)$/s.exec(String(script));
        if (!m) return cb("EvalScript error.");
        const fn = m[1];
        let args = [];
        try { args = m[2].trim() ? JSON.parse("[" + m[2] + "]") : []; }
        catch (e) { return cb("EvalScript error."); }
        calls.push({ fn, args });

        const impl = (opts.hostImpl || {})[fn];
        const reply = (data) => cb(JSON.stringify({ ok: true, data }));
        const refuse = (msg) => cb(JSON.stringify({ ok: false, error: String(msg) }));

        if (impl) {
            let out;
            try { out = typeof impl === "function" ? impl(...args) : impl; }
            catch (e) { return refuse(e.message); }
            if (out instanceof Error) return refuse(out.message);
            if (out === undefined) return reply(null);
            return reply(out);
        }

        switch (fn) {
            case "ping": return reply({ app: "AfterFX", version: "24.0" });
            case "getSetting": {
                const v = settings[args[0]];
                return reply(v === undefined ? args[1] ?? null : v);
            }
            case "setSetting":
                settings[args[0]] = args[1];
                return reply(true);
            case "getProjectInfo":
                return reply(opts.projectInfo === undefined ? { open: false } : opts.projectInfo);
            case "findRelinkPlaceholders": return reply([]);
            case "releaseFileLock": return reply({ items: [], oms: [], failed: [] });
            case "restoreFileLock": return reply({ restored: 0, failed: [] });
            case "recoverPlaceholders": return reply({ restored: 0, failed: [] });
            default: return reply(null);
        }
    }

    // A test may supply its own bridge (to stall a call, or to fail one).
    // Its calls are still recorded, so assertions on `calls` keep working.
    const evalScript = opts.evalScript
        ? function (script, cb) {
            const m = /^BH\.([a-zA-Z]+)\((.*)\)$/s.exec(String(script));
            if (m) {
                let args = [];
                try { args = m[2].trim() ? JSON.parse("[" + m[2] + "]") : []; } catch (e) { }
                calls.push({ fn: m[1], args });
            }
            return opts.evalScript(script, cb);
        }
        : defaultEvalScript;

    const env = installDOM(Object.assign({}, opts, { evalScript }));
    const win = env.window;

    // The panel polls the project every 4s and re-checks for updates hourly.
    // Those intervals keep Node's event loop alive forever, so track every
    // timer the panel starts and hand the test a way to stop them.
    const timers = { intervals: [], timeouts: [] };
    win.setInterval = function (fn, ms) {
        const h = setInterval(fn, ms);
        timers.intervals.push(h);
        return h;
    };
    // `compressTimers` collapses any delay of a second or more to nothing, so
    // a test can reach the host bridge's 30s timeout without waiting 30s.
    win.setTimeout = function (fn, ms) {
        const delay = opts.compressTimers && ms >= 1000 ? 0 : ms;
        const h = setTimeout(fn, delay);
        timers.timeouts.push(h);
        return h;
    };
    win.clearInterval = clearInterval;
    win.clearTimeout = clearTimeout;

    // The context's global object IS window, so window.X and bare X are one
    // and the same — the browser arrangement the panel scripts assume.
    const sandbox = win;
    sandbox.global = sandbox;
    sandbox.console = opts.console || {
        log() { }, warn() { }, error() { }, info() { }
    };
    sandbox.process = process;
    sandbox.CSInterface = env.CSInterface;
    sandbox.Promise = Promise;
    vm.createContext(sandbox);

    const loaded = [];
    for (const file of panelScripts()) {
        const full = path.join(JS_DIR, file);
        if (!fs.existsSync(full)) throw new Error("index.html references a missing script: js/" + file);
        vm.runInContext(fs.readFileSync(full, "utf8"), sandbox, { filename: "js/" + file });
        loaded.push(file);
    }

    // Let boot's promise chain settle (settings load, first render).
    await new Promise((r) => setTimeout(r, opts.waitMs == null ? 60 : opts.waitMs));

    return {
        window: win,
        document: env.document,
        localStorage: env.localStorage,
        settings,
        calls,
        loaded,
        $: (id) => env.document.getElementById(id),
        /** BH.* calls made so far, by name. */
        callsTo: (fn) => calls.filter((c) => c.fn === fn),
        /** Fire a DOM event on an element by id. */
        fire: (id, type, ev) => {
            const el = env.document.getElementById(id);
            if (!el) throw new Error("no element #" + id);
            return el.dispatchEvent(Object.assign({ type }, ev || {}));
        },
        /** Let pending promises/timers settle. */
        settle: (ms) => new Promise((r) => setTimeout(r, ms == null ? 30 : ms)),
        /** Stop the panel's polling intervals so the test process can exit. */
        stop: () => {
            timers.intervals.forEach(clearInterval);
            timers.timeouts.forEach(clearTimeout);
            timers.intervals.length = timers.timeouts.length = 0;
        }
    };
}

module.exports = { bootPanel, panelScripts };
