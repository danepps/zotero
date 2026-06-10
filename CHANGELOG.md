# Changelog

Release notes for the plugins in this repo. Versions are per-plugin; the
prefix in each section header identifies which plugin shipped.

## bluebook-citations-fixer

### v1.2.0 — 2026-06-10

Bug-fix release from a full code review of the rewrite pipeline.

- **"Break id." keeps your suffix.** The id-suppress rewrite now replaces only
  the `Id. [at <pincite>]` span. A user-typed suffix on the flagged cite —
  e.g. an explanatory parenthetical `(discussing X)` — survives the rewrite
  instead of being silently dropped, and multi-pincites (`Id. at 12, 15`)
  come through whole.
- **"Break id." works for authorless sources.** Student notes and other
  unsigned pieces are now tracked in the first-note map and rewritten in the
  title-based form the Bluebook style itself uses for their supra cites:
  `<i>Short Title</i>, supra note N, at <loc>`.
- **Never `supra note 0`.** If note numbering is unavailable, the `Id.` is
  left in place (with the sentinel stripped) rather than pointing at a
  nonexistent note.
- **Hereinafter bracket placement (Rule 4.2(b)).** `[hereinafter ...]` is now
  inserted *before* the cite's explanatory-parenthetical suffix instead of
  after it.
- **Output-format gate on the prewrite pass.** The `Session._updateDocument`
  prewrite pass now skips non-RTF sessions (Google Docs HTML, plain text),
  matching the `setText` hook — previously it could inject RTF fragments into
  HTML output.
- **Faster refreshes on large documents.** While the prewrite pass has
  already rewritten every cluster for an update, the per-field `setText` hook
  short-circuits instead of re-running the chain (which cost a `getCode()`
  round trip to the word processor per field).
- **RTF splice safety.** New `BCF.rtf.findPlainRange` / `plainIndexToRtf` /
  `repairGroups` helpers ensure rewrites that cut through formatting groups
  (e.g. a style that italicizes the comma before a pincite) can never emit
  unbalanced RTF that Word/LibreOffice would reject.
- **Lifecycle hygiene.** Delayed citations rebuild the per-run eligibility
  cache; the prewrite pass can no longer break document updates if it throws;
  diagnostic field wrappers are removed on shutdown; and a stale `setText`
  patch left by a failed unload is recovered instead of adopted.

### v1.1.0.1 — 2026-06-08

- **Style gate.** The fixer now reads the document's active CSL style (from the
  integration session's `data.style.styleID`, with fallbacks) and only runs its
  rewrite chain when that style matches a configured style ID. The new pref
  `extensions.bluebook-citations-fixer.styleID` **defaults to Dan Epps's
  Bluebook style** (`https://danepps.github.io/bluebook/BluebookDSEStyle.csl`),
  so out of the box the plugin stays completely dormant under every other style.
  - Matching is exact and applies to **both** hook paths (the `Field.setText`
    patch and the `Session._updateDocument` prewrite pass).
  - **Empty pref disables the gate** — rewrite under all styles, the prior
    behavior — and an **unreadable styleID fails open** (rewrite + diagnostic)
    so the plugin never silently stops working.
  - Surfaced in **Settings → Bluebook Citations Fixer → Style gate**.

### v1.0.0 — 2026-06-08

- **First stable release.** Promotes the 0.2.x line to 1.0 with no
  behavioral changes since v0.2.0 — the manual "Break id." toggle, the
  hereinafter / id-suppress / journal-volume-year / book-at feature chain,
  and the citation-dialog checkbox are all carried forward as-is.
- **Relicensed under the GNU General Public License v3 (GPLv3).** `COPYING.txt`
  now carries the full GPLv3 text (previously AGPLv3), and the Settings → About
  pane states the license.

### v0.2.0 — 2026-06-06

- **Manual "Break id." toggle.** A new checkbox in the citation dialog's
  bubble settings (under *Omit Author*) lets you flag a cite whose
  immediately preceding same-source citation is **hand-typed** — and
  therefore invisible to Zotero/citeproc, which then wrongly renders the
  cite as `Id.` When flagged, the plugin rewrites that wrong `Id.` into the
  correct Bluebook short form:
  - secondary sources → `Author, supra note N` (with italic *supra*;
    composes with the hereinafter rule, which inserts the short title when
    the author is ambiguous);
  - cases → `Short, Vol Reporter at Pincite` (short name italic, from the
    item's Short Title field or the full case name).
  The flag is stored as an invisible zero-width sentinel on the cite's
  prefix, so it round-trips across Refresh and document reopen. The `supra`
  target is resolved by the earliest note the source appears in, combining
  the item URI with an author+title signature so a duplicate library item or
  URI mismatch can't make a repeat cite point at itself. First-cite long
  forms, statutes, and cases missing the reporter/volume are detected, the
  sentinel stripped, and the text left untouched.

### v0.1.18 — 2026-06-06

- **Hereinafter options + Settings pane:** the "hereinafter" rule can now be
  tuned from Zotero's Settings under **BB Citations Fixer**. A checkbox
  controls whether same-author works that do *not* first appear in the same
  footnote still receive hereinafter treatment (the frequency path), and a
  numeric field sets how many times each such work must be cited for it to
  apply (default 3, minimum 2). Defaults preserve the previous behavior.
- **Removed the Tools → "Bluebook Citations Fixer: Status" menu item**, a
  testing aid. File diagnostics (`/tmp/bluebook-citations-fixer-diag.txt`,
  enabled via the `…diag` pref) and Error Console reporting are unchanged.

### v0.1.17 — 2026-05-26

- **Hereinafter:** chapters now render like articles instead of books.
  Previously a chapter shared the book-like rendering, so a hereinafter
  for a chapter came out in small caps for both the author and the
  short title (e.g. `[hereinafter MERRILL, PRIVATE AND PUBLIC LAW]`).
  Under Bluebook Rule 15.5/B14 only the containing book takes small
  caps — the chapter title is italic and the chapter author is roman —
  so a hereinafter that names the chapter now renders in article form
  (e.g. `[hereinafter Merrill, Private and Public Law]` with the title
  in italics).

### v0.1.16 — 2026-05-23

- **book-at:** insert `, at` correctly for compressed page ranges
  like `403-07`. The locator regex anchored on a literal hyphen, but
  CSL styles often re-render hyphens as en-dashes (`–`) in the output,
  so the action check missed and the cluster went out without `, at`.
  Normalize hyphens/en-dashes in the regex and rewrite the splice
  through `findPlainOffset` so the locator is matched in the plain-text
  projection rather than its RTF encoding.
- **hereinafter:** refreshing a document now picks up a short title
  edited in the Zotero library without re-inserting the citation. The
  per-run builder was using the snapshot embedded in the field code,
  which dates from the last insert/full refresh, so library edits were
  invisible. It now consults `Zotero.Items.get` + `itemToCSLJSON`
  first and falls back to the embedded snapshot only when the live
  fetch fails (item deleted, group library unavailable, etc.).

(Version 0.1.15 was skipped; 0.1.14 → 0.1.16.)

### v0.1.14 — 2026-05-23

- **Zotero 10 beta:** enrich `citationItem.itemData` from
  `Zotero.Items` when the prewrite hook sees it empty. In Zotero 10
  the live `citationsByIndex[i].citationItems[]` objects don't carry
  `itemData` at the moment `_updateDocument` fires — Zotero populates
  it lazily, after citeproc, which is after the plugin's pass. With
  no `itemData`, every feature bailed (empty author key, empty title,
  etc.), so working cites silently lost their `, at` and `[hereinafter]`
  rewrites. `BCF.run` now resolves the underlying item by id and
  converts it via `Zotero.Utilities.Item.itemToCSLJSON`
  (with a legacy fallback), caching the result on the citation item.
- **Diagnostics:** each `book-at` skip now records its reason
  (`title-not-numeric`, `label-mismatch`, `no-locator`,
  `segments-mismatch`, `no-replace`) plus the relevant fields, and
  the session event reports `liveHadData` / `enriched` / `noData`
  counts so future regressions are visible at a glance.

### v0.1.13 — 2026-05-23

- **book-at:** drop the year-only constraint on the trailing
  parenthetical. The tail regex previously required `(YYYY)` (or
  nothing) after the locator, so a book ending in an edition
  parenthetical like `1763–1789 12 (rev. ed. 2005)` went out without
  `, at`. The trailing content shouldn't gate the rewrite — only what
  precedes the pincite matters — so the tail now accepts any sequence
  of trailing parentheticals (year, edition, editor, citing
  parenthetical, or nothing). The `$` anchor is preserved so the
  rewrite still targets the *last* `<sep><locator>` in the segment
  rather than locator-shaped digits earlier in the title.

### v0.1.12 — 2026-05-23

- **Zotero 10 beta startup:** resolve the `Zotero` global without the
  dead XPCOM fallback. The previous bootstrap declared `var Zotero;`
  at the module top, which shadowed the free variable that Zotero 10's
  plugin sandbox injects, and Zotero 10 also doesn't expose `Zotero`
  on `globalThis` — so both modern paths missed and we fell through to
  `Components.classes["@zotero.org/Zotero;1"]`, a contract ID Zotero 10
  no longer ships. Startup threw and the plugin failed to install.
  Bootstrap now walks the scope chain in order (free variable →
  `globalThis.Zotero` → legacy XPCOM, guarded so it no-ops when
  `Components` is gone).
- **Diagnostics:** rate-limit `BCF.diag.err` to one
  `Components.utils.reportError` per `(tag, message)` pair. Zotero 10
  changed `Field._code` storage, so the setText path's
  `await field.getCode()` throws on every call, which previously
  flooded the Error Console. The prewrite path doesn't go through
  `getCode`, so rewriting still happens — only the setText hook is
  degraded.

### v0.1.11 — 2026-05-23

- **Hereinafter eligibility tightened:** `[hereinafter Short]` no
  longer attaches to works that are never cited again. Same-footnote
  ambiguity used to flag a work even if neither sibling was cited a
  second time, leaving a short-form tag that was never used.
  `eligibleKeys` now intersects with `itemCounts >= 2`.
- **Feature order fixed:** reorder the registry to `journal-volume-year`
  → `book-at` → `hereinafter`. With `hereinafter` running first, the
  trailing `[hereinafter …]` bracket broke `book-at`'s `$`-anchored
  locator match, so `, at` rewrites silently dropped on
  hereinafter-eligible cites. Hereinafter runs last on purpose so the
  end-of-segment rewriters see the un-bracketed tail first.
- **Small caps for book-like items:** hereinafter on book-like items
  now renders the author surname and short title in large-and-small
  caps (`{\scaps …}`), per Bluebook rules 15.1, 16, and B14. "Et al."
  remains italic. Adds `BCF.rtf.smallCaps(s)` alongside the existing
  `BCF.rtf.italic(s)`.

### v0.1.10 — 2026-05-06

- **book-at:** apply the rewrite using the rendered long-form title
  even when the user has a `title-short` that doesn't preserve the
  trailing numeral. The `titleEndsInNumeral` predicate now reads the
  long title (or falls back to `title-short`), matching what CSL
  actually emits into the first cite. Force-built XPI for side-load
  verification before release.

### v0.1.9 — 2026-05-06

- **Hereinafter author surname fix:** correct author rendering inside
  the `[hereinafter …]` bracket (single surname, "X & Y" for two
  authors, "X et al." with italicized "et al." for three or more,
  per Bluebook Rule 15.1).

### v0.1.8 — 2026-04-23

- **Status menu visibility:** install the Tools > Bluebook Citations
  Fixer menu item via direct DOM (`menu_ToolsPopup` + a XUL
  `menuitem`) instead of `Zotero.MenuManager.registerMenu`.
  MenuManager only honors `l10nID`, which Fluent resolves against
  the main window's localization — and this plugin's FTL isn't
  registered there, so the entry rendered blank. The direct-DOM path
  uses `setAttribute("label", …)`, which is honored. Window watcher
  kept in sync so the menu shows up in newly opened windows.

### v0.1.7 — 2026-04-23

- **Status menu label:** drop the unregistered `l10nID` from the
  status menu registration. MenuManager wrote the id to
  `dataset.l10nId`, Fluent resolved it to empty (FTL not registered
  with the main document), and the empty l10n value won out over the
  static label — leaving the Tools menu item visible but blank.

### v0.1.6 — 2026-04-23

- Side-load build for the menu-label fix work that landed in 0.1.7,
  cut alongside 0.1.5 for bug testing.

### v0.1.5 — 2026-04-21

- Stabilization release.

### v0.1.4 — 2026-04-21

- Stabilization release.

### v0.1.1 — 2026-04-20

- First side-load build under the `bluebook-citations-fixer` name.

### v0.1.0 — 2026-04-19

- Initial cut. Renamed from `legal-citations-fixer` for naming
  consistency with `bluebook-signals`; plugin id, update JSON, namespace
  (`LCF` → `BCF`), diag pref, diag file, release tag convention, and
  XPI filename all renamed in lock-step.

For the underlying commits, see the [git history on `main`](https://github.com/danepps/zotero/commits/main/bluebook-citations-fixer).
