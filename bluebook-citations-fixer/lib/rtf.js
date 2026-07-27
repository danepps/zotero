"use strict";

// RTF helpers for citation rewriting.
//
// Zotero hands its RTF citations to the word-processor bridge using the
// citeproc-js RTF output format (see Zotero's citeproc.js, around line 22439).
//   italics      : {\i{}TEXT}
//   small caps   : {\scaps TEXT}
//   escape rule  : replace [\\{}] with \<char>
//   non-ASCII    : \uc0\uNNNN{}  (decimal codepoint)
//
// Integration.Field.setText auto-wraps the incoming string in {\rtf ...} if it
// spots a backslash, so inline RTF fragments like "{\i{}Foo}" are fine.

BCF.rtf = {};

// Escape literal text for inclusion inside an RTF string.
BCF.rtf.escape = function (s) {
    if (s == null) return "";
    s = String(s);
    var out = "";
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        var ch = s.charAt(i);
        if (ch === "\\" || ch === "{" || ch === "}") {
            out += "\\" + ch;
        } else if (c < 0x80) {
            out += ch;
        } else {
            // \uc0 disables ANSI-fallback bytes; the trailing {} keeps the
            // control word from eating following characters.
            out += "\\uc0\\u" + c + "{}";
        }
    }
    return out;
};

// Produce the RTF fragment for italicized text.
BCF.rtf.italic = function (s) {
    return "{\\i{}" + BCF.rtf.escape(s) + "}";
};

// Produce the RTF fragment for large-and-small-caps text. Used for book
// titles and author names under Bluebook typography (rules 15.1, 16, B14).
// citeproc-js's RTF output also uses `\scaps` for small caps.
BCF.rtf.smallCaps = function (s) {
    return "{\\scaps " + BCF.rtf.escape(s) + "}";
};

// Render a title parsed by BCF.cite.titleSegments inside an italic wrapper
// with citeproc-style flip-flop: spans the source marked <i>/<em> come out
// roman ({\i0{}...} — citeproc's @font-style/normal RTF form). With no
// marked spans the output is identical to italic().
BCF.rtf.italicTitle = function (segments) {
    var inner = "";
    for (var i = 0; i < segments.length; i++) {
        inner += segments[i].italic
            ? "{\\i0{}" + BCF.rtf.escape(segments[i].text) + "}"
            : BCF.rtf.escape(segments[i].text);
    }
    return "{\\i{}" + inner + "}";
};

// Small-caps counterpart: inside a small-caps title an <i>/<em> span stays
// italic (no flip — small caps isn't italics). With no marked spans the
// output is identical to smallCaps().
BCF.rtf.smallCapsTitle = function (segments) {
    var inner = "";
    for (var i = 0; i < segments.length; i++) {
        inner += segments[i].italic
            ? "{\\i{}" + BCF.rtf.escape(segments[i].text) + "}"
            : BCF.rtf.escape(segments[i].text);
    }
    return "{\\scaps " + inner + "}";
};

// Is the given string *likely* already RTF-wrapped?  Detects the outer
// {\rtf ...} envelope that Zotero wraps around rich cluster text.
BCF.rtf.isWrapped = function (s) {
    return /^\s*\{\\rtf/i.test(s);
};

// Strip RTF control words / braces to get an approximation of the plain text.
// Good enough for substring-style idempotency checks and for matching
// literal ASCII anchors like "supra note".  Not a full RTF parser.
BCF.rtf.plainish = function (s) {
    if (s == null) return "";
    // Decode \uNNNN escapes back to real characters.
    s = String(s).replace(/\\u(-?\d+)\b\s*\{\}?/g, function (_, n) {
        var cp = parseInt(n, 10);
        if (cp < 0) cp += 0x10000;
        try { return String.fromCharCode(cp); } catch (_) { return ""; }
    });
    // Drop control words like \i, \scaps, \rtf1, \pard, etc.
    s = s.replace(/\\[a-zA-Z]+-?\d*\s?/g, "");
    // Drop escape-doubled braces / backslashes.
    s = s.replace(/\\([\\{}])/g, "$1");
    // Drop stray braces.
    s = s.replace(/[{}]/g, "");
    return s;
};

// Walk the RTF once and build a parallel array of [plainChar, rtfIndex] for
// each visible character, plus the plainish projection itself. Shared by the
// offset/range helpers below so they all agree on the projection.
BCF.rtf._plainMap = function (rtf) {
    var map = [];
    var plain = "";
    var i = 0;
    while (i < rtf.length) {
        var ch = rtf.charAt(i);

        // Skip RTF groups that we treat as zero-width for our anchor search:
        // none for now — we want italics to count as visible chars so that
        // positions inside italic groups still resolve correctly.

        if (ch === "\\") {
            // \uNNNN{}: decode.
            var mU = /^\\u(-?\d+)\b\s?\{\}?/.exec(rtf.slice(i));
            if (mU) {
                var cp = parseInt(mU[1], 10);
                if (cp < 0) cp += 0x10000;
                var decoded = "";
                try { decoded = String.fromCharCode(cp); } catch (_) {}
                for (var k = 0; k < decoded.length; k++) {
                    map.push([decoded.charAt(k), i]);
                }
                plain += decoded;
                i += mU[0].length;
                continue;
            }
            // \<word><optional-digits><optional-space>: control word, drop.
            var mW = /^\\[a-zA-Z]+-?\d*\s?/.exec(rtf.slice(i));
            if (mW) { i += mW[0].length; continue; }
            // \<char>: literal escaped char.
            if (i + 1 < rtf.length) {
                map.push([rtf.charAt(i + 1), i]);
                plain += rtf.charAt(i + 1);
                i += 2;
                continue;
            }
            i += 1;
            continue;
        }
        if (ch === "{" || ch === "}") { i += 1; continue; }
        map.push([ch, i]);
        plain += ch;
        i += 1;
    }
    return { map: map, plain: plain };
};

// Find the RTF-offset index that corresponds to the first match of `needleRe`
// in the plainish projection.  Returns the RTF offset, or -1.
BCF.rtf.findPlainOffset = function (rtf, needleRe) {
    var pm = BCF.rtf._plainMap(rtf);
    var m = needleRe.exec(pm.plain);
    if (!m) return -1;
    if (m.index >= pm.map.length) return rtf.length;
    return pm.map[m.index][1];
};

// Like findPlainOffset, but returns the full RTF span of the first match:
// { start, end, match }. `end` is the RTF offset of the first visible char
// AFTER the match (or rtf.length), so invisible content (closing braces,
// control words) sitting between the match and the next visible char is
// included in the span — which keeps groups opened inside the span from
// leaking a stray closer into the tail. Returns null when there is no match.
BCF.rtf.findPlainRange = function (rtf, needleRe) {
    var pm = BCF.rtf._plainMap(rtf);
    var m = needleRe.exec(pm.plain);
    if (!m) return null;
    var start = m.index >= pm.map.length ? rtf.length : pm.map[m.index][1];
    var endIdx = m.index + m[0].length;
    var end = endIdx >= pm.map.length ? rtf.length : pm.map[endIdx][1];
    return { start: start, end: end, match: m };
};

// RTF offset of the visible character at `plainIdx` in the plainish
// projection (rtf.length when plainIdx is past the end).
BCF.rtf.plainIndexToRtf = function (rtf, plainIdx) {
    var pm = BCF.rtf._plainMap(rtf);
    if (plainIdx < 0) return -1;
    if (plainIdx >= pm.map.length) return rtf.length;
    return pm.map[plainIdx][1];
};

// Repair group balance after a splice: drop closing braces that would take
// the depth negative and append closers for any groups left open. Escaped
// \{ \} don't count. Splices that cut through a group can otherwise leave
// RTF that Word/LibreOffice reject outright; this trades that for (at worst)
// a slightly larger formatting span.
BCF.rtf.repairGroups = function (s) {
    var out = "";
    var depth = 0;
    for (var i = 0; i < s.length; i++) {
        var ch = s.charAt(i);
        if (ch === "\\") {
            out += ch;
            if (i + 1 < s.length) { out += s.charAt(i + 1); i++; }
            continue;
        }
        if (ch === "{") { depth++; out += ch; continue; }
        if (ch === "}") {
            if (depth > 0) { depth--; out += ch; }
            continue;
        }
        out += ch;
    }
    while (depth-- > 0) out += "}";
    return out;
};

// Split a multi-item RTF citation cluster on the citeproc cite-group delimiter
// "; ", but only at brace depth 0 so italic / small-caps groups stay intact.
// Returns [{text, start, end, sep}] of length expectedCount, or null if the
// split doesn't yield that many segments (caller should fall back to
// pass-through for multi-item clusters it can't split reliably).
BCF.rtf.segments = function (rtf, expectedCount) {
    if (expectedCount === 1) {
        return [{ text: rtf, start: 0, end: rtf.length, sep: "" }];
    }
    var segs = [];
    var depth = 0;
    var start = 0;
    for (var i = 0; i < rtf.length; i++) {
        var ch = rtf.charAt(i);
        if (ch === "\\") { i += 1; continue; }
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        else if (depth === 0 && ch === ";" && rtf.charAt(i + 1) === " ") {
            segs.push({
                text: rtf.slice(start, i),
                start: start, end: i, sep: "; "
            });
            start = i + 2;
            i += 1;
        }
    }
    segs.push({ text: rtf.slice(start), start: start, end: rtf.length, sep: "" });
    return segs.length === expectedCount ? segs : null;
};
