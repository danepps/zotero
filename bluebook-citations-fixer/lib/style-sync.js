"use strict";

// Style sync: keep the installed Epps Bluebook CSL styles current.
//
// The style gate (lib/patch.js) compares style IDs only, so a stale installed
// copy of the Epps style passes silently and renders citations with outdated
// rules. Zotero's own style auto-update covers only styles hosted on
// zotero.org/styles; the Epps styles live on danepps.github.io, so nothing
// updates them — until this.
//
// Contract:
//   - Covered styles: BCF.patch.BUILTIN_STYLE_IDS only, and only when the
//     style is already installed. Never auto-installs a missing style (the
//     Settings pane's "Install style" button covers that case).
//   - Update trigger: the remote CSL's <updated> timestamp is STRICTLY newer
//     than the installed copy's. Equal or unreadable on either side => no
//     install (never install on an indeterminate comparison; strictly-newer
//     prevents a reinstall loop since timestamps match after an install).
//   - All failures (network, 404, parse, install) are silent to the user:
//     diag/Error Console only, never a dialog, and the installed style is
//     NEVER uninstalled or modified on failure. (Contrast: a 404ing plugin
//     update JSON makes Zotero delete the plugin — style sync must have no
//     analogous behavior.)
//   - Runs shortly after startup, throttled to once per 24h via the lastCheck
//     pref, plus on demand from the Settings pane button (which bypasses both
//     the throttle and the enable pref — check() itself never consults them).
//
// All Zotero access is lazy or injected via a deps object so the Node harness
// (no Components, no Zotero.HTTP/Styles/Prefs) can load this file and test
// the decision logic.

BCF.styleSync = {};

BCF.styleSync.PREF_ENABLED = "extensions.bluebook-citations-fixer.styleSync";
BCF.styleSync.PREF_LAST_CHECK = "extensions.bluebook-citations-fixer.styleSync.lastCheck";
BCF.styleSync.CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
BCF.styleSync.STARTUP_DELAY_MS = 60 * 1000;
BCF.styleSync._timer = null;      // pending one-shot nsITimer; cancelled at shutdown
BCF.styleSync._inFlight = null;   // pending check() promise (reentrancy guard)

// The styles to keep current. Read lazily off BCF.patch so there is exactly
// one authoritative copy of the built-in IDs; the hardcoded fallback keeps
// this total against load-order changes.
BCF.styleSync.styleIDs = function () {
    if (BCF.patch && BCF.patch.BUILTIN_STYLE_IDS) {
        return BCF.patch.BUILTIN_STYLE_IDS.slice();
    }
    return [
        "https://danepps.github.io/bluebook/BluebookDSEStyle.csl",
        "https://danepps.github.io/bluebook/BluebookDSEStyle-Experimental.csl"
    ];
};

// { enabled: bool (default true), lastCheck: number ms epoch (default 0) }.
// lastCheck is stored as a STRING because Zotero prefs have no int64. Same
// try/catch-with-fallback pattern as BCF.run.options().
BCF.styleSync.options = function () {
    var enabled = true;
    var lastCheck = 0;
    try {
        var v = Zotero.Prefs.get(BCF.styleSync.PREF_ENABLED, true);
        if (v !== undefined && v !== null) enabled = !!v;
    } catch (_) {}
    try {
        var n = parseInt(Zotero.Prefs.get(BCF.styleSync.PREF_LAST_CHECK, true), 10);
        if (!isNaN(n)) lastCheck = n;
    } catch (_) {}
    return { enabled: enabled, lastCheck: lastCheck };
};

BCF.styleSync._setLastCheck = function (ms) {
    try { Zotero.Prefs.set(BCF.styleSync.PREF_LAST_CHECK, String(ms), true); } catch (_) {}
};

// Extract the first <updated> element from raw CSL XML and Date.parse it.
// Regex, not DOMParser — the Node harness has no DOM and the element is flat
// text. CSL <updated> is RFC3339, which Date.parse handles as ISO 8601 (both
// "Z" and "+hh:mm" offsets). Returns ms epoch, or null when missing or
// unparseable.
BCF.styleSync.parseUpdated = function (cslText) {
    if (typeof cslText !== "string") return null;
    var m = /<updated[^>]*>\s*([^<]+?)\s*<\/updated>/.exec(cslText);
    if (!m) return null;
    var t = Date.parse(m[1]);
    return isNaN(t) ? null : t;
};

// Defensive read of an installed Zotero Style object's `updated` field
// (parsed by Zotero from the CSL <updated> element). Returns ms epoch or
// null; null means "skip sync for that style" — fail safe, never install on
// an indeterminate comparison.
BCF.styleSync.localUpdated = function (style) {
    try {
        if (!style || style.updated == null) return null;
        var t = Date.parse(String(style.updated));
        return isNaN(t) ? null : t;
    } catch (_) {
        return null;
    }
};

// Strictly newer only: equal timestamps => not newer; null/NaN on either
// side => false.
BCF.styleSync.isRemoteNewer = function (remoteMs, localMs) {
    return typeof remoteMs === "number" && isFinite(remoteMs) &&
        typeof localMs === "number" && isFinite(localMs) &&
        remoteMs > localMs;
};

// Startup-throttle decision: due when enabled AND (never checked, OR >= 24h
// elapsed, OR lastCheck is in the future — a clock-rollback guard so a bad
// stored value can't disable sync forever). The pane button bypasses this by
// calling check() directly.
BCF.styleSync.shouldCheck = function (nowMs) {
    var o = BCF.styleSync.options();
    if (!o.enabled) return false;
    if (o.lastCheck > nowMs) return true;
    return (nowMs - o.lastCheck) >= BCF.styleSync.CHECK_INTERVAL_MS;
};

// Real dependencies, resolved lazily off the context Zotero at call time.
// Builds closures only — touches no Zotero API until a member is invoked, so
// merging it in check() is harness-safe (tests pass a complete deps object).
BCF.styleSync._defaultDeps = function () {
    return {
        now: function () { return Date.now(); },
        // Installed Style object or null. Styles.get returns false before
        // init; init is idempotent.
        getStyle: async function (id) {
            await Zotero.Styles.init();
            return Zotero.Styles.get(id) || null;
        },
        // Raw CSL text; Zotero.HTTP.request rejects on non-2xx, so any
        // failure surfaces as a rejection.
        fetch: async function (url) {
            var xhr = await Zotero.HTTP.request("GET", url, { timeout: 15000 });
            return xhr.responseText;
        },
        // Same call as the pane's "Install style" button (prefs-pane.js):
        // {url} makes Zotero download + install; 3rd arg true = silent, no
        // overwrite-confirmation dialog.
        install: function (id) {
            return Zotero.Styles.install({ url: id }, id, true);
        }
    };
};

// Check (and possibly update) one style. Never rejects. Returns
// { id, status, remote?, local?, error? } with status one of
// "updated" | "up-to-date" | "not-installed" | "skipped" | "failed".
BCF.styleSync.checkStyle = async function (id, deps) {
    // shutdown() nulls BCF; capture what the async body needs so an in-flight
    // check settles harmlessly after teardown.
    var diag = BCF.diag;
    var sync = BCF.styleSync;
    try {
        // Installed-first: never auto-install a missing style, and don't
        // spend a network fetch on one.
        var style = await deps.getStyle(id);
        if (!style) {
            diag.event("style-sync", "not installed: " + id);
            return { id: id, status: "not-installed" };
        }
        var local = sync.localUpdated(style);
        if (local === null) {
            diag.event("style-sync", "skip (unreadable local updated): " + id);
            return { id: id, status: "skipped" };
        }
        var remote = sync.parseUpdated(await deps.fetch(id)); // style ID == download URL
        if (remote === null) {
            diag.event("style-sync", "skip (unparseable remote <updated>): " + id);
            return { id: id, status: "skipped" };
        }
        if (!sync.isRemoteNewer(remote, local)) {
            diag.event("style-sync", "up to date: " + id);
            return { id: id, status: "up-to-date", remote: remote, local: local };
        }
        await deps.install(id);
        diag.event("style-sync",
            "updated " + id + " -> " + new Date(remote).toISOString());
        return { id: id, status: "updated", remote: remote, local: local };
    } catch (e) {
        diag.err("style-sync " + id, e);
        return { id: id, status: "failed", error: String(e) };
    }
};

// Check every built-in style (sequentially — there are two). Never rejects;
// resolves to { results, counts, checkedAt }. Concurrent callers (startup
// timer firing while the pane button is mid-check) share one run via
// _inFlight. lastCheck is written when a run finishes — success OR failure —
// so a dead network can't turn the startup path into an every-launch fetch.
BCF.styleSync.check = function (deps) {
    if (BCF.styleSync._inFlight) return BCF.styleSync._inFlight;
    var diag = BCF.diag;
    var sync = BCF.styleSync;
    var d = Object.assign(sync._defaultDeps(), deps || {});
    var p = (async function () {
        var results = [];
        var ids = sync.styleIDs();
        for (var i = 0; i < ids.length; i++) {
            results.push(await sync.checkStyle(ids[i], d));
        }
        var counts = { updated: 0, upToDate: 0, notInstalled: 0, skipped: 0, failed: 0 };
        results.forEach(function (r) {
            if (r.status === "updated") counts.updated++;
            else if (r.status === "up-to-date") counts.upToDate++;
            else if (r.status === "not-installed") counts.notInstalled++;
            else if (r.status === "skipped") counts.skipped++;
            else counts.failed++;
        });
        var checkedAt = d.now();
        sync._setLastCheck(checkedAt);
        diag.event("style-sync", "done " + JSON.stringify(counts));
        return { results: results, counts: counts, checkedAt: checkedAt };
    })();
    sync._inFlight = p.then(
        function (r) { sync._inFlight = null; return r; },
        function (e) { sync._inFlight = null; throw e; }
    );
    return sync._inFlight;
};

// Short status string for the Settings pane. Precedence: any update > any
// failure/skip > up to date > nothing installed.
BCF.styleSync.summaryLabel = function (res) {
    if (!res || !res.counts) return "Check failed";
    var c = res.counts;
    if (c.updated > 0) {
        var newest = 0;
        res.results.forEach(function (r) {
            if (r.status === "updated" && r.remote > newest) newest = r.remote;
        });
        return "Updated to " + new Date(newest).toISOString().slice(0, 10);
    }
    if (c.failed > 0 || c.skipped > 0) return "Check failed";
    if (c.upToDate > 0) return "Up to date";
    return "Epps Bluebook styles not installed";
};

// Called once from bootstrap startup(). Must not block or slow startup: the
// throttle test is two synchronous pref reads; the network work is deferred
// behind a one-shot nsITimer (pattern from lib/patch.js) that RE-TESTS the
// throttle at fire time (prefs may have changed, or the pane button may have
// just run a check). Fully wrapped — can never fail startup.
BCF.styleSync.scheduleStartupCheck = function () {
    var diag = BCF.diag;
    var sync = BCF.styleSync;
    try {
        if (!sync.shouldCheck(Date.now())) {
            diag.event("style-sync", "startup check skipped (disabled or throttled)");
            return;
        }
        sync._timer = Components.classes["@mozilla.org/timer;1"]
            .createInstance(Components.interfaces.nsITimer);
        sync._timer.initWithCallback(
            { notify: function () {
                sync._timer = null;
                if (!sync.shouldCheck(Date.now())) return;
                sync.check().catch(function (e) {
                    diag.err("style-sync startup", e);
                });
            } },
            sync.STARTUP_DELAY_MS,
            Components.interfaces.nsITimer.TYPE_ONE_SHOT
        );
        diag.event("style-sync",
            "startup check scheduled (+" + sync.STARTUP_DELAY_MS + "ms)");
    } catch (e) {
        try { diag.err("style-sync schedule", e); } catch (_) {}
    }
};

// Called from bootstrap shutdown(): cancel a pending timer. An in-flight
// check() is left to settle — its side effects are all try/catch'd and it
// runs on locals captured before the first await.
BCF.styleSync.cancel = function () {
    try {
        if (BCF.styleSync._timer) {
            BCF.styleSync._timer.cancel();
            BCF.styleSync._timer = null;
        }
    } catch (_) {}
};
