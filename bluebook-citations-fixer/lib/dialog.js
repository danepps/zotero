"use strict";

// Checkbox injected into Zotero's citation dialog ("Break id."). When ticked,
// it stores BCF.NOID_SENTINEL (an invisible zero-width char) at the head of the
// active cite's `prefix`; the id-suppress feature reads that flag downstream and
// rewrites the wrongly rendered "Id." into the correct short form.
//
// The Zotero 7+ citation dialog is HTML/React. So we:
//   * build a real HTML <input type="checkbox"> + <label> (a XUL <checkbox>
//     renders but never fires its `command` event in this document);
//   * copy the "Omit Author" control's CSS classes so it matches visually, and
//     insert it as its OWN row after the Omit Author row (not inside it);
//   * write the prefix through React's native value setter and dispatch a real
//     `input` event, otherwise React ignores a direct `.value` assignment and
//     the flag never reaches the field code.
//
// A MutationObserver (re-)injects + syncs the control as the per-bubble popup is
// rebuilt, so the user never has to focus the Prefix field. The sentinel is
// zero-width, so it stays invisible in the Prefix box and the citation bubble.

BCF.dialog = {};

BCF.dialog.CHECKBOX_ID = "bluebook-citations-fixer-break-id";
BCF.dialog.ROW_ID = "bluebook-citations-fixer-break-id-row";
BCF.dialog.LABEL = "Break id.";
BCF.dialog.TITLE = "Render this cite as a short form, not “Id.” " +
    "(the previous citation is hand-typed and invisible to Zotero).";
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

// Idempotently ensure our row sits after the Omit Author row, styled to match,
// and reflect the active cite's flag state.
BCF.dialog._tryInject = function (doc) {
    try {
        var omitBox = BCF.dialog._findOmitAuthor(doc);
        if (!omitBox) return;
        var box = doc.getElementById(BCF.dialog.CHECKBOX_ID);
        if (!box) {
            box = BCF.dialog._inject(doc, omitBox);
            if (!box) return;
        }
        var prefix = doc.getElementById("prefix");
        if (prefix) BCF.dialog._sync(box, prefix);
    } catch (e) {
        BCF.diag.err("dialog.tryInject", e);
    }
};

// Build the HTML control, copying the Omit Author pieces' classes so it matches,
// and insert it as its own row right after the Omit Author row.
BCF.dialog._inject = function (doc, omitBox) {
    var omitLabel = BCF.dialog._labelFor(doc, omitBox);
    var omitRow = (omitBox.closest && (omitBox.closest("div") || omitBox.closest("tr"))) ||
        omitBox.parentNode;

    var row = doc.createElement("div");
    row.id = BCF.dialog.ROW_ID;
    if (omitRow && omitRow.className) row.className = omitRow.className;
    row.style.marginTop = "6px";

    var box = doc.createElement("input");
    box.type = "checkbox";
    box.id = BCF.dialog.CHECKBOX_ID;
    if (omitBox.className) box.className = omitBox.className;
    box.addEventListener("change", function () { BCF.dialog._toggle(doc, box); });

    var label = doc.createElement("label");
    label.setAttribute("for", BCF.dialog.CHECKBOX_ID);
    label.textContent = BCF.dialog.LABEL;
    if (omitLabel && omitLabel.className) label.className = omitLabel.className;

    row.title = BCF.dialog.TITLE;
    row.appendChild(box);
    row.appendChild(label);

    var parent = omitRow && omitRow.parentNode;
    if (parent) parent.insertBefore(row, omitRow.nextSibling);
    else if (omitRow) omitRow.appendChild(row);
    else return null;

    BCF.diag.event("dialog", "break-id row injected after omit-author");
    return box;
};

// The label paired with the Omit Author checkbox, for class-matching.
BCF.dialog._labelFor = function (doc, omitBox) {
    try {
        if (omitBox.id) {
            var byFor = doc.querySelector('label[for="' + omitBox.id + '"]');
            if (byFor) return byFor;
        }
        if (omitBox.closest) {
            var wrap = omitBox.closest("label");
            if (wrap) return wrap;
        }
        var p = omitBox.parentNode;
        if (p && p.querySelector) return p.querySelector("label");
    } catch (_) {}
    return null;
};

// Locate the "Omit Author" checkbox: known ids first, then scan checkboxes for
// a matching label so we survive Zotero DOM / string changes.
BCF.dialog._findOmitAuthor = function (doc) {
    var byId = doc.getElementById("omit-author") ||
        doc.getElementById("suppress-author") ||
        doc.getElementById("suppressAuthor");
    if (byId) return byId;
    var nodes = doc.querySelectorAll("input[type='checkbox'], checkbox");
    for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (el.id === BCF.dialog.CHECKBOX_ID) continue;
        var lbl = (el.getAttribute && el.getAttribute("label")) || el.label || el.textContent || "";
        if (/(omit|suppress)\s+author/i.test(lbl)) return el;
        var p = el.parentNode;
        if (p && /(omit|suppress)\s+author/i.test(p.textContent || "")) return el;
    }
    return null;
};

// Apply the checkbox's new state to the active cite's prefix, writing through
// React's native value setter so the change is recorded in the field code.
BCF.dialog._toggle = function (doc, box) {
    try {
        var p = doc.getElementById("prefix");
        if (!p) return;
        var val = p.value || "";
        var has = BCF.cite.hasNoId(val);
        var want = !!box.checked;
        if (want && !has) val = BCF.NOID_SENTINEL + val;
        else if (!want && has) val = BCF.cite.stripNoId(val);
        else return;
        BCF.dialog._setReactValue(p, val);
    } catch (e) {
        BCF.diag.err("dialog.toggle", e);
    }
};

// React tracks <input>/<textarea> values via a private setter; assigning
// `.value` directly is ignored. Call the native prototype setter, then dispatch
// a bubbling `input` event so React picks up the new value.
BCF.dialog._setReactValue = function (el, value) {
    try {
        var win = el.ownerDocument.defaultView;
        var proto = (win.HTMLTextAreaElement && el instanceof win.HTMLTextAreaElement)
            ? win.HTMLTextAreaElement.prototype
            : win.HTMLInputElement.prototype;
        var desc = Object.getOwnPropertyDescriptor(proto, "value");
        if (desc && desc.set) desc.set.call(el, value);
        else el.value = value;
        el.dispatchEvent(new win.Event("input", { bubbles: true }));
    } catch (e) {
        try { el.value = value; el.dispatchEvent(new el.ownerDocument.defaultView.Event("input", { bubbles: true })); } catch (_) {}
        BCF.diag.err("dialog.setReactValue", e);
    }
};

// Re-derive the checkbox state from the field (the popup is rebuilt per bubble).
BCF.dialog._sync = function (box, prefixField) {
    try { box.checked = BCF.cite.hasNoId(prefixField.value || ""); } catch (_) {}
};
