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

var BCF;          // shared namespace populated by each lib file
var Zotero;

function install() {}
function uninstall() {}

async function startup(data) {
    var rootURI = data.rootURI;
    try {
        var bootZotero = null;
        if (typeof globalThis.Zotero !== "undefined" && globalThis.Zotero) {
            bootZotero = globalThis.Zotero;
        } else if (Components.classes["@zotero.org/Zotero;1"]) {
            bootZotero = Components.classes["@zotero.org/Zotero;1"]
                .getService(Components.interfaces.nsISupports)
                .wrappedJSObject;
        } else {
            throw new Error("Zotero bootstrap global is unavailable");
        }
        Zotero = bootZotero;
        await Zotero.initializationPromise;

        BCF = {
            rootURI: rootURI,
            id: data.id || "bluebook-citations-fixer@danepps.com",
            version: data.version || "0.1.5",
            features: {},
            startupError: null
        };

        var loadScope = {
            Zotero: Zotero,
            BCF: BCF,
            Services: Services,
            Components: Components,
            Cc: Components.classes,
            Ci: Components.interfaces
        };

        var load = function (path) {
            Services.scriptloader.loadSubScript(rootURI + path, loadScope);
        };

        load("lib/rtf.js");
        load("lib/cite.js");
        load("lib/diag.js");
        load("lib/ui.js");
        load("lib/session-run.js");
        load("lib/features/hereinafter.js");
        load("lib/features/journal-volume-year.js");
        load("lib/features/book-at.js");
        load("lib/features/registry.js");
        load("lib/patch.js");

        BCF.diag.init();
        BCF.ui.install();
        BCF.diag.event("startup", "loaded");
        BCF.patch.install();

        Zotero.debug("[bluebook-citations-fixer] startup complete");
    } catch (e) {
        try {
            if (BCF) BCF.startupError = String(e);
            Components.utils.reportError(
                "bluebook-citations-fixer startup error: " + e +
                (e && e.stack ? "\n" + e.stack : "")
            );
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
    try { if (BCF && BCF.ui) BCF.ui.uninstall(); } catch (_) {}
    try { if (BCF && BCF.patch) BCF.patch.uninstall(); } catch (_) {}
    BCF = null;
}
