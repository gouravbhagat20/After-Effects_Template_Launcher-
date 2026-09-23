/*
    Minimal DOM + CEP host stub, enough to boot the panel headlessly.

    The panel's browser half (js/*.js) has never been testable: it needs a
    document, a CSInterface, and window.cep. The test harness has no runtime
    dependencies by design (see package.json), so rather than pull in jsdom
    this builds a small DOM over the real index.html.

    It is not a browser. It implements exactly the surface the panel uses —
    an inventory of ~20 element properties and 14 selectors — so that loading
    the panel exercises real wiring: every getElementById the code performs
    must resolve against the real markup, and every listener it attaches can
    be fired.

    Usage:
        const { installDOM } = require("./_dom.js");
        const env = installDOM();          // globals are now in place
        env.document.getElementById("btn-optimize").click();
*/
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const INDEX_HTML = path.join(__dirname, "..", "index.html");
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr"]);

/* ------------------------------------------------------------ parsing --- */

function parseAttrs(str) {
    const attrs = {};
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let m;
    while ((m = re.exec(str))) {
        attrs[m[1].toLowerCase()] = m[2] !== undefined ? m[2]
            : m[3] !== undefined ? m[3]
                : m[4] !== undefined ? m[4] : "";
    }
    return attrs;
}

/** Tag soup in, element tree out. index.html is hand-written and well formed. */
function parseHTML(html, doc) {
    const root = new Element("#fragment", doc);
    const stack = [root];
    const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\/([a-zA-Z][-a-zA-Z0-9]*)\s*>|<([a-zA-Z][-a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
    let last = 0;
    let m;
    while ((m = re.exec(html))) {
        const text = html.slice(last, m.index);
        if (text) stack[stack.length - 1].appendChild(new TextNode(text, doc));
        last = re.lastIndex;

        if (m[0].startsWith("<!")) continue;
        if (m[1]) {                                   // closing tag
            const tag = m[1].toLowerCase();
            for (let i = stack.length - 1; i > 0; i--) {
                if (stack[i].tagName === tag) { stack.length = i; break; }
            }
            continue;
        }
        const tag = m[2].toLowerCase();
        const el = new Element(tag, doc);
        const attrs = parseAttrs(m[3] || "");
        for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
        stack[stack.length - 1].appendChild(el);

        if (tag === "script" || tag === "style") {    // raw-text elements
            const close = new RegExp("</" + tag + "\\s*>", "i");
            close.lastIndex = re.lastIndex;
            const rest = html.slice(re.lastIndex);
            const hit = rest.match(close);
            const end = hit ? re.lastIndex + hit.index + hit[0].length : html.length;
            const raw = html.slice(re.lastIndex, hit ? re.lastIndex + hit.index : html.length);
            if (raw) el.appendChild(new TextNode(raw, doc));
            re.lastIndex = last = end;
            continue;
        }
        if (!m[4] && !VOID.has(tag)) stack.push(el);
    }
    const tail = html.slice(last);
    if (tail) stack[stack.length - 1].appendChild(new TextNode(tail, doc));
    return root;
}

/* -------------------------------------------------------------- nodes --- */

function escapeText(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

class TextNode {
    constructor(data, doc) { this.nodeType = 3; this.data = data; this.ownerDocument = doc; this.parentNode = null; }
    get textContent() { return this.data; }
    set textContent(v) { this.data = String(v); }
    get outerHTML() { return escapeText(this.data); }
}

class ClassList {
    constructor(el) { this.el = el; }
    get _set() {
        const raw = this.el.getAttribute("class") || "";
        return raw.split(/\s+/).filter(Boolean);
    }
    _write(list) { this.el.setAttribute("class", list.join(" ")); }
    contains(c) { return this._set.indexOf(c) !== -1; }
    add(...cs) {
        const s = this._set;
        cs.forEach((c) => { if (c && s.indexOf(c) === -1) s.push(c); });
        this._write(s);
    }
    remove(...cs) { this._write(this._set.filter((c) => cs.indexOf(c) === -1)); }
    toggle(c, force) {
        const has = this.contains(c);
        const want = force === undefined ? !has : !!force;
        if (want) this.add(c); else this.remove(c);
        return want;
    }
    get length() { return this._set.length; }
    toString() { return this._set.join(" "); }
}

class Element {
    constructor(tagName, doc) {
        this.nodeType = 1;
        this.tagName = tagName;
        this.ownerDocument = doc;
        this.attributes = {};
        this.childNodes = [];
        this.parentNode = null;
        this.classList = new ClassList(this);
        this.style = new Proxy({}, { get: (t, k) => (k === "setProperty" ? (n, v) => { t[n] = v; } : t[k]), set: (t, k, v) => { t[k] = v; return true; } });
        this.dataset = {};
        this._listeners = {};
        // Layout is meaningless headlessly; the panel only reads these to
        // position the sliding tab indicator.
        this.offsetWidth = 0;
        this.offsetLeft = 0;
        this.scrollTop = 0;
        this.scrollHeight = 0;
    }

    /* --- attributes --- */
    setAttribute(name, value) {
        name = String(name).toLowerCase();
        this.attributes[name] = String(value);
        if (name === "id") this._reindex();
        if (name.startsWith("data-")) {
            const k = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            this.dataset[k] = String(value);
        }
        if (name === "value") this._value = String(value);
        if (name === "checked") this.checked = true;
        if (name === "disabled") this.disabled = true;
    }
    getAttribute(name) {
        const v = this.attributes[String(name).toLowerCase()];
        return v === undefined ? null : v;
    }
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, String(name).toLowerCase()); }
    removeAttribute(name) { delete this.attributes[String(name).toLowerCase()]; }
    _reindex() { if (this.ownerDocument) this.ownerDocument._index(this); }

    get id() { return this.getAttribute("id") || ""; }
    set id(v) { this.setAttribute("id", v); }
    get className() { return this.getAttribute("class") || ""; }
    set className(v) { this.setAttribute("class", v); }
    get title() { return this.getAttribute("title") || ""; }
    set title(v) { this.setAttribute("title", v); }
    get placeholder() { return this.getAttribute("placeholder") || ""; }
    set placeholder(v) { this.setAttribute("placeholder", v); }
    get tabIndex() { return Number(this.getAttribute("tabindex") || -1); }
    set tabIndex(v) { this.setAttribute("tabindex", String(v)); }

    /* --- form state --- */
    get value() {
        if (this.tagName === "select") {
            // An explicit assignment wins, as in a browser; otherwise the
            // value is whichever option is currently selected.
            const opts = this.querySelectorAll("option");
            if (this._value !== undefined &&
                opts.some((o) => o.value === this._value)) return this._value;
            const sel = opts.filter((o) => o.selected || o.hasAttribute("selected"))[0] || opts[0];
            return sel ? sel.value : "";
        }
        if (this._value !== undefined) return this._value;
        if (this.tagName === "option") {
            // An option with no value attribute reports its label.
            const attr = this.getAttribute("value");
            return attr === null ? this.textContent : attr;
        }
        return "";
    }
    set value(v) { this._value = String(v); }
    get selectedIndex() {
        const opts = this.querySelectorAll("option");
        const v = this.value;
        return opts.findIndex((o) => o.value === v);
    }
    set selectedIndex(i) {
        const opts = this.querySelectorAll("option");
        opts.forEach((o) => { o.selected = false; });
        if (opts[i]) { opts[i].selected = true; this._value = opts[i].value; }
    }

    /* --- tree --- */
    get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
    get firstChild() { return this.childNodes[0] || null; }
    appendChild(node) {
        if (node.parentNode) node.parentNode.removeChild(node);
        node.parentNode = this;
        node.ownerDocument = this.ownerDocument;
        this.childNodes.push(node);
        if (this.ownerDocument) this.ownerDocument._indexTree(node);
        return node;
    }
    insertBefore(node, ref) {
        if (!ref) return this.appendChild(node);
        const i = this.childNodes.indexOf(ref);
        if (node.parentNode) node.parentNode.removeChild(node);
        node.parentNode = this;
        node.ownerDocument = this.ownerDocument;
        this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, node);
        if (this.ownerDocument) this.ownerDocument._indexTree(node);
        return node;
    }
    removeChild(node) {
        const i = this.childNodes.indexOf(node);
        if (i >= 0) this.childNodes.splice(i, 1);
        node.parentNode = null;
        return node;
    }

    /* --- content --- */
    get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
    set textContent(v) {
        this.childNodes = [];
        if (v !== "" && v != null) this.appendChild(new TextNode(String(v), this.ownerDocument));
    }
    get innerHTML() { return this.childNodes.map((n) => n.outerHTML).join(""); }
    set innerHTML(html) {
        this.childNodes = [];
        const frag = parseHTML(String(html), this.ownerDocument);
        frag.childNodes.slice().forEach((c) => this.appendChild(c));
    }
    get outerHTML() {
        const attrs = Object.keys(this.attributes)
            .map((k) => ` ${k}="${String(this.attributes[k]).replace(/"/g, "&quot;")}"`).join("");
        if (VOID.has(this.tagName)) return `<${this.tagName}${attrs}>`;
        return `<${this.tagName}${attrs}>${this.innerHTML}</${this.tagName}>`;
    }

    /* --- selectors --- */
    matches(sel) { return matchCompound(this, sel.trim()); }
    closest(sel) {
        let n = this;
        while (n && n.nodeType === 1) {
            if (n.matches(sel)) return n;
            n = n.parentNode;
        }
        return null;
    }
    querySelectorAll(sel) { return queryAll(this, sel); }
    querySelector(sel) { return queryAll(this, sel)[0] || null; }

    /* --- events --- */
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
    removeEventListener(type, fn) {
        const l = this._listeners[type];
        if (l) this._listeners[type] = l.filter((f) => f !== fn);
    }
    dispatchEvent(ev) {
        ev.target = ev.target || this;
        ev.preventDefault = ev.preventDefault || function () { ev.defaultPrevented = true; };
        ev.stopPropagation = ev.stopPropagation || function () { ev._stop = true; };
        let node = this;
        while (node) {                                 // bubble, like a browser
            (node._listeners[ev.type] || []).slice().forEach((fn) => fn.call(node, ev));
            if (ev._stop) break;
            node = node.parentNode;
        }
        if (ev.type === "click" && typeof this.onclick === "function") this.onclick(ev);
        return !ev.defaultPrevented;
    }
    click(detail) {
        const ev = { type: "click", detail: detail === undefined ? 1 : detail };
        return this.dispatchEvent(ev);
    }
    focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
    blur() { if (this.ownerDocument && this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
    /** Web Animations stub — the panel only cancels these and reads onfinish. */
    animate() {
        const anim = { cancel() { if (typeof anim.oncancel === "function") anim.oncancel(); }, finish() { }, onfinish: null, oncancel: null };
        return anim;
    }
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }; }
}

/* ------------------------------------------------------------ queries --- */

function matchCompound(el, sel) {
    if (el.nodeType !== 1) return false;
    const re = /([#.]?[-\w]+|\[[^\]]+\])/g;
    let m;
    while ((m = re.exec(sel))) {
        const tok = m[1];
        if (tok[0] === "#") {
            if (el.id !== tok.slice(1)) return false;
        } else if (tok[0] === ".") {
            if (!el.classList.contains(tok.slice(1))) return false;
        } else if (tok[0] === "[") {
            const body = tok.slice(1, -1);
            const eq = body.indexOf("=");
            if (eq === -1) {
                if (!el.hasAttribute(body)) return false;
            } else {
                const name = body.slice(0, eq);
                const want = body.slice(eq + 1).replace(/^["']|["']$/g, "");
                if (el.getAttribute(name) !== want) return false;
            }
        } else if (el.tagName !== tok.toLowerCase()) return false;
    }
    return true;
}

function descendants(root, out) {
    root.childNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        out.push(n);
        descendants(n, out);
    });
    return out;
}

/** Supports comma groups and descendant combinators of compound selectors. */
function queryAll(root, selector) {
    const results = [];
    String(selector).split(",").forEach((group) => {
        const parts = group.trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return;
        let current = descendants(root, []);
        parts.forEach((part, depth) => {
            if (depth === 0) {
                current = current.filter((el) => matchCompound(el, part));
            } else {
                const next = [];
                current.forEach((el) => descendants(el, []).forEach((d) => {
                    if (matchCompound(d, part) && next.indexOf(d) === -1) next.push(d);
                }));
                current = next;
            }
        });
        current.forEach((el) => { if (results.indexOf(el) === -1) results.push(el); });
    });
    return results;
}

/* ----------------------------------------------------------- document --- */

class Document {
    constructor(html) {
        this._byId = new Map();
        this.activeElement = null;
        this._listeners = {};
        const root = parseHTML(html, this);
        this.documentElement = root.querySelector("html") || root;
        this.body = root.querySelector("body") || this.documentElement;
        this.head = root.querySelector("head") || this.documentElement;
        this._root = root;
        this._indexTree(root);
    }
    _index(el) { if (el.id) this._byId.set(el.id, el); }
    _indexTree(node) {
        if (node.nodeType !== 1) return;
        this._index(node);
        node.ownerDocument = this;
        node.childNodes.forEach((c) => this._indexTree(c));
    }
    createElement(tag) { return new Element(String(tag).toLowerCase(), this); }
    createTextNode(t) { return new TextNode(String(t), this); }
    getElementById(id) { return this._byId.get(id) || null; }
    querySelector(sel) { return queryAll(this._root, sel)[0] || null; }
    querySelectorAll(sel) { return queryAll(this._root, sel); }
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
    removeEventListener(type, fn) {
        const l = this._listeners[type];
        if (l) this._listeners[type] = l.filter((f) => f !== fn);
    }
    dispatchEvent(ev) {
        ev.preventDefault = ev.preventDefault || function () { ev.defaultPrevented = true; };
        (this._listeners[ev.type] || []).slice().forEach((fn) => fn.call(this, ev));
        return !ev.defaultPrevented;
    }
    execCommand() { return true; }
}

/* ------------------------------------------------------------ install --- */

/**
 * Build the globals the panel expects and return handles for driving it.
 * @param {object} [opts]
 *   html       - markup to use (defaults to the real index.html)
 *   evalScript - fn(script, cb) standing in for the ExtendScript bridge
 */
function installDOM(opts) {
    opts = opts || {};
    const html = opts.html || fs.readFileSync(INDEX_HTML, "utf8");
    const document = new Document(html);

    const hostCalls = [];
    const evalScript = opts.evalScript || function (script, cb) {
        hostCalls.push(script);
        cb(JSON.stringify({ ok: true, data: null }));
    };

    const store = new Map();
    const localStorage = {
        getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
        setItem: (k, v) => store.set(String(k), String(v)),
        removeItem: (k) => store.delete(String(k)),
        clear: () => store.clear()
    };

    const listeners = {};
    const win = {
        document,
        localStorage,
        navigator: { userAgent: "Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36" },
        requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
        cancelAnimationFrame: (h) => clearTimeout(h),
        matchMedia: () => ({ matches: false, addEventListener() { }, addListener() { } }),
        setTimeout, clearTimeout, setInterval, clearInterval,
        addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
        removeEventListener: (t, fn) => {
            if (listeners[t]) listeners[t] = listeners[t].filter((f) => f !== fn);
        },
        dispatchEvent: (ev) => {
            (listeners[ev.type] || []).slice().forEach((fn) => fn(ev));
            return true;
        },
        getComputedStyle: () => ({ getPropertyValue: () => "" }),
        require,
        cep_node: { require },
        cep: {
            fs: {
                showOpenDialogEx: () => ({ err: 0, data: opts.pickResult || [] }),
                showSaveDialogEx: () => ({ err: 0, data: opts.savePath || "" })
            }
        }
    };
    win.window = win;
    win.self = win;
    win.top = win;

    /** Stand-in for CSInterface.js — the real one needs the CEP runtime. */
    function CSInterface() { }
    CSInterface.prototype.evalScript = evalScript;
    CSInterface.prototype.getExtensionPath = () => opts.extensionPath || "/ext/com.bighappy.launcher";
    CSInterface.prototype.getSystemPath = () => opts.extensionPath || "/ext/com.bighappy.launcher";
    CSInterface.prototype.getHostEnvironment = () => ({
        appName: "AEFT", appVersion: "24.0", apiVersion: "11.0",
        appSkinInfo: { panelBackgroundColor: { color: { red: 50, green: 50, blue: 50 } } }
    });
    CSInterface.prototype.addEventListener = () => { };
    CSInterface.prototype.closeExtension = () => { };
    CSInterface.THEME_COLOR_CHANGED_EVENT = "com.adobe.csxs.events.ThemeColorChanged";

    return { window: win, document, localStorage, CSInterface, hostCalls, Element, TextNode };
}

module.exports = { installDOM, parseHTML, Document, Element, TextNode, queryAll };
