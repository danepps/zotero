"use strict";

// Per-run state cached on a Zotero.Integration.Session.
//
// Zotero creates a Session when a command like addCitation/refresh starts;
// it's available as Zotero.Integration.currentSession during the run and
// cleared in the finally block afterward. citationsByIndex is an object keyed
// by field index; each value holds the full CSL_CITATION shape.
//
// Hereinafter eligibility is computed once per run and stashed on the session.
// A work qualifies when either:
//   1. Two or more works with the same exact author list first appear in the
//      same footnote; or
//   2. At least two works with that exact author list are each cited three or
//      more times in the document.

BCF.run = {};
BCF.run.KEY = "__bluebookCitationsFixer";
BCF.run.FREQUENCY_THRESHOLD = 3;

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

BCF.run._build = function (session) {
    var items = new Map();              // itemKey -> itemData
    var authorBuckets = new Map();      // authorKey -> Set<itemKey>
    var itemCounts = new Map();         // itemKey -> count
    var itemFirstNotes = new Map();     // itemKey -> first note index
    var noteFirstBuckets = new Map();   // authorKey -> Map<groupKey, Set<itemKey>>

    var citations = BCF.run.citationsInOrder(session);
    for (var i = 0; i < citations.length; i++) {
        var cit = citations[i];
        if (!cit) continue;
        var noteIndex = BCF.cite.noteIndexOf(cit);
        var groupKey = noteIndex > 0 ? ("note:" + noteIndex) : ("cluster:" + i);
        var itemsArr = BCF.cite.itemsOf(cit);
        for (var ci = 0; ci < itemsArr.length; ci++) {
            var ci_ = itemsArr[ci];
            var data = ci_.itemData || {};
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
            if ((itemCounts.get(key) || 0) >= BCF.run.FREQUENCY_THRESHOLD) {
                qualifying.push(key);
            }
        });
        if (qualifying.length >= 2) {
            for (var i = 0; i < qualifying.length; i++) {
                thresholdKeys.add(qualifying[i]);
            }
        }
    });

    var eligibleKeys = new Set();
    sameFootnoteKeys.forEach(function (key) { eligibleKeys.add(key); });
    thresholdKeys.forEach(function (key) { eligibleKeys.add(key); });

    var ctx = {
        session: session,
        items: items,
        authorBuckets: authorBuckets,
        itemCounts: itemCounts,
        itemFirstNotes: itemFirstNotes,
        ambiguousKeys: ambiguousKeys,
        sameFootnoteKeys: sameFootnoteKeys,
        thresholdKeys: thresholdKeys,
        eligibleKeys: eligibleKeys,
        log: []
    };
    BCF.diag.event("session", {
        citations: citations.length,
        items: items.size,
        ambiguous: ambiguousKeys.size,
        sameFootnote: sameFootnoteKeys.size,
        threshold: thresholdKeys.size,
        eligible: eligibleKeys.size
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

BCF.run.itemData = function (ctx, citItem) {
    var key = BCF.cite.itemKey(citItem);
    if (ctx && ctx.items && ctx.items.has(key)) return ctx.items.get(key);
    return citItem.itemData || {};
};
