/*
    Test loader: the extension scripts are browser IIFEs that attach to
    `window` and pull Node builtins through window.require (CEP's cep_node).
    Recreate just enough of that environment to load them headlessly.
*/
"use strict";

if (!globalThis.window) globalThis.window = { require: require };

require("../js/calc.js");
require("../js/templates.js");
require("../js/ffmpeg.js");
require("../js/postrender.js");

module.exports = {
    Calc: globalThis.window.BHCalc,
    T: globalThis.window.BHTemplates,
    FF: globalThis.window.BHFFmpeg,
    Post: globalThis.window.BHPost
};
