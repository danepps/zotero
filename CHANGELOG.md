# Changelog

Release notes for the plugins in this repo. Versions are per-plugin; the
prefix in each section header identifies which plugin shipped.

## bluebook-citations-fixer

### v0.1.17 — 2026-05-26

- **Hereinafter:** chapters now render like articles instead of books.
  Previously a chapter shared the book-like rendering, so a hereinafter
  for a chapter came out in small caps for both the author and the short
  title (e.g. `[hereinafter MERRILL, PRIVATE AND PUBLIC LAW]`). Under
  Bluebook Rule 15.5/B14, only the containing book takes small caps —
  the chapter title is italic and the chapter author is roman — so a
  hereinafter that names the chapter now renders in article form
  (e.g. `[hereinafter Merrill, Private and Public Law]` with the title
  in italics).

For earlier releases, see the [GitHub Releases page](https://github.com/danepps/zotero/releases)
and the project git history.
