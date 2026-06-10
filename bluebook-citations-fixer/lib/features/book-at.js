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
            BCF.diag.event("book-at:skip", {
                reason: "segments-mismatch",
                expected: items.length,
                plain: BCF.rtf.plainish(text).slice(0, 200)
            });
            return text;
        }

        var rewrote = false;
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var data = BCF.run.itemData(run, item);
            // The rendered first-cite uses the long-form title, so anchor
            // the regex on its trailing numeral — not `title-short`, which
            // a user may have abbreviated (e.g. "Stites") and which would
            // otherwise make the feature silently no-op.
            var title = BCF.cite.fullTitle(data);
            var locator = item && item.locator != null ? String(item.locator).trim() : "";
            var label = item && item.label != null ? String(item.label).trim().toLowerCase() : "";
            var titleEndsInNumeral = BCF.cite.titleEndsInNumeral(data);

            if (!titleEndsInNumeral) {
                BCF.diag.event("book-at:skip", {
                    reason: "title-not-numeric",
                    key: BCF.cite.itemKey(item),
                    title: title,
                    type: BCF.cite.itemType(data),
                    hasData: !!data && !!Object.keys(data).length
                });
                continue;
            }

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
                BCF.diag.event("book-at:skip", { reason: "label-mismatch", label: label });
                continue;
            }

            if (!locator) {
                BCF.diag.event("book-at:skip", { reason: "no-locator", title: title });
                continue;
            }
            var newSeg = BCF.features.bookAt._rewriteSegment(seg.text, locator, title);
            if (newSeg !== null && newSeg !== seg.text) {
                seg.text = newSeg;
                rewrote = true;
                BCF.diag.event("book-at:rewrite", {
                    before: BCF.rtf.plainish(text),
                    after: BCF.rtf.plainish(newSeg)
                });
            } else {
                BCF.diag.event("book-at:no-replace", {
                    title: title,
                    locator: locator,
                    plainTail: BCF.rtf.plainish(seg.text).slice(-80)
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
        // Normalize hyphens/en-dashes so a range like "403-07" also matches
        // when the CSL style renders it as "403\u201307" (en-dash) in the output.
        var escapedLocator = BCF.cite.escapeRegex(locator).replace(/[-\u2013]/g, "[-\u2013]");
        var plain = BCF.rtf.plainish(segRtf);
        var titleNumeralMatch = /(\d+)\s*$/.exec(title || "");
        if (!titleNumeralMatch) return null;

        var titleNumeral = titleNumeralMatch[1];
        var escapedTitleNumeral = BCF.cite.escapeRegex(titleNumeral);
        // Whatever follows the locator \u2014 `(2011)`, `(rev. ed. 2005)`,
        // `(Sarah Smith ed., 2010)`, multiple citing-parentheticals, or nothing
        // \u2014 is irrelevant to the decision. Anchor on `$` so we always target
        // the *last* `<sep><locator>` in the segment (the one that's actually
        // the pincite, not stray locator-shaped digits earlier in the title).
        var tail = "(?:\\s*\\([^)]*\\))*\\s*$";
        if (new RegExp(escapedTitleNumeral + ",\\s*at\\s+" + escapedLocator + tail, "i").test(plain)) {
            return null;
        }
        if (!new RegExp(escapedTitleNumeral + "(?:,\\s*|\\s+)" + escapedLocator + tail, "i").test(plain)) {
            return null;
        }
        // Use findPlainOffset to locate the separator in the RTF rather than
        // searching for the locator itself: the locator in the RTF may use a
        // different separator (en-dash as \uc0\u8211{}) than item.locator (hyphen).
        var sepNeedle = new RegExp("(?:,\\s*|\\s+)(?:" + escapedLocator + ")" + tail, "i");
        var range = BCF.rtf.findPlainRange(segRtf, sepNeedle);
        if (!range) return null;
        var sepLength = /^(?:,\s*|\s+)/.exec(range.match[0])[0].length;
        // Map the locator's start back to an RTF offset too \u2014 the separator's
        // plain length is not its RTF length when a group brace or control
        // word sits inside the span, and slicing by plain length there would
        // eat a brace and corrupt the RTF. repairGroups covers the remaining
        // pathological case of a group cut by the splice.
        var rtfLocStart = BCF.rtf.plainIndexToRtf(segRtf, range.match.index + sepLength);
        if (rtfLocStart < 0 || rtfLocStart < range.start) return null;
        return BCF.rtf.repairGroups(
            segRtf.slice(0, range.start) + ", at " + segRtf.slice(rtfLocStart)
        );
    },

    _inferLocator: function (plain) {
        var m = /(?:,?\s+)(\d+(?:[-\u2013]\d+)?)(?:\s*\([^)]*\))?\s*$/.exec(plain || "");
        return m ? m[1] : "";
    }
};
