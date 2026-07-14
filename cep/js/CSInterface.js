/*
    Slim CSInterface — minimal wrapper over the __adobe_cep__ runtime.
    Covers only what this panel uses (evalScript, extension path, OS info).
    Swap in Adobe's full CSInterface.js if more of the CEP API is needed.
*/
(function (global) {
    "use strict";

    function CSInterface() { }

    /** Run ExtendScript in the host and get its string result via callback. */
    CSInterface.prototype.evalScript = function (script, callback) {
        callback = callback || function () { };
        global.__adobe_cep__.evalScript(script, callback);
    };

    /** Absolute path of this extension's folder. */
    CSInterface.prototype.getExtensionPath = function () {
        var p = decodeURI(global.__adobe_cep__.getSystemPath("extension"));
        p = p.replace(/^file:\/\//, "");
        // Windows URIs look like file:///C:/... — drop the leading slash
        if (/^\/[A-Za-z]:/.test(p)) p = p.substring(1);
        return p;
    };

    /** e.g. "Mac OS X 12.6" or "Windows 10 ..." */
    CSInterface.prototype.getOSInformation = function () {
        return global.navigator.platform.indexOf("Win") >= 0 ? "Windows" : "Mac";
    };

    /** Host environment incl. appSkinInfo (panel background color, etc.). */
    CSInterface.prototype.getHostEnvironment = function () {
        return JSON.parse(global.__adobe_cep__.getHostEnvironment());
    };

    /** Subscribe to CEP events (e.g. theme changes). */
    CSInterface.prototype.addEventListener = function (type, listener) {
        global.__adobe_cep__.addEventListener(type, listener);
    };

    CSInterface.THEME_COLOR_CHANGED_EVENT = "com.adobe.csxs.events.ThemeColorChanged";

    global.CSInterface = CSInterface;
})(window);
