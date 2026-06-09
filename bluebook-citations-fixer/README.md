---
title: Bluebook Citations Fixer
description: Bluebook rule fixes for Zotero citations
---

# Bluebook Citations Fixer

Zotero plugin that rewrites rendered citation text to apply Bluebook rules
that are awkward or impossible to express cleanly in CSL alone.

> ⚠️ This plugin is in active development and possibly buggy.
> It seems to be working well, but use at your own risk. 

## Install

Download [Bluebook_Citations_Fixer_v1.1.0.1.xpi](https://github.com/danepps/zotero/releases/download/bluebook-citations-fixer-v1.1.0.1/Bluebook_Citations_Fixer_v1.1.0.1.xpi)
and install it via **Zotero → Tools → Plugins → gear menu → Install Plugin From File**.

> 💡 Pairs with [Bluebook Signals](../bluebook-signals/README.md) —
> [installing both](#companion-plugin) is recommended.

> ## 🚨 Requires the Epps Bluebook CSL style
>
> Out of the box this plugin **only runs when your document uses Dan Epps's
> Bluebook style** — under any other citation style it stays completely
> dormant and changes nothing. You must install and select that style for the
> fixer to do anything.
>
> - **Get the style:** [BluebookDSEStyle.csl](https://danepps.github.io/bluebook/BluebookDSEStyle.csl)
> - **More info:** [danepps.github.io/bluebook](https://danepps.github.io/bluebook/)
>
> (Advanced: the style requirement is a configurable "style gate" — see
> [Current Features](#current-features). You can clear it in Settings to apply
> the rules under any style, but the default expects the Epps Bluebook style.)

> ## 🔄 Run a full refresh to apply the rules
>
> The document-aware rules don't update as you type — you must run a **full
> Zotero refresh** (the **Refresh** button in the Zotero tab of your word
> processor) after adding, editing, or removing citations. Adding or deleting
> one cite changes what *other* cites should say, and only a full refresh
> re-runs every citation in the document.
>
> - **Need a refresh:** the *hereinafter* rule and the *"Break id."* short-form
>   fix — both depend on the whole document (who shares an author, how often a
>   work is cited, which footnote a source first appears in).
> - **Apply on insert too:** the *journal volume/year* and *book ", at"* fixes
>   are local to a single cite, so they take effect immediately — but a refresh
>   never hurts.
>
> When in doubt, **refresh** — it's the only way to guarantee every rule is
> applied consistently across the document.

## Current Features

- Hereinafter support for ambiguous same-author works
  - First full cite gets `[hereinafter Author, <short title>]`
  - Subsequent `supra note` cites get the short title inserted before
    `supra note`
  - Only fires when the work actually has a subsequent cite — no
    `[hereinafter Short]` tags on works that are never referenced again
  - Book-like items render the author surname and short title in
    large-and-small caps per Bluebook rules 15.1, 16, and B14; chapters
    are the exception and render like articles (italic title, roman author)
    since only the containing book takes small caps under Rule 15.5/B14;
    "et al." stays italic
  - `Id.` cites, including signal-prefixed forms such as `See id.`, are
    never given a `[hereinafter ...]` tag
  - Editing a short title in the Zotero library is picked up on the next
    document refresh without needing to re-insert the citation
- Suppress the trailing year parenthetical for journal articles when the
  volume itself is a four-digit year-like number
- Insert `, at` for qualifying citations when a title ends in a numeral and
  the rendered cite would otherwise look like `... 1868 45 (2006)`. Works
  regardless of what follows the pincite — `(YYYY)`, `(rev. ed. 2005)`,
  `(Sarah Smith ed., 2010)`, citing-parentheticals, or nothing at all.
  Handles compressed page ranges like `403-07` whether the CSL style renders
  the separator as a hyphen or en-dash.
- Manual **"Break id."** toggle. A checkbox in the citation dialog's bubble
  settings (under *Omit Author*) flags a cite whose immediately preceding
  same-source citation is hand-typed — invisible to Zotero, which then
  wrongly renders the cite as `Id.` When flagged, the plugin rewrites that
  `Id.` into the correct Bluebook short form: `Author, supra note N` for
  secondary sources (italic *supra*; the hereinafter rule adds the short
  title when the author is ambiguous), or `Short, Vol Reporter at Pincite`
  for cases. The flag is invisible and persists across refreshes. First-cite
  long forms, statutes, and cases missing the reporter/volume are detected
  and left untouched.
- **Style gate.** By default the plugin only rewrites citations when the open
  document uses Dan Epps's Bluebook CSL style — under every other style it
  stays completely dormant, so it never touches a document formatted in some
  other style. Configurable in Settings: clear the style-ID box to apply the
  rules under all styles (the old behavior), or point it at a different style's
  ID. If the active style can't be read for any reason, it fails open so the
  plugin never silently stops working.

## Companion plugin

This plugin pairs with **[Bluebook Signals](../bluebook-signals/README.md)**, a
Ctrl+S signal picker for the citation-dialog Prefix field (*See*, *E.g.*,
*Accord*, etc.). The two are built for the same law-review workflow and are
meant to be used together — **installing both is recommended.**

## Compatibility

Zotero 7 and Zotero 10 beta on macOS, Windows, and Linux. RTF output
only — Word and LibreOffice work; Google Docs is not yet supported.

## Latest Released Version

- `1.1.0.1`
- Git tag: `bluebook-citations-fixer-v1.1.0.1`
- GitHub release asset: [Bluebook_Citations_Fixer_v1.1.0.1.xpi](https://github.com/danepps/zotero/releases/download/bluebook-citations-fixer-v1.1.0.1/Bluebook_Citations_Fixer_v1.1.0.1.xpi)

## Release History

See [`../CHANGELOG.md`](../CHANGELOG.md) for the full history. Recent releases:

### v1.1.0.1

- **Style gate.** The fixer now checks the document's active CSL style and only
  rewrites citations when it matches the configured style ID (default: Dan
  Epps's Bluebook style), so it stays dormant under every other style. Surfaced
  in Settings; clearing the box restores the old "apply under all styles"
  behavior, and an unreadable style fails open so the plugin never goes silently
  dark.

### v1.0.0

- **First stable release.** Promotes the 0.2.x line to 1.0 with no behavioral
  changes since v0.2.0.

### v0.2.0

- **Manual "Break id." toggle.** New checkbox in the citation dialog (under
  *Omit Author*) flags a cite whose preceding same-source citation is
  hand-typed and therefore invisible to Zotero, which otherwise renders the
  cite as `Id.` The plugin rewrites the wrong `Id.` into the correct short
  form — `Author, supra note N` for secondary sources (italic *supra*,
  composing with hereinafter when the author is ambiguous) or
  `Short, Vol Reporter at Pincite` for cases. First-cite long forms,
  statutes, and cases missing reporter/volume are detected and skipped.

### v0.1.18

- **Hereinafter options + Settings pane.** The hereinafter rule is now
  configurable from Zotero's Settings under **BB Citations Fixer**:
  - A checkbox toggles whether same-author works that do *not* first appear in
    the same footnote still get hereinafter treatment (the frequency path).
  - A numeric field sets how many times each such work must be cited for that
    path to apply (default `3`, minimum `2`).
  - Defaults preserve the prior behavior; works that first appear together in
    the same footnote always receive hereinafter treatment.
- **Removed the Tools → "Bluebook Citations Fixer: Status" menu item** (a
  testing aid). File diagnostics (`/tmp/bluebook-citations-fixer-diag.txt`,
  enabled via the `…diag` pref) and Error Console reporting are unchanged.

### v0.1.17

- Chapters now render like articles instead of books: only the containing
  book takes small caps (Rule 15.5/B14), so a hereinafter naming a chapter
  uses an italic title and roman author.
