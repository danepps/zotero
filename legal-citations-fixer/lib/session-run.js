"use strict";

// Per-run state cached on a Zotero.Integration.Session.
//
// Zotero creates a Session when a command like addCitation/refresh starts;
// it's available as Zotero.Integration.currentSession during the run and
// cleared in the finally block afterward. Each of its citationsByIndex entries
// holds the full CSL_CITATION shape (citationItems + properties).
//
// The "ambiguity map" (authorKey -> Set<itemKey>) only needs to be computed
// once per run -- we stash it on the session under a private key.

LCF.run = {};
LCF.run.KEY = "__legalCitationsFixer";

LCF.run.forSession = function (session) {
    if (!session) return null;
    if (session[LCF.run.KEY]) return session[LCF.run.KEY];
    var ctx = LCF.run._build(session);
    try {
        Object.defineProperty(session, LCF.run.KEY, {
            value: ctx, writable: true, configurable: true, enumerable: false
        });
    } catch (_) {
        session[LCF.run.KEY] = ctx;
    }
    return ctx;
};

LCF.run._build = function (session) {
    var items = new Map();          // itemKey -> itemData
    var authorBuckets = new Map();  // authorKey -> Set<itemKey>

    var byIndex = session.citationsByIndex || [];
    for (var i = 0; i < byIndex.length; i++) {
        var cit = byIndex[i];
        if (!cit) continue;
        var itemsArr = LCF.cite.itemsOf(cit);
        for (var ci = 0; ci < itemsArr.length; ci++) {
            var ci_ = itemsArr[ci];
            var data = ci_.itemData || {};
            var key = LCF.cite.itemKey(ci_);
            var authorKey = LCF.cite.authorKey(data);
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

    return {
        session: session,
        items: items,                 // Map<itemKey, itemData>
        ambiguousKeys: ambiguousKeys, // Set<itemKey>
        firstCiteSeen: new Set(),     // itemKeys whose full cite we've handled
        log: []
    };
};

// Convenience: is this item one whose author is also used by some other
// distinct item in the document?
LCF.run.isAmbiguous = function (ctx, citItem) {
    return ctx.ambiguousKeys.has(LCF.cite.itemKey(citItem));
};

// Pull itemData for an item from the session-wide cache (falls back to the
// itemData embedded in the field's own CSL_CITATION JSON).
LCF.run.itemData = function (ctx, citItem) {
    var key = LCF.cite.itemKey(citItem);
    if (ctx.items.has(key)) return ctx.items.get(key);
    return citItem.itemData || {};
};
