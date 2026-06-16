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
BCF.dialog.TITLE = "Render this cite as a short form, not \"Id.\" " +
    "(the previous citation is hand-typed and invisible to Zotero).";

BCF.dialog.HEREINAFTER_CHECKBOX_ID = "bluebook-citations-fixer-hereinafter";
BCF.dialog.HEREINAFTER_ROW_ID = "bluebook-citations-fixer-hereinafter-row";
BCF.dialog.HEREINAFTER_LABEL = "Use hereinafter";
BCF.dialog.HEREINAFTER_TITLE = "Force hereinafter treatment for this source across the " +
    "whole document, even if the automatic eligibility rules are not met. " +
    "Requires at least two cites to the source.";

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

// Idempotently ensure both rows sit after the Omit Author row and reflect the
// active cite's flag state. Order: Omit Author -> Use hereinafter -> Break id.
BCF.dialog._tryInject = function (doc) {
    try {
        var omitBox = BCF.dialog._findOmitAuthor(doc);
        if (!omitBox) return;

        // "Break id." row (inserts after omitRow).
        var box = doc.getElementById(BCF.dialog.CHECKBOX_ID);
        if (!box) {
            box = BCF.dialog._inject(doc, omitBox);
            if (!box) return;
        }
        var row = doc.getElementById(BCF.dialog.ROW_ID);
        if (row) BCF.dialog._align(row, box, omitBox);

        // "Use hereinafter" row (inserts before "Break id." row so it appears
        // between Omit Author and Break id.).
        var hBox = doc.getElementById(BCF.dialog.HEREINAFTER_CHECKBOX_ID);
        if (!hBox) {
            hBox = BCF.dialog._injectHereinafter(doc, omitBox);
        }
        var hRow = doc.getElementById(BCF.dialog.HEREINAFTER_ROW_ID);
        if (hRow) BCF.dialog._align(hRow, hBox, omitBox);

        // Sync both, but skip whichever is currently focused (just clicked).
        var prefix = doc.getElementById("prefix");
        if (prefix) {
            // Don't fight the user: while a checkbox is the activeElement, the
            // click's own DOM mutation must not revert the check before it shows.
            if (box && box !== doc.activeElement) BCF.dialog._sync(box, prefix);
            if (hBox && hBox !== doc.activeElement) BCF.dialog._syncHereinafter(hBox, prefix);
        }
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
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "6px";
    row.style.marginTop = "6px";
    row.title = BCF.dialog.TITLE;

    var box = doc.createElementNS(XHTML, "input");
    box.setAttribute("type", "checkbox");
    box.id = BCF.dialog.CHECKBOX_ID;

    // Label reads "Break id." with "id." italicized (Bluebook term).
    var label = doc.createElementNS(XHTML, "label");
    label.setAttribute("for", BCF.dialog.CHECKBOX_ID);
    label.style.cursor = "pointer";
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

    BCF.dialog._align(row, box, omitBox);
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
    var ourIds = [BCF.dialog.CHECKBOX_ID, BCF.dialog.HEREINAFTER_CHECKBOX_ID];
    var nodes = doc.querySelectorAll("input[type='checkbox'], checkbox");
    for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (ourIds.indexOf(el.id) !== -1) continue;
        var lbl = (el.getAttribute && el.getAttribute("label")) || el.label || el.textContent || "";
        if (/(omit|suppress)\s+author/i.test(lbl)) return el;
        var p = el.parentNode;
        if (p && /(omit|suppress)\s+author/i.test(p.textContent || "")) return el;
    }
    return null;
};

// Inject the "Use hereinafter" row, positioned before the "Break id." row so
// the visual order is: Omit Author -> Use hereinafter -> Break id.
BCF.dialog._injectHereinafter = function (doc, omitBox) {
    var XHTML = BCF.dialog.XHTML_NS;
    var omitRow = (omitBox.closest && (omitBox.closest("div") || omitBox.closest("tr"))) ||
        omitBox.parentNode;

    var row = doc.createElementNS(XHTML, "div");
    row.id = BCF.dialog.HEREINAFTER_ROW_ID;
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "6px";
    row.style.marginTop = "6px";
    row.title = BCF.dialog.HEREINAFTER_TITLE;

    var box = doc.createElementNS(XHTML, "input");
    box.setAttribute("type", "checkbox");
    box.id = BCF.dialog.HEREINAFTER_CHECKBOX_ID;

    var label = doc.createElementNS(XHTML, "label");
    label.setAttribute("for", BCF.dialog.HEREINAFTER_CHECKBOX_ID);
    label.style.cursor = "pointer";
    label.textContent = BCF.dialog.HEREINAFTER_LABEL;

    box.addEventListener("click", function () { BCF.dialog._toggleHereinafter(doc, box); });
    label.addEventListener("click", function (e) {
        e.preventDefault();
        BCF.dialog._toggleHereinafter(doc, box);
    });

    row.appendChild(box);
    row.appendChild(label);

    // Insert after omitRow but before the "Break id." row (if present).
    var breakRow = doc.getElementById(BCF.dialog.ROW_ID);
    var parent = omitRow && omitRow.parentNode;
    if (parent) {
        if (breakRow && breakRow.parentNode === parent) {
            parent.insertBefore(row, breakRow);
        } else {
            parent.insertBefore(row, omitRow.nextSibling);
        }
    } else if (omitRow) {
        omitRow.appendChild(row);
    } else {
        return null;
    }

    BCF.dialog._align(row, box, omitBox);
    BCF.diag.event("dialog", "use-hereinafter row injected");
    return box;
};

BCF.dialog._toggleHereinafter = function (doc, box) {
    try {
        var p = doc.getElementById("prefix");
        if (!p) { BCF.diag.event("dialog:toggle-hi", "no #prefix"); return; }
        var val = p.value || "";
        var want = !BCF.cite.hasHereinafter(val);
        var newVal = want
            ? (BCF.HEREINAFTER_SENTINEL + BCF.cite.stripHereinafter(val))
            : BCF.cite.stripHereinafter(val);
        BCF.dialog._setReactValue(p, newVal);
        if (box) box.checked = want;
        BCF.diag.event("dialog:toggle-hi",
            "want=" + want + " nowHasHereinafter=" + BCF.cite.hasHereinafter(p.value || ""));
    } catch (e) {
        BCF.diag.err("dialog.toggleHereinafter", e);
    }
};

BCF.dialog._syncHereinafter = function (box, prefixField) {
    try { box.checked = BCF.cite.hasHereinafter(prefixField.value || ""); } catch (_) {}
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

// "Omit Author" is indented because it lives in the Prefix/Suffix grid's input
// column; our row is a sibling outside that grid. Align by translating our row
// to the Omit Author checkbox's left edge. We use `transform` (not margin) so
// the shift is purely visual and doesn't widen the row — a wider row would
// enlarge the content-sized, centered dialog and push every field over. Retries
// across observer passes until layout yields a usable measurement, then locks.
BCF.dialog._align = function (row, box, omitBox) {
    try {
        if (row.getAttribute("data-bcf-aligned") === "1") return;
        var delta = omitBox.getBoundingClientRect().left - box.getBoundingClientRect().left;
        if (Math.abs(delta) > 0.5 && Math.abs(delta) < 800) {
            row.style.transform = "translateX(" + delta + "px)";
            row.setAttribute("data-bcf-aligned", "1");
        }
    } catch (_) {}
};

// Re-derive the checkbox state from the field (the popup is rebuilt per bubble).
BCF.dialog._sync = function (box, prefixField) {
    try { box.checked = BCF.cite.hasNoId(prefixField.value || ""); } catch (_) {}
};
