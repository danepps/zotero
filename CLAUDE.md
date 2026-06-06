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

Each plugin is a zip of its root files (`manifest.json`, `chrome.manifest`, `bootstrap.js`, and — for `bluebook-citations-fixer` — `prefs.js`, `prefs.xhtml`, `locale/`, and the `lib/` tree) with a `.xpi` extension. Plugins with a `build.sh` use it:

```
./bluebook-citations-fixer/build.sh <version>
```

Each writes `releases/<Name>_v<version>.xpi` inside the plugin dir. The `releases/` dirs are gitignored; built XPIs are force-added to the dev branch (`git add -f …`) so the user can side-load via the raw-branch URL for iterative testing.

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

`execCommand`, `Session.updateDocument`, and `Session.writeDelayedCitation` are also wrapped but only for diagnostics.

Key facts that anchor the design:

- **`Zotero.Integration.currentSession`** is set on every `execCommand` and cleared in its `finally`. Full document-global knowledge (every cluster's `citationItems`, their citeproc `position`, author / short-title metadata) is available on `session.citationsByIndex` during a setText call.
- **Bibliography also calls `setText`.** Filter by checking that the field's code contains `CSL_CITATION` — bibliography fields have a different ADDIN prefix.
- **Delayed citations** (`Session.writeDelayedCitation`) go through the same `setText` seam, so our patch covers them for free.
- **`properties.custom`** short-circuits `_updateDocument`, but writing to it persists into the field code. We intentionally do *not* use it.
- **Do not globally gate the feature chain on hereinafter eligibility.** `run.eligibleKeys` is specific to Rule 4.2(b); the other features must continue to run even when no cite in the document qualifies for hereinafter treatment. Each feature owns its own eligibility predicate.

### File layout

```
bluebook-citations-fixer/
├── bootstrap.js                  # Zotero 7/9 bootstrap; loadSubScript each lib
├── manifest.json
├── chrome.manifest
├── build.sh
├── prefs.js                      # default diag + hereinafter prefs
├── prefs.xhtml                   # Settings pane (hereinafter options)
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

The plugin is not pipeline-only. `BCF.dialog` (installed from `bootstrap.js`, modeled on `bluebook-signals/bootstrap.js`) injects a **"Break id."** checkbox into the bubble settings popup of Zotero's citation dialog, anchored **after the "Omit Author" checkbox** (its own row, so the Prefix/Suffix grid isn't rearranged). A `MutationObserver` on the dialog document injects it as soon as the popup renders — no need to focus the Prefix field first. Ticking it writes `BCF.NOID_SENTINEL` to the head of the active cite's `prefix` (via the popup's `#prefix` field) and dispatches a native `input` event so Zotero records the change. The sentinel is **U+200B (ZERO WIDTH SPACE)** so the flag is invisible in both the Prefix box and the citation bubble; it round-trips reliably in the field code, so it persists across Refresh and reopen. The checkbox re-derives its state from the field as the popup is rebuilt per bubble; the label is a static string since the plugin registers no FTL messages. If that state-sync proves fragile, the documented fallback is a menu-item/keystroke that just injects the sentinel.

This feeds the `id-suppress` feature, which corrects the wrongly-rendered `Id.` — the failure mode where a hand-typed citation citeproc can't see intervenes between two Zotero cites of the same source. It rewrites that `Id.` into the correct short form: `<Author>, supra note N, at <loc>` for secondary sources (`hereinafter` then adds the short title when the author is ambiguous, via composition), or `<Short>, <Vol> <Reporter> at <loc>` for cases (short name from `BCF.cite.shortTitle` — Short Title / `title-short`, else the full Case Name; Reporter emitted verbatim from `container-title`). `BCF.cite.hasNoId(prefix)` detects the flag and `BCF.cite.stripNoId(rtf)` removes every form of the sentinel (raw char + `\uc0\uNNNN{}` escape) in the same pass so it never reaches the document. First-cite long forms, statutes, and cases missing Reporter/Volume are detected, the sentinel stripped, the text left intact, and a `skip:id-suppress` diag recorded.

### Per-run ambiguity map

`BCF.run.forSession(session)` lazily walks `session.citationsByIndex` once per run and caches `{ items, authorBuckets, itemCounts, itemFirstNotes, ambiguousKeys, sameFootnoteKeys, thresholdKeys, eligibleKeys, log }` on the session object under a non-enumerable `__bluebookCitationsFixer` key. Zotero's `citationsByIndex` is an object keyed by field index, not necessarily an array, so iterate it with `BCF.run.citationsInOrder(session)`.

Hereinafter-specific eligibility triggers (`BCF.run.shouldUseHereinafter` → `eligibleKeys`): a work qualifies when either (1) two or more works with the same author list first appear in the same footnote (`sameFootnoteKeys`), or (2) at least two works with that author list are each cited at the frequency threshold or more in the document (`thresholdKeys`). In **both** cases the work must itself appear more than once in the document (`itemCounts >= 2`) — `[hereinafter Short]` on a work that's never cited again is noise. Other features should consult their own predicates and must not gate on `eligibleKeys`.

Two user prefs (read in `BCF.run.options()`, defaults preserve historical behavior) tune path (2), the "not in the same footnote" case: `extensions.bluebook-citations-fixer.hereinafter.crossFootnote` (bool, default `true`) — when `false`, `thresholdKeys` no longer folds into `eligibleKeys`, so only the same-footnote path fires; and `…hereinafter.frequencyThreshold` (int, default `3`, floored at 2) replaces the hardcoded `BCF.run.FREQUENCY_THRESHOLD` cutoff. Both are surfaced in the Settings pane (`prefs.xhtml`, registered from `bootstrap.js`).

### RTF conventions

Zotero hands RTF to the integration bridge using citeproc-js's RTF output format:
- italics = `{\i{}TEXT}`
- large-and-small caps = `{\scaps TEXT}`
- escape `\` `{` `}` as `\\` `\{` `\}`
- non-ASCII as `\uc0\uNNNN{}` (decimal codepoint)

`BCF.rtf.italic(s)`, `BCF.rtf.smallCaps(s)`, and `BCF.rtf.escape(s)` produce the right fragments. `BCF.rtf.plainish(rtf)` collapses RTF to a plain-text projection for idempotency checks and anchor matching (e.g. finding `, supra note`). `BCF.rtf.findPlainOffset(rtf, re)` gives the RTF index corresponding to the first plainish-projection match, so injections land at the correct character even when there are `\uNNNN{}` escapes or italic groups before the match.

Hereinafter uses small caps for book-like items (`BCF.cite.isBookLike` → `book`, `entry-encyclopedia`, `entry-dictionary`, etc.) and italics for everything else, per Bluebook rules 15.1, 16, and B14. Chapters are the exception: although `isBookLike` includes them, the chapter title is italic and the chapter author is roman in long form (Rule 15.5/B14), so a hereinafter naming the chapter renders like an article. "Et al." stays italic in both cases.

### Idempotency

Every feature must be idempotent — both the `_updateDocument` prewrite pass and `setText` can see already-rewritten text on later refreshes. `hereinafter` checks for `[hereinafter <shortTitle>]` (first cite) and `shortTitle ... supra note` (subsequent cite) in the plainish projection before inserting. `journal-volume-year` checks for the trailing `(YYYY)` before stripping. `book-at` checks for `, at <locator>` before rewriting.

### Diagnostics

Off by default via root `prefs.js`. Set `extensions.bluebook-citations-fixer.diag = true` in about:config, restart Zotero, and lines appear in `/tmp/bluebook-citations-fixer-diag.txt`. Errors always surface via `Components.utils.reportError` (Error Console) regardless of the pref.

### Known limitations

- RTF output only — Google Docs (HTML output format) is not yet covered. Adding it is a branch on `session.outputFormat` inside `lib/rtf.js` + feature code that consults it.
- Multi-cite splitting relies on the `; ` literal separator in the RTF. If a user's CSL style uses a different `cite-group-delimiter`, multi-item clusters will fall back to pass-through.
- Ambiguity grouping is by author-surname list only — no handling of editor-as-author or institutional authors yet.
- `id-suppress` (manual "Break id.") covers secondary sources (via `supra`) and cases (via the reporter short form). **Out of scope:** a flagged cite that is the document's first real cite (no earlier note to reference, and faithful long-form rendering would mean reproducing citeproc), and statutes (their own short-form template + variable field coverage). These are detected and skipped, not silently mis-rendered. "First cite vs repeat" is inferred from whether citeproc rendered an `Id.`; the `supra note N` target comes from `itemFirstNotes`, built only from Zotero-visible cites.
- The "Break id." checkbox state-sync (`lib/dialog.js`) rides Zotero's reused item-details panel; if it proves fragile, the fallback is a menu-item/keystroke that just injects the sentinel.
