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
// If anything here throws, the manual row stays visible and fully
// functional — the prefs are the source of truth and this UI is just a
// nicer way to edit them.
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
        var titleByID = {};
        var installed = [];
        Zotero.Styles.getAll().forEach(function (s) {
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
                if (!b.__bcfBuiltin && b.checked) {
                    ids.push(b.getAttribute("data-bcf-style-id"));
                }
            });
            try { Zotero.Prefs.set(PREF_EXTRAS, ids.join(" "), true); } catch (_) {}
        }
        function syncDisabled() {
            boxes.forEach(function (b) {
                b.disabled = b.__bcfBuiltin || allBox.checked;
            });
        }

        rows.forEach(function (row) {
            var cb = document.createXULElement("checkbox");
            cb.setAttribute("label", row.title + (row.builtin ? " — always on" : ""));
            cb.setAttribute("tooltiptext", row.id);
            cb.setAttribute("data-bcf-style-id", row.id);
            cb.__bcfBuiltin = !!row.builtin;
            cb.checked = row.builtin || extras.indexOf(row.id) !== -1;
            if (!row.builtin) cb.addEventListener("command", commit);
            listBox.appendChild(cb);
            boxes.push(cb);
        });
        listBox.setAttribute("data-bcf-built", "1");

        allBox.checked = readAll();
        allBox.addEventListener("command", function () {
            try { Zotero.Prefs.set(PREF_ALL, !!allBox.checked, true); } catch (_) {}
            syncDisabled();
        });
        syncDisabled();

        manual.hidden = true;
        return true;
    }

    function start(attempt) {
        Promise.resolve()
            .then(init)
            .then(function (ok) {
                // The pane fragment may not be in the document yet when the
                // script runs; retry briefly, then give up and leave the
                // manual input visible.
                if (!ok && attempt < 20) setTimeout(function () { start(attempt + 1); }, 100);
            })
            .catch(function (e) {
                try { Zotero.debug("bluebook-citations-fixer prefs pane: " + e); } catch (_) {}
            });
    }
    start(0);
})();
