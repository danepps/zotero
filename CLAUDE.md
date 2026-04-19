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
- `bluebook-citations-fixer/` — In-pipeline replacement for `bluebook-hereinafter`. Hooks `Zotero.Integration.Field.prototype.setText` so rewrites happen *inside* Zotero's citation pipeline instead of post-hoc in the word processor. RTF output only for now (Word + LibreOffice). Designed as a feature chain — each Bluebook rule is a file under `lib/features/`.

At the repo root, `update-*.json` files are the Zotero auto-update manifests, served from GitHub Pages at `https://danepps.github.io/zotero/<file>`. The `update_url` in each plugin's `manifest.json` points back to one of these. If the JSON is missing or 404s, Zotero periodically **deletes the plugin** — so any new version must have a matching entry here before release.

## Build / release

Each plugin is a zip of its root files (`manifest.json`, `chrome.manifest`, `bootstrap.js`, and — for `bluebook-citations-fixer` — the `lib/` tree) with a `.xpi` extension. Plugins with a `build.sh` use it:

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

There is no test suite, linter, or CI. Validation is manual: install the XPI in Zotero, run the feature, read the diagnostic written to `/tmp/bluebook-hereinafter-diag.txt` or `/tmp/bluebook-citations-fixer-diag.txt` (the latter must be enabled via the `extensions.bluebook-citations-fixer.diag` pref in about:config).

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

`Zotero.Integration.Field.prototype.setText` (in Zotero's `chrome/content/zotero/xpcom/integration.js`). This sits downstream of citeproc (both citeproc-js and citeproc-rs write to `citation.text` before this is called) and upstream of every word-processor-specific field implementation (`WinWord`/`MacWord`/LibreOffice `ReferenceMark`/`httpIntegrationClient`). A monkey-patch here replaces the old AppleScript post-processor entirely.

Key facts that anchor the design:

- **`Zotero.Integration.currentSession`** is set on every `execCommand` and cleared in its `finally`. Full document-global knowledge (every cluster's `citationItems`, their citeproc `position`, author / short-title metadata) is available on `session.citationsByIndex` during a setText call.
- **Bibliography also calls `setText`.** Filter by checking that the field's code contains `CSL_CITATION` — bibliography fields have a different ADDIN prefix.
- **Delayed citations** (`Session.writeDelayedCitation`) go through the same `setText` seam, so our patch covers them for free.
- **`properties.custom`** short-circuits `_updateDocument`, but writing to it persists into the field code. We intentionally do *not* use it.

### File layout

```
bluebook-citations-fixer/
├── bootstrap.js                  # Zotero 7/9 bootstrap; loadSubScript each lib
├── manifest.json
├── chrome.manifest
├── build.sh
└── lib/
    ├── rtf.js                    # escape, italic(), plainish projection, findPlainOffset
    ├── cite.js                   # CSL_CITATION parse, authorKey, shortTitle, position
    ├── diag.js                   # /tmp log, gated on extensions.bluebook-citations-fixer.diag pref
    ├── session-run.js            # per-run context cached on currentSession (ambiguity map)
    ├── patch.js                  # monkey-patch Field.prototype.setText + run feature chain
    └── features/
        ├── registry.js           # ordered list of features
        └── hereinafter.js        # Rule 4.2(b): [hereinafter Short] + supra-cite rewrite
```

All lib files attach to a single shared `BCF` namespace populated via `Services.scriptloader.loadSubScript`.

### Feature contract

Each feature is a plain object `{ id, rewrite(ctx) -> string | undefined }` registered in `lib/features/registry.js`. `rewrite` receives:

```
ctx = {
  session,   // Zotero.Integration.currentSession
  field,     // Zotero.Integration.Field the text is about to be written to
  codeJson,  // parsed CSL_CITATION from field.getCode()
  run,       // per-session cache: { items, ambiguousKeys, firstCiteSeen, log }
  text,      // current RTF (output of the previous feature, or the original)
  rtf        // BCF.rtf helpers
}
```

Returning a string replaces `ctx.text`; returning undefined is a pass-through. Features run in `registry.list` order, each seeing the previous feature's output. **To add a new Bluebook rule: create `lib/features/<id>.js`, load it in `bootstrap.js`, and append it to `registry.list`.**

### Per-run ambiguity map

`BCF.run.forSession(session)` lazily walks `session.citationsByIndex` once per run and caches `{ ambiguousKeys, items, firstCiteSeen }` on the session object under a non-enumerable `__bluebookCitationsFixer` key. All features can read it without recomputing.

### RTF conventions

Zotero hands RTF to the integration bridge using citeproc-js's RTF output format:
- italics = `{\i{}TEXT}`
- escape `\` `{` `}` as `\\` `\{` `\}`
- non-ASCII as `\uc0\uNNNN{}` (decimal codepoint)

`BCF.rtf.italic(s)` and `BCF.rtf.escape(s)` produce the right fragments. `BCF.rtf.plainish(rtf)` collapses RTF to a plain-text projection for idempotency checks and anchor matching (e.g. finding `, supra note`). `BCF.rtf.findPlainOffset(rtf, re)` gives the RTF index corresponding to the first plainish-projection match, so injections land at the correct character even when there are `\uNNNN{}` escapes or italic groups before the match.

### Idempotency

Every feature must be idempotent — `setText` fires on every refresh and we'll see already-rewritten text on subsequent runs. `hereinafter` checks for `[hereinafter <shortTitle>]` (first cite) and `shortTitle ... supra note` (subsequent cite) in the plainish projection before inserting.

### Diagnostics

Off by default. Set `extensions.bluebook-citations-fixer.diag = true` in about:config, restart Zotero, and lines appear in `/tmp/bluebook-citations-fixer-diag.txt`. Errors always surface via `Components.utils.reportError` regardless of the pref.

### Known limitations

- RTF output only — Google Docs (HTML output format) is not yet covered. Adding it is a branch on `session.outputFormat` inside `lib/rtf.js` + feature code that consults it.
- Multi-cite splitting relies on the `; ` literal separator in the RTF. If a user's CSL style uses a different `cite-group-delimiter`, multi-item clusters will fall back to pass-through.
- Same author-surname grouping limitation as `bluebook-hereinafter` — no editor-as-author or institutional-author handling yet.
- Small caps not supported; short titles are italicized uniformly.
- `bluebook-hereinafter` (AppleScript) runs in parallel for now. If both are installed, the in-pipeline rewrite happens first, then the AS post-processor re-analyzes; the AS path's idempotency check (looking for `[hereinafter ...]`) should prevent double application, but uninstall one or the other once the new plugin is validated.
