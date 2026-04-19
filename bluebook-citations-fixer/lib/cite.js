"use strict";

// CSL_CITATION / Zotero.Integration.Citation helpers.

BCF.cite = {};

// Extract the CSL_CITATION JSON from a Zotero field code (the string that comes
// out of Field.getCode()). The code looks like:
//   ADDIN ZOTERO_ITEM CSL_CITATION { ...json... }
BCF.cite.parseFieldCode = function (code) {
    if (!code) return null;
    var idx = code.indexOf("CSL_CITATION");
    if (idx === -1) return null;
    var jsonStart = code.indexOf("{", idx);
    if (jsonStart === -1) return null;
    var depth = 0, end = -1;
    for (var i = jsonStart; i < code.length; i++) {
        var ch = code.charAt(i);
        if (ch === "{") depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0) { end = i; break; }
        }
    }
    if (end === -1) return null;
    try {
        return JSON.parse(code.slice(jsonStart, end + 1));
    } catch (_) {
        return null;
    }
};

// Stable per-item key. Prefers the first Zotero URI, then the id.
BCF.cite.itemKey = function (citItem) {
    if (!citItem) return "";
    if (citItem.uris && citItem.uris.length) return citItem.uris[0];
    if (citItem.uri && citItem.uri.length) return citItem.uri[0];
    if (citItem.id != null) return "id:" + citItem.id;
    return "";
};

// Author surnames (or literal/name fallbacks) from an itemData object.
BCF.cite.surnames = function (itemData) {
    var authors = (itemData && itemData.author) || [];
    var out = [];
    for (var i = 0; i < authors.length; i++) {
        var a = authors[i] || {};
        var s = a.family || a.literal || a.name || "";
        if (s) out.push(s);
    }
    return out;
};

// Concatenated lowercased surnames. Two items with the same authorKey are
// treated as potentially ambiguous. Empty string if no authors.
BCF.cite.authorKey = function (itemData) {
    var ss = BCF.cite.surnames(itemData);
    if (!ss.length) return "";
    return ss.join("|").toLowerCase();
};

// Short title to inject. Prefers `title-short`; falls back to full title.
BCF.cite.shortTitle = function (itemData) {
    if (!itemData) return "";
    return itemData["title-short"] || itemData.title || "";
};

// citeproc position: 0=first, 1=subsequent, 2=ibid, 3=ibid-with-locator.
// Undefined falls back to 0.
BCF.cite.POSITION_FIRST = 0;
BCF.cite.isSubsequentPosition = function (citItem) {
    var p = citItem && citItem.position;
    return p !== undefined && p !== null && p !== BCF.cite.POSITION_FIRST;
};

// Extract the citation items array from either a raw CSL_CITATION JSON (from
// the field code) or a live Zotero.Integration.Citation object on the session.
BCF.cite.itemsOf = function (citOrJson) {
    if (!citOrJson) return [];
    if (Array.isArray(citOrJson.citationItems)) return citOrJson.citationItems;
    return [];
};

// Pull the citationID out of whatever we were given.
BCF.cite.idOf = function (citOrJson) {
    if (!citOrJson) return "";
    return citOrJson.citationID || (citOrJson.properties && citOrJson.properties.citationID) || "";
};

// Regex-escape helper.
BCF.cite.escapeRegex = function (s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};
