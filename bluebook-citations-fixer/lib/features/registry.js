"use strict";

// Ordered list of rewriting features. Each feature is invoked by patch.js
// with a ctx object; its return value (if a string) becomes the new text
// for the next feature in the chain.
//
// To enable a new feature:
//   1. Create lib/features/<your-feature>.js that sets
//        BCF.features.<id> = { id, rewrite(ctx) };
//   2. Load it from bootstrap.js (loadSubScript).
//   3. Add it to the list below, in the order it should run.

// Order matters.
//   * `id-suppress` runs FIRST: it corrects a wrongly-rendered "Id." into the
//     proper short form (e.g. "Author, supra note N"), so every later feature —
//     especially hereinafter — operates on the corrected text. (When the cite
//     is ambiguous, hereinafter then injects the short title before "supra
//     note", and the two features compose.)
//   * `hereinafter` runs LAST: it appends "[hereinafter ...]" to the end of a
//     segment; `journal-volume-year` and `statute-year` (both strip a trailing
//     "(YYYY)") and `book-at` (rewrites the trailing "<numeral> <locator>")
//     anchor their regexes at the end of the segment, so they must run *before*
//     hereinafter or they'll see the bracketed tag at the tail and silently
//     no-op.
BCF.features.list = [
    BCF.features.idSuppress,
    BCF.features.journalVolumeYear,
    BCF.features.statuteYear,
    BCF.features.bookAt,
    BCF.features.hereinafter
];
