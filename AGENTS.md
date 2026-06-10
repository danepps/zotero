# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Keeping this file current

Update AGENTS.md in the same change as the code whenever any of the following shifts:

- A new plugin directory is added or an existing one is renamed/removed.
- The build, release, or auto-update flow changes (e.g. a new `update-*.json`, a different branch-testing URL, a tagging convention change).
- The auto-update invariant changes (today: a missing or 404ing update JSON causes Zotero to delete the plugin — if that's ever no longer true, fix the warning here).
- `bluebook-citations-fixer`'s hook point, feature contract, lib layout, or RTF conventions change. In particular: the patch target (`Zotero.Integration.Field.prototype.setText`) is the core design decision — if you move it, update this file and say why.
- A new feature is added under `bluebook-citations-fixer/lib/features/`: list it in the architecture section with its rule.
- Known limitations listed at the bottom get fixed (remove them) or new ones are discovered (add them).

Do not let it drift. Stale guidance is worse than no guidance.

`CLAUDE.md` at the repo root is the Claude-facing sister file and mirrors the architecture sections below. When you change anything in "Repository layout", "Build / release", or "bluebook-citations-fixer architecture" here, apply the same edit to `CLAUDE.md` in the same commit. The two files exist for different agents but describe one codebase; they must agree.

## Repository layout

Each top-level directory is a separate Zotero 7/9 bootstrap plugin. They share no code — each has its own `manifest.json`, `bootstrap.js`, and `chrome.manifest`.

- `bluebook-signals/` — Ctrl+S signal picker for the citation-dialog prefix field (fork of Frank Bennett's plugin, updated for Zotero 9).
- `bluebook-citations-fixer/` — Rewrites Zotero's citation output *inside* the integration pipeline via a `Field.prototype.setText` patch plus a session-level prewrite pass in `Session._updateDocument`, applying Bluebook rules that CSL alone can't express. RTF output only for now (Word + LibreOffice). Designed as a feature chain — each Bluebook rule is a file under `lib/features/`.

At the repo root, `update-*.json` files are the Zotero auto-update manifests, served from GitHub Pages at `https://danepps.github.io/zotero/<file>`. The `update_url` in each plugin's `manifest.json` points back to one of these. If the JSON is missing or 404s, Zotero periodically **deletes the plugin** — so any new version must have a matching entry here before release.

## Build / release

Each plugin is a zip of its root files (`manifest.json`, `chrome.manifest`, `bootstrap.js`, and — for `bluebook-citations-fixer` — `prefs.js`, `prefs.xhtml`, `prefs-pane.js`, `locale/`, and the `lib/` tree) with a `.xpi` extension. Plugins with a `build.sh` use it:

```
./bluebook-citations-fixer/build.sh <version>
```

Each writes `releases/<Name>_v<version>.xpi` inside the plugin dir. The `releases/` dirs are gitignored; built XPIs are force-added to the dev branch (`git add -f …`) so the user can side-load via the raw-branch URL for iterative testing.

**Version numbering during iteration:** bump the `version` in `manifest.json` to a new `X.Y.Z` **only** when cutting a release to main. For iterative side-load builds on a dev branch, append a fourth component instead — `0.1.28.1`, `0.1.28.2`, … — so Zotero treats each test build as newer (and won't reuse a cached XPI) without burning a real version number. The base `X.Y.Z` is the version that lands on main; drop the fourth component when cutting the real release. `build.sh` takes the version string verbatim.

Shipping a real release requires three things in lock-step:
1. Create a GitHub release with the XPI attached. Tag convention:
   - `bluebook-citations-fixer` → `bluebook-citations-fixer-v<version>` (match the tag to what the update JSON's `update_link` says — v1.2.0 shipped under the tag `bluebook-citations-fixer-v1.2`, so verify the link resolves before pushing to main)
2. Update `update-bluebook-citations.json` at the repo root with the new version + download link.
3. Push to main so GitHub Pages serves the updated JSON.

There is no CI. `bluebook-citations-fixer` has a small Node helper test harness at `bluebook-citations-fixer/tests/run-node-tests.js`; broader validation is manual: install the XPI in Zotero, run the feature, and read the diagnostic written to `/tmp/bluebook-citations-fixer-diag.txt` (enabled via the `extensions.bluebook-citations-fixer.diag` pref in about:config). Errors also surface in the Error Console regardless of the pref.

## bluebook-citations-fixer architecture

The plugin rewrites Zotero's citation output *inside* the integration pipeline, so it works anywhere Zotero's word-processor bridge runs (Word, LibreOffice, Google Docs — though only RTF output is wired up today, meaning Word + LibreOffice).

### Hook seam

The primary seam is `Zotero.Integration.Field.prototype.setText` (in Zotero's `chrome/content/zotero/xpcom/integration.js`), which sits downstream of citeproc and upstream of every word-processor-specific field implementation. The plugin also patches `Session._updateDocument` to rewrite `citation.text` earlier in the run, before Zotero fans those strings back out to concrete field writes.

While `_updateDocument` is fanning the (already-rewritten) cluster texts out to field writes, the session carries a `__bcfPrewriteActive` flag and the `setText` hook **short-circuits** — re-running the chain there would only burn a `getCode()` round trip to the word processor per field. Writes outside `_updateDocument` (notably delayed citations) still take the full `setText` path. Both hook paths are gated on **RTF output** via `BCF.patch._sessionOutputFormat`, which reads **only `session.outputFormat`** (the exact field the setText gate always used) and fails open when unset: HTML (Google Docs) and plain-text sessions pass through untouched, since the chain emits RTF fragments.

### Style gate

Both hook paths consult `BCF.patch._styleAllowed(session)` before running the feature chain (`patch.run` for `setText`, `_prepareCitationTexts` for the prewrite pass). The document's active style — `session.data.style.styleID`, falling back to `session.styleID` / `session.style.styleID` — is allowed when it is (1) one of the **hard-wired** `BCF.patch.BUILTIN_STYLE_IDS` (the Epps Bluebook style + its experimental variant — always on, not configurable; a forked variant's `<id>` must be added there AND to the pane's `BUILTINS` in `prefs-pane.js`); (2) listed in the `extensions.bluebook-citations-fixer.styleID` pref (**extra** IDs, whitespace/comma/semicolon separated, exact match, default empty; the legacy `(none)` sentinel is filtered); or (3) the `extensions.bluebook-citations-fixer.allStyles` bool pref is true (gate off — this replaces the old "empty styleID pref disables the gate" rule). An **unreadable styleID fails open** so the plugin never goes silently dark. The Settings pane (`prefs-pane.js`, registered via `PreferencePanes.register({ scripts: [...] })`) renders an "Apply under all citation styles" master checkbox, the built-ins as always-on disabled rows, a pinned row for the traditional Bluebook Law Review style (`http://www.zotero.org/styles/bluebook-law-review`, shown even when not installed), every other installed style, and configured-but-not-installed extras; it's a progressive enhancement over a raw pref `<input>` row in `prefs.xhtml`, hidden only after the picker builds, so a script failure leaves the manual editor working. Built-in/pinned styles missing from this machine render with a "(not installed)" marker and an **Install style** button (`Zotero.Styles.install({ url })` — style IDs are their own download URLs), plus a static link to `https://danepps.github.io/bluebook/` for manual installs (the pane script wires `label.text-link[href^=http]` clicks to `Zotero.launchURL`; the toolkit text-link widget never upgrades inside plugin pane fragments); a missing style is otherwise harmless since the gate only compares ID strings.

Key facts that anchor the design:

- **`Zotero.Integration.currentSession`** is set on every `execCommand` and cleared in its `finally`. Full document-global knowledge (every cluster's `citationItems`, their citeproc `position`, author / short-title metadata) is available on `session.citationsByIndex` during a setText call.
- **Bibliography also calls `setText`.** Filter by checking that the field's code contains `CSL_CITATION` — bibliography fields have a different ADDIN prefix.
- **Delayed citations** (`Session.writeDelayedCitation`) still go through the same `setText` seam; the wrapper clears the per-run cache first so the new cite is in the maps, and instruments the method for diagnostics.
- **`properties.custom`** short-circuits `_updateDocument`, but writing to it persists into the field code. We intentionally do *not* use it.
- **Do not globally gate the feature chain on hereinafter eligibility.** `eligibleKeys` is only for Rule 4.2(b); the other features must continue to run even when no cite in the document qualifies for hereinafter treatment.

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
    ├── rtf.js                    # escape, italic(), plainish projection, findPlainOffset
    ├── cite.js                   # CSL_CITATION parse, authorKey, shortTitle, position
    ├── diag.js                   # /tmp log, gated on extensions.bluebook-citations-fixer.diag pref
    ├── dialog.js                 # citation-dialog "Break id." checkbox (NOID sentinel on prefix)
    ├── session-run.js            # per-run context cached on currentSession (ambiguity map)
    ├── patch.js                  # patch Session/Field integration seams + run feature chain
    └── features/
        ├── registry.js           # ordered list of features
        ├── id-suppress.js        # manual "Break id." -> correct short form (supra / reporter)
        ├── hereinafter.js        # Rule 4.2(b): [hereinafter Short] + supra-cite rewrite
        ├── journal-volume-year.js# suppress redundant trailing year when volume is year-like
        └── book-at.js            # insert ", at" when numeral-ending titles make locators ambiguous
```

All lib files attach to a single shared `BCF` namespace populated via `Services.scriptloader.loadSubScript`.

### Feature contract

Each feature is a plain object `{ id, rewrite(ctx) -> string | undefined }` registered in `lib/features/registry.js`. Features that need the earlier session prewrite pass also expose `rewriteCitation(ctx)`. `rewrite` receives:

```
ctx = {
  session,   // Zotero.Integration.currentSession
  field,     // Zotero.Integration.Field the text is about to be written to
  codeJson,  // parsed CSL_CITATION from field.getCode()
  run,       // per-session cache: { items, ambiguousKeys, sameFootnoteKeys, thresholdKeys, eligibleKeys, log }
  text,      // current RTF (output of the previous feature, or the original)
  rtf        // BCF.rtf helpers
}
```

Returning a string replaces `ctx.text`; returning undefined is a pass-through. Features run in `registry.list` order, each seeing the previous feature's output. The current order is `id-suppress` -> `journal-volume-year` -> `book-at` -> `hereinafter`. **`id-suppress` runs first on purpose:** it corrects a wrongly-rendered `Id.` into the proper short form so every later feature sees the corrected text (and `hereinafter` can then inject a short title before its `supra note`). **Hereinafter runs last on purpose:** it appends `[hereinafter ...]` to the end of a segment, and both `journal-volume-year` (strips trailing `(YYYY)`) and `book-at` (rewrites trailing `<numeral> <locator>`) anchor on `$` — they must see the un-bracketed tail first. **To add a new Bluebook rule: create `lib/features/<id>.js`, load it in `bootstrap.js`, and append it to `registry.list`.**

#### Dialog UI surface

`bluebook-citations-fixer` is not pipeline-only. `lib/dialog.js` (`BCF.dialog`, installed from `bootstrap.js`) injects a **"Break id."** checkbox into the bubble settings popup of Zotero's citation dialog. The Zotero 7+ dialog is HTML/React, so it's a **plain native HTML `<input type="checkbox">` + `<label>`** (XUL `<checkbox>` never fires `command` there; and copying Zotero's checkbox class onto a bare input sets `appearance:none` and suppresses native rendering so it can't toggle), inserted as its own row after the **"Omit Author"** row (Prefix/Suffix grid undisturbed) via a `MutationObserver` so it appears without focusing Prefix. `_sync` won't revert the box while it's the `activeElement`. Elements are created in the XHTML namespace (`createElementNS`; `createElement("input")` can land in the wrong namespace and render a dead checkbox), and the toggle is driven by a `click` handler that derives the new state from the prefix, not the unreliable native `change`. Ticking it writes `BCF.NOID_SENTINEL` to the active cite's `prefix` **through React's native value setter** (`_setReactValue`) + a bubbling `input` event — a direct `.value` assignment is ignored by the controlled input. The sentinel is **U+200B (ZERO WIDTH SPACE)**, invisible in the Prefix box and bubble, and round-trips in the field code. The `id-suppress` feature (`lib/features/id-suppress.js`) detects that flag and rewrites the `Id.` citeproc emits — for the case where a hand-typed citation citeproc can't see intervenes between two Zotero cites — into the correct short form: `<Author>, supra note N, at <loc>` for secondary sources (`hereinafter` then adds the short title when the author is ambiguous; authorless works are cited by title, matching the style's own supra form), or `<Short>, <Vol> <Reporter> at <loc>` for cases (short name from `title-short` / Case Name; Reporter emitted verbatim). Only the `Id. [at <loc>]` span is replaced — signals and suffixes are preserved. It strips the sentinel from the RTF in the same pass (`BCF.cite.stripNoId`) so it never reaches the document. First-cite long forms, statutes, and cases missing Reporter/Volume are detected, the sentinel stripped, the text left intact, and a `skip:id-suppress` diag recorded.

### Per-run ambiguity map

`BCF.run.forSession(session)` lazily walks `session.citationsByIndex` once per run and caches `{ items, authorBuckets, itemCounts, itemFirstNotes, itemFirstNotesBySig, ambiguousKeys, sameFootnoteKeys, thresholdKeys, eligibleKeys, log }` on the session object under a non-enumerable `__bluebookCitationsFixer` key. Zotero's `citationsByIndex` is an object keyed by field index, not necessarily an array, so iterate it with `BCF.run.citationsInOrder(session)`. `eligibleKeys` is specific to `hereinafter`; other features should consult their own predicates. A work is added to `eligibleKeys` only if its `itemCounts` is >= 2 — a `[hereinafter Short]` on a work that's never cited again is noise. A work qualifies via either the same-footnote path (`sameFootnoteKeys`) or the frequency path (`thresholdKeys`). `itemFirstNotesBySig` (author+title signature → earliest note) backs `BCF.run.firstNoteFor`, which `id-suppress` uses so a `supra` target survives two cites of one source resolving to different item keys (duplicate library item / URI variance).

Two user prefs (read in `BCF.run.options()`, defaults preserve historical behavior) tune the frequency path — the "not in the same footnote" case: `extensions.bluebook-citations-fixer.hereinafter.crossFootnote` (bool, default `true`) — when `false`, `thresholdKeys` no longer folds into `eligibleKeys`; and `…hereinafter.frequencyThreshold` (int, default `3`, floored at 2) replaces the hardcoded `BCF.run.FREQUENCY_THRESHOLD` cutoff. Both are exposed in the Settings pane (`prefs.xhtml`, registered from `bootstrap.js`).

### RTF conventions

Zotero hands RTF to the integration bridge using citeproc-js's RTF output format:
- italics = `{\i{}TEXT}`
- large-and-small caps = `{\scaps TEXT}`
- escape `\` `{` `}` as `\\` `\{` `\}`
- non-ASCII as `\uc0\uNNNN{}` (decimal codepoint)

`BCF.rtf.italic(s)`, `BCF.rtf.smallCaps(s)`, and `BCF.rtf.escape(s)` produce the right fragments. `BCF.rtf.plainish(rtf)` collapses RTF to a plain-text projection for idempotency checks and anchor matching (e.g. finding `, supra note`). `BCF.rtf.findPlainOffset(rtf, re)` gives the RTF index corresponding to the first plainish-projection match, so injections land at the correct character even when there are `\uNNNN{}` escapes or italic groups before the match. `BCF.rtf.findPlainRange(rtf, re)` returns the full RTF span of the match (for replacements, not just insertions), `BCF.rtf.plainIndexToRtf(rtf, idx)` maps a single projection index back to an RTF offset, and `BCF.rtf.repairGroups(s)` re-balances braces after a splice (drops unmatched closers, appends missing ones) so a splice through a formatting group can never produce RTF that Word/LibreOffice reject.

Hereinafter uses small caps for book-like items (`BCF.cite.isBookLike` → `book`, `entry-encyclopedia`, `entry-dictionary`, etc.) and italics for everything else, per Bluebook rules 15.1, 16, and B14. Chapters are the exception: although `isBookLike` includes them, the chapter title is italic and the chapter author is roman in long form (Rule 15.5/B14), so a hereinafter naming the chapter renders like an article. "Et al." stays italic in both cases.

### Idempotency

Every feature must be idempotent — both the `_updateDocument` prewrite pass and `setText` can see already-rewritten text on later refreshes. `hereinafter` checks for `[hereinafter <shortTitle>]` (first cite) and `shortTitle ... supra note` (subsequent cite) in the plainish projection before inserting.

### Diagnostics

Off by default via root `prefs.js`. Set `extensions.bluebook-citations-fixer.diag = true` in about:config, restart Zotero, and lines appear in `/tmp/bluebook-citations-fixer-diag.txt`. Errors always surface via `Components.utils.reportError` (Error Console) regardless of the pref.

### Known limitations

- RTF output only — Google Docs (HTML output format) is not yet covered; both hook paths gate on the output format and pass non-RTF sessions through untouched. Adding HTML support is a branch on `session.outputFormat` inside `lib/rtf.js` + feature code that consults it.
- Multi-cite splitting relies on the `; ` literal separator in the RTF. If a user's CSL style uses a different `cite-group-delimiter`, multi-item clusters will fall back to pass-through.
- Ambiguity grouping is by author-surname list only — no handling of editor-as-author or institutional authors yet.
- `id-suppress` (manual "Break id.") covers secondary sources (via `supra`; authorless works are cited by title — `<Short Title>, supra note N`) and cases (via the reporter short form). Only the `Id. [at <loc>]` span is replaced — user-typed signals and suffixes are preserved. **Out of scope:** a flagged cite that is the document's first real cite (no earlier note to reference, and faithful long-form rendering would mean reproducing citeproc), and statutes (their own short-form template + variable field coverage). These are detected and skipped, not silently mis-rendered. "First cite vs repeat" is inferred from whether citeproc rendered an `Id.`; the `supra note N` target is `BCF.run.firstNoteFor` (URI map + author+title signature, earliest of the two). If the earliest known note is this cite or later, the feature leaves the `Id.` rather than emit a self/forward reference.
- The "Break id." checkbox state-sync (`lib/dialog.js`) rides Zotero's reused item-details panel; if it proves fragile, the fallback is a menu-item/keystroke that just injects the sentinel.
- `[hereinafter ...]` is inserted before the cite's rendered **suffix** when one exists (Rule 4.2(b): the bracket precedes explanatory parentheticals), else appended at the segment end. This assumes suffixes hold explanatory material; a suffix carrying the date/edition parenthetical will see the bracket land before it, which is technically out of order.
- The test harness is Node-only and mocks Zotero's integration layer. It now covers the patch pipeline for regression purposes, but it is still not a substitute for manual Zotero document testing.
