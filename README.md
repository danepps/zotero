# Zotero Plugins — Dan Epps

Zotero plugins designed to improve functionality for legal scholars. Maintained by Dan Epps, Washington University School of Law.

## Bluebook Signals

A signal picker for the citation dialog prefix field. Press **Ctrl+S** 
while the prefix field is focused to insert a Bluebook signal 
(*See*, *E.g.*, *Accord*, etc.).

**Install:** Download [Bluebook_Signals_v3.0.0.xpi](https://github.com/danepps/zotero/releases/tag/bluebook-signals-v3.0.0)

**Usage:**
1. Open the Add Citation dialog in your word processor
2. Search for and select a citation
3. Click into the Prefix field
4. Press Ctrl+S to open the signal picker

**Original author:** Frank Bennett. Updated for Zotero 9 by Dan Epps, 2026.

---

## Bluebook Citations Fixer

Rewrites Zotero's citation output inside the integration pipeline to apply
Bluebook rules that CSL alone can't express cleanly. Runs automatically on
every insert/refresh.

**Install:** Download [Bluebook_Citations_Fixer_v0.1.5.xpi](https://github.com/danepps/zotero/releases/download/bluebook-cite-v0.1.5/Bluebook_Citations_Fixer_v0.1.5.xpi)

**Current rules:**

- **Hereinafter (Rule 4.2(b))** — When a document cites multiple works by
  the same author, appends `[hereinafter <i>Short Title</i>]` to each
  work's first full cite and rewrites subsequent `supra note` cites to
  include the short title (e.g. `Epps, supra note 1` →
  `Epps, <i>Adversarial Asymmetry</i>, supra note 1`). Skips `Id.` cites,
  including signal-prefixed forms like `See id.`
- **Journal volume/year** — Suppresses the trailing `(YYYY)` parenthetical
  for journal articles when the volume number itself is a four-digit
  year-like value.
- **Book `, at`** — When a book title ends in a numeral, rewrites bare page
  locators into the Bluebook `, at <page>` form to avoid ambiguous output
  like `... 1868 45 (2006)`.

**Platform:** Word and LibreOffice (RTF output). Google Docs not yet
supported.

**Status:** v0.1.5 (early). Intended to replace Bluebook Hereinafter below
once validated — it runs inside the Zotero pipeline rather than
post-processing the Word document via AppleScript, so it works
cross-platform.

---

## Bluebook Hereinafter

Auto-applies Bluebook Rule 4.2(b) "hereinafter" handling in Word documents.
When the same author has two or more distinct works cited, the plugin:

- Appends ` [hereinafter <i>Short Title</i>]` to each work's first full cite
- Rewrites later short-form cites from `Reich, supra note 5` to
  `Reich, <i>New Property</i>, supra note 5`

**Install:** Download [Bluebook_Hereinafter_v0.1.8.xpi](https://github.com/danepps/zotero/releases/tag/hereinafter-v0.1.8)

Short titles come from each item's **Short Title** field in Zotero (with
the full title as fallback). The plugin runs automatically after every
Zotero insert/refresh and is also exposed as **Tools &rarr; Fix Hereinafters**
for manual invocation.

**Platform:** macOS + Microsoft Word only (AppleScript).

**Status:** v0.1.8 (early). Known limitations:
- Mac/Word only for now
- Multi-cite fields (two works in one citation) append both hereinafters
  at the end of the combined field rather than inline per work
- Brief visual flicker during refresh (plugin re-writes after Zotero paints)
- Italicizes short titles uniformly; book titles in Bluebook actually use
  small caps
- Ambiguity grouping is by surname list only (no handling of editor-as-author
  or institutional authors yet)

---

*More plugins coming soon.*
