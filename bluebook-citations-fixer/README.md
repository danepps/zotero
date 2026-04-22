# Bluebook Citations Fixer

> ⚠️ **Beta / experimental.** This plugin is in active development and
> likely buggy. Install only if you want to help beta test and are
> comfortable reporting issues. Back up any document you run it against.

Zotero plugin that rewrites rendered citation text to apply Bluebook rules
that are awkward or impossible to express cleanly in CSL alone.

## Current Features

- Hereinafter support for ambiguous same-author works
  - First full cite gets `[hereinafter ...]`
  - Subsequent `supra note` cites get the short title inserted before
    `supra note`
  - `Id.` cites, including signal-prefixed forms such as `See id.`, should
    never get a hereinafter append
- Suppress the trailing year parenthetical for journal articles when the
  volume itself is a four-digit year-like number
- Insert `, at` for qualifying citations when a title ends in a numeral and
  the rendered cite would otherwise look like `... 1868 45 (2006)`

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

- `0.1.5`
- Git tag: `bluebook-citations-fixer-v0.1.5`
- GitHub release asset: [Bluebook_Citations_Fixer_v0.1.5.xpi](https://github.com/danepps/zotero/releases/download/bluebook-citations-fixer-v0.1.5/Bluebook_Citations_Fixer_v0.1.5.xpi)
