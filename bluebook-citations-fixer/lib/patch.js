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
BCF.patch._origExecCommand = null;
BCF.patch._origSessionUpdateDocument = null;
BCF.patch._origSessionWriteDelayedCitation = null;
BCF.patch._origSessionInternalUpdateDocument = null;
BCF.patch._instrumentedFieldProtos = new WeakSet();

BCF.patch.install = function () {
    BCF.patch._installExecCommandPatch();
    BCF.patch._installSessionPatches();
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
    BCF.diag.event("patch", "installed on Zotero.Integration.Field.prototype.setText");
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
    if (BCF.patch._origExecCommand) {
        try { Zotero.Integration.execCommand = BCF.patch._origExecCommand; } catch (_) {}
        BCF.patch._origExecCommand = null;
    }
    if (BCF.patch._origSessionUpdateDocument && Zotero.Integration && Zotero.Integration.Session) {
        try { Zotero.Integration.Session.prototype.updateDocument = BCF.patch._origSessionUpdateDocument; } catch (_) {}
        BCF.patch._origSessionUpdateDocument = null;
    }
    if (BCF.patch._origSessionWriteDelayedCitation && Zotero.Integration && Zotero.Integration.Session) {
        try { Zotero.Integration.Session.prototype.writeDelayedCitation = BCF.patch._origSessionWriteDelayedCitation; } catch (_) {}
        BCF.patch._origSessionWriteDelayedCitation = null;
    }
    if (BCF.patch._origSessionInternalUpdateDocument && Zotero.Integration && Zotero.Integration.Session) {
        try { Zotero.Integration.Session.prototype._updateDocument = BCF.patch._origSessionInternalUpdateDocument; } catch (_) {}
        BCF.patch._origSessionInternalUpdateDocument = null;
    }
};

BCF.patch._installExecCommandPatch = function () {
    if (BCF.patch._origExecCommand) return;
    if (!Zotero.Integration || typeof Zotero.Integration.execCommand !== "function") return;
    BCF.patch._origExecCommand = Zotero.Integration.execCommand;
    Zotero.Integration.execCommand = async function (agent, command, docId, templateVersion) {
        BCF.diag.event("execCommand", {
            agent: agent,
            command: command,
            docId: docId || "",
            templateVersion: templateVersion == null ? "" : templateVersion
        });
        try {
            return await BCF.patch._origExecCommand.apply(this, arguments);
        } finally {
            BCF.patch._inspectLiveSession("execCommand:finally");
        }
    };
    BCF.diag.event("patch", "installed on Zotero.Integration.execCommand");
};

BCF.patch._installSessionPatches = function () {
    if (!Zotero.Integration || !Zotero.Integration.Session || !Zotero.Integration.Session.prototype) {
        return;
    }
    var proto = Zotero.Integration.Session.prototype;
    if (!BCF.patch._origSessionUpdateDocument && typeof proto.updateDocument === "function") {
        BCF.patch._origSessionUpdateDocument = proto.updateDocument;
        proto.updateDocument = async function () {
            BCF.diag.event("session.updateDocument", {
                fieldCount: BCF.patch._fieldCount(this),
                outputFormat: this.outputFormat || (this.data && this.data.prefs && this.data.prefs.outputFormat) || ""
            });
            BCF.patch._instrumentSessionFields(this, "updateDocument:before");
            try {
                return await BCF.patch._origSessionUpdateDocument.apply(this, arguments);
            } finally {
                BCF.patch._instrumentSessionFields(this, "updateDocument:after");
            }
        };
        BCF.diag.event("patch", "installed on Session.updateDocument");
    }
    if (!BCF.patch._origSessionWriteDelayedCitation && typeof proto.writeDelayedCitation === "function") {
        BCF.patch._origSessionWriteDelayedCitation = proto.writeDelayedCitation;
        proto.writeDelayedCitation = async function (field, citation) {
            BCF.diag.event("session.writeDelayedCitation", {
                citationID: citation && citation.citationID ? citation.citationID : "",
                hasField: !!field
            });
            BCF.patch._instrumentField(field, "writeDelayedCitation");
            return await BCF.patch._origSessionWriteDelayedCitation.apply(this, arguments);
        };
        BCF.diag.event("patch", "installed on Session.writeDelayedCitation");
    }
    if (!BCF.patch._origSessionInternalUpdateDocument && typeof proto._updateDocument === "function") {
        BCF.patch._origSessionInternalUpdateDocument = proto._updateDocument;
        proto._updateDocument = async function () {
            BCF.patch._prepareCitationTexts(this);
            return await BCF.patch._origSessionInternalUpdateDocument.apply(this, arguments);
        };
        BCF.diag.event("patch", "installed on Session._updateDocument");
    }
};

BCF.patch._fieldCount = function (session) {
    if (!session) return 0;
    if (session._fields && typeof session._fields.length === "number") return session._fields.length;
    if (session.fields && typeof session.fields.length === "number") return session.fields.length;
    return 0;
};

BCF.patch._inspectLiveSession = function (tag) {
    try {
        var session = Zotero.Integration && Zotero.Integration.currentSession;
        if (!session) {
            BCF.diag.event(tag, "no currentSession");
            return;
        }
        BCF.diag.event(tag, {
            fieldCount: BCF.patch._fieldCount(session),
            outputFormat: session.outputFormat || "",
            fieldType: session.data && session.data.prefs ? session.data.prefs.fieldType : ""
        });
        BCF.patch._instrumentSessionFields(session, tag);
    } catch (e) {
        BCF.diag.err(tag, e);
    }
};

BCF.patch._instrumentSessionFields = function (session, tag) {
    if (!session) return;
    var fields = session._fields || session.fields || [];
    if (typeof fields.length !== "number") return;
    for (var i = 0; i < fields.length && i < 5; i++) {
        BCF.patch._instrumentField(fields[i], tag + ":" + i);
    }
};

BCF.patch._instrumentField = function (field, tag) {
    if (!field) return;
    try {
        var proto = Object.getPrototypeOf(field);
        if (!proto) return;
        if (!BCF.patch._instrumentedFieldProtos.has(proto)) {
            BCF.patch._instrumentedFieldProtos.add(proto);
            BCF.diag.event("fieldProto", {
                tag: tag,
                methods: Object.getOwnPropertyNames(proto).filter(function (name) {
                    return typeof proto[name] === "function";
                }).join(",")
            });
        }
        ["setText", "setCode", "getText", "getCode", "delete", "removeCode"].forEach(function (name) {
            if (typeof proto[name] !== "function" || proto["__bcfWrapped_" + name]) return;
            var orig = proto[name];
            proto[name] = function () {
                BCF.diag.event("field." + name, tag);
                return orig.apply(this, arguments);
            };
            proto["__bcfWrapped_" + name] = true;
        });
    } catch (e) {
        BCF.diag.err("instrumentField", e);
    }
};

BCF.patch._prepareCitationTexts = function (session) {
    if (!session || !session.citationsByIndex) return;
    BCF.run.clearSession(session);
    var run = BCF.run.forSession(session);
    if (!run || !run.eligibleKeys || !run.eligibleKeys.size) {
        BCF.diag.event("prepare", "skip empty eligibility map");
        return;
    }

    var citations = BCF.run.citationsInOrder(session);
    var rewrites = 0;
    for (var i = 0; i < citations.length; i++) {
        var citation = citations[i];
        if (!citation || !citation.citationItems || !citation.citationItems.length) continue;
        if (citation.properties && citation.properties.custom) {
            BCF.diag.event("prepare:skip", "custom citation");
            continue;
        }
        var text = citation.text || "";
        if (!text) continue;

        var rewritten = BCF.patch._rewriteCitationText(session, run, citation, text);
        if (typeof rewritten === "string" && rewritten !== text) {
            citation.text = rewritten;
            rewrites++;
            BCF.diag.event("prepare:rewrite", {
                citationID: citation.citationID || "",
                length: rewritten.length
            });
        }
    }
    BCF.diag.event("prepare", {
        citations: citations.length,
        rewrites: rewrites
    });
};

BCF.patch._rewriteCitationText = function (session, run, citation, text) {
    var ctx = {
        session: session,
        citation: citation,
        codeJson: citation,
        run: run,
        text: text,
        rtf: BCF.rtf
    };

    var list = (BCF.features && BCF.features.list) || [];
    for (var i = 0; i < list.length; i++) {
        var feat = list[i];
        if (!feat || typeof feat.rewriteCitation !== "function") continue;
        try {
            var out = feat.rewriteCitation(ctx);
            if (typeof out === "string" && out !== ctx.text) {
                BCF.diag.event("prepare:feature:" + (feat.id || i), "applied");
                ctx.text = out;
            }
        } catch (e) {
            BCF.diag.err("prepare:" + (feat && feat.id), e);
        }
    }
    return ctx.text;
};

// Run the feature chain for a single setText call. Returns the (possibly
// rewritten) RTF string.
BCF.patch.run = async function (field, text) {
    BCF.diag.event("setText", "len=" + (text ? text.length : 0));

    var session = Zotero.Integration.currentSession;
    if (!session) {
        BCF.diag.event("skip", "no currentSession");
        return text;
    }

    if (session.outputFormat && session.outputFormat !== "rtf") {
        BCF.diag.event("skip", "non-RTF output: " + session.outputFormat);
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
        BCF.diag.event("skip", "not a CSL_CITATION field");
        return text;
    }

    var codeJson = BCF.cite.parseFieldCode(code);
    if (!codeJson || !codeJson.citationItems || !codeJson.citationItems.length) {
        BCF.diag.event("skip", "no citationItems in field code");
        return text;
    }

    var run = BCF.run.forSession(session);
    if (!run || !run.eligibleKeys || !run.eligibleKeys.size) {
        BCF.diag.event("skip", "empty eligibility map");
        return text;
    }

    var ctx = {
        session: session,
        field: field,
        codeJson: codeJson,
        run: run,
        text: text,
        rtf: BCF.rtf
    };

    var list = (BCF.features && BCF.features.list) || [];
    for (var i = 0; i < list.length; i++) {
        var feat = list[i];
        try {
            var out = feat.rewrite(ctx);
            if (typeof out === "string" && out !== ctx.text) {
                BCF.diag.event("rewrite:" + (feat && feat.id), "applied");
                ctx.text = out;
            }
        } catch (e) {
            BCF.diag.err("feature:" + (feat && feat.id), e);
        }
    }
    if (ctx.text === text) BCF.diag.event("skip", "no rewrite");
    return ctx.text;
};
