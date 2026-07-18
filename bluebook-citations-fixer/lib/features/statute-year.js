"use strict";

// Feature: suppress the trailing year parenthetical for statute citations when
// the statute's name already ends in that same four-digit year (Bluebook
// 12.3.2 — "...Act of 2010" should not repeat "(2010)"). The strip fires only
// when the parenthetical year equals the year the title ends in, so a codified
// statute's code-edition year (e.g. "18 U.S.C. § 1 (2018)") is preserved even
// when the act name carries a different year.

BCF.features.statuteYear = {
    id: "statute-year",

    rewrite: function (ctx) {
        return BCF.features.statuteYear.rewriteText(ctx.text, ctx.codeJson, ctx.run);
    },

    rewriteCitation: function (ctx) {
        if (!ctx || !ctx.citation) return ctx && ctx.text;
        return BCF.features.statuteYear.rewriteText(ctx.text, ctx.citation, ctx.run);
    },

    rewriteText: function (text, codeJson, run) {
        var items = BCF.cite.itemsOf(codeJson);
        if (!items.length) return text;

        var segments = BCF.rtf.segments(text, items.length);
        if (!segments) {
            BCF.diag.event("skip:statute-year", "could not split multi-cite cluster");
            return text;
        }

        var rewrote = false;
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var data = BCF.run.itemData(run, item);
            if (!BCF.cite.isStatute(data)) continue;
            var year = BCF.cite.titleTrailingYear(data);
            if (!year) continue;

            var seg = segments[i];
            var newSeg = BCF.features.statuteYear._rewriteSegment(seg.text, year);
            if (newSeg !== null && newSeg !== seg.text) {
                seg.text = newSeg;
                rewrote = true;
            }
        }

        if (!rewrote) return text;

        var out = "";
        for (var j = 0; j < segments.length; j++) {
            if (j > 0) out += segments[j].sep || "; ";
            out += segments[j].text;
        }
        return out;
    },

    // `year` is always exactly four digits (from titleTrailingYear), so it is
    // safe to interpolate into the regex without escaping.
    _rewriteSegment: function (segRtf, year) {
        var plain = BCF.rtf.plainish(segRtf);
        if (!new RegExp("\\s\\(" + year + "\\)\\s*$").test(plain)) return null;
        return segRtf.replace(new RegExp("\\s+\\(" + year + "\\)\\s*$"), "");
    }
};
