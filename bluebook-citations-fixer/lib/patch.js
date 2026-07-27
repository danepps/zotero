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
BCF.patch.PREF_ALL_STYLES = "extensions.bluebook-citations-fixer.allStyles";
BCF.patch._orig = null;
BCF.patch._wrapper = null;
BCF.patch._retryTimer = null;
BCF.patch._origExecCommand = null;
BCF.patch._execWrapper = null;
BCF.patch._origSessionUpdateDocument = null;
BCF.patch._origSessionWriteDelayedCitation = null;
BCF.patch._origSessionInternalUpdateDocument = null;
BCF.patch._sessionWrappers = {};
BCF.patch._instrumentedFieldProtos = new WeakSet();
BCF.patch._wrappedFieldProtos = [];

BCF.patch.install = function () {
    BCF.patch._installExecCommandPatch();
    BCF.patch._installSessionPatches();
    BCF.patch._installFieldPatch();
    // Zotero.Integration loads lazily and its pieces can become available at
    // different moments; retry until EVERY seam is patched, not just setText.
    // (Field appearing while Session was still undefined used to end the
    // retry loop with the prewrite seam never installed.) Unbounded like the
    // original Field retry: Integration may not load until the user's first
    // word-processor command, and a 1s one-shot no-op is free.
    if (BCF.patch._needsInstall()) {
        try {
            if (BCF.patch._retryTimer) {
                BCF.patch._retryTimer.cancel();
                BCF.patch._retryTimer = null;
            }
            BCF.patch._retryTimer = Components.classes["@mozilla.org/timer;1"]
                .createInstance(Components.interfaces.nsITimer);
            BCF.patch._retryTimer.initWithCallback(
                { notify: function () { BCF.patch.install(); } },
                1000,
                Components.interfaces.nsITimer.TYPE_ONE_SHOT
            );
        } catch (_) {}
    }
};

BCF.patch._needsInstall = function () {
    return !BCF.patch._orig ||
        !BCF.patch._origExecCommand ||
        !BCF.patch._origSessionUpdateDocument ||
        !BCF.patch._origSessionWriteDelayedCitation ||
        !BCF.patch._origSessionInternalUpdateDocument;
};

BCF.patch._installFieldPatch = function () {
    if (BCF.patch._orig) return;
    if (!Zotero.Integration || !Zotero.Integration.Field ||
            !Zotero.Integration.Field.prototype ||
            typeof Zotero.Integration.Field.prototype.setText !== "function") {
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
    // Capture everything the wrapper needs NOW. A hot disable/upgrade can
    // null BCF.patch._orig while a write is mid-flight; the wrapper must
    // still be able to complete Zotero's original setText afterward, so it
    // never looks anything up through the global namespace after yielding.
    var orig = BCF.patch._orig;
    var patchMod = BCF.patch;
    var diagMod = BCF.diag;
    var wrapper = function (text) {
        var field = this;
        // Run our pipeline, then delegate. Always return the original's result
        // so the Integration Field interface contract (isRich) is preserved.
        return Promise.resolve()
            .then(function () { return patchMod.run(field, text); })
            .catch(function (e) {
                try { diagMod.err("patch.run", e); } catch (_) {}
                return text;
            })
            .then(function (rewritten) { return orig.call(field, rewritten); });
    };
    BCF.patch._wrapper = wrapper;
    Field.prototype.setText = wrapper;
    Field.prototype.__bcfOrigSetText = orig;
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
    // Identity-checked restoration throughout: restore a method only when the
    // installed function is still OUR wrapper. If another plugin wrapped on
    // top of us, putting our saved original back would silently drop their
    // wrapper; instead leave the chain intact (our wrappers are closure-safe
    // after teardown — they hold their original and modules captured) and log.
    // Restore the setText patch only if it was installed (install() sets _orig
    // last, after the exec/session patches), but DON'T gate the exec/session
    // restores below on _orig: a shutdown during the Field-retry window leaves
    // those installed while _orig is still null.
    if (BCF.patch._orig) {
        try {
            var Field = Zotero.Integration.Field;
            if (Field && Field.prototype) {
                if (Field.prototype.setText === BCF.patch._wrapper) {
                    Field.prototype.setText = BCF.patch._orig;
                    delete Field.prototype.__lcfPatched;
                    delete Field.prototype.__bcfOrigSetText;
                } else {
                    BCF.diag.event("patch", "setText overwrapped by another patch; leaving chain in place");
                }
            }
        } catch (_) {}
        BCF.patch._orig = null;
        BCF.patch._wrapper = null;
    }
    if (BCF.patch._origExecCommand) {
        try {
            if (Zotero.Integration.execCommand === BCF.patch._execWrapper) {
                Zotero.Integration.execCommand = BCF.patch._origExecCommand;
            } else {
                BCF.diag.event("patch", "execCommand overwrapped by another patch; leaving chain in place");
            }
        } catch (_) {}
        BCF.patch._origExecCommand = null;
        BCF.patch._execWrapper = null;
    }
    var sessionRestores = [
        ["updateDocument", "_origSessionUpdateDocument"],
        ["writeDelayedCitation", "_origSessionWriteDelayedCitation"],
        ["_updateDocument", "_origSessionInternalUpdateDocument"]
    ];
    for (var ri = 0; ri < sessionRestores.length; ri++) {
        var name = sessionRestores[ri][0];
        var slot = sessionRestores[ri][1];
        if (BCF.patch[slot] && Zotero.Integration && Zotero.Integration.Session) {
            try {
                var proto = Zotero.Integration.Session.prototype;
                if (proto[name] === BCF.patch._sessionWrappers[name]) {
                    proto[name] = BCF.patch[slot];
                } else {
                    BCF.diag.event("patch", "Session." + name + " overwrapped by another patch; leaving chain in place");
                }
            } catch (_) {}
            BCF.patch[slot] = null;
            delete BCF.patch._sessionWrappers[name];
        }
    }
};

BCF.patch._installExecCommandPatch = function () {
    if (BCF.patch._origExecCommand) return;
    if (!Zotero.Integration || typeof Zotero.Integration.execCommand !== "function") return;
    var orig = Zotero.Integration.execCommand;
    var patchMod = BCF.patch;
    var diagMod = BCF.diag;
    BCF.patch._origExecCommand = orig;
    var wrapper = async function (agent, command, docId, templateVersion) {
        try {
            diagMod.event("execCommand", {
                agent: agent,
                command: command,
                docId: docId || "",
                templateVersion: templateVersion == null ? "" : templateVersion
            });
        } catch (_) {}
        try {
            return await orig.apply(this, arguments);
        } finally {
            // Diagnostics only — a failure here (or a mid-command teardown)
            // must never mask the command's own result.
            try { patchMod._inspectLiveSession("execCommand:finally"); } catch (_) {}
        }
    };
    BCF.patch._execWrapper = wrapper;
    Zotero.Integration.execCommand = wrapper;
    BCF.diag.event("patch", "installed on Zotero.Integration.execCommand");
};

BCF.patch._installSessionPatches = function () {
    if (!Zotero.Integration || !Zotero.Integration.Session || !Zotero.Integration.Session.prototype) {
        return;
    }
    var proto = Zotero.Integration.Session.prototype;
    // Each wrapper captures its original plus the modules it needs, so a hot
    // disable/upgrade mid-command can never leave it dereferencing torn-down
    // globals after an await.
    var patchMod = BCF.patch;
    var diagMod = BCF.diag;
    var runMod = BCF.run;
    if (!BCF.patch._origSessionUpdateDocument && typeof proto.updateDocument === "function") {
        var origUpdate = proto.updateDocument;
        BCF.patch._origSessionUpdateDocument = origUpdate;
        var updateWrapper = async function () {
            try {
                diagMod.event("session.updateDocument", {
                    fieldCount: patchMod._fieldCount(this),
                    outputFormat: this.outputFormat || (this.data && this.data.prefs && this.data.prefs.outputFormat) || ""
                });
                patchMod._instrumentSessionFields(this, "updateDocument:before");
            } catch (_) {}
            try {
                return await origUpdate.apply(this, arguments);
            } finally {
                // Diagnostics only — never mask the command's own result.
                try { patchMod._instrumentSessionFields(this, "updateDocument:after"); } catch (_) {}
            }
        };
        BCF.patch._sessionWrappers.updateDocument = updateWrapper;
        proto.updateDocument = updateWrapper;
        BCF.diag.event("patch", "installed on Session.updateDocument");
    }
    if (!BCF.patch._origSessionWriteDelayedCitation && typeof proto.writeDelayedCitation === "function") {
        var origDelayed = proto.writeDelayedCitation;
        BCF.patch._origSessionWriteDelayedCitation = origDelayed;
        var delayedWrapper = async function (field, citation) {
            try {
                diagMod.event("session.writeDelayedCitation", {
                    citationID: citation && citation.citationID ? citation.citationID : "",
                    hasField: !!field
                });
                // The cached run context predates this citation (it was built
                // during the last full update); rebuild so eligibility and
                // first-note maps see the document as it now stands.
                runMod.clearSession(this);
                patchMod._instrumentField(field, "writeDelayedCitation");
            } catch (_) {}
            return await origDelayed.apply(this, arguments);
        };
        BCF.patch._sessionWrappers.writeDelayedCitation = delayedWrapper;
        proto.writeDelayedCitation = delayedWrapper;
        BCF.diag.event("patch", "installed on Session.writeDelayedCitation");
    }
    if (!BCF.patch._origSessionInternalUpdateDocument && typeof proto._updateDocument === "function") {
        var origInternal = proto._updateDocument;
        BCF.patch._origSessionInternalUpdateDocument = origInternal;
        var internalWrapper = async function () {
            // Never let a bug in the prewrite pass break document updates —
            // and if the pass failed, leave the per-field setText path armed
            // so each field still gets its independent fallback rewrite.
            var prewriteOk = false;
            try {
                prewriteOk = patchMod._prepareCitationTexts(this) === true;
            } catch (e) {
                try { diagMod.err("prepareCitationTexts", e); } catch (_) {}
            }
            // While the original _updateDocument fans the (already rewritten)
            // cluster texts out to field writes, the setText hook would re-run
            // the whole chain — including a getCode() round trip to the word
            // processor per field. Flag the session so patch.run can skip —
            // but only when the prewrite pass actually handled this update.
            if (prewriteOk) {
                try { this.__bcfPrewriteActive = true; } catch (_) {}
            }
            try {
                return await origInternal.apply(this, arguments);
            } finally {
                try { this.__bcfPrewriteActive = false; } catch (_) {}
            }
        };
        BCF.patch._sessionWrappers._updateDocument = internalWrapper;
        proto._updateDocument = internalWrapper;
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
    // Diagnostics-only wrappers: keep the raw word-processor field prototypes
    // clean unless the diag pref is actually on.
    if (!BCF.diag.enabled) return;
    if (!session) return;
    var fields = session._fields || session.fields || [];
    if (typeof fields.length !== "number") return;
    for (var i = 0; i < fields.length && i < 5; i++) {
        BCF.patch._instrumentField(fields[i], tag + ":" + i);
    }
};

BCF.patch._instrumentField = function (field, tag) {
    if (!BCF.diag.enabled) return;
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

// Hard-wired style IDs: the Epps Bluebook style and its experimental variant.
// These are the styles the rules are written against, so the gate ALWAYS
// allows them — no configuration involved, nothing to drift out of sync when
// a document switches between the two.
BCF.patch.BUILTIN_STYLE_IDS = [
    "https://danepps.github.io/bluebook/BluebookDSEStyle.csl",
    "https://danepps.github.io/bluebook/BluebookDSEStyle-Experimental.csl"
];

// Extra CSL style IDs the fixer should ALSO run under (beyond the built-ins),
// read from the styleID pref. The pref may hold several IDs separated by
// whitespace, commas, or semicolons (style IDs are URLs, so none of those
// appear inside an ID). "(none)" is a legacy sentinel from an older Settings
// pane; filter it so it can't show up as a junk entry.
BCF.patch._configuredStyleIDs = function () {
    try {
        var v = Zotero.Prefs.get(BCF.patch.PREF_STYLE_ID, true);
        if (v == null) return [];
        return String(v).split(/[\s,;]+/).filter(function (s) {
            return !!s && s !== "(none)";
        });
    } catch (_) {
        return [];
    }
};

// "Apply under all citation styles": disables the gate entirely.
BCF.patch._allStylesEnabled = function () {
    try {
        return !!Zotero.Prefs.get(BCF.patch.PREF_ALL_STYLES, true);
    } catch (_) {
        return false;
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

// Gate: rewrite under the hard-wired Epps Bluebook styles, plus any extra
// style IDs from the pref (exact match), plus everything when "apply under
// all styles" is on. If the active style can't be read at all, fail open and
// log — the plugin should never go silently dark if Zotero moves the styleID.
BCF.patch._styleAllowed = function (session) {
    if (BCF.patch._allStylesEnabled()) return true;
    var want = BCF.patch.BUILTIN_STYLE_IDS.concat(BCF.patch._configuredStyleIDs());
    var have = BCF.patch._sessionStyleID(session);
    if (!have) {
        BCF.diag.event("style", "unknown styleID; allowing (configured=" + want.join(" ") + ")");
        return true;
    }
    var ok = want.indexOf(have) !== -1;
    if (!ok) BCF.diag.event("skip", "style mismatch: have=" + have + " want=" + want.join(" "));
    return ok;
};

// The session's output format ("rtf" or "html"; Zotero sets it from
// app.outputFormat with an "rtf" default). Read ONLY session.outputFormat —
// the exact field the setText gate has always used. Unreadable/unknown now
// fails CLOSED: the chain emits RTF fragments, and injecting them into an
// unidentified format would corrupt the document, which is worse than the
// plugin going dark. The gates log the skip loudly instead.
BCF.patch._sessionOutputFormat = function (session) {
    if (!session) return "";
    return session.outputFormat ? String(session.outputFormat) : "";
};

// The session of an ACTIVE word-processor command. Zotero sets currentSession
// when a command begins but does NOT clear it at command end — the cleanup
// clears only currentDoc and currentWindow (zotero/zotero integration.js) —
// so a truthy currentSession alone can be stale document state. Gate on
// currentDoc for "a command is executing right now".
BCF.patch._activeSession = function () {
    try {
        if (!Zotero.Integration || !Zotero.Integration.currentDoc) return null;
        return Zotero.Integration.currentSession || null;
    } catch (_) {
        return null;
    }
};

// Returns true only when the prewrite pass actually ran the chain over this
// update's citations; false on every skip. The _updateDocument wrapper arms
// the setText short-circuit flag only on true, so a skipped or failed pass
// leaves each field its independent per-field rewrite.
BCF.patch._prepareCitationTexts = function (session) {
    if (!session || !session.citationsByIndex) return false;
    // RTF only: the feature chain injects RTF fragments, which would land as
    // literal garbage in HTML (Google Docs) or plain-text output. Unknown or
    // missing formats fail closed for the same reason.
    var fmt = BCF.patch._sessionOutputFormat(session);
    if (fmt !== "rtf") {
        BCF.diag.event("prepare:skip", "output format not rtf: '" + fmt + "'");
        return false;
    }
    if (!BCF.patch._styleAllowed(session)) {
        BCF.diag.event("prepare:skip", "style gate");
        return false;
    }
    BCF.run.clearSession(session);
    var run = BCF.run.forSession(session);
    if (!run) return false;

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
    return true;
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

    var session = BCF.patch._activeSession();
    if (!session) {
        BCF.diag.event("skip", "no active session (currentDoc unset or no currentSession)");
        return text;
    }

    // The _updateDocument prewrite pass already ran the chain on every
    // cluster this update will write; re-running it here would only burn a
    // getCode() round trip per field. Delayed citations and any other write
    // outside _updateDocument still take the full path below.
    if (session.__bcfPrewriteActive) {
        BCF.diag.event("skip", "prewrite pass handled this update");
        return text;
    }

    if (!BCF.patch._styleAllowed(session)) {
        return text;
    }

    var fmt = BCF.patch._sessionOutputFormat(session);
    if (fmt !== "rtf") {
        BCF.diag.event("skip", "output format not rtf: '" + fmt + "'");
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
