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
