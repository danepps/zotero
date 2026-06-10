"use strict";

// Monkey-patches Zotero.Integration.Field.prototype.setText so every citation
// cluster flowing through the integration bridge is passed through our feature
// chain before being written to the document.
//
// This sits between citeproc and the word-processor-specific implementation,
// so it works in Word (Mac + Win), LibreOffice, and Google Docs equally.
// Hook seam established by the recon report — see CLAUDE.md.

BCF.patch = {};
BCF.patch.PREF_STYLE_ID = "extensions.bluebook-citations-fixer.styleID";
BCF.patch._orig = null;
BCF.patch._retryTimer = null;
BCF.patch._origExecCommand = null;
BCF.patch._origSessionUpdateDocument = null;
BCF.patch._origSessionWriteDelayedCitation = null;
BCF.patch._origSessionInternalUpdateDocument = null;
BCF.patch._instrumentedFieldProtos = new WeakSet();
BCF.patch._wrappedFieldProtos = [];

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
        // A previous plugin instance patched setText and its uninstall never
        // ran (crash, upgrade-in-place). Recover the true original it stashed
        // on the prototype rather than adopting the stale wrapper as ours.
        if (typeof Field.prototype.__bcfOrigSetText === "function") {
            Field.prototype.setText = Field.prototype.__bcfOrigSetText;
            delete Field.prototype.__lcfPatched;
            delete Field.prototype.__bcfOrigSetText;
            BCF.diag.event("patch", "recovered original setText from stale patch");
        } else {
            BCF.patch._orig = Field.prototype.setText;
            return;
        }
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
    Field.prototype.__bcfOrigSetText = BCF.patch._orig;
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
    BCF.patch._uninstrumentFields();
    if (!BCF.patch._orig) return;
    try {
        var Field = Zotero.Integration.Field;
        Field.prototype.setText = BCF.patch._orig;
        delete Field.prototype.__lcfPatched;
        delete Field.prototype.__bcfOrigSetText;
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
            // The cached run context predates this citation (it was built
            // during the last full update); rebuild so eligibility and
            // first-note maps see the document as it now stands.
            try { BCF.run.clearSession(this); } catch (_) {}
            BCF.patch._instrumentField(field, "writeDelayedCitation");
            return await BCF.patch._origSessionWriteDelayedCitation.apply(this, arguments);
        };
        BCF.diag.event("patch", "installed on Session.writeDelayedCitation");
    }
    if (!BCF.patch._origSessionInternalUpdateDocument && typeof proto._updateDocument === "function") {
        BCF.patch._origSessionInternalUpdateDocument = proto._updateDocument;
        proto._updateDocument = async function () {
            // Never let a bug in the prewrite pass break document updates.
            try {
                BCF.patch._prepareCitationTexts(this);
            } catch (e) {
                BCF.diag.err("prepareCitationTexts", e);
            }
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
            proto["__bcfOrig_" + name] = orig;
            if (BCF.patch._wrappedFieldProtos.indexOf(proto) === -1) {
                BCF.patch._wrappedFieldProtos.push(proto);
            }
        });
    } catch (e) {
        BCF.diag.err("instrumentField", e);
    }
};

// Undo every diagnostic wrapper _instrumentField installed, so a disabled or
// upgraded plugin doesn't leave stale closures on the word-processor field
// prototypes.
BCF.patch._uninstrumentFields = function () {
    var protos = BCF.patch._wrappedFieldProtos;
    for (var i = 0; i < protos.length; i++) {
        var proto = protos[i];
        ["setText", "setCode", "getText", "getCode", "delete", "removeCode"].forEach(function (name) {
            try {
                if (proto["__bcfWrapped_" + name] && typeof proto["__bcfOrig_" + name] === "function") {
                    proto[name] = proto["__bcfOrig_" + name];
                }
                delete proto["__bcfWrapped_" + name];
                delete proto["__bcfOrig_" + name];
            } catch (_) {}
        });
    }
    BCF.patch._wrappedFieldProtos = [];
};

// The exact CSL style ID this gate is allowed to rewrite under, read from the
// styleID pref. Empty/whitespace turns the gate off (rewrite under every style).
BCF.patch._configuredStyleID = function () {
    try {
        var v = Zotero.Prefs.get(BCF.patch.PREF_STYLE_ID, true);
        if (v == null) return "";
        return String(v).trim();
    } catch (_) {
        return "";
    }
};

// The styleID of the document's active citation style. Zotero hangs the active
// style off the integration session's document data; fall back through a couple
// of known locations so a Zotero layout change doesn't silently break us.
BCF.patch._sessionStyleID = function (session) {
    if (!session) return "";
    try {
        if (session.data && session.data.style && session.data.style.styleID) {
            return String(session.data.style.styleID);
        }
    } catch (_) {}
    try {
        if (session.styleID) return String(session.styleID);
    } catch (_) {}
    try {
        if (session.style && session.style.styleID) return String(session.style.styleID);
    } catch (_) {}
    return "";
};

// Gate: when a style ID is configured (default = the Epps Bluebook style), only
// rewrite when the document's active style matches it exactly. An empty pref
// disables the gate. If the active style can't be read at all, fail open and
// log — the plugin should never go silently dark if Zotero moves the styleID.
BCF.patch._styleAllowed = function (session) {
    var want = BCF.patch._configuredStyleID();
    if (!want) return true; // gate disabled
    var have = BCF.patch._sessionStyleID(session);
    if (!have) {
        BCF.diag.event("style", "unknown styleID; allowing (configured=" + want + ")");
        return true;
    }
    var ok = (have === want);
    if (!ok) BCF.diag.event("skip", "style mismatch: have=" + have + " want=" + want);
    return ok;
};

// The session's output format ("rtf" or "html"; Zotero sets it from
// app.outputFormat with an "rtf" default). Read ONLY session.outputFormat —
// the exact field the setText gate has always used — and fail open when it's
// unreadable, so a Zotero layout change can't silently turn the plugin off.
BCF.patch._sessionOutputFormat = function (session) {
    if (!session) return "";
    return session.outputFormat ? String(session.outputFormat) : "";
};

BCF.patch._prepareCitationTexts = function (session) {
    if (!session || !session.citationsByIndex) return;
    // RTF only: the feature chain injects RTF fragments, which would land as
    // literal garbage in HTML (Google Docs) or plain-text output.
    var fmt = BCF.patch._sessionOutputFormat(session);
    if (fmt && fmt !== "rtf") {
        BCF.diag.event("prepare:skip", "non-RTF output: " + fmt);
        return;
    }
    if (!BCF.patch._styleAllowed(session)) {
        BCF.diag.event("prepare:skip", "style gate");
        return;
    }
    BCF.run.clearSession(session);
    var run = BCF.run.forSession(session);
    if (!run) return;

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

    if (!BCF.patch._styleAllowed(session)) {
        return text;
    }

    var fmt = BCF.patch._sessionOutputFormat(session);
    if (fmt && fmt !== "rtf") {
        BCF.diag.event("skip", "non-RTF output: " + fmt);
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
    if (!run) {
        BCF.diag.event("skip", "no run context");
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
