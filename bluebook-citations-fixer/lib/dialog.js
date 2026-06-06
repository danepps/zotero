"use strict";

// Checkbox injected into Zotero's citation dialog ("Break id."). When ticked,
// it stores BCF.NOID_SENTINEL (an invisible zero-width char) at the head of the
// active cite's `prefix`; the id-suppress feature reads that flag downstream and
// rewrites the wrongly rendered "Id." into the correct short form.
//
// Placement: the per-cite bubble settings popup has a standalone "Omit Author"
// checkbox below the Prefix/Suffix grid. We anchor our checkbox right after it
// (its own row) rather than inside the grid, so the existing fields don't get
// rearranged. A MutationObserver injects it as soon as the popup renders, so the
// user doesn't have to click into the Prefix field first.
//
// The checkbox writes/reads the flag through the popup's #prefix field (and
// dispatches a native `input` event so Zotero's React state records the change,
// the mechanism bluebook-signals proved). The sentinel is zero-width, so it is
// invisible in both the Prefix box and the citation bubble. Static label — the
// plugin registers no FTL messages.

BCF.dialog = {};

BCF.dialog.XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
BCF.dialog.CHECKBOX_ID = "bluebook-citations-fixer-break-id";
BCF.dialog.LABEL = "Break id. (previous cite is hand-typed)";
BCF.dialog._watcher = null;
BCF.dialog._observers = [];

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
    for (var i = 0; i < BCF.dialog._observers.length; i++) {
        try { BCF.dialog._observers[i].disconnect(); } catch (_) {}
    }
    BCF.dialog._observers = [];
};

// Watch the dialog document for the bubble settings popup appearing/redrawing,
// and (re-)inject + sync the checkbox each time. Also re-sync on focus changes.
BCF.dialog._wire = function (doc) {
    try {
        var win = doc.defaultView;
        var MO = win && win.MutationObserver;
        if (MO) {
            var obs = new MO(function () { BCF.dialog._tryInject(doc); });
            obs.observe(doc.documentElement || doc, { childList: true, subtree: true });
            BCF.dialog._observers.push(obs);
        }
        doc.addEventListener("focusin", function () { BCF.dialog._tryInject(doc); }, true);
        BCF.dialog._tryInject(doc);
        BCF.diag.event("dialog", "wired citation-dialog");
    } catch (e) {
        BCF.diag.err("dialog.wire", e);
    }
};

// Idempotently ensure the checkbox sits after the Omit Author control in the
// current popup, and reflect the active cite's flag state.
BCF.dialog._tryInject = function (doc) {
    try {
        var anchor = BCF.dialog._findOmitAuthor(doc);
        if (!anchor) return;
        var existing = doc.getElementById(BCF.dialog.CHECKBOX_ID);
        if (!existing) {
            existing = BCF.dialog._make(doc);
            var parent = anchor.parentNode;
            if (!parent) return;
            parent.insertBefore(existing, anchor.nextSibling);
            BCF.diag.event("dialog", "checkbox injected after omit-author");
        }
        var prefix = doc.getElementById("prefix");
        if (prefix) BCF.dialog._sync(existing, prefix);
    } catch (e) {
        BCF.diag.err("dialog.tryInject", e);
    }
};

BCF.dialog._make = function (doc) {
    var cb = doc.createElementNS(BCF.dialog.XUL_NS, "checkbox");
    cb.id = BCF.dialog.CHECKBOX_ID;
    cb.setAttribute("label", BCF.dialog.LABEL);
    cb.style.display = "block";
    cb.style.marginTop = "4px";
    cb.addEventListener("command", function () { BCF.dialog._toggle(doc); });
    return cb;
};

// Locate the "Omit Author" checkbox: try known ids, then fall back to scanning
// checkboxes for a matching label so we survive Zotero DOM/string changes.
BCF.dialog._findOmitAuthor = function (doc) {
    var byId = doc.getElementById("omit-author") ||
        doc.getElementById("suppress-author") ||
        doc.getElementById("suppressAuthor");
    if (byId) return byId;
    var nodes = doc.querySelectorAll("checkbox, input[type='checkbox']");
    for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var lbl = (el.getAttribute && el.getAttribute("label")) || el.label || el.textContent || "";
        if (/(omit|suppress)\s+author/i.test(lbl)) return el;
        var p = el.parentNode;
        if (p && /(omit|suppress)\s+author/i.test(p.textContent || "")) return el;
    }
    return null;
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
    } catch (e) {
        BCF.diag.err("dialog.toggle", e);
    }
};

// Re-derive the checkbox state from the field (the popup is rebuilt per bubble).
BCF.dialog._sync = function (cb, prefixField) {
    try {
        var on = BCF.cite.hasNoId(prefixField.value || "");
        if (on) cb.setAttribute("checked", "true");
        else cb.removeAttribute("checked");
        cb.checked = on;
    } catch (_) {}
};
