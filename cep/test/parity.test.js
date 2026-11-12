/*
    Parity between the two tools.

    The CEP panel's naming and render-format rules are hand-ported from
    BigHappyLauncher_Templates.jsx, and both write into the same project
    folders. Nothing kept the two copies in step: three of the bugs fixed in
    0.4.7–0.4.8 were one side quietly disagreeing with the other.

    This lifts the ScriptUI functions straight out of the .jsx source (they
    are plain top-level functions inside its closure) and runs them against
    the panel's versions on one shared set of inputs. A deliberate difference
    belongs in KNOWN_DIFFERENCES below, with the reason.
*/
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { T } = require("./_load.js");
const { buildAE, loadHost, unwrap } = require("./_aemock.js");

// Normalised to LF: a Windows checkout hands this file over with CRLF line
// endings, and the lookups below anchor on "\n" + indentation.
const SCRIPT = fs.readFileSync(
    path.join(__dirname, "..", "..", "BigHappyLauncher_Templates.jsx"), "utf8").replace(/\r\n/g, "\n");

/** Source of a 4-space-indented `function name(...) { … }` in the script. */
function scriptFunction(name) {
    const start = SCRIPT.indexOf("\n    function " + name + "(");
    assert.ok(start !== -1, "ScriptUI no longer defines " + name + "() at the top level");
    const end = SCRIPT.indexOf("\n    }\n", start);
    assert.ok(end !== -1, "could not find the end of " + name + "()");
    return SCRIPT.slice(start, end + 6);
}

/** CONFIG.RENDER_FORMATS as written in the script. */
function scriptRenderFormats() {
    const m = /RENDER_FORMATS:\s*(\{[\s\S]*?\n {8}\})/.exec(SCRIPT);
    assert.ok(m, "could not find CONFIG.RENDER_FORMATS in the script");
    return vm.runInNewContext("(" + m[1] + ")");
}

const NAMES = ["sanitizeName", "getTemplateType", "getTemplateFolderName",
               "isDOOHTemplate", "buildProjectFolderName", "parseProjectName"];
const S = vm.runInNewContext(
    NAMES.map(scriptFunction).join("\n") + "\n({" + NAMES.join(",") + "})");

const SIZES = [[750, 300], [880, 1912], [750, 1334], [1920, 1080], [1080, 1920], [300, 250], [1, 1]];

const PROJECT_NAMES = [
    "Nike_AirMax_Q3_750x300_V1_R1",
    "CocaCola_Summer_Vibes_Q1_300x250_V2_R5",
    "TechCorp_Q4_1920x1080_V1_R15",
    "DOOH_Generic_1920x1080_V1_R1",
    "DOOH_1920x1080_V1_R1",
    "dooh_Lower_Case_1080x1920_V3_R2",
    "Doohickey_Launch_Q2_750x300_V1_R1",
    "SimpleBrand_300x600_V1_R1",
    "NoVersion_Q1_750x1334_R4",
    "Brand_750x300",
    "not a project name",
    ""
];

const RAW_NAMES = ["  Nike  Air Max ", 'a<b>c:d"e/f\\g|h?i*j', "CON", "com1", "a__b   c", "", "Ünïcode Brand"];

for (const fn of ["getTemplateType", "getTemplateFolderName"]) {
    test("parity: " + fn, () => {
        for (const [w, h] of SIZES) {
            assert.strictEqual(T[fn](w, h), S[fn](w, h), fn + "(" + w + ", " + h + ")");
        }
    });
}

test("parity: sanitizeName", () => {
    for (const raw of RAW_NAMES) {
        assert.strictEqual(T.sanitizeName(raw), S.sanitizeName(raw), JSON.stringify(raw));
    }
});

test("parity: isDOOHTemplate and buildProjectFolderName", () => {
    for (const n of ["DOOH Horizontal", "dooh vertical", "Sunrise", "Expandable"]) {
        assert.strictEqual(T.isDOOHTemplate(n), S.isDOOHTemplate(n), n);
    }
    for (const [b, c] of [["Nike", "AirMax"], ["Nike", ""], ["Nike", undefined]]) {
        assert.strictEqual(T.buildProjectFolderName(b, c), S.buildProjectFolderName(b, c));
    }
});

test("parity: parseProjectName", () => {
    const FIELDS = ["brand", "campaign", "quarter", "size", "version", "revision"];
    for (const name of PROJECT_NAMES) {
        const panel = T.parseProjectName(name);
        const script = S.parseProjectName(name);
        assert.strictEqual(panel === null, script === null, "parses or not: " + JSON.stringify(name));
        if (!panel) continue;
        for (const f of FIELDS) {
            assert.strictEqual(panel[f], script[f], JSON.stringify(name) + " ." + f);
        }
        // the script sets isDOOH:false explicitly, the panel leaves it unset
        assert.strictEqual(!!panel.isDOOH, !!script.isDOOH, JSON.stringify(name) + " .isDOOH");
    }
});

test("parity: every template type renders in the format the script uses", () => {
    const formats = scriptRenderFormats();
    for (const type of Object.keys(formats)) {
        const ae = buildAE({ items: [{ kind: "comp", name: "Main" }] });
        unwrap(loadHost(ae).addMainToRenderQueue("/out/render", type));
        const applied = ae.log.filter((l) => l.op === "applyTemplate")[0].name;
        const panelIsPng = /PNG/.test(applied);
        assert.strictEqual(panelIsPng, formats[type].format === "png_sequence",
            type + ": script says " + formats[type].format + ", panel applied " + applied);
    }
});
