"use strict";

// Feature: Bluebook Rule 4.2(b) "hereinafter".
//
// When a document cites multiple works by the same author:
//   First cite: append  [hereinafter Author, <i>Short Title</i>]
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
        return BCF.features.hereinafter.rewriteText(ctx.text, ctx.codeJson, ctx.run);
    },

    rewriteCitation: function (ctx) {
        if (!ctx || !ctx.citation) return ctx && ctx.text;
        return BCF.features.hereinafter.rewriteText(ctx.text, ctx.citation, ctx.run);
    },

    rewriteText: function (text, codeJson, run) {
        var items = BCF.cite.itemsOf(codeJson);
        if (!items.length) return text;

        // Decide up front whether any item in this cluster is actually
        // eligible and has a usable short title. If none, short-circuit.
        var anyWork = false;
        for (var i = 0; i < items.length; i++) {
            if (BCF.run.shouldUseHereinafter(run, items[i])) { anyWork = true; break; }
        }
        if (!anyWork) {
            BCF.diag.event("skip:hereinafter", "no eligible item in cluster");
            return text;
        }

        // Split multi-item clusters into per-subcite segments.
        var segments = BCF.rtf.segments(text, items.length);
        if (!segments) {
            BCF.diag.event("skip:hereinafter", "could not split multi-cite cluster");
            return text;
        }

        var rewrote = false;
        for (var j = 0; j < items.length; j++) {
            var item = items[j];
            if (!BCF.run.shouldUseHereinafter(run, item)) continue;
            var data = BCF.run.itemData(run, item);
            var shortTitle = BCF.cite.shortTitle(data);
            if (!shortTitle) {
                BCF.diag.event("skip:hereinafter", "no short title for " + BCF.cite.itemKey(item));
                continue;
            }

            var seg = segments[j];
            var newSeg = BCF.features.hereinafter._rewriteSegment(
                seg.text, item, data, shortTitle
            );
            if (newSeg !== null && newSeg !== seg.text) {
                seg.text = newSeg;
                rewrote = true;
            }
        }

        if (!rewrote) {
            BCF.diag.event("skip:hereinafter", "no rewrite");
            return text;
        }

        // Rejoin.
        var out = "";
        for (var k = 0; k < segments.length; k++) {
            if (k > 0) out += segments[k].sep || "; ";
            out += segments[k].text;
        }
        return out;
    },

    _rewriteSegment: function (segRtf, citItem, itemData, shortTitle) {
        // Dispatch: subsequent-cite path (by citeproc position OR text-match
        // on "supra note", since citeproc sometimes reports position=0 for
        // short-form cites) vs. first-cite path.
        var isSubsequent = BCF.cite.isSubsequentPosition(citItem) ||
            BCF.features.hereinafter._hasSupraNote(segRtf);

        if (isSubsequent) {
            return BCF.features.hereinafter._rewriteSubsequent(segRtf, shortTitle);
        }
        return BCF.features.hereinafter._rewriteFirst(segRtf, itemData, shortTitle);
    },

    _hasSupraNote: function (rtf) {
        return /\bsupra\s+note\b/i.test(BCF.rtf.plainish(rtf));
    },

    _hasIdCite: function (rtf) {
        return /\bid\./i.test(BCF.rtf.plainish(rtf));
    },

    _rewriteFirst: function (segRtf, itemData, shortTitle) {
        var plain = BCF.rtf.plainish(segRtf);
        // Idempotency: already has "[hereinafter ...<shortTitle>...]" (loose).
        // Matches both the legacy form ("[hereinafter <ShortTitle>]") and the
        // current form ("[hereinafter Author, <ShortTitle>]") so we don't
        // double-inject when reprocessing a document.
        var rx = new RegExp(
            "\\[hereinafter\\b[^\\]]*" + BCF.cite.escapeRegex(shortTitle) + "[^\\]]*\\]",
            "i"
        );
        if (rx.test(plain)) return null;
        // Safety: never append [hereinafter] to short-form cites.
        if (/\bsupra\s+note\b/i.test(plain)) return null;
        if (BCF.features.hereinafter._hasIdCite(segRtf)) return null;

        // Append inline RTF. setText wraps the whole string in {\rtf ...} if
        // needed; inline groups are fine.
        var authorPrefix = BCF.features.hereinafter._authorPrefix(itemData);
        var inside = (authorPrefix ? authorPrefix + ", " : "") +
            BCF.rtf.italic(shortTitle);
        return segRtf + " [hereinafter " + inside + "]";
    },

    // Bluebook short-form author rendering (rule 15.1, applied inside the
    // hereinafter bracket): single surname, "X & Y" for two authors, and
    // "X et al." (with italicized "et al.") for three or more.
    _authorPrefix: function (itemData) {
        var surnames = BCF.cite.surnames(itemData);
        if (!surnames.length) return "";
        if (surnames.length === 1) return BCF.rtf.escape(surnames[0]);
        if (surnames.length === 2) {
            return BCF.rtf.escape(surnames[0]) + " & " +
                BCF.rtf.escape(surnames[1]);
        }
        return BCF.rtf.escape(surnames[0]) + " " + BCF.rtf.italic("et al.");
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
