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

// Find the RTF-offset index that corresponds to the first match of `needleRe`
// in the plainish projection.  Returns the RTF offset, or -1.
// Walks the RTF once, tracking plainish-offset alongside, so we can insert
// at the right spot without mangling control words.
BCF.rtf.findPlainOffset = function (rtf, needleRe) {
    // Build a parallel array of [plainChar, rtfIndex] for each visible char.
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

    var m = needleRe.exec(plain);
    if (!m) return -1;
    if (m.index >= map.length) return rtf.length;
    return map[m.index][1];
};
