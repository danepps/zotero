"use strict";

// Feature: manual "break id." correction.
//
// Bluebook "Id." is only valid when the *immediately preceding* citation is the
// same source. When a user has a hand-typed citation (invisible to Zotero /
// citeproc) sitting between two Zotero cites of the same source, citeproc treats
// the two Zotero cites as consecutive and wrongly renders the second as "Id.".
//
// The citation dialog lets the user flag such a cite (a sentinel stored at the
// head of the cite's `prefix` — see BCF.NOID_SENTINEL). This feature detects the
// flag, lets citeproc emit its (wrong) "Id." downstream, then rewrites that
// finished RTF into the correct short form for the source type:
//
//   secondary source -> "<Author>, supra note N, at <loc>"
//                        (hereinafter then injects the short title when ambiguous)
//   case             -> "<Short>, <Vol> <Reporter> at <loc>"  (short name italic)
//
// Out of scope (detected, sentinel stripped, original text left intact + diag):
//   - a flagged cite that renders no "Id." (it's the document's first cite, so
//     citeproc already produced the long form — nothing to point back to);
//   - cases missing Reporter / Reporter Volume;
//   - statutes and other types (own templates; deferred).
//
// Runs FIRST in the chain so the rest (especially hereinafter) sees the
// corrected short form. Idempotent: once rewritten the segment no longer shows
// "Id.", so a later pass strips the (still-present) sentinel and no-ops.
//
// Contract (see lib/patch.js):
//   rewrite(ctx)         -> string | undefined   (Field.setText path)
//   rewriteCitation(ctx) -> string | undefined   (Session._updateDocument path)

BCF.features.idSuppress = {
    id: "id-suppress",

    rewrite: function (ctx) {
        return BCF.features.idSuppress.rewriteText(ctx.text, ctx.codeJson, ctx.run);
    },

    rewriteCitation: function (ctx) {
        if (!ctx || !ctx.citation) return ctx && ctx.text;
        return BCF.features.idSuppress.rewriteText(ctx.text, ctx.citation, ctx.run);
    },

    rewriteText: function (text, codeJson, run) {
        var items = BCF.cite.itemsOf(codeJson);
        if (!items.length) return text;

        // Cheap gate: only touch clusters that actually carry the flag. Also
        // surface any prefix carrying a non-ASCII char (diagnostic): lets us
        // confirm whether the sentinel actually reached the field code.
        var anyFlagged = false;
        for (var f = 0; f < items.length; f++) {
            var pre = items[f] && items[f].prefix;
            if (pre && /[^\x20-\x7E]/.test(pre)) {
                BCF.diag.event("id-suppress:prefix", Array.prototype.map.call(
                    String(pre), function (c) { return c.charCodeAt(0); }).join(","));
            }
            if (BCF.cite.hasNoId(pre)) anyFlagged = true;
        }
        if (!anyFlagged) return text;

        var segments = BCF.rtf.segments(text, items.length);
        if (!segments) {
            // Can't split reliably — don't risk a bad rewrite, but still strip
            // the sentinel so it never shows in the document.
            BCF.diag.event("skip:id-suppress", "could not split multi-cite cluster; stripping sentinel");
            return BCF.cite.stripNoId(text);
        }

        // Note index of this cluster (from the field-code / live citation
        // properties), used to reject self/forward `supra` references.
        var currentNote = BCF.cite.noteIndexOf(codeJson);

        var rewrote = false;
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (!BCF.cite.hasNoId(item && item.prefix)) continue;

            var seg = segments[i];
            var newSeg = BCF.features.idSuppress._rewriteSegment(seg.text, item, run, currentNote);
            if (newSeg !== null && newSeg !== seg.text) {
                seg.text = newSeg;
                rewrote = true;
            }
        }

        if (!rewrote) return text;

        var out = "";
        for (var k = 0; k < segments.length; k++) {
            if (k > 0) out += segments[k].sep || "; ";
            out += segments[k].text;
        }
        return out;
    },

    _rewriteSegment: function (segRtf, item, run, currentNote) {
        var data = BCF.run.itemData(run, item);
        var plain = BCF.rtf.plainish(segRtf);

        // No "Id." form means there is nothing to suppress — but we must still
        // strip the sentinel so it never shows. This also covers the
        // out-of-scope "flagged cite is the document's first cite" case:
        // citeproc renders the long form (no "Id."), which we leave untouched.
        if (!/\bid\./i.test(plain)) {
            BCF.diag.event("skip:id-suppress", "no id. form (first-cite or already short)");
            return BCF.cite.stripNoId(segRtf);
        }

        // Keep everything before "Id." (any introductory signal the user typed)
        // and replace from there to the end of the segment.
        var idOffset = BCF.rtf.findPlainOffset(segRtf, /\bid\./i);
        if (idOffset < 0) return BCF.cite.stripNoId(segRtf);
        // citeproc italicizes "Id." per Bluebook, so the RTF up to "Id." can end
        // inside an open group (e.g. "{\i{}" from "{\i{}Id.}"). Slicing there
        // leaves that group unclosed, which would italicize the whole rewritten
        // cite. Close any groups still open at the cut so the short form we
        // append renders roman; an introductory signal keeps its own formatting
        // because its group opened and closed before "Id.".
        var prefixRtf = BCF.features.idSuppress._closeOpenGroups(segRtf.slice(0, idOffset));

        var locator = BCF.features.idSuppress._locator(item, plain);

        var t = BCF.cite.itemType(data);
        var shortForm;

        if (t === "case" || t === "legal_case") {
            var vol = data.volume != null ? String(data.volume).trim() : "";
            var reporter = data["container-title"] != null
                ? String(data["container-title"]).trim() : "";
            if (!vol || !reporter) {
                BCF.diag.event("skip:id-suppress", "case-reporter-missing " + BCF.cite.itemKey(item));
                return BCF.cite.stripNoId(segRtf);
            }
            // Reporter is emitted verbatim — Zotero's Reporter field already
            // holds the abbreviation (e.g. "U.S."). Short name comes from the
            // Short Title field (title-short), else the full Case Name.
            var shortName = BCF.cite.shortTitle(data);
            shortForm = BCF.rtf.italic(shortName) + ", " +
                BCF.rtf.escape(vol) + " " + BCF.rtf.escape(reporter) +
                (locator ? " at " + BCF.rtf.escape(locator) : "");
        } else if (BCF.cite.isBookLike(data) || BCF.cite.isJournalArticleLike(data)) {
            var firstNote = BCF.run.firstNoteFor(run, item, data);
            if (firstNote == null) {
                BCF.diag.event("skip:id-suppress", "no first-note for " + BCF.cite.itemKey(item));
                return BCF.cite.stripNoId(segRtf);
            }
            // A `supra` must point to an EARLIER note. If the earliest known
            // appearance is this note or later (e.g. the prior cite of this
            // source is hand-typed / invisible to Zotero, or this is genuinely
            // the first cite), we can't synthesize a valid target — leave the
            // "Id." rather than emit a self-reference.
            if (currentNote > 0 && firstNote >= currentNote) {
                BCF.diag.event("skip:id-suppress",
                    "self/forward supra (first=" + firstNote + " cur=" + currentNote + ") " +
                    BCF.cite.itemKey(item));
                return BCF.cite.stripNoId(segRtf);
            }
            // Chapters render like articles (roman author, italic title) — same
            // exception hereinafter makes. _authorPrefix renders the surname(s).
            var isBook = BCF.cite.isBookLike(data) && t !== "chapter";
            var authorPrefix = BCF.features.hereinafter._authorPrefix(data, isBook);
            // Surface form "supra note N" (regular space) so hereinafter's
            // _hasSupraNote / _rewriteSubsequent recognize it and inject the
            // short title when the work is ambiguous.
            shortForm = (authorPrefix ? authorPrefix + ", " : "") +
                "supra note " + firstNote +
                (locator ? ", at " + BCF.rtf.escape(locator) : "");
        } else {
            BCF.diag.event("skip:id-suppress", "unsupported-type " + t + " " + BCF.cite.itemKey(item));
            return BCF.cite.stripNoId(segRtf);
        }

        var rebuilt = BCF.cite.stripNoId(prefixRtf + shortForm);
        BCF.diag.event("id-suppress:rewrite", {
            type: t,
            before: plain,
            after: BCF.rtf.plainish(rebuilt)
        });
        return rebuilt;
    },

    // Append a closing brace for every RTF group still open at the end of the
    // string (escaped "\{" / "\}" don't count). Used to repair the prefix slice
    // when it cuts inside citeproc's italic wrapper around "Id.".
    _closeOpenGroups: function (rtf) {
        var depth = 0;
        for (var i = 0; i < rtf.length; i++) {
            var ch = rtf.charAt(i);
            if (ch === "\\") { i++; continue; }
            else if (ch === "{") depth++;
            else if (ch === "}") depth--;
        }
        var out = rtf;
        while (depth-- > 0) out += "}";
        return out;
    },

    // Pin locator for the rewritten short form. Prefer the citationItem's own
    // `locator` (raw, e.g. "526-27"); fall back to scraping "Id. at <loc>" from
    // the rendered text. Empty string when there is no pincite.
    _locator: function (item, plain) {
        var loc = item && item.locator != null ? String(item.locator).trim() : "";
        if (!loc) {
            var m = /\bid\.\s+at\s+([0-9][0-9.,–-]*)/i.exec(plain);
            loc = m ? m[1] : "";
        }
        return loc;
    }
};
