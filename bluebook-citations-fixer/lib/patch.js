"use strict";

// Monkey-patches Zotero.Integration.Field.prototype.setText so every citation
// cluster flowing through the integration bridge is passed through our feature
// chain before being written to the document.
//
// This sits between citeproc and the word-processor-specific implementation,
// so it works in Word (Mac + Win), LibreOffice, and Google Docs equally.
// Hook seam established by the recon report — see CLAUDE.md.

BCF.patch = {};
BCF.patch._orig = null;
BCF.patch._retryTimer = null;

BCF.patch.install = function () {
    if (BCF.patch._orig) return;
    if (!Zotero.Integration || !Zotero.Integration.Field ||
            !Zotero.Integration.Field.prototype ||
            typeof Zotero.Integration.Field.prototype.setText !== "function") {
        // Zotero.Integration is lazily loaded; retry shortly.
        BCF.patch._retryTimer = Components.classes["@mozilla.org/timer;1"]
            .createInstance(Components.interfaces.nsITimer);
        BCF.patch._retryTimer.initWithCallback(
            { notify: function () { BCF.patch.install(); } },
            1000,
            Components.interfaces.nsITimer.TYPE_ONE_SHOT
        );
        return;
    }
    var Field = Zotero.Integration.Field;
    if (Field.prototype.__lcfPatched) {
        BCF.patch._orig = Field.prototype.setText;
        return;
    }
    BCF.patch._orig = Field.prototype.setText;
    Field.prototype.setText = function (text) {
        var field = this;
        var origCall = function (t) { return BCF.patch._orig.call(field, t); };
        // Run our pipeline, then delegate. Always return the original's result
        // so the Integration Field interface contract (isRich) is preserved.
        return Promise.resolve()
            .then(function () { return BCF.patch.run(field, text); })
            .catch(function (e) { BCF.diag.err("patch.run", e); return text; })
            .then(function (rewritten) { return origCall(rewritten); });
    };
    Field.prototype.__lcfPatched = true;
    BCF.diag.log("patch installed on Zotero.Integration.Field.prototype.setText");
    try { BCF.ui.record("patch", "installed"); } catch (_) {}
};

BCF.patch.uninstall = function () {
    try {
        if (BCF.patch._retryTimer) {
            BCF.patch._retryTimer.cancel();
            BCF.patch._retryTimer = null;
        }
    } catch (_) {}
    if (!BCF.patch._orig) return;
    try {
        var Field = Zotero.Integration.Field;
        Field.prototype.setText = BCF.patch._orig;
        delete Field.prototype.__lcfPatched;
    } catch (_) {}
    BCF.patch._orig = null;
};

// Run the feature chain for a single setText call. Returns the (possibly
// rewritten) RTF string.
BCF.patch.run = async function (field, text) {
    try { BCF.ui.record("setText", "len=" + (text ? text.length : 0)); } catch (_) {}

    var session = Zotero.Integration.currentSession;
    if (!session) {
        try { BCF.ui.record("skip", "no currentSession"); } catch (_) {}
        return text;
    }

    // Only touch citation clusters. Bibliography also flows through setText,
    // but it has different semantics and we don't want to rewrite it.
    var code;
    try {
        code = await field.getCode();
    } catch (e) {
        BCF.diag.err("getCode", e);
        return text;
    }
    if (!code || code.indexOf("CSL_CITATION") === -1) {
        try { BCF.ui.record("skip", "not a citation cluster"); } catch (_) {}
        return text;
    }

    var codeJson = BCF.cite.parseFieldCode(code);
    if (!codeJson || !codeJson.citationItems || !codeJson.citationItems.length) {
        try { BCF.ui.record("skip", "no citationItems"); } catch (_) {}
        return text;
    }

    var ctx = {
        session: session,
        field: field,
        codeJson: codeJson,
        run: BCF.run.forSession(session),
        text: text,
        rtf: BCF.rtf
    };

    var list = (BCF.features && BCF.features.list) || [];
    for (var i = 0; i < list.length; i++) {
        var feat = list[i];
        try {
            var out = feat.rewrite(ctx);
            if (typeof out === "string" && out !== ctx.text) {
                try { BCF.ui.record("rewrite:" + feat.id, "applied"); } catch (_) {}
                ctx.text = out;
            }
        } catch (e) {
            BCF.diag.err("feature:" + (feat && feat.id), e);
        }
    }
    return ctx.text;
};
