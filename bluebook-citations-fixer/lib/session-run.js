"use strict";

// Per-run state cached on a Zotero.Integration.Session.
//
// Zotero creates a Session when a command like addCitation/refresh starts;
// it's available as Zotero.Integration.currentSession during the run and
// cleared in the finally block afterward. citationsByIndex is an object keyed
// by field index; each value holds the full CSL_CITATION shape.
//
// Hereinafter eligibility is computed once per run and stashed on the session.
// A work qualifies when:
//   - It has at least one subsequent cite in the document (itemCount >= 2 — a
//     `[hereinafter Short]` on a work that's never cited again is pointless);
//     AND either
//   1. Two or more works with the same exact author list first appear in the
//      same footnote; or
//   2. At least two works with that exact author list are each cited three or
//      more times in the document.

BCF.run = {};
BCF.run.KEY = "__bluebookCitationsFixer";
BCF.run.FREQUENCY_THRESHOLD = 3;

BCF.run.PREF_CROSS_FOOTNOTE = "extensions.bluebook-citations-fixer.hereinafter.crossFootnote";
BCF.run.PREF_THRESHOLD = "extensions.bluebook-citations-fixer.hereinafter.frequencyThreshold";

// User-tunable hereinafter options, read from Zotero prefs with safe fallbacks.
// Mirrors the try/catch pattern in lib/diag.js so the Node test harness (which
// does not stub Zotero.Prefs) keeps the historical defaults: cross-footnote on,
// threshold 3.
//   - crossFootnote: when false, the frequency path (thresholdKeys) no longer
//     contributes to eligibleKeys, so only works that first appear together in
//     the same footnote get hereinafter treatment.
//   - threshold: replaces FREQUENCY_THRESHOLD; floored at 2 because eligibleKeys
//     already requires a work to be cited at least twice.
BCF.run.options = function () {
    var crossFootnote = true;
    var threshold = BCF.run.FREQUENCY_THRESHOLD;
    try {
        var v = Zotero.Prefs.get(BCF.run.PREF_CROSS_FOOTNOTE, true);
        if (v !== undefined && v !== null) crossFootnote = !!v;
    } catch (_) {}
    try {
        var n = parseInt(Zotero.Prefs.get(BCF.run.PREF_THRESHOLD, true), 10);
        if (!isNaN(n)) threshold = n;
    } catch (_) {}
    if (threshold < 2) threshold = 2;
    return { crossFootnote: crossFootnote, threshold: threshold };
};

BCF.run.clearSession = function (session) {
    if (!session) return;
    try {
        delete session[BCF.run.KEY];
    } catch (_) {
        try { session[BCF.run.KEY] = null; } catch (_) {}
    }
};

BCF.run.forSession = function (session) {
    if (!session) return null;
    if (session[BCF.run.KEY]) return session[BCF.run.KEY];
    var ctx = BCF.run._build(session);
    try {
        Object.defineProperty(session, BCF.run.KEY, {
            value: ctx, writable: true, configurable: true, enumerable: false
        });
    } catch (_) {
        session[BCF.run.KEY] = ctx;
    }
    return ctx;
};

// Fetch current CSL JSON directly from Zotero.Items, bypassing any itemData
// snapshot embedded in the citationItem. Used by _build so that library edits
// (e.g. changing a short title) are reflected on the next Refresh without
// requiring the user to re-insert the citation.
BCF.run._fetchLibraryData = function (citItem) {
    if (!citItem) return null;
    var id = citItem.id;
    if (id == null) return null;
    try {
        if (typeof Zotero === "undefined" || !Zotero.Items || !Zotero.Items.get) return null;
        var item = Zotero.Items.get(id);
        if (!item) return null;
        var util = Zotero.Utilities && (Zotero.Utilities.Item || Zotero.Utilities.Internal);
        if (util && typeof util.itemToCSLJSON === "function") {
            return util.itemToCSLJSON(item);
        }
        if (Zotero.Utilities && typeof Zotero.Utilities.itemToCSLJSON === "function") {
            return Zotero.Utilities.itemToCSLJSON(item);
        }
    } catch (e) {
        try { BCF.diag.err("fetchLibraryData:" + id, e); } catch (_) {}
    }
    return null;
};

// Lazily fetch CSL JSON for a citationItem when the live integration object
// doesn't carry `itemData`. Zotero 10's integration session attaches the item
// id but defers populating `itemData` until after citeproc runs, which is
// after our prewrite hook fires — so without this fallback the run map ends
// up empty and every feature silently bails.
BCF.run._cslFor = function (citItem) {
    if (!citItem) return null;
    if (citItem.itemData && Object.keys(citItem.itemData).length) {
        return citItem.itemData;
    }
    return BCF.run._fetchLibraryData(citItem);
};

BCF.run._build = function (session) {
    var items = new Map();              // itemKey -> itemData
    var authorBuckets = new Map();      // authorKey -> Set<itemKey>
    var itemCounts = new Map();         // itemKey -> count
    var itemFirstNotes = new Map();     // itemKey -> first note index
    var itemFirstNotesBySig = new Map();// author+title signature -> earliest note
    var noteFirstBuckets = new Map();   // authorKey -> Map<groupKey, Set<itemKey>>
    var enriched = 0;
    var liveHadData = 0;
    var noData = 0;
    var opts = BCF.run.options();

    var citations = BCF.run.citationsInOrder(session);
    for (var i = 0; i < citations.length; i++) {
        var cit = citations[i];
        if (!cit) continue;
        var noteIndex = BCF.cite.noteIndexOf(cit);
        var groupKey = noteIndex > 0 ? ("note:" + noteIndex) : ("cluster:" + i);
        var itemsArr = BCF.cite.itemsOf(cit);
        for (var ci = 0; ci < itemsArr.length; ci++) {
            var ci_ = itemsArr[ci];
            var data;
            // Prefer fresh data from the library so edits to a Zotero item
            // (e.g. changing a short title) are picked up on the next Refresh
            // without the user needing to re-insert the citation. The itemData
            // embedded in the field-code snapshot is used only as a fallback
            // when the live fetch fails (item deleted, unavailable, etc.).
            var freshData = BCF.run._fetchLibraryData(ci_);
            if (freshData) {
                data = freshData;
                enriched++;
                try { ci_.itemData = freshData; } catch (_) {}
            } else if (ci_.itemData && Object.keys(ci_.itemData).length) {
                data = ci_.itemData;
                liveHadData++;
            } else {
                noData++;
                data = {};
            }
            var key = BCF.cite.itemKey(ci_);
            var authorKey = BCF.cite.authorKey(data);
            if (!key || !authorKey) continue;

            if (!items.has(key)) items.set(key, data);
            if (!authorBuckets.has(authorKey)) authorBuckets.set(authorKey, new Set());
            authorBuckets.get(authorKey).add(key);
            itemCounts.set(key, (itemCounts.get(key) || 0) + 1);

            if (!itemFirstNotes.has(key)) {
                itemFirstNotes.set(key, noteIndex);
                if (!noteFirstBuckets.has(authorKey)) noteFirstBuckets.set(authorKey, new Map());
                var byNote = noteFirstBuckets.get(authorKey);
                if (!byNote.has(groupKey)) byNote.set(groupKey, new Set());
                byNote.get(groupKey).add(key);
            }

            // Track earliest note by author+title signature too, so two cites
            // of the same source that resolve to different item keys (duplicate
            // library items, or URI variance across insertions) still share a
            // first-note target for `supra`. Records the minimum note index.
            var sig = BCF.run._sigFor(data);
            if (sig) {
                var prevSig = itemFirstNotesBySig.get(sig);
                if (prevSig == null || noteIndex < prevSig) {
                    itemFirstNotesBySig.set(sig, noteIndex);
                }
            }
        }
    }

    var ambiguousKeys = new Set();
    authorBuckets.forEach(function (keys) {
        if (keys.size >= 2) keys.forEach(function (k) { ambiguousKeys.add(k); });
    });

    var sameFootnoteKeys = new Set();
    noteFirstBuckets.forEach(function (byNote) {
        byNote.forEach(function (keys) {
            if (keys.size >= 2) {
                keys.forEach(function (key) { sameFootnoteKeys.add(key); });
            }
        });
    });

    var thresholdKeys = new Set();
    authorBuckets.forEach(function (keys) {
        var qualifying = [];
        keys.forEach(function (key) {
            if ((itemCounts.get(key) || 0) >= opts.threshold) {
                qualifying.push(key);
            }
        });
        if (qualifying.length >= 2) {
            for (var i = 0; i < qualifying.length; i++) {
                thresholdKeys.add(qualifying[i]);
            }
        }
    });

    // A work is only eligible for hereinafter treatment if it actually has a
    // subsequent cite (count >= 2). Otherwise the `[hereinafter Short]` tag
    // attaches to a first-and-only cite that nothing ever references — pure
    // noise. (thresholdKeys requires count >= threshold (>= 2) so the filter is
    // a no-op for those, but apply it uniformly for clarity.)
    //
    // The frequency path (thresholdKeys) only folds in when the user leaves the
    // cross-footnote option on; the same-footnote path always applies.
    var eligibleKeys = new Set();
    sameFootnoteKeys.forEach(function (key) {
        if ((itemCounts.get(key) || 0) >= 2) eligibleKeys.add(key);
    });
    if (opts.crossFootnote) {
        thresholdKeys.forEach(function (key) {
            if ((itemCounts.get(key) || 0) >= 2) eligibleKeys.add(key);
        });
    }

    var ctx = {
        session: session,
        items: items,
        authorBuckets: authorBuckets,
        itemCounts: itemCounts,
        itemFirstNotes: itemFirstNotes,
        itemFirstNotesBySig: itemFirstNotesBySig,
        ambiguousKeys: ambiguousKeys,
        sameFootnoteKeys: sameFootnoteKeys,
        thresholdKeys: thresholdKeys,
        eligibleKeys: eligibleKeys,
        log: []
    };
    BCF.diag.event("session", {
        citations: citations.length,
        items: items.size,
        liveHadData: liveHadData,
        enriched: enriched,
        noData: noData,
        ambiguous: ambiguousKeys.size,
        sameFootnote: sameFootnoteKeys.size,
        threshold: thresholdKeys.size,
        eligible: eligibleKeys.size,
        crossFootnote: opts.crossFootnote,
        thresholdN: opts.threshold
    });
    return ctx;
};

BCF.run.citationsInOrder = function (session) {
    var byIndex = (session && session.citationsByIndex) || {};
    if (Array.isArray(byIndex)) return byIndex;
    var keys = Object.keys(byIndex);
    keys.sort(function (a, b) {
        var na = Number(a), nb = Number(b);
        var aNum = !isNaN(na), bNum = !isNaN(nb);
        if (aNum && bNum) return na - nb;
        if (aNum) return -1;
        if (bNum) return 1;
        return String(a).localeCompare(String(b));
    });
    var out = [];
    for (var i = 0; i < keys.length; i++) {
        if (byIndex[keys[i]]) out.push(byIndex[keys[i]]);
    }
    return out;
};

BCF.run.isAmbiguous = function (ctx, citItem) {
    if (!ctx || !ctx.ambiguousKeys) return false;
    return ctx.ambiguousKeys.has(BCF.cite.itemKey(citItem));
};

BCF.run.shouldUseHereinafter = function (ctx, citItem) {
    if (!ctx || !ctx.eligibleKeys) return false;
    return ctx.eligibleKeys.has(BCF.cite.itemKey(citItem));
};

// Author+title signature for an itemData. Lets two cites of the same source
// that resolve to different item keys still be recognized as the same work.
BCF.run._sigFor = function (data) {
    if (!data) return "";
    var ak = BCF.cite.authorKey(data);
    var title = BCF.cite.fullTitle(data).toLowerCase().replace(/\s+/g, " ").trim();
    if (!ak && !title) return "";
    return ak + "||" + title;
};

// Earliest note index at which a work first appears, for `supra note N`.
// Combines the URI-keyed first-note map with the author+title signature map and
// returns the smaller, so a duplicate library item / URI mismatch can't make a
// repeat cite point at itself. Returns undefined when the work isn't tracked.
BCF.run.firstNoteFor = function (ctx, citItem, data) {
    if (!ctx) return undefined;
    var notes = [];
    var key = BCF.cite.itemKey(citItem);
    if (ctx.itemFirstNotes && key != null && ctx.itemFirstNotes.has(key)) {
        notes.push(ctx.itemFirstNotes.get(key));
    }
    if (ctx.itemFirstNotesBySig) {
        var sig = BCF.run._sigFor(data || BCF.run.itemData(ctx, citItem));
        if (sig && ctx.itemFirstNotesBySig.has(sig)) {
            notes.push(ctx.itemFirstNotesBySig.get(sig));
        }
    }
    if (!notes.length) return undefined;
    return Math.min.apply(null, notes);
};

BCF.run.itemData = function (ctx, citItem) {
    var key = BCF.cite.itemKey(citItem);
    if (ctx && ctx.items && ctx.items.has(key)) return ctx.items.get(key);
    if (citItem && citItem.itemData && Object.keys(citItem.itemData).length) {
        return citItem.itemData;
    }
    var data = BCF.run._cslFor(citItem);
    if (data) {
        try { citItem.itemData = data; } catch (_) {}
        if (ctx && ctx.items && key) ctx.items.set(key, data);
        return data;
    }
    return {};
};
