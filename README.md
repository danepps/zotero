# Zotero Plugins — Dan Epps

Zotero plugins designed to improve functionality for legal scholars writing in
law reviews. Maintained by Dan Epps, Washington University School of Law.
Questions and suggestions: epps@wustl.edu

Each plugin is self-contained and independently installable. Pick the one you
want below, then follow the link to its own README for features, install steps,
and usage.

## Plugins

### Bluebook Signals

A signal picker for the citation-dialog prefix field. Press **Ctrl+S** while the
Prefix field is focused to insert a Bluebook signal (*See*, *E.g.*, *Accord*,
etc.).

🌐 [Project page & install →](https://danepps.github.io/zotero/bluebook-signals/)

📖 **[Documentation](bluebook-signals/README.md)** ·

### Bluebook Citations Fixer

> ⚠️ In active development and possibly buggy. It seems to work well, but use at
> your own risk.

Rewrites Zotero's citation output inside the integration pipeline to apply
Bluebook rules that CSL alone can't express cleanly (hereinafter, journal
volume/year, book pincites, manual "Break id.", and a style gate that keeps the
plugin dormant under any style but your own). Runs automatically on every
insert/refresh.

🌐 [Project page & install →](https://danepps.github.io/zotero/bluebook-citations-fixer/)

📖 **[Documentation](bluebook-citations-fixer/README.md)** ·

## Installing a plugin

Every plugin installs the same way:

1. Download the plugin's `.xpi` from its project page (linked above).
2. In Zotero, go to **Tools → Plugins → gear menu → Install Plugin From File**.
3. Select the downloaded `.xpi`.

## License

Each plugin carries its own license; see the `COPYING.txt` (or equivalent) in
the plugin's directory. Bluebook Citations Fixer is licensed under the GNU
General Public License v3.
