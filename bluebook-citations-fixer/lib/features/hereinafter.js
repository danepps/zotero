"use strict";

// Feature: Bluebook Rule 4.2(b) "hereinafter".
//
// When a document cites multiple works by the same author:
//   First cite: append  [hereinafter <i>Short Title</i>]
//   Subsequent cite:    rewrite "Author, supra note N"
//                       to       "Author, <i>Short Title</i>, supra note N"
//
// Operates on the RTF string Zotero is about to write for a single cluster.
// Multi-item clusters ("A; B") are split on "; " so each hereinafter lands
// inline after its own sub-cite.
//
// Contract (see lib/patch.js):
//   rewrite(ctx) -> string | undefined
//     ctx = { session, field, codeJson, run, text, rtf }

BCF.features.hereinafter = {
    id: "hereinafter",

    rewrite: function (ctx) {
        var items = BCF.cite.itemsOf(ctx.codeJson);
        if (!items.length) return ctx.text;

        // Decide up front whether any item in this cluster is actually
        // ambiguous and has a usable short title. If none, short-circuit.
        var anyWork = false;
        for (var i = 0; i < items.length; i++) {
            if (BCF.run.isAmbiguous(ctx.run, items[i])) { anyWork = true; break; }
        }
        if (!anyWork) {
            BCF.diag.event("skip:hereinafter", "no ambiguous item in cluster");
            return ctx.text;
        }

        // Split multi-item clusters into per-subcite segments.
        var segments = BCF.features.hereinafter._segments(ctx.text, items.length);
        if (!segments) {
            // Fall back to single-segment operation — treat the whole cluster
            // as one cite. Only safe for single-item clusters.
            if (items.length !== 1) {
                BCF.diag.event("skip:hereinafter", "could not split multi-cite cluster");
                return ctx.text;
            }
            segments = [{ text: ctx.text, start: 0, end: ctx.text.length, sep: "" }];
        }

        var rewrote = false;
        for (var j = 0; j < items.length; j++) {
            var item = items[j];
            if (!BCF.run.isAmbiguous(ctx.run, item)) continue;
            var data = BCF.run.itemData(ctx.run, item);
            var shortTitle = BCF.cite.shortTitle(data);
            if (!shortTitle) {
                BCF.diag.event("skip:hereinafter", "no short title for " + BCF.cite.itemKey(item));
                continue;
            }

            var seg = segments[j];
            var newSeg = BCF.features.hereinafter._rewriteSegment(
                seg.text, item, shortTitle
            );
            if (newSeg !== null && newSeg !== seg.text) {
                seg.text = newSeg;
                rewrote = true;
            }
        }

        if (!rewrote) {
            BCF.diag.event("skip:hereinafter", "no rewrite");
            return ctx.text;
        }

        // Rejoin.
        var out = "";
        for (var k = 0; k < segments.length; k++) {
            if (k > 0) out += segments[k].sep || "; ";
            out += segments[k].text;
        }
        return out;
    },

    // Split the RTF cluster into per-sub-cite segments on the citeproc
    // cite-group delimiter "; ". Returns [{text, start, end, sep}] or null
    // if the split doesn't yield expectedCount segments.
    _segments: function (rtf, expectedCount) {
        if (expectedCount === 1) {
            return [{ text: rtf, start: 0, end: rtf.length, sep: "" }];
        }
        // Simple literal split — "; " is an ASCII pair that passes through
        // RTF escaping unchanged in practice. We split only at top level
        // (depth 0 braces) to avoid breaking inside {\i{}...} groups.
        var segs = [];
        var depth = 0;
        var start = 0;
        for (var i = 0; i < rtf.length; i++) {
            var ch = rtf.charAt(i);
            if (ch === "\\") { i += 1; continue; } // skip escaped char
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
    },

    _rewriteSegment: function (segRtf, citItem, shortTitle) {
        // Dispatch: subsequent-cite path (by citeproc position OR text-match
        // on "supra note", since citeproc sometimes reports position=0 for
        // short-form cites) vs. first-cite path.
        var isSubsequent = BCF.cite.isSubsequentPosition(citItem) ||
            BCF.features.hereinafter._hasSupraNote(segRtf);

        if (isSubsequent) {
            return BCF.features.hereinafter._rewriteSubsequent(segRtf, shortTitle);
        }
        return BCF.features.hereinafter._rewriteFirst(segRtf, shortTitle);
    },

    _hasSupraNote: function (rtf) {
        return /\bsupra\s+note\b/i.test(BCF.rtf.plainish(rtf));
    },

    _rewriteFirst: function (segRtf, shortTitle) {
        var plain = BCF.rtf.plainish(segRtf);
        // Idempotency: already has "[hereinafter <shortTitle>]" (loose).
        var rx = new RegExp(
            "\\[hereinafter\\s+" + BCF.cite.escapeRegex(shortTitle) + "\\s*\\]",
            "i"
        );
        if (rx.test(plain)) return null;
        // Safety: never append [hereinafter] to short-form cites.
        if (/\bsupra\s+note\b/i.test(plain)) return null;

        // Append inline RTF. setText wraps the whole string in {\rtf ...} if
        // needed; inline groups are fine.
        return segRtf + " [hereinafter " + BCF.rtf.italic(shortTitle) + "]";
    },

    _rewriteSubsequent: function (segRtf, shortTitle) {
        var plain = BCF.rtf.plainish(segRtf);
        // Idempotency: short title already appears before "supra note".
        var beforeSupra = new RegExp(
            BCF.cite.escapeRegex(shortTitle) + "[^,]*,?\\s*supra\\s+note",
            "i"
        );
        if (beforeSupra.test(plain)) return null;

        // Find ", supra note" in the plainish projection, insert before it
        // in the RTF at the equivalent offset.
        var needle = /,\s+supra\s+note\b/i;
        var rtfOffset = BCF.rtf.findPlainOffset(segRtf, needle);
        if (rtfOffset < 0) return null;

        var injection = ", " + BCF.rtf.italic(shortTitle);
        return segRtf.slice(0, rtfOffset) + injection + segRtf.slice(rtfOffset);
    }
};
