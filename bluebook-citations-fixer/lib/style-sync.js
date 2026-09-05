"use strict";

// Keeps the installed copies of the Epps Bluebook CSL styles current.
//
// Zotero's own style auto-update only covers styles hosted on zotero.org, so
// the Epps styles at danepps.github.io/bluebook never refresh on their own and
// a stale local copy silently passes the style gate (lib/patch.js) while
// rendering citations under outdated rules. This module closes that gap: for
// each hard-wired built-in style that is ALREADY installed, fetch the hosted
// CSL once, verify it really is that style, and install it only when its
// <updated> timestamp is STRICTLY newer than the local one.
//
// Contract, in brief:
//   * Built-ins only, from BCF.patch.BUILTIN_STYLE_IDS. No second list.
//   * Installed styles only — a missing style is never auto-installed (the
//     Settings pane's "Install style" button covers that).
//   * One fetch. The bytes that are validated are the bytes that are
//     installed; Zotero.Styles.install({url}) would re-download and could
//     install something other than what we inspected.
//   * Validation is explicit (Zotero.Styles.validate) because install() with
//     silent=true swallows validation errors and proceeds — and it deletes the
//     existing style file before writing the replacement.
//   * Installing resets every open integration session's style engine
//     (Styles.install -> reinit -> Integration.resetSessionStyles), so the
//     install step waits for any active word-processor command to finish.
//   * Failures are silent: diag + Error Console only, never a dialog, and we
//     never uninstall or otherwise touch the local style ourselves.
//
// Nothing here touches Zotero at load time: every Zotero API is reached lazily
// through _defaultDeps() closures or through injected deps, so the file loads
// cleanly in the Node test harness's Zotero-less vm context.

BCF.styleSync = {};

BCF.styleSync.PREF_ENABLED = "extensions.bluebook-citations-fixer.styleSync";
BCF.styleSync.PREF_LAST_CHECK = "extensions.bluebook-citations-fixer.styleSync.lastCheck";
BCF.styleSync.CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;  // startup throttle
BCF.styleSync.STARTUP_DELAY_MS = 60 * 1000;             // network work deferred
BCF.styleSync.FETCH_TIMEOUT_MS = 15000;

BCF.styleSync._timer = null;      // one-shot nsITimer; cancelled at shutdown
BCF.styleSync._inFlight = null;   // reentrancy guard: the pending check() promise
// Lifecycle token. cancel() (shutdown) bumps it; every continuation after an
// await re-reads it and aborts if it moved. Cancelling the timer alone cannot
// stop an already-running check from reaching install().
BCF.styleSync._generation = 0;

// The styles to check. Single source of truth: the same hard-wired list the
// style gate uses (lib/patch.js). If it is somehow unavailable, fail CLOSED —
// a second literal list here would be one more thing to drift.
BCF.styleSync.styleIDs = function () {
    try {
        if (BCF.patch && BCF.patch.BUILTIN_STYLE_IDS &&
                BCF.patch.BUILTIN_STYLE_IDS.length) {
            return BCF.patch.BUILTIN_STYLE_IDS.slice();
        }
    } catch (_) {}
    try { BCF.diag.event("style-sync", "BUILTIN_STYLE_IDS unavailable; nothing to check"); } catch (_) {}
    return [];
};

// { enabled: bool (default true), lastCheck: ms epoch (default 0) }.
// Same try/catch + hardcoded-fallback shape as BCF.run.options(), so the Node
// harness (no Zotero.Prefs) gets the defaults.
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

// Stored as a STRING: Zotero prefs have no int64 and a ms epoch overflows int32.
BCF.styleSync._setLastCheck = function (ms) {
    try { Zotero.Prefs.set(BCF.styleSync.PREF_LAST_CHECK, String(ms), true); } catch (_) {}
};

// ---------------------------------------------------------------------------
// Pure helpers (no Zotero access — Node-testable).
// ---------------------------------------------------------------------------

// First <updated> element of a raw CSL document, as ms epoch; null when
// missing or unparseable. Regex, not DOMParser: no DOM in the Node harness and
// the element is flat text. CSL <updated> is RFC3339, which Date.parse handles
// as ISO 8601 in both the "Z" and "+hh:mm" forms (the published Epps styles
// use "+00:00").
BCF.styleSync.parseUpdated = function (cslText) {
    if (typeof cslText !== "string") return null;
    var m = /<updated[^>]*>\s*([^<]+?)\s*<\/updated>/.exec(cslText);
    if (!m) return null;
    var t = Date.parse(m[1]);
    return isNaN(t) ? null : t;
};

// First <id> element of a raw CSL document, trimmed; null when missing. Used
// to prove the fetched bytes really are the style we asked for before any
// install — a redirect or a mispublished file must not overwrite a local style.
BCF.styleSync.parseStyleID = function (cslText) {
    if (typeof cslText !== "string") return null;
    var m = /<id[^>]*>\s*([^<]+?)\s*<\/id>/.exec(cslText);
    return m ? m[1] : null;
};

// Defensive read of an installed Style object's `updated` field -> ms epoch,
// or null. null means "skip this style": never install on an indeterminate
// comparison.
BCF.styleSync.localUpdated = function (style) {
    try {
        if (!style || style.updated === undefined || style.updated === null) return null;
        var t = Date.parse(String(style.updated));
        return isNaN(t) ? null : t;
    } catch (_) {
        return null;
    }
};

// Strictly newer only. Equal => NOT newer: Zotero rewrites the style file on
// install, so an >= compare would reinstall on every check forever. Either
// side null/NaN/non-finite => false.
BCF.styleSync.isRemoteNewer = function (remoteMs, localMs) {
    return typeof remoteMs === "number" && isFinite(remoteMs) &&
        typeof localMs === "number" && isFinite(localMs) &&
        remoteMs > localMs;
};

// Startup-throttle decision. Due when enabled AND (never checked, OR the
// interval has elapsed, OR lastCheck is in the future — a clock rollback or a
// junk stored value must not disable sync forever). The manual pane button
// bypasses this entirely.
BCF.styleSync.shouldCheck = function (nowMs) {
    var opts = BCF.styleSync.options();
    if (!opts.enabled) return false;
    var now = typeof nowMs === "number" && isFinite(nowMs) ? nowMs : Date.now();
    if (!opts.lastCheck) return true;
    if (opts.lastCheck > now) return true;
    return (now - opts.lastCheck) >= BCF.styleSync.CHECK_INTERVAL_MS;
};

// Short status string for the Settings pane. Partial failure is never masked
// by a success phrase: an update plus a failure reports both.
BCF.styleSync.summaryLabel = function (res) {
    if (!res || !res.counts) return "Check failed";
    var c = res.counts;
    var updated = c.updated || 0;
    var failed = c.failed || 0;
    var skipped = c.skipped || 0;
    var unverified = c.unverified || 0;
    var parts = [];
    if (updated) parts.push("Updated " + updated + (updated === 1 ? " style" : " styles"));
    if (unverified) {
        parts.push(unverified + (unverified === 1 ? " style" : " styles") +
            " installed but not verified");
    }
    if (failed) parts.push(failed + (failed === 1 ? " check failed" : " checks failed"));
    if (skipped) {
        parts.push(skipped + (skipped === 1 ? " style" : " styles") +
            " skipped: invalid metadata");
    }
    if (parts.length) return parts.join("; ");
    if (c.upToDate) return "Up to date";
    if (c.notInstalled) return "Epps Bluebook styles not installed";
    if (c.cancelled) return "Check cancelled";
    return "Nothing to check";
};

// ---------------------------------------------------------------------------
// Injectable dependencies.
// ---------------------------------------------------------------------------

// Real implementations, resolved lazily off Zotero at call time. This builds
// closures only — it touches no Zotero API — so merging it in is harness-safe.
BCF.styleSync._defaultDeps = function () {
    return {
        now: function () { return Date.now(); },
        // Installed Style object, or null.
        getStyle: async function (id) {
            await Zotero.Styles.init();   // idempotent; get() is false pre-init
            return Zotero.Styles.get(id) || null;
        },
        // Raw CSL text; rejects on non-2xx.
        fetch: async function (url) {
            var xhr = await Zotero.HTTP.request("GET", url, {
                timeout: BCF.styleSync.FETCH_TIMEOUT_MS
            });
            return xhr.responseText;
        },
        // Explicit validation. install(..., silent=true) suppresses validation
        // errors and installs anyway, so this must run first and its rejection
        // must abort the install. A missing API fails closed.
        validate: function (text) {
            return Promise.resolve().then(function () {
                if (!Zotero.Styles || typeof Zotero.Styles.validate !== "function") {
                    throw new Error("Zotero.Styles.validate unavailable");
                }
                return Zotero.Styles.validate(text);
            });
        },
        // True while a word-processor command is executing. currentSession is
        // NOT cleared at command end; currentDoc is.
        commandActive: function () {
            try {
                return !!(Zotero.Integration && Zotero.Integration.currentDoc);
            } catch (_) {
                return false;
            }
        },
        commandPromise: function () {
            try {
                return Promise.resolve(Zotero.Integration &&
                    Zotero.Integration.currentCommandPromise);
            } catch (_) {
                return Promise.resolve();
            }
        },
        // Install the bytes we already fetched and validated — NOT {url}, which
        // would re-download and could install something we never inspected.
        // silent=true suppresses the overwrite-confirmation dialog.
        install: function (id, text) {
            return Promise.resolve().then(function () {
                return Zotero.Styles.install({ string: text }, id, true);
            });
        }
    };
};

BCF.styleSync._mergeDeps = function (deps) {
    var d = BCF.styleSync._defaultDeps();
    if (deps) {
        for (var k in deps) {
            if (typeof deps[k] === "function") d[k] = deps[k];
        }
    }
    return d;
};

// ---------------------------------------------------------------------------
// Per-style check. Never rejects.
// ---------------------------------------------------------------------------

// Returns { id, status, remote?, local?, error? } with status one of
// "updated" | "up-to-date" | "not-installed" | "skipped" | "failed" |
// "unverified" | "cancelled". Pre-install failures ("failed"/"skipped") leave
// the local style untouched; once install() has started, Zotero owns the file
// and recovery is its business — "unverified" means install() resolved but the
// re-read installed style did not carry the fetched <updated> (or couldn't be
// re-read), so the pane must not claim "Updated".
BCF.styleSync.checkStyle = async function (id, deps, generation) {
    // Captured at entry: shutdown sets BCF = null, and this body outlives it.
    var sync = BCF.styleSync;
    var diag = BCF.diag;
    var d = sync._mergeDeps(deps);   // idempotent; a partial deps stays whole
    var gen = generation === undefined ? sync._generation : generation;
    function live() { return sync._generation === gen; }

    try {
        var style = await d.getStyle(id);
        if (!live()) return { id: id, status: "cancelled" };
        if (!style) {
            diag.event("style-sync", "not installed: " + id);
            return { id: id, status: "not-installed" };
        }

        var local = sync.localUpdated(style);
        if (local === null) {
            diag.event("style-sync", "skip (unreadable local <updated>): " + id);
            return { id: id, status: "skipped", error: "local updated unreadable" };
        }

        var text = await d.fetch(id);
        if (!live()) return { id: id, status: "cancelled" };

        var remoteID = sync.parseStyleID(text);
        if (remoteID !== id) {
            diag.event("style-sync", "skip (remote <id> mismatch): " + id +
                " -> " + (remoteID === null ? "(none)" : remoteID));
            return { id: id, status: "failed", error: "remote id mismatch" };
        }

        var remote = sync.parseUpdated(text);
        if (remote === null) {
            diag.event("style-sync", "skip (unreadable remote <updated>): " + id);
            return { id: id, status: "skipped", error: "remote updated unreadable" };
        }

        if (!sync.isRemoteNewer(remote, local)) {
            diag.event("style-sync", "up to date: " + id);
            return { id: id, status: "up-to-date", remote: remote, local: local };
        }

        // Validate BEFORE anything can touch the installed file.
        await d.validate(text);
        if (!live()) return { id: id, status: "cancelled" };

        // Installing rebuilds the style engine of every open integration
        // session; doing that mid-command would swap the engine underneath a
        // running Word/LibreOffice refresh.
        if (d.commandActive()) {
            diag.event("style-sync", "waiting for active integration command: " + id);
            try {
                await d.commandPromise();
            } catch (_) {
                // A failed word-processor command is not our failure; we only
                // needed it to be over.
            }
            if (!live()) return { id: id, status: "cancelled" };
        }

        // Mandatory final check: nothing may start an install after cancel().
        if (!live()) return { id: id, status: "cancelled" };
        await d.install(id, text);

        // Post-install verification: install() resolving proves nothing about
        // what is on disk (silent=true swallows installer errors). Re-read the
        // style and require its <updated> to equal the bytes we installed.
        var after = null;
        try {
            after = sync.localUpdated(await d.getStyle(id));
        } catch (e) {
            try { diag.err("style-sync post-install re-read " + id, e); } catch (_) {}
        }
        if (after !== remote) {
            diag.event("style-sync", "installed but unverified: " + id +
                " installed=" + (after === null ? "(unreadable)" : new Date(after).toISOString()) +
                " expected=" + new Date(remote).toISOString());
            return { id: id, status: "unverified", remote: remote, local: local,
                     installed: after, error: "post-install <updated> mismatch" };
        }
        diag.event("style-sync", "updated " + id + " -> " + new Date(remote).toISOString());
        return { id: id, status: "updated", remote: remote, local: local };
    } catch (e) {
        try { diag.err("style-sync " + id, e); } catch (_) {}
        return { id: id, status: "failed", error: String(e) };
    }
};

// ---------------------------------------------------------------------------
// Top-level check: reentrancy guard + throttle bookkeeping.
// ---------------------------------------------------------------------------

BCF.styleSync._COUNT_KEYS = {
    "updated": "updated",
    "up-to-date": "upToDate",
    "not-installed": "notInstalled",
    "skipped": "skipped",
    "failed": "failed",
    "unverified": "unverified",
    "cancelled": "cancelled"
};

// Sequential over styleIDs() (two styles; parallelism buys nothing). Resolves
// to { results, counts, checkedAt } and NEVER rejects. Does NOT consult the
// enabled pref — only shouldCheck() does — so the manual pane button works
// with automatic sync switched off.
BCF.styleSync.check = function (deps) {
    var sync = BCF.styleSync;
    if (sync._inFlight) return sync._inFlight;
    var promise = sync._run(deps);
    sync._inFlight = promise;
    var clear = function () {
        if (sync._inFlight === promise) sync._inFlight = null;
    };
    promise.then(clear, clear);
    return promise;
};

BCF.styleSync._run = async function (deps) {
    var sync = BCF.styleSync;
    var diag = BCF.diag;
    var gen = sync._generation;
    var d = sync._mergeDeps(deps);
    var ids = sync.styleIDs();
    var counts = {
        updated: 0, upToDate: 0, notInstalled: 0,
        skipped: 0, failed: 0, unverified: 0, cancelled: 0
    };
    var results = [];

    for (var i = 0; i < ids.length; i++) {
        var r;
        try {
            r = await sync.checkStyle(ids[i], d, gen);
        } catch (e) {
            // checkStyle is supposed to be total; belt and braces.
            try { diag.err("style-sync " + ids[i], e); } catch (_) {}
            r = { id: ids[i], status: "failed", error: String(e) };
        }
        results.push(r);
        var key = sync._COUNT_KEYS[r && r.status];
        if (key) counts[key]++;
    }

    var checkedAt;
    try { checkedAt = d.now(); } catch (_) { checkedAt = Date.now(); }
    if (typeof checkedAt !== "number" || !isFinite(checkedAt)) checkedAt = Date.now();
    // Written on failed runs too: a dead network must not turn the startup
    // path into an every-launch fetch. Skipped after cancellation — a
    // shut-down plugin has no business rewriting prefs.
    if (sync._generation === gen) sync._setLastCheck(checkedAt);
    try { diag.event("style-sync", { done: counts }); } catch (_) {}
    return { results: results, counts: counts, checkedAt: checkedAt };
};

// ---------------------------------------------------------------------------
// Startup scheduling + teardown.
// ---------------------------------------------------------------------------

// Called once from bootstrap startup(). Must not slow startup: the throttle
// test is two synchronous pref reads and the network work is deferred behind a
// one-shot nsITimer (same pattern as lib/patch.js's retry timer), which
// re-tests shouldCheck() at fire time — prefs may have changed, or the pane
// button may have just run a check.
BCF.styleSync.scheduleStartupCheck = function () {
    try {
        var sync = BCF.styleSync;
        var diag = BCF.diag;
        if (!sync.shouldCheck(Date.now())) {
            diag.event("style-sync", "startup check skipped (disabled or throttled)");
            return;
        }
        var gen = sync._generation;
        try {
            if (sync._timer) {
                sync._timer.cancel();
                sync._timer = null;
            }
        } catch (_) {}
        sync._timer = Components.classes["@mozilla.org/timer;1"]
            .createInstance(Components.interfaces.nsITimer);
        sync._timer.initWithCallback(
            {
                notify: function () {
                    try {
                        sync._timer = null;
                        if (sync._generation !== gen) return;   // shut down since
                        if (!sync.shouldCheck(Date.now())) {
                            diag.event("style-sync", "startup check skipped at fire time");
                            return;
                        }
                        sync.check();
                    } catch (e) {
                        try { diag.err("style-sync startup", e); } catch (_) {}
                    }
                }
            },
            sync.STARTUP_DELAY_MS,
            Components.interfaces.nsITimer.TYPE_ONE_SHOT
        );
        diag.event("style-sync", "startup check scheduled (+" + sync.STARTUP_DELAY_MS + "ms)");
    } catch (e) {
        try { BCF.diag.err("style-sync schedule", e); } catch (_) {}
    }
};

// Called from bootstrap shutdown(). Cancels the pending timer AND invalidates
// every in-flight continuation, so a check already past its fetch can no
// longer reach install().
BCF.styleSync.cancel = function () {
    var sync = BCF.styleSync;
    sync._generation++;
    try {
        if (sync._timer) {
            sync._timer.cancel();
            sync._timer = null;
        }
    } catch (_) {}
};
