# Bluebook Citations Fixer

> ⚠️ **Beta / experimental.** This plugin is in active development and
> likely buggy. Install only if you want to help beta test and are
> comfortable reporting issues. Back up any document you run it against.

Zotero plugin that rewrites rendered citation text to apply Bluebook rules
that are awkward or impossible to express cleanly in CSL alone.

## Current Features

- Hereinafter support for ambiguous same-author works
  - First full cite gets `[hereinafter Author, <short title>]`
  - Subsequent `supra note` cites get the short title inserted before
    `supra note`
  - Only fires when the work actually has a subsequent cite — no
    `[hereinafter Short]` tags on works that are never referenced again
  - Book-like items render the author surname and short title in
    large-and-small caps (`{\scaps ...}`) per Bluebook rules 15.1, 16,
    and B14; chapters are the exception and render like articles
    (italic title, roman author) since only the containing book takes
    small caps under Rule 15.5/B14; "et al." stays italic
  - `Id.` cites, including signal-prefixed forms such as `See id.`, should
    never get a hereinafter append
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

## Compatibility

Zotero 7 and Zotero 10 beta on macOS, Windows, and Linux. RTF output
only — Word and LibreOffice work; Google Docs is not yet supported.

## Architecture

- `bootstrap.js` loads shared helpers and feature modules
- `lib/patch.js` intercepts Zotero integration output before it is written
  into the document
- `lib/features/registry.js` defines feature order
- `lib/features/*.js` holds individual rewrite features
- `tests/run-node-tests.js` contains focused regression tests for rewrite
  behavior

## Release Notes

- Every installable test cut should get a fresh version number
  - Do not rebuild different behavior under the same published version
- Keep these three files in sync on each version bump:
  - `manifest.json`
  - `bootstrap.js`
  - `build.sh`
- The plugin manifest includes an `update_url`, so releases also require
  updating `../update-bluebook-citations.json`
- The update feed should point to the matching GitHub release asset
  `Bluebook_Citations_Fixer_v<version>.xpi`

## Latest Released Version

- `0.1.18`
- Git tag: `bluebook-citations-fixer-v0.1.18`
- GitHub release asset: [Bluebook_Citations_Fixer_v0.1.18.xpi](https://github.com/danepps/zotero/releases/download/bluebook-citations-fixer-v0.1.18/Bluebook_Citations_Fixer_v0.1.18.xpi)

## Release History

See [`../CHANGELOG.md`](../CHANGELOG.md) for the full history. Recent releases:

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
