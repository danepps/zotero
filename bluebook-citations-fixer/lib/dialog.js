"use strict";

// Checkbox injected into Zotero's citation dialog ("Break id."). When ticked,
// it stores BCF.NOID_SENTINEL at the head of the active cite's `prefix` field;
// the id-suppress feature reads that flag downstream and rewrites the wrongly
// rendered "Id." into the correct short form.
//
// Modeled on bluebook-signals/bootstrap.js (same #prefix anchor + native
// `input` dispatch so Zotero's React state records the change). The label is a
// static string — the plugin registers no FTL messages (see locale/), so direct
// DOM insertion with a literal label is simplest.
//
// The item-details panel is reused as the user clicks different bubbles, and
// #prefix is created lazily when a bubble's details open. So rather than inject
// once at load, we listen at the document level and (re-)inject + sync whenever
// #prefix is focused or edited.

BCF.dialog = {};

BCF.dialog.XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
BCF.dialog.CHECKBOX_ID = "bluebook-citations-fixer-break-id";
BCF.dialog.LABEL = "Break id. (previous cite is hand-typed)";
BCF.dialog._watcher = null;

BCF.dialog.install = function () {
    try {
        BCF.dialog._watcher = {
            observe: function (subject, topic) {
                if (topic !== "domwindowopened") return;
                var win = subject;
                win.addEventListener("DOMContentLoaded", function onLoad(event) {
                    win.removeEventListener("DOMContentLoaded", onLoad);
                    var doc = event.target;
                    var root = doc && doc.documentElement;
                    if (root && root.id === "citation-dialog") {
                        BCF.dialog._wire(doc);
                    }
                });
            }
        };
        Services.ww.registerNotification(BCF.dialog._watcher);
        BCF.diag.event("dialog", "watcher installed");
    } catch (e) {
        BCF.diag.err("dialog.install", e);
    }
};

BCF.dialog.uninstall = function () {
    try {
        if (BCF.dialog._watcher) {
            Services.ww.unregisterNotification(BCF.dialog._watcher);
            BCF.dialog._watcher = null;
        }
    } catch (_) {}
};

// Attach document-level listeners that lazily inject the checkbox next to
// #prefix and keep it in sync with the field's contents.
BCF.dialog._wire = function (doc) {
    try {
        var onActivity = function (event) {
            var t = event.target;
            if (t && t.id === "prefix") {
                BCF.dialog._ensureCheckbox(doc, t);
                BCF.dialog._sync(doc, t);
            }
        };
        // `focusin`/`input`/`click` bubble through the document in capture phase.
        doc.addEventListener("focusin", onActivity, true);
        doc.addEventListener("input", onActivity, true);
        doc.addEventListener("click", onActivity, true);
        BCF.diag.event("dialog", "wired citation-dialog");
    } catch (e) {
        BCF.diag.err("dialog.wire", e);
    }
};

BCF.dialog._ensureCheckbox = function (doc, prefixField) {
    if (doc.getElementById(BCF.dialog.CHECKBOX_ID)) return;
    try {
        var cb = doc.createElementNS(BCF.dialog.XUL_NS, "checkbox");
        cb.id = BCF.dialog.CHECKBOX_ID;
        cb.setAttribute("label", BCF.dialog.LABEL);
        cb.style.marginTop = "4px";
        cb.addEventListener("command", function () {
            BCF.dialog._toggle(doc);
        });
        var parent = prefixField.parentNode;
        if (!parent) return;
        parent.insertBefore(cb, prefixField.nextSibling);
        BCF.diag.event("dialog", "checkbox injected");
    } catch (e) {
        BCF.diag.err("dialog.ensureCheckbox", e);
    }
};

// Add/remove the sentinel at the head of the prefix, then dispatch a native
// input event so Zotero records the change.
BCF.dialog._toggle = function (doc) {
    try {
        var p = doc.getElementById("prefix");
        if (!p) return;
        var val = p.value || "";
        if (BCF.cite.hasNoId(val)) {
            val = BCF.cite.stripNoId(val);
        } else {
            val = BCF.NOID_SENTINEL + val;
        }
        p.value = val;
        p.dispatchEvent(new doc.defaultView.Event("input", { bubbles: true }));
        p.focus();
    } catch (e) {
        BCF.diag.err("dialog.toggle", e);
    }
};

// Re-derive the checkbox state from the field (the panel is reused per bubble).
BCF.dialog._sync = function (doc, prefixField) {
    try {
        var cb = doc.getElementById(BCF.dialog.CHECKBOX_ID);
        if (!cb) return;
        var on = BCF.cite.hasNoId(prefixField.value || "");
        if (on) cb.setAttribute("checked", "true");
        else cb.removeAttribute("checked");
        cb.checked = on;
    } catch (_) {}
};
