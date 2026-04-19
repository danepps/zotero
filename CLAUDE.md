# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Each top-level directory is a separate Zotero 7/9 bootstrap plugin. They share no code — each has its own `manifest.json`, `bootstrap.js`, and `chrome.manifest`.

- `bluebook-signals/` — Ctrl+S signal picker for the citation-dialog prefix field (fork of Frank Bennett's plugin, updated for Zotero 9).
- `bluebook-hereinafter/` — Applies Bluebook Rule 4.2(b) "hereinafter" handling by post-processing the Word document after every Zotero integration call. **macOS + Microsoft Word only (AppleScript).**
- `bluebook-fixer/` — Earlier/experimental plugin; not currently shipped.

At the repo root, `update-*.json` files are the Zotero auto-update manifests, served from GitHub Pages at `https://danepps.github.io/zotero/<file>`. The `update_url` in each plugin's `manifest.json` points back to one of these. If the JSON is missing or 404s, Zotero periodically **deletes the plugin** — so any new version must have a matching entry here before release.

## Build / release

Each plugin is a zip of `manifest.json` + `bootstrap.js` + `chrome.manifest` with a `.xpi` extension. Plugins with a `build.sh` use it:

```
./bluebook-hereinafter/build.sh <version>
```

This writes `bluebook-hereinafter/releases/Bluebook_Hereinafter_v<version>.xpi`. The `releases/` dirs are gitignored; built XPIs are force-added to the dev branch (`git add -f …`) so the user can side-load via the raw-branch URL for iterative testing.

Shipping a real release requires three things in lock-step:
1. Create a GitHub release tagged `hereinafter-v<version>` (or equivalent per plugin) with the XPI attached.
2. Update the matching `update-*.json` at the repo root with the new version + download link.
3. Push to main so GitHub Pages serves the updated JSON.

There is no test suite, linter, or CI. Validation is manual: install the XPI in Zotero, run the feature, read the diagnostic written to `/tmp/bluebook-hereinafter-diag.txt`.

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
