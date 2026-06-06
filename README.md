# Zotero Plugins — Dan Epps

Zotero plugins designed to improve functionality for legal scholars. Maintained by Dan Epps, Washington University School of Law. For questions and suggestions: epps@wustl.edu

## Bluebook Signals

A signal picker for the citation dialog prefix field. Press **Ctrl+S** 
while the prefix field is focused to insert a Bluebook signal 
(*See*, *E.g.*, *Accord*, etc.).

**More info and install:** [danepps.github.io/zotero/bluebook-signals](https://danepps.github.io/zotero/bluebook-signals/)

**Usage:**
1. Open the Add Citation dialog in your word processor
2. Search for and select a citation
3. Click into the Prefix field
4. Press Ctrl+S to open the signal picker

**Original author:** Frank Bennett. Updated for Zotero 9 by Dan Epps, 2026.

---

## Bluebook Citations Fixer

> ⚠️ **Beta / experimental.** This plugin is in active development and
> likely buggy. Install only if you want to help beta test and are
> comfortable reporting issues. Back up any document you run it against.

Rewrites Zotero's citation output inside the integration pipeline to apply
Bluebook rules that CSL alone can't express cleanly. Runs automatically on
every insert/refresh.

**Install:** Download [Bluebook_Citations_Fixer_v0.1.18.xpi](https://github.com/danepps/zotero/releases/download/bluebook-citations-fixer-v0.1.18/Bluebook_Citations_Fixer_v0.1.18.xpi)

**Current rules:**

- **Hereinafter (Rule 4.2(b))** — When a document cites multiple works by
  the same author *and* at least one of them is referenced subsequently,
  appends `[hereinafter Author, <i>Short Title</i>]` to the first full
  cite and rewrites subsequent `supra note` cites to include the short
  title (e.g. `Epps, supra note 1` →
  `Epps, <i>Adversarial Asymmetry</i>, supra note 1`). Books render the
  author surname and short title in large-and-small caps (per Bluebook
  rules 15.1, 16, B14) instead of italics; chapters follow the article
  form (italic title, roman author) since only the containing book takes
  small caps under Rule 15.5/B14; "et al." stays italic. Skips
  `Id.` cites, including signal-prefixed forms like `See id.` Editing a
  short title in the Zotero library is picked up on the next refresh
  without re-inserting the citation.
- **Journal volume/year** — Suppresses the trailing `(YYYY)` parenthetical
  for journal articles when the volume number itself is a four-digit
  year-like value.
- **Book `, at`** — When a book title ends in a numeral, rewrites bare page
  locators into the Bluebook `, at <page>` form to avoid ambiguous output
  like `... 1868 45 (2006)`. Works regardless of what follows the pincite
  (`(YYYY)`, `(rev. ed. 2005)`, `(Sarah Smith ed., 2010)`, etc.). Handles
  compressed page ranges like `403-07` whether the CSL style renders the
  separator as a hyphen or en-dash.

**Platform:** Word and LibreOffice (RTF output) on Zotero 7 and Zotero 10
beta. Google Docs not yet supported.

---

*More plugins coming soon.*
