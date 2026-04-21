"use strict";

// Per-run state cached on a Zotero.Integration.Session.
//
// Zotero creates a Session when a command like addCitation/refresh starts;
// it's available as Zotero.Integration.currentSession during the run and
// cleared in the finally block afterward. citationsByIndex is an object keyed
// by field index; each value holds the full CSL_CITATION shape.
//
// The "ambiguity map" (authorKey -> Set<itemKey>) only needs to be computed
// once per run -- we stash it on the session under a private key.

BCF.run = {};
BCF.run.KEY = "__bluebookCitationsFixer";

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
    var items = new Map();          // itemKey -> itemData
    var authorBuckets = new Map();  // authorKey -> Set<itemKey>

    var byIndex = BCF.run.citationsInOrder(session);
    for (var i = 0; i < byIndex.length; i++) {
        var cit = byIndex[i];
        if (!cit) continue;
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
        }
    }

    var ambiguousKeys = new Set();
    authorBuckets.forEach(function (keys) {
        if (keys.size >= 2) keys.forEach(function (k) { ambiguousKeys.add(k); });
    });

    var ctx = {
        session: session,
        items: items,                 // Map<itemKey, itemData>
        ambiguousKeys: ambiguousKeys, // Set<itemKey>
        firstCiteSeen: new Set(),     // itemKeys whose full cite we've handled
        log: []
    };
    BCF.diag.event("session", {
        citations: byIndex.length,
        items: items.size,
        ambiguous: ambiguousKeys.size
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

// Convenience: is this item one whose author is also used by some other
// distinct item in the document?
BCF.run.isAmbiguous = function (ctx, citItem) {
    if (!ctx || !ctx.ambiguousKeys) return false;
    return ctx.ambiguousKeys.has(BCF.cite.itemKey(citItem));
};

// Pull itemData for an item from the session-wide cache (falls back to the
// itemData embedded in the field's own CSL_CITATION JSON).
BCF.run.itemData = function (ctx, citItem) {
    var key = BCF.cite.itemKey(citItem);
    if (ctx && ctx.items && ctx.items.has(key)) return ctx.items.get(key);
    return citItem.itemData || {};
};
