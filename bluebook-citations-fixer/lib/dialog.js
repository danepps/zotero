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

BCF.dialog.XHTML_NS = "http://www.w3.org/1999/xhtml";
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
        // Don't fight the user: while our checkbox is focused (just clicked),
        // leave its state alone — otherwise an observer pass triggered by the
        // click's own DOM mutation would revert the check before it shows.
        if (box === doc.activeElement) return;
        var prefix = doc.getElementById("prefix");
        if (prefix) BCF.dialog._sync(box, prefix);
    } catch (e) {
        BCF.diag.err("dialog.tryInject", e);
    }
};

// Build the control as a plain native HTML checkbox + label and insert it as
// its own row right after the Omit Author row. We deliberately do NOT copy
// Zotero's checkbox class onto the <input>: that class sets `appearance: none`
// and custom-draws the box for a specific DOM structure, which on a bare input
// just suppresses the native checkbox so it can't render or toggle. A native
// checkbox already matches the OS-styled "Omit Author" box.
BCF.dialog._inject = function (doc, omitBox) {
    var XHTML = BCF.dialog.XHTML_NS;
    var omitRow = (omitBox.closest && (omitBox.closest("div") || omitBox.closest("tr"))) ||
        omitBox.parentNode;

    // Create elements in the XHTML namespace explicitly: in a XUL/XHTML dialog
    // document, doc.createElement("input") can land in the wrong namespace and
    // produce a non-functional checkbox that renders but won't toggle.
    var row = doc.createElementNS(XHTML, "div");
    row.id = BCF.dialog.ROW_ID;
    // Copy the Omit Author row's class (layout only — NOT the checkbox's own
    // appearance class) so our row lines up in the same column above it.
    if (omitRow && omitRow.className) row.className = omitRow.className;
    row.style.marginTop = "6px";
    row.title = BCF.dialog.TITLE;

    var box = doc.createElementNS(XHTML, "input");
    box.setAttribute("type", "checkbox");
    box.id = BCF.dialog.CHECKBOX_ID;

    // Label reads "Break id." with "id." italicized (Bluebook term).
    var label = doc.createElementNS(XHTML, "label");
    label.setAttribute("for", BCF.dialog.CHECKBOX_ID);
    label.style.cursor = "pointer";
    label.style.marginLeft = "6px";
    label.appendChild(doc.createTextNode("Break "));
    var em = doc.createElementNS(XHTML, "i");
    em.textContent = "id.";
    label.appendChild(em);

    // Drive the toggle from a click (deriving the new state from the prefix,
    // not the checkbox's native state) so it works regardless of whether the
    // native checkbox toggle / `change` event behaves in this document.
    var onClick = function () { BCF.dialog._toggle(doc, box); };
    box.addEventListener("click", onClick);
    label.addEventListener("click", function (e) {
        // Prevent the label's implicit toggle from double-firing with our click.
        e.preventDefault();
        BCF.dialog._toggle(doc, box);
    });

    row.appendChild(box);
    row.appendChild(label);

    var parent = omitRow && omitRow.parentNode;
    if (parent) parent.insertBefore(row, omitRow.nextSibling);
    else if (omitRow) omitRow.appendChild(row);
    else return null;

    BCF.diag.event("dialog", "break-id row injected after omit-author");
    return box;
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

// Toggle the flag on the active cite's prefix. The new state is derived from
// the prefix itself (source of truth), so it's correct regardless of whether
// the native checkbox toggle fired. Writes through React's native value setter.
BCF.dialog._toggle = function (doc, box) {
    try {
        var p = doc.getElementById("prefix");
        if (!p) { BCF.diag.event("dialog:toggle", "no #prefix"); return; }
        var val = p.value || "";
        var want = !BCF.cite.hasNoId(val);
        var newVal = want ? (BCF.NOID_SENTINEL + BCF.cite.stripNoId(val))
            : BCF.cite.stripNoId(val);
        BCF.dialog._setReactValue(p, newVal);
        if (box) box.checked = want;
        BCF.diag.event("dialog:toggle",
            "want=" + want + " nowHasNoId=" + BCF.cite.hasNoId(p.value || ""));
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
        if (desc && desc.set) { desc.set.call(el, value); BCF.diag.event("dialog:write", "native-setter"); }
        else { el.value = value; BCF.diag.event("dialog:write", "direct"); }
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
