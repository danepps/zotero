# Bluebook Signals

Zotero 7/9 plugin that adds a signal picker to the citation-dialog prefix
field. While the prefix field is focused, press **Ctrl+S** to open a menu of
Bluebook signals and insert the chosen one.

## Install

Download [Bluebook_Signals_v3.0.2.xpi](https://github.com/danepps/zotero/releases/download/bluebook-signals-v3.0.2/Bluebook_Signals_v3.0.2.xpi)
and install it via **Zotero → Tools → Plugins → gear menu → Install Plugin From File**.

> 💡 Pairs with [Bluebook Citations Fixer](../bluebook-citations-fixer/README.md) —
> [installing both](#companion-plugin) is recommended.

## Usage

1. Open the Add Citation dialog in your word processor.
2. Search for and select a citation.
3. Click into the **Prefix** field.
4. Press **Ctrl+S** to open the signal picker.
5. Select a signal to insert it into the prefix.

Signals are shown in italics in the menu, previewing how they'll appear in
the citation.

## Included Signals

`e.g.,`, `accord`, `see`, `see also`, `see, e.g.,`, `cf.`, `contra`,
`but see`, `see generally`

## Companion plugin

This plugin pairs with
**[Bluebook Citations Fixer](../bluebook-citations-fixer/README.md)**, which
rewrites Zotero's citation output to apply Bluebook rules CSL can't express
cleanly (hereinafter, journal volume/year, book pincites, and a manual
"Break id." fix). The two are built for the same law-review workflow and are
meant to be used together — **installing both is recommended.**

## Release history

- **v3.0.2** (2026-10-31) — Menu signals now use a sans-serif italic instead of a
  serif one.
- **v3.0.1** (2026-10-31) — Signals display in italics in the Ctrl+S menu.
  Also fixes the plugin's packaging so it builds correctly from the repo.
- **v3.0.0** (2026-04-03) — Initial release, updated for Zotero 7/9.

## Credits

Original author: Frank Bennett. Updated for Zotero 9 by Dan Epps, 2026.
