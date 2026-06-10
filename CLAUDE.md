# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Keeping this file current

Update CLAUDE.md in the same change as the code whenever any of the following shifts:

- A new plugin directory is added or an existing one is renamed/removed.
- The build, release, or auto-update flow changes (e.g. a new `update-*.json`, a different branch-testing URL, a tagging convention change).
- The auto-update invariant changes (today: a missing or 404ing update JSON causes Zotero to delete the plugin — if that's ever no longer true, fix the warning here).
- `bluebook-citations-fixer`'s hook point, feature contract, lib layout, or RTF conventions change. In particular: the patch target (`Zotero.Integration.Field.prototype.setText`) is the core design decision — if you move it, update this file and say why.
- A new feature is added under `bluebook-citations-fixer/lib/features/`: list it in the architecture section with its rule.
- Known limitations listed at the bottom get fixed (remove them) or new ones are discovered (add them).

Do not let it drift. Stale guidance is worse than no guidance.

`AGENTS.md` at the repo root is the Codex-facing sister file and mirrors the architecture sections below. When you change anything in "Repository layout", "Build / release", or "bluebook-citations-fixer architecture" here, apply the same edit to `AGENTS.md` in the same commit. The two files exist for different agents but describe one codebase; they must agree.

## Repository layout

Each top-level directory is a separate Zotero 7/9 bootstrap plugin. They share no code — each has its own `manifest.json`, `bootstrap.js`, and `chrome.manifest`.

- `bluebook-signals/` — Ctrl+S signal picker for the citation-dialog prefix field (fork of Frank Bennett's plugin, updated for Zotero 9).
- `bluebook-citations-fixer/` — Rewrites Zotero's citation output *inside* the integration pipeline via a `Field.prototype.setText` patch plus an earlier `Session._updateDocument` prewrite pass, applying Bluebook rules that CSL alone can't express. RTF output only for now (Word + LibreOffice). Designed as a feature chain — each Bluebook rule is a file under `lib/features/`.

At the repo root, `update-*.json` files are the Zotero auto-update manifests, served from GitHub Pages at `https://danepps.github.io/zotero/<file>`. The `update_url` in each plugin's `manifest.json` points back to one of these. If the JSON is missing or 404s, Zotero periodically **deletes the plugin** — so any new version must have a matching entry here before release.

## Build / release

Each plugin is a zip of its root files (`manifest.json`, `chrome.manifest`, `bootstrap.js`, and — for `bluebook-citations-fixer` — `prefs.js`, `prefs.xhtml`, `prefs-pane.js`, `locale/`, and the `lib/` tree) with a `.xpi` extension. Plugins with a `build.sh` use it:

```
./bluebook-citations-fixer/build.sh <version>
```

Each writes `releases/<Name>_v<version>.xpi` inside the plugin dir. The `releases/` dirs are gitignored; built XPIs are force-added to the dev branch (`git add -f …`) so the user can side-load via the raw-branch URL for iterative testing.

**Version numbering during iteration:** bump the `version` in `manifest.json` to a new `X.Y.Z` **only** when cutting a release to main. For iterative side-load builds on a dev branch, append a fourth component instead — `0.1.28.1`, `0.1.28.2`, … — so Zotero treats each test build as newer (and won't reuse a cached XPI) without burning a real version number. The base `X.Y.Z` is the version that will land on main; drop the fourth component when you cut the real release. `build.sh` takes the version string verbatim, so `./build.sh 0.1.28.1` just works.

Shipping a real release requires three things in lock-step:
1. Create a GitHub release with the XPI attached. Tag convention:
   - `bluebook-citations-fixer` → `bluebook-citations-fixer-v<version>`
2. Update `update-bluebook-citations.json` at the repo root with the new version + download link.
3. Push to main so GitHub Pages serves the updated JSON.

There is no CI. `bluebook-citations-fixer` has a small Node helper test harness at `bluebook-citations-fixer/tests/run-node-tests.js`; broader validation is manual: install the XPI in Zotero, run the feature, and read the diagnostic written to `/tmp/bluebook-citations-fixer-diag.txt` (enabled via the `extensions.bluebook-citations-fixer.diag` pref in about:config). Errors also surface in the Error Console regardless of the pref.

## bluebook-citations-fixer architecture

The plugin rewrites Zotero's citation output *inside* the integration pipeline, so it works anywhere Zotero's word-processor bridge runs (Word, LibreOffice, Google Docs — though only RTF output is wired up today, meaning Word + LibreOffice).

### Hook seam

Two patches, run in order:

1. `Zotero.Integration.Session.prototype._updateDocument` — prewrite pass that walks `session.citationsByIndex` and rewrites each cluster's `.text` before Zotero fans those strings out to concrete field writes. Runs the feature chain via `feat.rewriteCitation(ctx)`.
2. `Zotero.Integration.Field.prototype.setText` — downstream hook on the per-field write. Runs the same feature chain via `feat.rewrite(ctx)`. Sits downstream of citeproc (both citeproc-js and citeproc-rs write to `citation.text` before this is called) and upstream of every word-processor-specific field implementation (`WinWord`/`MacWord`/LibreOffice `ReferenceMark`/`httpIntegrationClient`).

While `_updateDocument` is fanning the (already-rewritten) cluster texts out to field writes, the session carries a `__bcfPrewriteActive` flag and the `setText` hook **short-circuits** — re-running the chain there would only burn a `getCode()` round trip to the word processor per field. Writes outside `_updateDocument` (notably delayed citations) still take the full `setText` path. Both hook paths are gated on **RTF output** via `BCF.patch._sessionOutputFormat`, which reads **only `session.outputFormat`** (the exact field the setText gate always used) and fails open when unset: HTML (Google Docs) and plain-text sessions pass through untouched, since the chain emits RTF fragments.

`execCommand`, `Session.updateDocument`, and `Session.writeDelayedCitation` are also wrapped but only for diagnostics (plus, for `writeDelayedCitation`, clearing the per-run cache so the delayed cite sees a fresh eligibility map).

### Style gate

Both hook paths consult `BCF.patch._styleAllowed(session)` before running the feature chain (`patch.run` for `setText`, `_prepareCitationTexts` for the prewrite pass). It compares the document's active style — read from `session.data.style.styleID`, falling back to `session.styleID` / `session.style.styleID` — against the `extensions.bluebook-citations-fixer.styleID` pref. The pref holds a **list** of style IDs separated by whitespace, commas, or semicolons (style IDs are URLs, so those separators can't appear inside an ID); it **defaults to the Epps Bluebook style and its experimental variant** (`https://danepps.github.io/bluebook/BluebookDSEStyle.csl` + `…/BluebookDSEStyle-Experimental.csl`), so out of the box the plugin stays dormant under every other style. Matching against each listed ID is **exact** — a forked/renamed style gets its own `<id>` and must be added to the pref, or the plugin silently sits out (this bit once: hereinafters "broke" because the document used the experimental style while the gate only listed the main one). Two escape hatches keep it from going silently dark: an **empty pref disables the gate** (rewrite under all styles — the old behavior), and an **unreadable styleID fails open** (allow + log `style: unknown styleID`). Mismatches log `skip: style mismatch`. The Node harness leaves `Zotero.Prefs` unstubbed, so `_configuredStyleIDs()` throws → caught → returns `[]` → gate disabled, preserving historical test behavior.

The Settings pane surfaces the gate as a **checkbox picker**: `prefs-pane.js` (registered via `PreferencePanes.register({ scripts: [...] })`, paths relative to the plugin root like `src`) lists every installed CSL style from `Zotero.Styles.getAll()` plus any configured-but-not-installed IDs, and an "Apply under all citation styles" master checkbox. It's a progressive enhancement over a raw pref `<input>` row in `prefs.xhtml`: the script hides that row only after it builds the picker, so a script failure leaves the manual editor working. The picker writes the pref encoding above, with one addition: when "limit to selected styles" is on but nothing is checked it writes the sentinel **`(none)`** — which matches no real style ID (IDs are URLs), so the plugin goes dormant everywhere rather than silently flipping to gate-off. Only the pane knows the sentinel; `_styleAllowed` just sees an ID that never matches.

Key facts that anchor the design:

- **`Zotero.Integration.currentSession`** is set on every `execCommand` and cleared in its `finally`. Full document-global knowledge (every cluster's `citationItems`, their citeproc `position`, author / short-title metadata) is available on `session.citationsByIndex` during a setText call.
- **Bibliography also calls `setText`.** Filter by checking that the field's code contains `CSL_CITATION` — bibliography fields have a different ADDIN prefix.
- **Delayed citations** (`Session.writeDelayedCitation`) go through the same `setText` seam, so our patch covers them for free; the wrapper clears the per-run cache first so the new cite is in the maps.
- **`properties.custom`** short-circuits `_updateDocument`, but writing to it persists into the field code. We intentionally do *not* use it.
- **Do not globally gate the feature chain on hereinafter eligibility.** `run.eligibleKeys` is specific to Rule 4.2(b); the other features must continue to run even when no cite in the document qualifies for hereinafter treatment. Each feature owns its own eligibility predicate.

### File layout

```
bluebook-citations-fixer/
├── bootstrap.js                  # Zotero 7/9 bootstrap; loadSubScript each lib
├── manifest.json
├── chrome.manifest
├── build.sh
├── prefs.js                      # default diag + style-gate + hereinafter prefs
├── prefs.xhtml                   # Settings pane (style gate + hereinafter options)
├── prefs-pane.js                 # Settings pane script: style-gate checkbox picker
├── locale/en-US/bluebook-citations-fixer.ftl
├── tests/run-node-tests.js       # pure helper tests for ambiguity + rewrites
└── lib/
    ├── rtf.js                    # escape, italic(), plainish projection, findPlainOffset, segments
    ├── cite.js                   # CSL_CITATION parse, authorKey, shortTitle, position, item-type predicates
    ├── diag.js                   # /tmp log, gated on extensions.bluebook-citations-fixer.diag pref
    ├── dialog.js                 # citation-dialog "Break id." checkbox (NOID sentinel on prefix)
    ├── session-run.js            # per-run context cached on currentSession (eligibility maps)
    ├── patch.js                  # patch Session/Field integration seams + run feature chain
    └── features/
        ├── registry.js           # ordered list of features
        ├── id-suppress.js        # manual "Break id." -> correct short form (supra / reporter)
        ├── hereinafter.js        # Rule 4.2(b): [hereinafter Short] + supra-cite rewrite
        ├── journal-volume-year.js# suppress trailing (YYYY) when the volume itself is a four-digit year
        └── book-at.js            # insert ", at" when numeral-ending book titles collide with the locator
```

All lib files attach to a single shared `BCF` namespace populated via `Services.scriptloader.loadSubScript`.

### Feature contract

Each feature is a plain object registered in `lib/features/registry.js` with two entry points:

- `rewrite(ctx)` — called by the `Field.setText` hook for each individual field write.
- `rewriteCitation(ctx)` — called by the `Session._updateDocument` prewrite pass for each cluster in `session.citationsByIndex`.

Both receive a similar ctx; they typically delegate to a shared `rewriteText(text, codeJson, run)` helper. The current chain order is `id-suppress` → `journal-volume-year` → `book-at` → `hereinafter`. **`id-suppress` runs first on purpose:** it corrects a wrongly-rendered `Id.` into the proper short form so every later feature sees the corrected text (and `hereinafter` can then inject a short title before its `supra note`). **Hereinafter runs last on purpose:** it appends `[hereinafter ...]` to the end of a segment, and both `journal-volume-year` (strips trailing `(YYYY)`) and `book-at` (rewrites trailing `<numeral> <locator>`) anchor on `$`, so they must see the un-bracketed tail first.

```
ctx = {
  session,   // Zotero.Integration.currentSession
  field,     // Zotero.Integration.Field (setText path) or absent (prewrite path)
  citation,  // live session citation (prewrite path) or absent (setText path)
  codeJson,  // parsed CSL_CITATION from field.getCode() (setText) or citation (prewrite)
  run,       // per-session cache: { items, authorBuckets, itemCounts, ambiguousKeys,
             //                      sameFootnoteKeys, thresholdKeys, eligibleKeys, log }
  text,      // current RTF (output of the previous feature, or the original)
  rtf        // BCF.rtf helpers
}
```

Returning a string replaces `ctx.text`; returning undefined is a pass-through. Features run in `registry.list` order, each seeing the previous feature's output. Use `BCF.rtf.segments(text, itemCount)` to split multi-item clusters at the `; ` delimiter (brace-depth-aware); it returns null when the split can't be made reliably, at which point the feature should pass the cluster through. **To add a new Bluebook rule: create `lib/features/<id>.js`, load it in `bootstrap.js`, and append it to `registry.list`.**

### Dialog UI surface (`lib/dialog.js`)

The plugin is not pipeline-only. `BCF.dialog` (installed from `bootstrap.js`) injects a **"Break id."** checkbox into the bubble settings popup of Zotero's citation dialog. The Zotero 7+ dialog is HTML/React, so the control is a **plain native HTML `<input type="checkbox">` + `<label>`** (a XUL `<checkbox>` renders but never fires `command` there), inserted as **its own row after the Omit Author row** so the existing fields aren't disturbed. Do **not** copy Zotero's checkbox CSS class onto the input: that class sets `appearance: none` and custom-draws the box for a specific DOM structure, which on a bare input just suppresses the native checkbox so it can't render or toggle — a native checkbox already matches the OS-styled Omit Author box. `_sync` skips reverting the box while it's the `activeElement`, so an observer pass triggered by the click's own mutation can't undo a just-made check. Elements are created in the **XHTML namespace** (`createElementNS`) — in the XUL/XHTML dialog `createElement("input")` can land in the wrong namespace and render a non-functional checkbox — and the toggle is driven by a **`click` handler that derives the new state from the prefix** (the source of truth), not from the checkbox's native `change`, which doesn't fire reliably there. A `MutationObserver` on the dialog document injects it as soon as the popup renders — no need to focus the Prefix field first. Ticking it writes `BCF.NOID_SENTINEL` to the head of the active cite's `prefix` **through React's native value setter** (`BCF.dialog._setReactValue`) + a bubbling `input` event; a plain `.value` assignment is ignored by the controlled input, so the flag would never reach the field code. The sentinel is **U+200B (ZERO WIDTH SPACE)** so the flag is invisible in both the Prefix box and the citation bubble; it round-trips reliably in the field code, so it persists across Refresh and reopen. The checkbox re-derives its state from the field as the popup is rebuilt per bubble; the label is static since the plugin registers no FTL messages. If the injection proves fragile, the documented fallback is a menu-item/keystroke that just injects the sentinel.

This feeds the `id-suppress` feature, which corrects the wrongly-rendered `Id.` — the failure mode where a hand-typed citation citeproc can't see intervenes between two Zotero cites of the same source. It rewrites that `Id.` into the correct short form: `<Author>, supra note N, at <loc>` for secondary sources (`hereinafter` then adds the short title when the author is ambiguous, via composition; authorless works are cited by title — `<Short Title>, supra note N` — matching the style's own supra form), or `<Short>, <Vol> <Reporter> at <loc>` for cases (short name from `BCF.cite.shortTitle` — Short Title / `title-short`, else the full Case Name; Reporter emitted verbatim from `container-title`). Only the `Id. [at <loc>]` span is replaced (via `BCF.rtf.findPlainRange`): any user-typed signal before it and suffix after it (e.g. an explanatory parenthetical) are preserved. `BCF.cite.hasNoId(prefix)` detects the flag and `BCF.cite.stripNoId(rtf)` removes every form of the sentinel (raw char + `\uc0\uNNNN{}` escape) in the same pass so it never reaches the document. First-cite long forms, statutes, cases missing Reporter/Volume, and documents without note numbering (no `supra note 0`) are detected, the sentinel stripped, the text left intact, and a `skip:id-suppress` diag recorded.

### Per-run ambiguity map

`BCF.run.forSession(session)` lazily walks `session.citationsByIndex` once per run and caches `{ items, authorBuckets, itemCounts, itemFirstNotes, itemFirstNotesBySig, ambiguousKeys, sameFootnoteKeys, thresholdKeys, eligibleKeys, log }` on the session object under a non-enumerable `__bluebookCitationsFixer` key. Zotero's `citationsByIndex` is an object keyed by field index, not necessarily an array, so iterate it with `BCF.run.citationsInOrder(session)`. `itemFirstNotes` maps item key → first note; `itemFirstNotesBySig` maps an author+title signature → earliest note. `BCF.run.firstNoteFor(ctx, item, data)` returns the smaller of the two, so `id-suppress`'s `supra` target survives a duplicate library item / URI mismatch (two cites of the same source that resolve to different keys) instead of pointing the repeat at itself.

Hereinafter-specific eligibility triggers (`BCF.run.shouldUseHereinafter` → `eligibleKeys`): a work qualifies when either (1) two or more works with the same author list first appear in the same footnote (`sameFootnoteKeys`), or (2) at least two works with that author list are each cited at the frequency threshold or more in the document (`thresholdKeys`). In **both** cases the work must itself appear more than once in the document (`itemCounts >= 2`) — `[hereinafter Short]` on a work that's never cited again is noise. Other features should consult their own predicates and must not gate on `eligibleKeys`.

Two user prefs (read in `BCF.run.options()`, defaults preserve historical behavior) tune path (2), the "not in the same footnote" case: `extensions.bluebook-citations-fixer.hereinafter.crossFootnote` (bool, default `true`) — when `false`, `thresholdKeys` no longer folds into `eligibleKeys`, so only the same-footnote path fires; and `…hereinafter.frequencyThreshold` (int, default `3`, floored at 2) replaces the hardcoded `BCF.run.FREQUENCY_THRESHOLD` cutoff. Both are surfaced in the Settings pane (`prefs.xhtml`, registered from `bootstrap.js`).

### RTF conventions

Zotero hands RTF to the integration bridge using citeproc-js's RTF output format:
- italics = `{\i{}TEXT}`
- large-and-small caps = `{\scaps TEXT}`
- escape `\` `{` `}` as `\\` `\{` `\}`
- non-ASCII as `\uc0\uNNNN{}` (decimal codepoint)

`BCF.rtf.italic(s)`, `BCF.rtf.smallCaps(s)`, and `BCF.rtf.escape(s)` produce the right fragments. `BCF.rtf.plainish(rtf)` collapses RTF to a plain-text projection for idempotency checks and anchor matching (e.g. finding `, supra note`). `BCF.rtf.findPlainOffset(rtf, re)` gives the RTF index corresponding to the first plainish-projection match, so injections land at the correct character even when there are `\uNNNN{}` escapes or italic groups before the match. `BCF.rtf.findPlainRange(rtf, re)` returns the full RTF span of the match (for replacements, not just insertions), `BCF.rtf.plainIndexToRtf(rtf, idx)` maps a single projection index back to an RTF offset, and `BCF.rtf.repairGroups(s)` re-balances braces after a splice (drops unmatched closers, appends missing ones) so a splice through a formatting group can never produce RTF that Word/LibreOffice reject.

Hereinafter uses small caps for book-like items (`BCF.cite.isBookLike` → `book`, `entry-encyclopedia`, `entry-dictionary`, etc.) and italics for everything else, per Bluebook rules 15.1, 16, and B14. Chapters are the exception: although `isBookLike` includes them, the chapter title is italic and the chapter author is roman in long form (Rule 15.5/B14), so a hereinafter naming the chapter renders like an article. "Et al." stays italic in both cases.

### Idempotency

Every feature must be idempotent — both the `_updateDocument` prewrite pass and `setText` can see already-rewritten text on later refreshes. `hereinafter` checks for `[hereinafter <shortTitle>]` (first cite) and `shortTitle ... supra note` (subsequent cite) in the plainish projection before inserting. `journal-volume-year` checks for the trailing `(YYYY)` before stripping. `book-at` checks for `, at <locator>` before rewriting.

### Diagnostics

Off by default via root `prefs.js`. Set `extensions.bluebook-citations-fixer.diag = true` in about:config, restart Zotero, and lines appear in `/tmp/bluebook-citations-fixer-diag.txt`. Errors always surface via `Components.utils.reportError` (Error Console) regardless of the pref.

### Known limitations

- RTF output only — Google Docs (HTML output format) is not yet covered; both hook paths gate on the output format and pass non-RTF sessions through untouched. Adding HTML support is a branch on `session.outputFormat` inside `lib/rtf.js` + feature code that consults it.
- Multi-cite splitting relies on the `; ` literal separator in the RTF. If a user's CSL style uses a different `cite-group-delimiter`, multi-item clusters will fall back to pass-through.
- Ambiguity grouping is by author-surname list only — no handling of editor-as-author or institutional authors yet.
- `id-suppress` (manual "Break id.") covers secondary sources (via `supra`) and cases (via the reporter short form). **Out of scope:** a flagged cite that is the document's first real cite (no earlier note to reference, and faithful long-form rendering would mean reproducing citeproc), and statutes (their own short-form template + variable field coverage). These are detected and skipped, not silently mis-rendered. "First cite vs repeat" is inferred from whether citeproc rendered an `Id.`; the `supra note N` target is `BCF.run.firstNoteFor` (URI map combined with the author+title signature map, taking the earliest). If the earliest known note is this cite or later (the prior same-source cite is hand-typed, or this is the first cite), the feature leaves the `Id.` rather than emit a self/forward reference.
- The "Break id." checkbox state-sync (`lib/dialog.js`) rides Zotero's reused item-details panel; if it proves fragile, the fallback is a menu-item/keystroke that just injects the sentinel.
- `[hereinafter ...]` is inserted before the cite's rendered **suffix** when one exists (Rule 4.2(b): the bracket precedes explanatory parentheticals), else appended at the segment end. This assumes suffixes hold explanatory material; a suffix carrying the date/edition parenthetical will see the bracket land before it, which is technically out of order.
