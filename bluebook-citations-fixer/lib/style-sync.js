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
//   * Routine updates cover installed styles only. Each startup may install
//     the missing PRIMARY_STYLE_ID; experimental is never auto-installed.
//   * One fetch. The bytes that are validated are the bytes that are
//     installed; Zotero.Styles.install({url}) would re-download and could
//     install something other than what we inspected.
//   * Validation is explicit (Zotero.Styles.validate) because install() with
//     silent=true swallows validation errors and proceeds — and it deletes the
//     existing style file before writing the replacement.
//   * Installing resets every open integration session's style engine
//     (Styles.install -> reinit -> Integration.resetSessionStyles), so the
//     install step waits for any active word-processor command to finish.
//   * Routine update failures are logged. Startup repair failures also show a
//     brief warning and Settings status; no confirmation dialog is required.
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
BCF.styleSync.PREF_SETUP_ATTEMPT = "extensions.bluebook-citations-fixer.styleSetup.lastAttempt";
BCF.styleSync.PREF_SETUP_STATUS = "extensions.bluebook-citations-fixer.styleSetup.status";
BCF.styleSync.SETUP_DELAY_MS = 5000;
BCF.styleSync._setupCheckedThisStartup = false;

BCF.styleSync.setupStatus = function () {
    try { return Zotero.Prefs.get(this.PREF_SETUP_STATUS, true) || ""; }
    catch (_) { return ""; }
};
BCF.styleSync.shouldSetup = function () {
    return !this._setupCheckedThisStartup;
};

BCF.styleSync._timer = null;      // one-shot nsITimer; cancelled at shutdown
BCF.styleSync._inFlight = null;   // reentrancy guard: the pending check() promise
BCF.styleSync._inFlightSetup = false;
BCF.styleSync._queuedRoutine = null;
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

BCF.styleSync._parseXML = function (text) {
    var win = Zotero.getMainWindow() || Services.appShell.hiddenDOMWindow;
    return new win.DOMParser().parseFromString(text, "application/xml");
};

// Only direct CSL style/info children count as metadata. Comments, nested
// lookalikes, foreign namespaces, duplicate elements and malformed XML cannot
// authorize installation. The parser is injectable; production uses Gecko.
BCF.styleSync.parseMetadata = function (cslText, parse) {
    if (typeof cslText !== "string") return null;
    try {
        var ns = "http://purl.org/net/xbiblio/csl";
        var doc = (parse || this._parseXML)(cslText), root = doc.documentElement;
        if (!root || root.namespaceURI !== ns || root.localName !== "style" ||
                doc.getElementsByTagNameNS("*", "parsererror").length || doc.doctype) return null;
        function children(node, name) {
            return Array.from(node.childNodes).filter(function (n) {
                return n.nodeType === 1 && n.namespaceURI === ns && n.localName === name;
            });
        }
        var infos = children(root, "info");
        if (infos.length !== 1) return null;
        function value(name) {
            var nodes = children(infos[0], name);
            if (nodes.length !== 1 || Array.from(nodes[0].childNodes).some(function (n) { return n.nodeType === 1; })) return null;
            return nodes[0].textContent.trim() || null;
        }
        var updated = value("updated");
        var ms = updated && /(?:Z|[+-]\d{2}:\d{2})$/i.test(updated) ? Date.parse(updated) : NaN;
        return { id: value("id"), title: value("title"), updated: isNaN(ms) ? null : ms };
    } catch (_) { return null; }
};

BCF.styleSync.parseUpdated = function (cslText, parse) {
    var metadata = this.parseMetadata(cslText, parse);
    return metadata ? metadata.updated : null;
};

BCF.styleSync.parseStyleID = function (cslText, parse) {
    var metadata = this.parseMetadata(cslText, parse);
    return metadata ? metadata.id : null;
};

// Zotero's silent installer matches by ID, filename, and then title. Protect
// other identities and unindexed files, including the hidden styles folder.
// Run synchronously inside the command gate, immediately before installation.
BCF.styleSync.assertInstallSafe = function (metadata, deps) {
    if (!metadata || !metadata.id || !metadata.title) throw new Error("Missing CSL identity or title");
    var all = deps.getInstalledStyles();
    if (!all || typeof all !== "object") throw new Error("Installed-style inventory unavailable");
    var styles = Array.isArray(all) ? all : Object.values(all);
    var hasExpectedID = styles.some(function (style) { return style.styleID === metadata.id; });
    var targets = deps.installTargets(metadata.id);
    if (!Array.isArray(targets)) throw new Error("Style installation paths unavailable");
    var owned = new Set();
    styles.forEach(function (style) {
        var sameID = style.styleID === metadata.id;
        if (!hasExpectedID && !sameID && style.title === metadata.title) {
            throw new Error("Style conflict: another installed style has this title (" + style.styleID + "). Resolve it in Zotero Settings → Cite → Styles; no style was replaced.");
        }
        targets.forEach(function (target) {
            if (!deps.styleUsesFile(style, target)) return;
            if (!sameID) throw new Error("Style conflict: another style owns the installation file; no style was replaced.");
            owned.add(target);
        });
    });
    targets.forEach(function (target) {
        if (target.exists() && !owned.has(target)) {
            throw new Error("Style conflict: an unrecognized file occupies the installation path; no style was replaced.");
        }
    });
};

// Read the original timestamp from installed CSL. Zotero's Style.updated is
// display metadata: it replaces T with a space and strips a positive offset.
// Date.parse then treats it as local time, corrupting comparisons outside UTC.
// A failed XML read must not fall back to that lossy value. Lightweight callers
// without getXML may supply an explicitly zoned timestamp, never a naive one.
BCF.styleSync.localUpdated = function (style, parse) {
    try {
        if (!style) return null;
        if (typeof style.getXML === "function") {
            return this.parseUpdated(style.getXML(), parse);
        }
        var updated = style.updated;
        if (typeof updated !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(updated.trim())) return null;
        var t = Date.parse(updated);
        return isNaN(t) ? null : t;
    } catch (_) {
        return null;
    }
};

// Read-only pane data. No fetch, install, throttle write, or update check.
// Capture dependencies before awaiting so pane reads can finish during unload.
BCF.styleSync.installedVersions = async function (deps) {
    var sync = BCF.styleSync;
    var ids = sync.styleIDs();
    var d = sync._mergeDeps(deps);
    var versions = [];
    for (var i = 0; i < ids.length; i++) {
        try {
            var style = await d.getStyle(ids[i]);
            versions.push({ id: ids[i], status: style ? "installed" : "not-installed",
                updated: style ? sync.localUpdated(style, d.parse) : null });
        } catch (_) {
            versions.push({ id: ids[i], status: "unavailable", updated: null });
        }
    }
    return versions;
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
    var installed = c.installed || 0;
    var updated = c.updated || 0;
    var failed = c.failed || 0;
    var skipped = c.skipped || 0;
    var unverified = c.unverified || 0;
    var parts = [];
    if (installed) parts.push("Epps Bluebook style installed");
    if (updated) parts.push("Updated " + updated + (updated === 1 ? " style" : " styles"));
    if (unverified) {
        parts.push(unverified + (unverified === 1 ? " style" : " styles") +
            " installed but not verified");
    }
    if (failed) {
        parts.push(failed + (failed === 1 ? " check failed" : " checks failed"));
        if (res.results && res.results.some(function (r) { return r.stage === "collision"; })) {
            parts.push("style conflict: review Settings → Cite → Styles");
        }
    }
    if (skipped) {
        parts.push(skipped + (skipped === 1 ? " style" : " styles") +
            " skipped: invalid metadata");
    }
    if (parts.length) return parts.join("; ");
    if (c.alreadyInstalled) return "Epps Bluebook style already installed";
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
    var sync = BCF.styleSync;
    var etAl = BCF.etAl;
    return {
        parse: sync._parseXML,
        getInstalledStyles: function () { return Zotero.Styles.getAll(); },
        installTargets: function (id) {
            var match = /[^\/]+$/.exec(id);
            var name = Zotero.File.getValidFileName(match ? match[0] : id);
            if (name.slice(-4).toLowerCase() !== ".csl") name += ".csl";
            var visible = Zotero.getStylesDirectory().clone();
            var hidden = visible.clone();
            visible.append(name); hidden.append("hidden"); hidden.append(name);
            return [visible, hidden];
        },
        styleUsesFile: function (style, target) {
            var file = style.path ? Zotero.File.pathToFile(style.path) : style.file;
            return file ? target.equals(file) : false;
        },
        withStyleChange: function (task, current) {
            if (!etAl || typeof etAl.withStyleChange !== "function") {
                return Promise.reject(new Error("Style-change command gate unavailable"));
            }
            return etAl.withStyleChange(task, current);
        },
        setupNoticeDue: function (now) {
            var last = Number(Zotero.Prefs.get(sync.PREF_SETUP_ATTEMPT, true));
            return !isFinite(last) || last <= 0 || last > now || now - last >= sync.CHECK_INTERVAL_MS;
        },
        setupResult: function (result, now) {
            Zotero.Prefs.set(sync.PREF_SETUP_STATUS, sync.summaryLabel(result), true);
            Zotero.Prefs.set(sync.PREF_SETUP_ATTEMPT, String(now), true);
        },
        notifyInstalled: function () {
            var notice = new Zotero.ProgressWindow({ closeOnClick: true });
            notice.changeHeadline("Bluebook Citations Fixer");
            notice.addDescription("Epps Bluebook style installed");
            notice.show();
            notice.startCloseTimer(5000);
        },
        notifySetupFailure: function (result) {
            var failure = result.results.find(function (r) {
                return r.status === "failed" || r.status === "skipped" || r.status === "unverified";
            });
            var message = failure && failure.status === "unverified"
                ? "Automatic style installation could not be verified."
                : failure && failure.stage === "download"
                    ? "The Epps Bluebook style could not be downloaded."
                    : "The Epps Bluebook style could not be installed.";
            var notice = new Zotero.ProgressWindow({ closeOnClick: true });
            notice.changeHeadline("Epps Bluebook style unavailable");
            notice.addDescription(failure && failure.stage === "collision"
                ? "An existing style or file conflicts with the Epps style. Review Settings → Cite → Styles. No style was replaced."
                : message + " Open Settings → BB Citations Fixer and use Install style to retry.");
            notice.show();
            notice.startCloseTimer(10000);
        },
        delay: function () { return Zotero.Promise.delay(100); },
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
            // Enter Zotero's installer immediately after the collision check,
            // without adding a microtask before its destination selection.
            return Zotero.Styles.install({ string: text }, id, true);
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

// Settings installs use the same validated-byte, identity, collision and
// native-reset protections as startup repair. Preserve a style that appears
// while the download or command wait is in progress.
BCF.styleSync.installStyle = async function (id, deps) {
    var sync = BCF.styleSync, d = sync._mergeDeps(deps), gen = sync._generation;
    function live() { return sync._generation === gen; }
    var text = await d.fetch(id);
    if (!live()) throw new Error("Style installation cancelled");
    var metadata = sync.parseMetadata(text, d.parse);
    if (!metadata || metadata.id !== id || metadata.updated === null || !metadata.title) {
        throw new Error("Downloaded style identity or metadata is invalid");
    }
    await d.validate(text);
    if (!live()) throw new Error("Style installation cancelled");
    var installed = await d.withStyleChange(async function () {
        var existing = await d.getStyle(id);
        if (!live()) return false;
        if (existing) return true;
        sync.assertInstallSafe(metadata, d);
        await d.install(id, text);
        if (!live()) return false;
        var after = await d.getStyle(id);
        if (!live()) return false;
        if (!after || sync.localUpdated(after, d.parse) !== metadata.updated) {
            throw new Error("Style installation could not be verified");
        }
        return true;
    }, live);
    if (!installed || !live()) throw new Error("Style installation cancelled");
    return true;
};

// ---------------------------------------------------------------------------
// Per-style check. Never rejects.
// ---------------------------------------------------------------------------

// Returns { id, status, remote?, local?, error? } with status one of
// "installed" | "already-installed" | "updated" | "up-to-date" |
// "not-installed" | "skipped" | "failed" |
// "unverified" | "cancelled". Pre-install failures ("failed"/"skipped") leave
// the local style untouched; once install() has started, Zotero owns the file
// and recovery is its business — "unverified" means install() resolved but the
// re-read installed style did not carry the fetched <updated> (or couldn't be
// re-read), so the pane must not claim "Updated".
BCF.styleSync.checkStyle = async function (id, deps, generation, setupOnly) {
    // Captured at entry: shutdown sets BCF = null, and this body outlives it.
    var sync = BCF.styleSync;
    var diag = BCF.diag;
    var d = sync._mergeDeps(deps);   // idempotent; a partial deps stays whole
    var gen = generation === undefined ? sync._generation : generation;
    function live() { return sync._generation === gen; }
    var setup = !!setupOnly && id === BCF.patch.PRIMARY_STYLE_ID && sync.styleIDs().indexOf(id) !== -1;
    var stage = "lookup";


    try {
        var style = await d.getStyle(id);
        if (!live()) return { id: id, status: "cancelled" };
        if (setup && style) {
            return { id: id, status: "already-installed" };
        }
        if (!style && !setup) {
            diag.event("style-sync", "not installed: " + id);
            return { id: id, status: "not-installed" };
        }

        var local = sync.localUpdated(style, d.parse);
        if (style && local === null) {
            diag.event("style-sync", "skip (unreadable local <updated>): " + id);
            return { id: id, status: "skipped", error: "local updated unreadable" };
        }

        stage = "download";
        var text = await d.fetch(id);
        if (!live()) return { id: id, status: "cancelled" };

        stage = "metadata";
        var metadata = sync.parseMetadata(text, d.parse);
        var remoteID = metadata && metadata.id;
        if (remoteID !== id) {
            diag.event("style-sync", "skip (remote <id> mismatch): " + id +
                " -> " + (remoteID === null ? "(none)" : remoteID));
            return { id: id, status: "failed", error: "remote id mismatch" };
        }

        var remote = metadata.updated;
        if (remote === null) {
            diag.event("style-sync", "skip (unreadable remote <updated>): " + id);
            return { id: id, status: "skipped", error: "remote updated unreadable" };
        }

        if (style && !sync.isRemoteNewer(remote, local)) {
            diag.event("style-sync", "up to date: " + id);
            return { id: id, status: "up-to-date", remote: remote, local: local };
        }

        // Validate BEFORE anything can touch the installed file.
        stage = "validation";
        await d.validate(text);
        if (!live()) return { id: id, status: "cancelled" };

        // Reserve the shared command gate through final local-state checks,
        // install/reinit, and verification. New commands cannot enter during
        // any of these awaits; preference resets use the same queue.
        var result = await d.withStyleChange(async function () {
            if (!live()) return { id: id, status: "cancelled" };
            var currentStyle = await d.getStyle(id);
            if (!live()) return { id: id, status: "cancelled" };
            if (setup && currentStyle) return { id: id, status: "already-installed" };
            if (!setup) {
                if (!currentStyle) return { id: id, status: "not-installed" };
                local = sync.localUpdated(currentStyle, d.parse);
                if (local === null) return { id: id, status: "skipped", error: "local updated unreadable" };
                if (!sync.isRemoteNewer(remote, local)) return { id: id, status: "up-to-date", local: local, remote: remote };
            }

            // Mandatory final check: nothing may start an install after cancel().
            if (!live()) return { id: id, status: "cancelled" };
            stage = "collision";
            sync.assertInstallSafe(metadata, d);
            stage = "install";
            await d.install(id, text);
            if (!live()) return { id: id, status: "cancelled" };

            // Post-install verification: install() resolving proves nothing about
            // what is on disk (silent=true swallows installer errors). Re-read the
            // style and require its <updated> to equal the bytes we installed.
            var after = null;
            try {
                after = sync.localUpdated(await d.getStyle(id), d.parse);
            } catch (e) {
                try { diag.err("style-sync post-install re-read " + id, e); } catch (_) {}
            }
            if (!live()) return { id: id, status: "cancelled" };
            if (after !== remote) {
                diag.event("style-sync", "installed but unverified: " + id +
                    " installed=" + (after === null ? "(unreadable)" : new Date(after).toISOString()) +
                    " expected=" + new Date(remote).toISOString());
                return { id: id, status: "unverified", remote: remote, local: local,
                         installed: after, error: "post-install <updated> mismatch" };
            }
            if (setup) {
                return { id: id, status: "installed", remote: remote, local: local };
            }
            diag.event("style-sync", "updated " + id + " -> " + new Date(remote).toISOString());
            return { id: id, status: "updated", remote: remote, local: local };
        }, live);
        if (!live()) return { id: id, status: "cancelled" };
        if (result && result.status === "installed") {
            try { d.notifyInstalled(); } catch (e) { diag.err("style setup notification", e); }
        }
        return result || { id: id, status: "cancelled" };
    } catch (e) {
        try { diag.err("style-sync " + id, e); } catch (_) {}
        return { id: id, status: "failed", stage: stage, error: String(e) };
    }
};

// ---------------------------------------------------------------------------
// Top-level check: reentrancy guard + throttle bookkeeping.
// ---------------------------------------------------------------------------

BCF.styleSync._COUNT_KEYS = {
    "already-installed": "alreadyInstalled",
    "installed": "installed",
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
BCF.styleSync.check = function (deps, setupOnly) {
    var sync = BCF.styleSync;
    if (sync._inFlight) {
        if (sync._inFlightSetup && !setupOnly) {
            if (sync._queuedRoutine) return sync._queuedRoutine;
            var gen = sync._generation;
            var queued = sync._inFlight.then(function () {
                if (sync._generation !== gen) return { results: [], counts: { cancelled: 1 }, checkedAt: null };
                return sync.check(deps, false);
            });
            sync._queuedRoutine = queued;
            var clearQueued = function () {
                if (sync._queuedRoutine === queued) sync._queuedRoutine = null;
            };
            queued.then(clearQueued, clearQueued);
            return queued;
        }
        return sync._inFlight;
    }
    var promise = sync._run(deps, setupOnly);
    sync._inFlight = promise;
    sync._inFlightSetup = !!setupOnly;
    var clear = function () {
        if (sync._inFlight === promise) {
            sync._inFlight = null;
            sync._inFlightSetup = false;
        }
    };
    promise.then(clear, clear);
    return promise;
};

BCF.styleSync._run = async function (deps, setupOnly) {
    var sync = BCF.styleSync;
    var diag = BCF.diag;
    var gen = sync._generation;
    var d = sync._mergeDeps(deps);
    var ids = sync.styleIDs();
    if (setupOnly) ids = ids.indexOf(BCF.patch.PRIMARY_STYLE_ID) !== -1
        ? [BCF.patch.PRIMARY_STYLE_ID] : [];
    var counts = {
        alreadyInstalled: 0, installed: 0, updated: 0, upToDate: 0, notInstalled: 0,
        skipped: 0, failed: 0, unverified: 0, cancelled: 0
    };
    var results = [];

    for (var i = 0; i < ids.length; i++) {
        var r;
        try {
            r = sync._generation !== gen ? { id: ids[i], status: "cancelled" }
                : await sync.checkStyle(ids[i], d, gen, setupOnly);
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
    // Routine update attempts maintain the daily throttle. Presence repair
    // records a separate status and retries missing main on the next startup.
    // A shut-down plugin must not write preferences or show a notice.
    if (sync._generation === gen) {
        if (setupOnly && results.length) {
            var result = { results: results, counts: counts };
            var failed = counts.failed || counts.skipped || counts.unverified;
            var noticeDue = false;
            // Read the previous attempt before setupResult replaces it. Only
            // the popup is throttled; repairs and Settings status always run.
            if (failed) {
                try { noticeDue = d.setupNoticeDue(checkedAt); }
                catch (e) { diag.err("style setup notice throttle", e); }
            }
            try { d.setupResult(result, checkedAt); }
            catch (e) { diag.err("style setup status", e); }
            if (failed && noticeDue) {
                try { d.notifySetupFailure(result); } catch (e) { diag.err("style setup warning", e); }
            }
        } else if (!setupOnly) sync._setLastCheck(checkedAt);
    }
    try { diag.event("style-sync", { done: counts }); } catch (_) {}
    return { results: results, counts: counts, checkedAt: checkedAt };
};

// ---------------------------------------------------------------------------
// Startup scheduling + teardown.
// ---------------------------------------------------------------------------

// Startup presence repair runs once after 5 seconds, independently of the
// update preference/throttle. Completion schedules the ordinary 60-second
// update timer when due. Both routes use the same in-flight guard.
BCF.styleSync.scheduleStartupCheck = function () {
    try {
        var sync = BCF.styleSync;
        var diag = BCF.diag;
        if (!sync.shouldSetup(Date.now()) && !sync.shouldCheck(Date.now())) {
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
                        if (sync.shouldSetup(Date.now())) {
                            sync._setupCheckedThisStartup = true;
                            // If a manual update check was already running,
                            // finish it, then retry setup through the same guard.
                            var prior = sync._inFlight || Promise.resolve();
                            prior.then(function () {
                                if (sync._generation === gen) return sync.check(null, true);
                            }).then(function () {
                                if (sync._generation === gen) sync.scheduleStartupCheck();
                            }).catch(function (e) { diag.err("style setup", e); });
                            return;
                        }
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
            sync.shouldSetup(Date.now()) ? sync.SETUP_DELAY_MS : sync.STARTUP_DELAY_MS,
            Components.interfaces.nsITimer.TYPE_ONE_SHOT
        );
        diag.event("style-sync", "startup check scheduled (+" +
            (sync.shouldSetup(Date.now()) ? sync.SETUP_DELAY_MS : sync.STARTUP_DELAY_MS) + "ms)");
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
