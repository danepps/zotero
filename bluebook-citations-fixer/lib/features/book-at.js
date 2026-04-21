"use strict";

// Feature: when a book title ends in a numeral, force bare page locators into
// the Bluebook-style ", at <page>" form.

BCF.features.bookAt = {
    id: "book-at",

    rewrite: function (ctx) {
        return BCF.features.bookAt.rewriteText(ctx.text, ctx.codeJson, ctx.run);
    },

    rewriteCitation: function (ctx) {
        if (!ctx || !ctx.citation) return ctx && ctx.text;
        return BCF.features.bookAt.rewriteText(ctx.text, ctx.citation, ctx.run);
    },

    rewriteText: function (text, codeJson, run) {
        var items = BCF.cite.itemsOf(codeJson);
        if (!items.length) return text;

        var segments = BCF.rtf.segments(text, items.length);
        if (!segments) {
            BCF.diag.event("skip:book-at", "could not split multi-cite cluster");
            return text;
        }

        var rewrote = false;
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var data = BCF.run.itemData(run, item);
            var title = BCF.cite.shortTitle(data);
            var locator = item && item.locator != null ? String(item.locator).trim() : "";
            var label = item && item.label != null ? String(item.label).trim().toLowerCase() : "";
            var titleEndsInNumeral = BCF.cite.titleEndsInNumeral(data);

            if (!titleEndsInNumeral) continue;

            var seg = segments[i];
            var inferredLocator = BCF.features.bookAt._inferLocator(BCF.rtf.plainish(seg.text));
            if (!locator || !/^\d+(?:[-\u2013]\d+)?$/.test(locator)) {
                locator = inferredLocator;
            }
            if (label &&
                    label !== "page" &&
                    label !== "page-first" &&
                    label !== "page-subsequent" &&
                    label !== "locator") {
                continue;
            }

            if (!locator) continue;
            var newSeg = BCF.features.bookAt._rewriteSegment(seg.text, locator, title);
            if (newSeg !== null && newSeg !== seg.text) {
                seg.text = newSeg;
                rewrote = true;
                BCF.diag.event("book-at:rewrite", {
                    before: BCF.rtf.plainish(text),
                    after: BCF.rtf.plainish(newSeg)
                });
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

    _rewriteSegment: function (segRtf, locator, title) {
        var escapedLocator = BCF.cite.escapeRegex(locator);
        var plain = BCF.rtf.plainish(segRtf);
        var titleNumeralMatch = /(\d+)\s*$/.exec(title || "");
        if (!titleNumeralMatch) return null;

        var titleNumeral = titleNumeralMatch[1];
        var escapedTitleNumeral = BCF.cite.escapeRegex(titleNumeral);
        var tail = "(\\s*\\(\\d{4}\\))?\\s*$";
        if (new RegExp(escapedTitleNumeral + ",\\s*at\\s+" + escapedLocator + tail, "i").test(plain)) {
            return null;
        }
        if (!new RegExp(escapedTitleNumeral + "(?:,\\s*|\\s+)" + escapedLocator + tail, "i").test(plain)) {
            return null;
        }
        return segRtf.replace(
            new RegExp("(?:,\\s*|\\s+)(" + escapedLocator + ")(\\s*\\(\\d{4}\\))?\\s*$"),
            function (_, matchedLocator, yearPart) {
                return ", at " + matchedLocator + (yearPart || "");
            }
        );
    },

    _inferLocator: function (plain) {
        var m = /(?:,?\s+)(\d+(?:[-\u2013]\d+)?)(?:\s*\(\d{4}\))?\s*$/.exec(plain || "");
        return m ? m[1] : "";
    }
};
