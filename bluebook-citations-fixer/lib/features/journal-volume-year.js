"use strict";

// Feature: suppress trailing year parenthetical for journal citations when the
// volume itself is a four-digit year-like number.

BCF.features.journalVolumeYear = {
    id: "journal-volume-year",

    rewrite: function (ctx) {
        return BCF.features.journalVolumeYear.rewriteText(ctx.text, ctx.codeJson, ctx.run);
    },

    rewriteCitation: function (ctx) {
        if (!ctx || !ctx.citation) return ctx && ctx.text;
        return BCF.features.journalVolumeYear.rewriteText(ctx.text, ctx.citation, ctx.run);
    },

    rewriteText: function (text, codeJson, run) {
        var items = BCF.cite.itemsOf(codeJson);
        if (!items.length) return text;

        var segments = BCF.rtf.segments(text, items.length);
        if (!segments) {
            BCF.diag.event("skip:journal-volume-year", "could not split multi-cite cluster");
            return text;
        }

        var rewrote = false;
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var data = BCF.run.itemData(run, item);
            if (!BCF.cite.isJournalArticleLike(data) || !BCF.cite.hasFourDigitVolume(data)) {
                continue;
            }

            var seg = segments[i];
            var newSeg = BCF.features.journalVolumeYear._rewriteSegment(seg.text);
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

    _rewriteSegment: function (segRtf) {
        var plain = BCF.rtf.plainish(segRtf);
        if (!/\s\(\d{4}\)\s*$/.test(plain)) return null;
        return segRtf.replace(/\s+\(\d{4}\)\s*$/, "");
    }
};
