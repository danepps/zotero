"use strict";

// Style-gate picker for the Bluebook Citations Fixer settings pane.
//
// Progressive enhancement over the raw style-ID input (#bcf-style-manual):
// when this script runs successfully it hides the manual row and renders
//   [ ] Apply under all citation styles
//   [x] Bluebook Style — Epps Version
//   [x] Bluebook Style — Epps Version (Experimental)
//   [ ] ...one checkbox per installed CSL style...
// keeping the `styleID` pref in sync. If anything here throws, the manual
// row stays visible and fully functional — the pref is always the source
// of truth and this UI is just a nicer way to edit it.
//
// Pref encoding (see lib/patch.js):
//   ""            -> gate disabled, rewrite under every style
//   "id1 id2 ..." -> rewrite only under those exact style IDs
//   "(none)"      -> sentinel written when "limit to selected styles" is on
//                    but nothing is checked; matches no real style ID (IDs
//                    are URLs), so the plugin stays dormant everywhere
//                    instead of silently flipping to "all styles".
(function () {
    var PREF = "extensions.bluebook-citations-fixer.styleID";
    var SENTINEL = "(none)";
    var DEFAULT_IDS = [
        "https://danepps.github.io/bluebook/BluebookDSEStyle.csl",
        "https://danepps.github.io/bluebook/BluebookDSEStyle-Experimental.csl"
    ];

    function parsePref() {
        var v = "";
        try { v = Zotero.Prefs.get(PREF, true) || ""; } catch (_) {}
        return String(v).split(/[\s,;]+/).filter(function (s) {
            return !!s && s !== SENTINEL;
        });
    }

    function writePref(ids, limit) {
        var v = !limit ? "" : (ids.length ? ids.join(" ") : SENTINEL);
        try { Zotero.Prefs.set(PREF, v, true); } catch (_) {}
    }

    async function init() {
        var allBox = document.getElementById("bcf-style-all");
        var listBox = document.getElementById("bcf-style-list");
        var manual = document.getElementById("bcf-style-manual");
        if (!allBox || !listBox || !manual) return false;
        if (listBox.getAttribute("data-bcf-built") === "1") return true;

        await Zotero.Styles.init();
        var styles = Zotero.Styles.getAll().map(function (s) {
            return { id: s.styleID || s.url || "", title: s.title || "" };
        }).filter(function (s) { return s.id; });
        styles.sort(function (a, b) { return a.title.localeCompare(b.title); });

        var selected = parsePref();
        var limit = selected.length > 0; // empty pref = gate off = all styles

        // IDs configured but not installed locally must stay visible (and
        // checked) so a sync/profile mismatch can't silently drop them.
        var installed = {};
        styles.forEach(function (s) { installed[s.id] = true; });
        selected.forEach(function (id) {
            if (!installed[id]) styles.push({ id: id, title: id + " — not installed" });
        });

        var boxes = [];
        function commit() {
            var ids = [];
            boxes.forEach(function (b) {
                if (b.checked) ids.push(b.getAttribute("data-bcf-style-id"));
            });
            writePref(ids, !allBox.checked);
        }
        function syncDisabled() {
            boxes.forEach(function (b) { b.disabled = allBox.checked; });
        }

        styles.forEach(function (s) {
            var cb = document.createXULElement("checkbox");
            cb.setAttribute("label", s.title);
            cb.setAttribute("tooltiptext", s.id);
            cb.setAttribute("data-bcf-style-id", s.id);
            cb.checked = selected.indexOf(s.id) !== -1;
            cb.addEventListener("command", commit);
            listBox.appendChild(cb);
            boxes.push(cb);
        });
        listBox.setAttribute("data-bcf-built", "1");

        allBox.checked = !limit;
        allBox.addEventListener("command", function () {
            if (!allBox.checked) {
                // Flipping from "all styles" back to "selected styles" with an
                // empty selection would leave the plugin dormant everywhere;
                // preselect the plugin's default styles when present.
                var any = boxes.some(function (b) { return b.checked; });
                if (!any) {
                    boxes.forEach(function (b) {
                        if (DEFAULT_IDS.indexOf(b.getAttribute("data-bcf-style-id")) !== -1) {
                            b.checked = true;
                        }
                    });
                }
            }
            syncDisabled();
            commit();
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
