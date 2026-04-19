"use strict";

// ===========================================================================
// Legal Citations Fixer
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

var LCF;          // shared namespace populated by each lib file
var Zotero;

function install() {}
function uninstall() {}

async function startup({ rootURI }) {
    Components.classes["@zotero.org/Zotero;1"]
        .getService(Components.interfaces.nsISupports)
        .wrappedJSObject;

    Zotero = Components.classes["@zotero.org/Zotero;1"]
        .getService(Components.interfaces.nsISupports)
        .wrappedJSObject;
    await Zotero.initializationPromise;

    LCF = {
        rootURI: rootURI,
        features: {}
    };

    var loadScope = {
        Zotero: Zotero,
        LCF: LCF,
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
    load("lib/session-run.js");
    load("lib/features/hereinafter.js");
    load("lib/features/registry.js");
    load("lib/patch.js");

    LCF.diag.init();
    LCF.patch.install();

    Zotero.debug("[legal-citations-fixer] startup complete");
}

function shutdown() {
    try { if (LCF && LCF.patch) LCF.patch.uninstall(); } catch (_) {}
    LCF = null;
}
