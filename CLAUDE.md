# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Keeping this file current

Update CLAUDE.md in the same change as the code whenever any of the following shifts:

- A new plugin directory is added or an existing one is renamed/removed.
- The build, release, or auto-update flow changes (e.g. a new `update-*.json`, a different branch-testing URL, a tagging convention change).
- The auto-update invariant changes (today: a missing or 404ing update JSON causes Zotero to delete the plugin — if that's ever no longer true, fix the warning here).
- `bluebook-hereinafter`'s data-flow stages, hook target, or diagnostic file paths change.
- A new Word AppleScript pitfall is discovered and worked around, or a previously-documented pitfall turns out to be wrong. The "AppleScript pitfalls" section is the institutional memory for why the writer is shaped the way it is — keep it accurate.
- `bluebook-citations-fixer`'s hook point, feature contract, lib layout, or RTF conventions change. In particular: the patch target (`Zotero.Integration.Field.prototype.setText`) is the core design decision — if you move it, update this file and say why.
- A new feature is added under `bluebook-citations-fixer/lib/features/`: list it in the architecture section with its rule.
- Known limitations listed at the bottom get fixed (remove them) or new ones are discovered (add them).

Do not let it drift. Stale guidance is worse than no guidance.

## Repository layout

Each top-level directory is a separate Zotero 7/9 bootstrap plugin. They share no code — each has its own `manifest.json`, `bootstrap.js`, and `chrome.manifest`.

- `bluebook-signals/` — Ctrl+S signal picker for the citation-dialog prefix field (fork of Frank Bennett's plugin, updated for Zotero 9).
- `bluebook-hereinafter/` — Applies Bluebook Rule 4.2(b) "hereinafter" handling by post-processing the Word document after every Zotero integration call. **macOS + Microsoft Word only (AppleScript).** Being superseded by `bluebook-citations-fixer/`; kept running in parallel until the new plugin is validated.
- `bluebook-citations-fixer/` — In-pipeline replacement for `bluebook-hereinafter`. Rewrites happen *inside* Zotero's citation pipeline via a `Field.prototype.setText` patch plus an earlier `Session._updateDocument` prewrite pass. RTF output only for now (Word + LibreOffice). Designed as a feature chain — each Bluebook rule is a file under `lib/features/`.

At the repo root, `update-*.json` files are the Zotero auto-update manifests, served from GitHub Pages at `https://danepps.github.io/zotero/<file>`. The `update_url` in each plugin's `manifest.json` points back to one of these. If the JSON is missing or 404s, Zotero periodically **deletes the plugin** — so any new version must have a matching entry here before release.

## Build / release

Each plugin is a zip of its root files (`manifest.json`, `chrome.manifest`, `bootstrap.js`, and — for `bluebook-citations-fixer` — `prefs.js`, `locale/`, and the `lib/` tree) with a `.xpi` extension. Plugins with a `build.sh` use it:

```
./bluebook-hereinafter/build.sh <version>
./bluebook-citations-fixer/build.sh <version>
```

Each writes `releases/<Name>_v<version>.xpi` inside the plugin dir. The `releases/` dirs are gitignored; built XPIs are force-added to the dev branch (`git add -f …`) so the user can side-load via the raw-branch URL for iterative testing.

Shipping a real release requires three things in lock-step:
1. Create a GitHub release with the XPI attached. Tag conventions:
   - `bluebook-hereinafter` → `hereinafter-v<version>`
   - `bluebook-citations-fixer` → `bluebook-cite-v<version>`
2. Update the matching `update-*.json` at the repo root (`update-hereinafter.json`, `update-bluebook-citations.json`) with the new version + download link.
3. Push to main so GitHub Pages serves the updated JSON.

There is no CI. `bluebook-citations-fixer` has a small Node helper test harness at `bluebook-citations-fixer/tests/run-node-tests.js`; broader validation is manual: install the XPI in Zotero, run the feature, read the diagnostic written to `/tmp/bluebook-hereinafter-diag.txt` or `/tmp/bluebook-citations-fixer-diag.txt` (the latter must be enabled via the `extensions.bluebook-citations-fixer.diag` pref in about:config), and use Tools -> Bluebook Citations Fixer: Status for recent hook events.

## bluebook-hereinafter architecture

The plugin detects when a document cites multiple works by the same author and (a) appends ` [hereinafter <i>ShortTitle</i>]` to each work's first full cite and (b) rewrites subsequent short-form cites from `Epps, supra note 1` to `Epps, <i>Adversarial Asymmetry</i>, supra note 1`.

All logic lives in `bluebook-hereinafter/bootstrap.js`, organized as a single `BH` namespace with sections: AppleScript bridge → field I/O → citation JSON parsing → ambiguity detection → edit computation → AppleScript edit writer → diagnostics → menu/hook. The key data flow per run:

1. **Read** every Zotero field in the active Word doc. `BH.readFieldsScript()` emits AS that walks body fields + every footnote's fields, base64-encodes each field's code + displayed text, and returns tab-separated records. Base64 is required because the code + text can contain tabs, newlines, and high-bit characters that would otherwise corrupt the pipe.
2. **Parse** each field's `ADDIN ZOTERO_ITEM CSL_CITATION { … }` code with `BH.parseFieldCode`. Items are keyed by URI (falling back to id).
3. **Analyze** for ambiguity: group items by `authorKey` (concatenated, lowercased surnames). An item is ambiguous iff at least one other distinct item in the document shares its authorKey.
4. **Compute edits** per field. `BH.computeEdits` dispatches per citation item. Multi-item fields (`"A; B"`) are split on `"; "` so each hereinafter lands inline after its own sub-cite rather than stacked at the end. Dispatch between first-cite and subsequent-cite paths uses `cit.position`, but **also falls back to a text match on `/\bsupra\s+note\b/i`** — citeproc sometimes reports `position=0` for short-form cites, which would otherwise corrupt the doc.
5. **Write** via `BH.buildWriterScript`. Generates one AS `try`/`on error` block per edit, tagged with a step marker so the diagnostic pinpoints which AS step failed.
6. **Hook**: `BH.installHook` monkey-patches `Zotero.Integration.execCommand` to run the post-processor after every insert/refresh. `Tools → Fix Hereinafters` also triggers it manually.

### AppleScript pitfalls learned the hard way

Word's AS dictionary differs from its VBA object model in subtle ways. If you edit the writer, re-check all of these:

- `font` is a reserved AS class name — use `font object of selection`, not `font of selection`.
- Selection does **not** expose `start` / `end` as top-level properties (that's VBA). Read bounds with `start of content of <range>` / `end of content of <range>`. They are read-only on a selection-derived range.
- `create range active document start N end N` builds the range in the **body story**. Offsets from `start of content` of a footnote's field are footnote-story-relative, so selecting the body-range fails with "object does not exist". Don't use `create range` unless you know the story.
- Positioning within a field: get the field's result range via `text object of <fieldRef>`, build a multi-char subrange (`characters 1 thru pos of fldRange`), `collapse range subRange direction collapse end`, then `select subRange`. Single-`character N` references go stale on collapse; multi-char subranges don't.
- `collapse range <range> direction collapse start|end` is the working form. Inline `tell selection to collapse direction collapse end` fails to parse on the `direction` keyword.
- `move right` and `move selection` have finicky parameter naming (`count`, `unit`, `by`) that vary by Word build — avoid them; prefer subrange + collapse.
- `do Visual Basic "…"` is not exposed in some recent Word for Mac builds (parser bails at `Visual`). Don't rely on VBA from AS.

The writer always emits a per-edit step marker (`set step to "<name>"` before each AS call) so when `osascript` returns `"<tag> [step=<name>]: <msg>"` the failing operation is identifiable.

### Diagnostics

Every run writes `/tmp/bluebook-hereinafter-diag.txt` (version, field count, ambiguous-item count, planned/applied edits, per-field item summaries, writer stdout, writer error log). The writer AS itself is dumped to `/tmp/bluebook-hereinafter-writer.applescript` for direct re-execution in Script Editor. On parse errors, `BH.fixHereinafters` extracts the `:start:end:` character offsets from the osascript error and injects a `>>>…<<<` marker showing the offending span in context — this is the fastest way to debug AS syntax issues.

### Known limitations (per README)

- Mac + Word only.
- Short titles come from the item's `Short Title` field (falls back to full title).
- Italicizes short titles uniformly; Bluebook actually uses small caps for book titles.
- Ambiguity grouping is by surname list only — no handling of editor-as-author or institutional authors.
- Brief visual flicker during refresh (the plugin re-writes the doc after Zotero paints).

## bluebook-citations-fixer architecture

The plugin rewrites Zotero's citation output *inside* the integration pipeline, so it works anywhere Zotero's word-processor bridge runs (Word, LibreOffice, Google Docs — though only RTF output is wired up today, meaning Word + LibreOffice).

### Hook seam

Two patches, run in order:

1. `Zotero.Integration.Session.prototype._updateDocument` — prewrite pass that walks `session.citationsByIndex` and rewrites each cluster's `.text` before Zotero fans those strings out to concrete field writes. Runs the feature chain via `feat.rewriteCitation(ctx)`.
2. `Zotero.Integration.Field.prototype.setText` — downstream hook on the per-field write. Runs the same feature chain via `feat.rewrite(ctx)`. Sits downstream of citeproc (both citeproc-js and citeproc-rs write to `citation.text` before this is called) and upstream of every word-processor-specific field implementation (`WinWord`/`MacWord`/LibreOffice `ReferenceMark`/`httpIntegrationClient`).

Together these patches replace the old AppleScript post-processor. `execCommand`, `Session.updateDocument`, and `Session.writeDelayedCitation` are also wrapped but only for diagnostics.

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
├── prefs.js                      # default diag pref
├── locale/en-US/bluebook-citations-fixer.ftl
├── tests/run-node-tests.js       # pure helper tests for ambiguity + rewrites
└── lib/
    ├── rtf.js                    # escape, italic(), plainish projection, findPlainOffset, segments
    ├── cite.js                   # CSL_CITATION parse, authorKey, shortTitle, position, item-type predicates
    ├── diag.js                   # /tmp log, gated on extensions.bluebook-citations-fixer.diag pref
    ├── ui.js                     # Tools-menu status popup + recent event buffer
    ├── session-run.js            # per-run context cached on currentSession (eligibility maps)
    ├── patch.js                  # patch Session/Field integration seams + run feature chain
    └── features/
        ├── registry.js           # ordered list of features
        ├── hereinafter.js        # Rule 4.2(b): [hereinafter Short] + supra-cite rewrite
        ├── journal-volume-year.js# suppress trailing (YYYY) when the volume itself is a four-digit year
        └── book-at.js            # insert ", at" when numeral-ending book titles collide with the locator
```

All lib files attach to a single shared `BCF` namespace populated via `Services.scriptloader.loadSubScript`.

### Feature contract

Each feature is a plain object registered in `lib/features/registry.js` with two entry points:

- `rewrite(ctx)` — called by the `Field.setText` hook for each individual field write.
- `rewriteCitation(ctx)` — called by the `Session._updateDocument` prewrite pass for each cluster in `session.citationsByIndex`.

Both receive a similar ctx; they typically delegate to a shared `rewriteText(text, codeJson, run)` helper. The current chain order is `hereinafter` → `journal-volume-year` → `book-at`.

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

### Per-run ambiguity map

`BCF.run.forSession(session)` lazily walks `session.citationsByIndex` once per run and caches `{ items, authorBuckets, itemCounts, itemFirstNotes, ambiguousKeys, sameFootnoteKeys, thresholdKeys, eligibleKeys, log }` on the session object under a non-enumerable `__bluebookCitationsFixer` key. Zotero's `citationsByIndex` is an object keyed by field index, not necessarily an array, so iterate it with `BCF.run.citationsInOrder(session)`.

Hereinafter-specific eligibility triggers (`BCF.run.shouldUseHereinafter` → `eligibleKeys`): a work qualifies when either (1) two or more works with the same author list first appear in the same footnote (`sameFootnoteKeys`), or (2) at least two works with that author list are each cited `BCF.run.FREQUENCY_THRESHOLD` (3) or more times in the document (`thresholdKeys`). Other features should consult their own predicates and must not gate on `eligibleKeys`.

### RTF conventions

Zotero hands RTF to the integration bridge using citeproc-js's RTF output format:
- italics = `{\i{}TEXT}`
- escape `\` `{` `}` as `\\` `\{` `\}`
- non-ASCII as `\uc0\uNNNN{}` (decimal codepoint)

`BCF.rtf.italic(s)` and `BCF.rtf.escape(s)` produce the right fragments. `BCF.rtf.plainish(rtf)` collapses RTF to a plain-text projection for idempotency checks and anchor matching (e.g. finding `, supra note`). `BCF.rtf.findPlainOffset(rtf, re)` gives the RTF index corresponding to the first plainish-projection match, so injections land at the correct character even when there are `\uNNNN{}` escapes or italic groups before the match.

### Idempotency

Every feature must be idempotent — both the `_updateDocument` prewrite pass and `setText` can see already-rewritten text on later refreshes. `hereinafter` checks for `[hereinafter <shortTitle>]` (first cite) and `shortTitle ... supra note` (subsequent cite) in the plainish projection before inserting. `journal-volume-year` checks for the trailing `(YYYY)` before stripping. `book-at` checks for `, at <locator>` before rewriting.

### Diagnostics

Off by default via root `prefs.js`. Set `extensions.bluebook-citations-fixer.diag = true` in about:config, restart Zotero, and lines appear in `/tmp/bluebook-citations-fixer-diag.txt`. Errors always surface via `Components.utils.reportError` regardless of the pref. The status menu item records recent startup, patch, setText, skip, and rewrite events even when file diagnostics are disabled.

### Known limitations

- RTF output only — Google Docs (HTML output format) is not yet covered. Adding it is a branch on `session.outputFormat` inside `lib/rtf.js` + feature code that consults it.
- Multi-cite splitting relies on the `; ` literal separator in the RTF. If a user's CSL style uses a different `cite-group-delimiter`, multi-item clusters will fall back to pass-through.
- Same author-surname grouping limitation as `bluebook-hereinafter` — no editor-as-author or institutional-author handling yet.
- Small caps not supported; short titles are italicized uniformly.
- `bluebook-hereinafter` (AppleScript) runs in parallel for now. If both are installed, the in-pipeline rewrite happens first, then the AS post-processor re-analyzes; the AS path's idempotency check (looking for `[hereinafter ...]`) should prevent double application, but uninstall one or the other once the new plugin is validated.
