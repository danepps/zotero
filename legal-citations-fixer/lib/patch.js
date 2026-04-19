"use strict";

// Monkey-patches Zotero.Integration.Field.prototype.setText so every citation
// cluster flowing through the integration bridge is passed through our feature
// chain before being written to the document.
//
// This sits between citeproc and the word-processor-specific implementation,
// so it works in Word (Mac + Win), LibreOffice, and Google Docs equally.
// Hook seam established by the recon report — see CLAUDE.md.

LCF.patch = {};
LCF.patch._orig = null;
LCF.patch._retryTimer = null;

LCF.patch.install = function () {
    if (LCF.patch._orig) return;
    if (!Zotero.Integration || !Zotero.Integration.Field ||
            !Zotero.Integration.Field.prototype ||
            typeof Zotero.Integration.Field.prototype.setText !== "function") {
        // Zotero.Integration is lazily loaded; retry shortly.
        LCF.patch._retryTimer = Components.classes["@mozilla.org/timer;1"]
            .createInstance(Components.interfaces.nsITimer);
        LCF.patch._retryTimer.initWithCallback(
            { notify: function () { LCF.patch.install(); } },
            1000,
            Components.interfaces.nsITimer.TYPE_ONE_SHOT
        );
        return;
    }
    var Field = Zotero.Integration.Field;
    if (Field.prototype.__lcfPatched) {
        LCF.patch._orig = Field.prototype.setText;
        return;
    }
    LCF.patch._orig = Field.prototype.setText;
    Field.prototype.setText = function (text) {
        var field = this;
        var origCall = function (t) { return LCF.patch._orig.call(field, t); };
        // Run our pipeline, then delegate. Always return the original's result
        // so the Integration Field interface contract (isRich) is preserved.
        return Promise.resolve()
            .then(function () { return LCF.patch.run(field, text); })
            .catch(function (e) { LCF.diag.err("patch.run", e); return text; })
            .then(function (rewritten) { return origCall(rewritten); });
    };
    Field.prototype.__lcfPatched = true;
    LCF.diag.log("patch installed on Zotero.Integration.Field.prototype.setText");
};

LCF.patch.uninstall = function () {
    try {
        if (LCF.patch._retryTimer) {
            LCF.patch._retryTimer.cancel();
            LCF.patch._retryTimer = null;
        }
    } catch (_) {}
    if (!LCF.patch._orig) return;
    try {
        var Field = Zotero.Integration.Field;
        Field.prototype.setText = LCF.patch._orig;
        delete Field.prototype.__lcfPatched;
    } catch (_) {}
    LCF.patch._orig = null;
};

// Run the feature chain for a single setText call. Returns the (possibly
// rewritten) RTF string.
LCF.patch.run = async function (field, text) {
    var session = Zotero.Integration.currentSession;
    if (!session) return text;

    // Only touch citation clusters. Bibliography also flows through setText,
    // but it has different semantics and we don't want to rewrite it.
    var code;
    try {
        code = await field.getCode();
    } catch (e) {
        LCF.diag.err("getCode", e);
        return text;
    }
    if (!code || code.indexOf("CSL_CITATION") === -1) return text;

    var codeJson = LCF.cite.parseFieldCode(code);
    if (!codeJson || !codeJson.citationItems || !codeJson.citationItems.length) {
        return text;
    }

    var ctx = {
        session: session,
        field: field,
        codeJson: codeJson,
        run: LCF.run.forSession(session),
        text: text,
        rtf: LCF.rtf
    };

    var list = (LCF.features && LCF.features.list) || [];
    for (var i = 0; i < list.length; i++) {
        var feat = list[i];
        try {
            var out = feat.rewrite(ctx);
            if (typeof out === "string") ctx.text = out;
        } catch (e) {
            LCF.diag.err("feature:" + (feat && feat.id), e);
        }
    }
    return ctx.text;
};
