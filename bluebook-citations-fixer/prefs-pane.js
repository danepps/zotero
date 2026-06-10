"use strict";

// Style-gate picker for the Bluebook Citations Fixer settings pane.
//
// Progressive enhancement over the raw style-ID input (#bcf-style-manual):
// when this script runs successfully it hides the manual row and renders
//   [ ] Apply under all citation styles
//   [x] Bluebook Style — Epps Version            (always on, disabled)
//   [x] Bluebook Style — Epps Version (Experimental)  (always on, disabled)
//   [ ] Bluebook Law Review                      (pinned, even if not installed)
//   [ ] ...one checkbox per other installed CSL style...
// If anything here fails, the manual row stays visible and fully
// functional — the prefs are the source of truth and this UI is just a
// nicer way to edit them.
//
// Pane-script environment notes (Zotero 7 preferences.js):
//   * Scripts are loaded into a Cu.Sandbox with sandboxPrototype = the prefs
//     window, BEFORE the pane's XHTML fragment is inserted into the DOM. So
//     never touch elements at top level — wait for the `load` event Zotero
//     fires on the pane content after insertion (capture listener on the
//     document catches it; it doesn't bubble).
//   * Never call bare `setTimeout(...)`: it resolves to window.setTimeout but
//     gets the sandbox as `this` and throws. Use `window.setTimeout(...)`.
//   * Report failures via Zotero.logError so they reach the Error Console.
//
// Pref model (see lib/patch.js):
//   allStyles (bool)  -> gate off, rewrite under every style
//   styleID (string)  -> EXTRA style IDs beyond the hard-wired built-ins,
//                        separated by whitespace/commas/semicolons
(function () {
    var PREF_EXTRAS = "extensions.bluebook-citations-fixer.styleID";
    var PREF_ALL = "extensions.bluebook-citations-fixer.allStyles";
    // Legacy sentinel from an older pane; never write it, always drop it.
    var SENTINEL = "(none)";
    // Hard-wired in BCF.patch.BUILTIN_STYLE_IDS; shown here as always-on rows.
    var BUILTINS = [
        { id: "https://danepps.github.io/bluebook/BluebookDSEStyle.csl",
          title: "Bluebook Style — Epps Version" },
        { id: "https://danepps.github.io/bluebook/BluebookDSEStyle-Experimental.csl",
          title: "Bluebook Style — Epps Version (Experimental)" }
    ];
    // First-class optional styles, listed even when not installed.
    var PINNED = [
        { id: "http://www.zotero.org/styles/bluebook-law-review",
          title: "Bluebook Law Review" }
    ];

    function report(e) {
        try { Zotero.logError(e); } catch (_) {}
        try { Zotero.debug("bluebook-citations-fixer prefs pane: " + e); } catch (_) {}
    }

    function builtinIDs() {
        return BUILTINS.map(function (b) { return b.id; });
    }

    function parseExtras() {
        var v = "";
        try { v = Zotero.Prefs.get(PREF_EXTRAS, true) || ""; } catch (_) {}
        var builtin = builtinIDs();
        return String(v).split(/[\s,;]+/).filter(function (s) {
            return !!s && s !== SENTINEL && builtin.indexOf(s) === -1;
        });
    }

    function readAll() {
        try { return !!Zotero.Prefs.get(PREF_ALL, true); } catch (_) { return false; }
    }

    async function init() {
        var allBox = document.getElementById("bcf-style-all");
        var listBox = document.getElementById("bcf-style-list");
        var manual = document.getElementById("bcf-style-manual");
        if (!allBox || !listBox || !manual) return false;
        if (listBox.getAttribute("data-bcf-built") === "1") return true;

        await Zotero.Styles.init();
        var all = Zotero.Styles.getAll();
        if (!Array.isArray(all)) all = Object.values(all || {});
        var titleByID = {};
        var installed = [];
        all.forEach(function (s) {
            var id = s.styleID || s.url || "";
            if (!id) return;
            titleByID[id] = s.title || id;
            installed.push(id);
        });

        var extras = parseExtras();

        // Row order: built-ins (always on), pinned styles, other installed
        // styles (by title), then any configured-but-unknown extras so a
        // sync/profile mismatch can't silently drop them.
        var pinnedIDs = PINNED.map(function (p) { return p.id; });
        var rows = [];
        BUILTINS.forEach(function (b) {
            rows.push({ id: b.id, title: titleByID[b.id] || b.title, builtin: true });
        });
        PINNED.forEach(function (p) {
            rows.push({ id: p.id, title: titleByID[p.id] || p.title });
        });
        installed
            .filter(function (id) {
                return builtinIDs().indexOf(id) === -1 && pinnedIDs.indexOf(id) === -1;
            })
            .sort(function (a, b) { return titleByID[a].localeCompare(titleByID[b]); })
            .forEach(function (id) { rows.push({ id: id, title: titleByID[id] }); });
        extras.forEach(function (id) {
            if (installed.indexOf(id) === -1 && pinnedIDs.indexOf(id) === -1) {
                rows.push({ id: id, title: id + " — not installed" });
            }
        });

        var boxes = [];
        function commit() {
            var ids = [];
            boxes.forEach(function (b) {
                if (b.getAttribute("data-bcf-builtin") !== "1" && b.checked) {
                    ids.push(b.getAttribute("data-bcf-style-id"));
                }
            });
            try { Zotero.Prefs.set(PREF_EXTRAS, ids.join(" "), true); } catch (e) { report(e); }
        }
        function syncDisabled() {
            boxes.forEach(function (b) {
                b.disabled = b.getAttribute("data-bcf-builtin") === "1" || allBox.checked;
            });
        }

        rows.forEach(function (row) {
            var cb = document.createXULElement("checkbox");
            cb.setAttribute("label", row.title + (row.builtin ? " — always on" : ""));
            cb.setAttribute("tooltiptext", row.id);
            cb.setAttribute("data-bcf-style-id", row.id);
            if (row.builtin) cb.setAttribute("data-bcf-builtin", "1");
            cb.checked = !!row.builtin || extras.indexOf(row.id) !== -1;
            if (!row.builtin) cb.addEventListener("command", commit);
            listBox.appendChild(cb);
            boxes.push(cb);
        });
        listBox.setAttribute("data-bcf-built", "1");

        allBox.checked = readAll();
        allBox.addEventListener("command", function () {
            try { Zotero.Prefs.set(PREF_ALL, !!allBox.checked, true); } catch (e) { report(e); }
            syncDisabled();
        });
        syncDisabled();

        manual.hidden = true;
        return true;
    }

    var attempts = 0;
    function tryInit() {
        Promise.resolve()
            .then(init)
            .then(function (ok) {
                // Backup path only: the elements normally appear with the
                // `load` event below. window.setTimeout, NOT bare setTimeout —
                // see the environment notes up top.
                if (!ok && ++attempts < 20) window.setTimeout(tryInit, 100);
            })
            .catch(report);
    }

    // Zotero dispatches `load` on the pane's content after inserting it; it
    // doesn't bubble, so listen in the capture phase.
    document.addEventListener("load", function onPaneLoad(event) {
        var t = event.target;
        if (!t || !t.querySelector || !t.querySelector("#bcf-style-list")) return;
        document.removeEventListener("load", onPaneLoad, true);
        tryInit();
    }, true);
    // Also try right away in case the fragment is already in the document
    // (e.g. the script is re-run after the pane was built once).
    tryInit();
})();
