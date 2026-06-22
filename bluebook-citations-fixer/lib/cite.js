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
    // Track string state so braces inside a citation prefix/suffix (which JSON
    // does NOT escape, e.g. a user typing "see {foo}" or an unmatched "see }")
    // can't fool the brace counter into stopping early or running past the end.
    var depth = 0, end = -1, inStr = false, esc = false;
    for (var i = jsonStart; i < code.length; i++) {
        var ch = code.charAt(i);
        if (inStr) {
            if (esc) { esc = false; }
            else if (ch === "\\") { esc = true; }
            else if (ch === "\"") { inStr = false; }
            continue;
        }
        if (ch === "\"") inStr = true;
        else if (ch === "{") depth++;
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
    if (Array.isArray(citItem.uris) && citItem.uris.length) return citItem.uris[0];
    // `uri` is normally an array, but guard the string form too: indexing a
    // string would return its first character ("h" from an http URL) and
    // collapse unrelated items onto the same key.
    if (Array.isArray(citItem.uri) && citItem.uri.length) return citItem.uri[0];
    if (typeof citItem.uri === "string" && citItem.uri) return citItem.uri;
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

BCF.cite.normalizeTitleMarkup = function (s) {
    if (s == null) return "";
    s = String(s);
    s = s.replace(/<\/?(?:i|em|b|strong|sub|sup|span)[^>]*>/gi, "");
    s = s.replace(/<[^>]+>/g, "");
    s = s.replace(/&amp;/gi, "&");
    s = s.replace(/&lt;/gi, "<");
    s = s.replace(/&gt;/gi, ">");
    s = s.replace(/&quot;/gi, "\"");
    s = s.replace(/&#39;/gi, "'");
    s = s.replace(/&nbsp;/gi, " ");
    // Convert apostrophes between word characters to the typographic right
    // single quotation mark (U+2019), matching citeproc's smart-quotes pass
    // so injected short titles agree with the rendered first cite.
    s = s.replace(/(\w)'(\w)/g, "$1’$2");
    return s;
};

// Short title to inject. Prefers `title-short`; falls back to full title.
BCF.cite.shortTitle = function (itemData) {
    if (!itemData) return "";
    return BCF.cite.normalizeTitleMarkup(itemData["title-short"] || itemData.title || "");
};

// Full title as rendered in a first-cite. Prefers `title`; falls back to
// `title-short`. Use this whenever you need the form CSL emits in long-form
// citations (e.g. "ends in a numeral?" predicates that operate on the
// rendered cluster) — `shortTitle` would lie when the user has a
// `title-short` that doesn't preserve the numeral tail.
BCF.cite.fullTitle = function (itemData) {
    if (!itemData) return "";
    return BCF.cite.normalizeTitleMarkup(itemData.title || itemData["title-short"] || "");
};

BCF.cite.itemType = function (itemData) {
    if (!itemData) return "";
    return String(itemData.type || itemData.itemType || "").toLowerCase();
};

BCF.cite.isBookLike = function (itemData) {
    var t = BCF.cite.itemType(itemData);
    return t === "book" ||
        t === "chapter" ||
        t === "entry-encyclopedia" ||
        t === "entry-dictionary" ||
        t === "pamphlet" ||
        t === "manuscript";
};

BCF.cite.isJournalArticleLike = function (itemData) {
    var t = BCF.cite.itemType(itemData);
    return t === "article-journal" ||
        t === "article-magazine" ||
        t === "article-newspaper";
};

BCF.cite.titleEndsInNumeral = function (itemData) {
    // Operates on the long-form (first-cite) title because that's what CSL
    // renders into the cluster text book-at then rewrites.
    var title = BCF.cite.fullTitle(itemData);
    return /\d\s*$/.test(title);
};

BCF.cite.hasFourDigitVolume = function (itemData) {
    if (!itemData || itemData.volume == null) return false;
    return /^\d{4}$/.test(String(itemData.volume).trim());
};

BCF.cite.isStatute = function (itemData) {
    return BCF.cite.itemType(itemData) === "legislation";
};

// If the (long-form) title ends in a four-digit year-like numeral (e.g.
// "...Act of 2010"), return that year as a string; otherwise null. Operates on
// the long-form title because that's what CSL renders into the cluster text the
// statute-year feature then rewrites. Returning the captured year (not a bool)
// lets the feature suppress the trailing "(YYYY)" only when it matches.
BCF.cite.titleTrailingYear = function (itemData) {
    var title = BCF.cite.fullTitle(itemData);
    var m = /(?:^|\D)(\d{4})\s*$/.exec(title);
    return m ? m[1] : null;
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

// Best-effort note index extraction from a live citation/session object.
BCF.cite.noteIndexOf = function (citOrJson) {
    if (!citOrJson) return 0;
    var p = citOrJson.properties || {};
    var v = citOrJson.noteIndex != null ? citOrJson.noteIndex
        : (p.noteIndex != null ? p.noteIndex
        : (p.noteIndexAtInsertion != null ? p.noteIndexAtInsertion : 0));
    v = Number(v);
    return isNaN(v) ? 0 : v;
};

// Regex-escape helper.
BCF.cite.escapeRegex = function (s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// "Break id." sentinel. The citation-dialog checkbox stores this character at
// the head of a cite's `prefix` to flag "do not let this render as Id." (used
// when a hand-typed citation citeproc can't see intervenes between two Zotero
// cites of the same source). `prefix` round-trips reliably in the field code,
// so the flag persists across Refresh. U+200B (ZERO WIDTH SPACE) is used so the
// flag is invisible in the prefix box and the citation bubble even if a strip
// step is ever missed — a Private-Use-Area char would render as a visible
// .notdef box. It is category Cf (not whitespace), so Zotero won't trim it. The
// id-suppress feature detects it on the citationItem and strips it from the
// rendered RTF so it never reaches the document.
BCF.NOID_CP = 0x200B;
BCF.NOID_SENTINEL = String.fromCharCode(BCF.NOID_CP);

// True when a citationItem's prefix carries the sentinel.
BCF.cite.hasNoId = function (prefix) {
    return typeof prefix === "string" && prefix.indexOf(BCF.NOID_SENTINEL) !== -1;
};

// Remove every form of the sentinel from an RTF (or plain) string: the raw
// character, and citeproc-js's RTF escape for it (\uc0\uNNNN{}). Idempotent.
BCF.cite.stripNoId = function (rtf) {
    if (rtf == null) return rtf;
    var s = String(rtf);
    if (s.indexOf(BCF.NOID_SENTINEL) !== -1) {
        s = s.split(BCF.NOID_SENTINEL).join("");
    }
    var cp = BCF.NOID_CP;
    // citeproc-js RTF escape for a non-ASCII char (see lib/rtf.js escape()).
    s = s.replace(new RegExp("\\\\uc0\\\\u" + cp + "\\{\\}", "g"), "");
    // Defensive: a bare \uNNNN with optional trailing space / empty group.
    s = s.replace(new RegExp("\\\\u" + cp + "\\b\\s?(?:\\{\\})?", "g"), "");
    return s;
};
