"use strict";

// ===========================================================================
// Bluebook Citations Fixer
//
// Hooks Zotero.Integration.Field.prototype.setText so every citation cluster
// Zotero is about to write to the document can be rewritten by a chain of
// "features" (Bluebook-style rules). This replaces the old AppleScript
// post-processor; each feature works cross-platform wherever Zotero's
// word-processor bridge runs (Word, LibreOffice, Google Docs).
//
// RTF output only for now (Word + LibreOffice). See lib/rtf.js.
//
// To add a feature: drop a file in lib/features/, load it in startup() below,
// and register it in lib/features/registry.js.
// ===========================================================================

// Note: do NOT declare `var Zotero;` here. Zotero 10's plugin sandbox injects
// `Zotero` as a free variable in the bootstrap scope; a module-level `var`
// would shadow it to undefined, and the legacy
// `Components.classes["@zotero.org/Zotero;1"]` XPCOM contract was removed in
// Zotero 10, so the old fallback no longer works either.
var BCF;          // shared namespace populated by each lib file

function install() {}
function uninstall() {}

// Resolve the Zotero global across Zotero 7 (legacy XPCOM), Zotero 7+ sandbox
// (globalThis.Zotero), and Zotero 10 sandbox (free `Zotero` in bootstrap
// scope). Returns the Zotero object or throws.
function _resolveZotero() {
    // Zotero 10: free variable injected into the bootstrap sandbox scope.
    // `typeof` doesn't throw on undeclared names, so this is safe even if
    // Zotero isn't in scope.
    try {
        if (typeof Zotero !== "undefined" && Zotero) return Zotero;
    } catch (_) {}
    // Zotero 7: sandbox-as-global exposes it on globalThis.
    try {
        if (typeof globalThis.Zotero !== "undefined" && globalThis.Zotero) {
            return globalThis.Zotero;
        }
    } catch (_) {}
    // Pre-7 fallback. Zotero 10 dropped this contract ID; the guard keeps the
    // legacy path available for old Zotero builds that still expose it.
    try {
        if (typeof Components !== "undefined" &&
                Components.classes &&
                Components.classes["@zotero.org/Zotero;1"]) {
            return Components.classes["@zotero.org/Zotero;1"]
                .getService(Components.interfaces.nsISupports)
                .wrappedJSObject;
        }
    } catch (_) {}
    throw new Error("Zotero global is unavailable in the bootstrap scope");
}

// Register the Settings pane (Zotero 7+). Best-effort: if the API is missing or
// throws we just skip it — the prefs still work via about:config and their
// defaults in prefs.js. `src` and `scripts` entries are resolved relative to
// the plugin root by Zotero, so they must NOT be prefixed with rootURI.
// prefs-pane.js renders the style-gate checkbox picker; if it fails to load,
// the pane's raw style-ID input remains visible and functional. register() may
// return the pane id directly or a promise resolving to it; capture it so
// shutdown() can unregister.
function _registerPrefsPane(Zot, rootURI) {
    try {
        if (!Zot.PreferencePanes || typeof Zot.PreferencePanes.register !== "function") {
            return;
        }
        var ret = Zot.PreferencePanes.register({
            pluginID: BCF.id,
            src: "prefs.xhtml",
            scripts: ["prefs-pane.js"],
            label: "BB Citations Fixer"
        });
        if (ret && typeof ret.then === "function") {
            ret.then(function (id) { BCF.prefsPaneID = id; }, function () {});
        } else {
            BCF.prefsPaneID = ret;
        }
    } catch (e) {
        try { if (BCF.diag) BCF.diag.err("registerPrefsPane", e); } catch (_) {}
    }
}

async function startup(data) {
    var rootURI = data.rootURI;
    try {
        var Zot = _resolveZotero();
        await Zot.initializationPromise;

        BCF = {
            rootURI: rootURI,
            id: data.id || "bluebook-citations-fixer@danepps.com",
            version: data.version || "0.1.18",
            features: {},
            startupError: null,
            Zotero: Zot
        };

        var loadScope = {
            Zotero: Zot,
            BCF: BCF,
            Services: Services,
            Components: typeof Components !== "undefined" ? Components : undefined,
            Cc: typeof Components !== "undefined" ? Components.classes : undefined,
            Ci: typeof Components !== "undefined" ? Components.interfaces : undefined
        };

        var load = function (path) {
            Services.scriptloader.loadSubScript(rootURI + path, loadScope);
        };

        load("lib/rtf.js");
        load("lib/cite.js");
        load("lib/diag.js");
        load("lib/dialog.js");
        load("lib/session-run.js");
        load("lib/features/hereinafter.js");
        load("lib/features/journal-volume-year.js");
        load("lib/features/statute-year.js");
        load("lib/features/book-at.js");
        load("lib/features/id-suppress.js");
        load("lib/features/registry.js");
        load("lib/patch.js");

        BCF.diag.init();
        BCF.diag.event("startup", "loaded");
        BCF.patch.install();
        BCF.dialog.install();
        _registerPrefsPane(Zot, rootURI);

        try { Zot.debug("[bluebook-citations-fixer] startup complete"); } catch (_) {}
    } catch (e) {
        try {
            if (BCF) BCF.startupError = String(e);
        } catch (_) {}
        try {
            if (typeof Components !== "undefined" && Components.utils && Components.utils.reportError) {
                Components.utils.reportError(
                    "bluebook-citations-fixer startup error: " + e +
                    (e && e.stack ? "\n" + e.stack : "")
                );
            } else {
                // Best-effort fallback for sandboxes without Components.
                // eslint-disable-next-line no-console
                if (typeof console !== "undefined" && console.error) {
                    console.error(
                        "bluebook-citations-fixer startup error:", e,
                        e && e.stack ? "\n" + e.stack : ""
                    );
                }
            }
        } catch (_) {}
        try {
            Services.prompt.alert(
                null,
                "Bluebook Citations Fixer",
                "Startup error:\n\n" + e + (e && e.stack ? "\n\n" + e.stack : "")
            );
        } catch (_) {}
    }
}

function shutdown() {
    try { if (BCF && BCF.dialog) BCF.dialog.uninstall(); } catch (_) {}
    try { if (BCF && BCF.patch) BCF.patch.uninstall(); } catch (_) {}
    try {
        if (BCF && BCF.prefsPaneID && BCF.Zotero && BCF.Zotero.PreferencePanes &&
                typeof BCF.Zotero.PreferencePanes.unregister === "function") {
            BCF.Zotero.PreferencePanes.unregister(BCF.prefsPaneID);
        }
    } catch (_) {}
    BCF = null;
}
