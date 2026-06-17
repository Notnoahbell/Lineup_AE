/**
 * CSInterface - Adobe CEP extension bridge
 * Minimal implementation compatible with CEP 7-11 / After Effects CC 2018+
 */

var SystemPath = {
    USER_DATA:        "userData",
    COMMON_FILES:     "commonFiles",
    MY_DOCUMENTS:     "myDocuments",
    APPLICATION:      "application",
    EXTENSION:        "extension",
    HOST_APPLICATION: "hostApplication"
};

var CSInterface = function () {
    this._id = 0;
    this._cbs = {};
    var self = this;

    // Route callbacks from the native layer
    if (window.__adobe_cep__) {
        // CEP 9+ provides a direct function-callback form; CEP 7/8 use string IDs
        // We detect which style is available at call time (see evalScript below).
        try {
            // Register the string-ID callback router in case it's needed
            window.__adobe_cep__.setEvalScriptCallback(function (id, result) {
                var cb = self._cbs[id];
                if (cb) { delete self._cbs[id]; cb(result); }
            });
        } catch (e) {
            // setEvalScriptCallback not present in this CEP version — handled below
        }
    }
};

/**
 * Evaluate an ExtendScript expression in the host application.
 * @param {string}   script   ExtendScript code to execute
 * @param {function} callback Called with the string result when complete
 */
CSInterface.prototype.evalScript = function (script, callback) {
    if (!script) return;
    var native = window.__adobe_cep__;
    if (!native) { if (callback) callback("undefined"); return; }

    // CEP 9+ accepts a JS function directly as the second argument
    try {
        native.evalScript(script, callback || function () {});
        return;
    } catch (e) {
        // Fall through to string-ID approach for older CEP
    }

    // CEP 7/8 string-ID approach
    var id = String(++this._id);
    if (callback) this._cbs[id] = callback;
    native.evalScript(script, id);
};

CSInterface.prototype.getSystemPath = function (pathType) {
    try { return window.__adobe_cep__.getSystemPath(pathType); } catch (e) { return ""; }
};

CSInterface.prototype.getHostEnvironment = function () {
    try { return JSON.parse(window.__adobe_cep__.getHostEnvironment()); } catch (e) { return {}; }
};

CSInterface.prototype.getExtensionID = function () {
    try { return window.__adobe_cep__.getExtensionId(); } catch (e) { return ""; }
};

CSInterface.prototype.closeExtension = function () {
    try { window.__adobe_cep__.closeExtension(); } catch (e) {}
};

CSInterface.prototype.addEventListener = function (type, listener, obj) {
    try { window.__adobe_cep__.addEventListener(type, listener, obj ? JSON.stringify(obj) : null); } catch (e) {}
};

CSInterface.prototype.removeEventListener = function (type, listener, obj) {
    try { window.__adobe_cep__.removeEventListener(type, listener, obj ? JSON.stringify(obj) : null); } catch (e) {}
};

CSInterface.prototype.openURLInDefaultBrowser = function (url) {
    try { window.__adobe_cep__.openURLInDefaultBrowser(url); } catch (e) {}
};

CSInterface.prototype.resizeContent = function (width, height) {
    try { window.__adobe_cep__.resizeContent(width, height); } catch (e) {}
};
