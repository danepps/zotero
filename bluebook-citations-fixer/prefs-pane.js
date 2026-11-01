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

    // Wire http(s) links to open in the default browser. The toolkit
    // label[is=text-link] widget isn't upgraded in plugin pane fragments, so
    // those labels render but clicking them does nothing (mailto: links work
    // only because the OS protocol handler intercepts them — leave those be).
    function wireLinks() {
        var root = document.getElementById("bcf-prefpane");
        if (!root) return;
        root.querySelectorAll('label.text-link[href^="http"]').forEach(function (lnk) {
            if (lnk.getAttribute("data-bcf-linked") === "1") return;
            lnk.setAttribute("data-bcf-linked", "1");
            lnk.style.cursor = "pointer";
            lnk.addEventListener("click", function (ev) {
                ev.preventDefault();
                try { Zotero.launchURL(lnk.getAttribute("href")); } catch (e) { report(e); }
            });
        });
    }

    var installedRowUpdaters = {};
    var versionRead = 0;
    var versionObserver = null;
    var setupObserver = null;
    var versionsDisposed = false;

    async function refreshStyleVersions() {
        var container = document.getElementById("bcf-style-versions");
        if (!container || versionsDisposed) return;
        var request = ++versionRead;
        var versions = [];
        try {
            var api = Zotero.BluebookCitationsFixer;
            var setupStatus = document.getElementById("bcf-style-setup-status");
            if (setupStatus && api && typeof api.styleSetupStatus === "function") {
                var summary = api.styleSetupStatus();
                setupStatus.value = summary ? "Startup check: " + summary : "";
            }
            if (api && typeof api.installedStyleVersions === "function") {
                versions = await api.installedStyleVersions();
            }
        } catch (e) { report(e); }
        if (versionsDisposed || request !== versionRead ||
                document.getElementById("bcf-style-versions") !== container) return;
        refreshEtAl();
        container.replaceChildren();
        BUILTINS.forEach(function (builtin) {
            var version = versions.find(function (v) { return v.id === builtin.id; });
            if (version && version.status === "installed" && installedRowUpdaters[builtin.id]) {
                installedRowUpdaters[builtin.id]();
            }
            var revision = "Revision date unavailable";
            var timestamp = "";
            if (version && version.status === "not-installed") {
                revision = "Not installed";
            } else if (version && version.status === "installed" &&
                    typeof version.updated === "number" && isFinite(version.updated)) {
                timestamp = new Date(version.updated).toISOString();
                revision = timestamp.slice(0, 10);
            }
            var label = document.createXULElement("label");
            label.setAttribute("value", builtin.title + ": " + revision);
            if (timestamp) label.setAttribute("tooltiptext", "Updated " +
                timestamp.replace("T", " ").replace(".000Z", " UTC"));
            container.appendChild(label);
        });
    }

    function wireStyleVersions() {
        refreshStyleVersions();
        if (versionObserver !== null) return;
        try {
            versionObserver = Zotero.Prefs.registerObserver(
                "extensions.bluebook-citations-fixer.styleSync.lastCheck",
                refreshStyleVersions, true);
            setupObserver = Zotero.Prefs.registerObserver(
                "extensions.bluebook-citations-fixer.styleSetup.lastAttempt",
                refreshStyleVersions, true);
        } catch (e) { report(e); }
    }

    window.addEventListener("unload", function () {
        versionsDisposed = true;
        versionRead++;
        [versionObserver, setupObserver].concat(etAlObservers).forEach(function (observer) {
            if (observer !== null) {
                try { Zotero.Prefs.unregisterObserver(observer); } catch (e) { report(e); }
            }
        });
    }, { once: true });

    // Manual "Check for style updates". The check itself lives in
    // lib/style-sync.js and is reached through the minimal bridge bootstrap.js
    // hangs on the Zotero object — this pane sandbox can't see BCF. The button
    // deliberately bypasses both the 24h throttle and the enable pref (it
    // calls check() directly), though the run still stamps lastCheck, pushing
    // the next automatic check out a full interval.
    function wireStyleSync() {
        var btn = document.getElementById("bcf-style-sync-check");
        var status = document.getElementById("bcf-style-sync-status");
        if (!btn || !status) return;
        if (btn.getAttribute("data-bcf-wired") === "1") return;
        btn.setAttribute("data-bcf-wired", "1");
        btn.addEventListener("command", function () {
            var api = null;
            try { api = Zotero.BluebookCitationsFixer; } catch (_) {}
            if (!api || typeof api.checkStyleUpdates !== "function") {
                status.value = "Check unavailable";
                return;
            }
            btn.disabled = true;
            status.value = "Checking…";
            Promise.resolve()
                .then(function () { return api.checkStyleUpdates(); })
                .then(function (res) {
                    status.value = typeof api.styleUpdateSummary === "function"
                        ? api.styleUpdateSummary(res)
                        : "Check complete";
                })
                .catch(function (e) { report(e); status.value = "Check failed"; })
                .then(function () { btn.disabled = false; return refreshStyleVersions(); });
        });
    }

    var etAlObservers = [];
    function effectiveFirstDefault() {
        try {
            var style = Zotero.Styles.get(BUILTINS[0].id);
            if (!style || !window.DOMParser) return null;
            var doc = new window.DOMParser().parseFromString(style.getXML(), "application/xml");
            var root = doc.documentElement;
            var citation = doc.getElementsByTagNameNS("http://purl.org/net/xbiblio/csl", "citation")[0];
            var value = citation && (citation.getAttribute("et-al-min") || root.getAttribute("et-al-min"));
            return /^\d+$/.test(value || "") && Number(value) > 0 ? Number(value) : null;
        } catch (_) { return null; }
    }
    function refreshEtAl() {
        if (versionsDisposed) return;
        var first = document.getElementById("bcf-et-al-min");
        var later = document.getElementById("bcf-et-al-subsequent-min");
        if (!first || !later) return;
        [[first, "min"], [later, "subsequentMin"]].forEach(function (setting) {
            var value;
            try { value = Zotero.Prefs.get("extensions.bluebook-citations-fixer.etAl." + setting[1], true); } catch (_) {}
            setting[0].value = Number.isInteger(value) && value >= 3 && value <= 11 ? String(value) : "0";
        });
        var effective = Number(first.value) || effectiveFirstDefault();
        Array.from(later.options || []).forEach(function (option) {
            option.disabled = !!effective && Number(option.value) > effective;
        });
        var status = document.getElementById("bcf-et-al-status");
        if (status) {
            var failures = [];
            try {
                var api = Zotero.BluebookCitationsFixer;
                if (api && typeof api.etAlStatus === "function") failures = api.etAlStatus();
            } catch (e) { report(e); }
            status.textContent = failures.map(function (failure) {
                return "Override not applied to " + failure.title + ": " + failure.reason;
            }).join("; ");
        }
        // Preserve a previously stored larger value; rendering clamps it. The
        // disabled selected option remains visible, so the saved pref is honest.
    }
    function wireEtAl() {
        [["bcf-et-al-min", "min"], ["bcf-et-al-subsequent-min", "subsequentMin"]].forEach(function (setting) {
            var input = document.getElementById(setting[0]);
            if (!input || input.getAttribute("data-bcf-wired") === "1") return;
            var pref = "extensions.bluebook-citations-fixer.etAl." + setting[1];
            input.setAttribute("data-bcf-wired", "1");
            input.addEventListener("change", function () {
                var value = Number(input.value);
                if (value === 0 || (Number.isInteger(value) && value >= 3 && value <= 11)) {
                    try { Zotero.Prefs.set(pref, value, true); } catch (e) { report(e); }
                }
                refreshEtAl();
            });
            try { etAlObservers.push(Zotero.Prefs.registerObserver(pref, refreshEtAl, true)); } catch (e) { report(e); }
        });
        if (etAlObservers.length === 2) {
            try { etAlObservers.push(Zotero.Prefs.registerObserver("extensions.bluebook-citations-fixer.etAl.statusRevision", refreshEtAl, true)); } catch (e) { report(e); }
        }
        refreshEtAl();
    }

    async function init() {
        var allBox = document.getElementById("bcf-style-all");
        var listBox = document.getElementById("bcf-style-list");
        var manual = document.getElementById("bcf-style-manual");
        if (!allBox || !listBox || !manual) return false;
        wireLinks();
        wireStyleSync();
        wireStyleVersions();
        wireEtAl();
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
        // sync/profile mismatch can't silently drop them. Built-in and pinned
        // styles may not be installed on this machine (fresh profile, second
        // computer): their IDs are also their download URLs, so those rows
        // get an "Install style" button instead of silently looking odd.
        var pinnedIDs = PINNED.map(function (p) { return p.id; });
        var rows = [];
        BUILTINS.forEach(function (b) {
            rows.push({
                id: b.id,
                title: titleByID[b.id] || b.title,
                builtin: true,
                installable: !(b.id in titleByID)
            });
        });
        PINNED.forEach(function (p) {
            rows.push({
                id: p.id,
                title: titleByID[p.id] || p.title,
                installable: !(p.id in titleByID)
            });
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

        function rowLabel(row, installed_) {
            return row.title +
                (row.builtin ? " — always on" : "") +
                (installed_ ? "" : " (not installed)");
        }

        rows.forEach(function (row) {
            var cb = document.createXULElement("checkbox");
            cb.setAttribute("label", rowLabel(row, !row.installable));
            cb.setAttribute("tooltiptext", row.id);
            cb.setAttribute("data-bcf-style-id", row.id);
            if (row.builtin) cb.setAttribute("data-bcf-builtin", "1");
            cb.checked = !!row.builtin || extras.indexOf(row.id) !== -1;
            if (!row.builtin) cb.addEventListener("command", commit);
            boxes.push(cb);

            if (!row.installable) {
                listBox.appendChild(cb);
                return;
            }
            // Not installed but fetchable: offer one-click install. The
            // checkbox still works either way — the gate compares ID strings,
            // so checking a not-yet-installed style is harmless and the
            // intent survives until the style arrives.
            var hbox = document.createXULElement("hbox");
            hbox.setAttribute("align", "center");
            var btn = document.createXULElement("button");
            btn.setAttribute("label", "Install style");
            installedRowUpdaters[row.id] = function () {
                btn.hidden = true;
                cb.setAttribute("label", rowLabel(row, true));
            };
            btn.addEventListener("command", function () {
                btn.disabled = true;
                Promise.resolve()
                    .then(function () {
                        var api = Zotero.BluebookCitationsFixer;
                        if (!api || typeof api.installStyle !== "function") throw new Error("Style installation unavailable");
                        return api.installStyle(row.id);
                    })
                    .then(function () {
                        btn.hidden = true;
                        cb.setAttribute("label", rowLabel(row, true));
                        return refreshStyleVersions();
                    })
                    .catch(function (e) {
                        report(e);
                        btn.disabled = false;
                        btn.setAttribute("label", "Install failed — retry");
                        btn.setAttribute("tooltiptext", String(e.message || e));
                        var status = document.getElementById("bcf-style-sync-status");
                        if (status) status.value = String(e.message || e);
                    });
            });
            hbox.appendChild(cb);
            hbox.appendChild(btn);
            listBox.appendChild(hbox);
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
