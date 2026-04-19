# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

Zotero 7+ bootstrap plugins for legal scholars, maintained by Dan Epps (Washington University School of Law). Two plugins:

- **bluebook-signals** — Ctrl+S signal picker injected into Zotero's citation dialog prefix field
- **bluebook-fixer** — Tools menu item that reads Zotero citation fields from an active Word document via AppleScript (macOS only)

## Building

Each plugin is packaged as a `.xpi` (zip) using its build script:

```bash
cd bluebook-signals
./build.sh 3.0.1          # produces releases/Bluebook_Signals_v3.0.1.xpi

cd bluebook-fixer
# No build script yet; zip manually analogous to bluebook-signals/build.sh
```

After building, the release process requires:
1. Create a GitHub release tagged `bluebook-signals-v<version>`
2. Upload the XPI as a release asset
3. Update `update.json` (signals) or `update-fixer.json` (fixer) with the new version and download URL

There are no tests, no linter, and no CI.

## Plugin Architecture

Both plugins follow the same Zotero bootstrap pattern:

- **`manifest.json`** — declares the extension ID, version, and `"loader": "bootstrap"`
- **`bootstrap.js`** — implements `startup`, `shutdown`, `install`, `uninstall`; uses `Services.ww` (window watcher) to observe new windows and inject UI at the right moment
- **`chrome.manifest`** — registers chrome:// content/skin paths
- **`chrome/chrome/content/defaultprefs.js`** — loaded via `Services.scriptloader.loadSubScript` in `startup()`; sets default preferences via a `pref()` shim

**Important path quirk in bluebook-signals:** The content directory is double-nested at `chrome/chrome/content/` (not `chrome/content/`). The `startup()` call and `chrome.manifest` both reference this correctly; do not flatten the structure.

### bluebook-signals flow

1. `startup()` loads default prefs and registers the window watcher
2. When a window opens, `windowWatcher` waits for `DOMContentLoaded` and checks if `doc.documentElement.id === 'citation-dialog'`
3. If so, `injectUI(doc)` builds a XUL `<menupopup>` and attaches it to `#popups` (or `<body>`)
4. A `keydown` listener on the document opens the popup when Ctrl+S is fired with `#prefix` focused
5. Selecting a menu item calls `insertSignal()`, which splices the signal value into the prefix field and dispatches an `input` event so React registers the change

**Prefix field markup:** The `#prefix` input field in Zotero's citation dialog accepts HTML markup. Values like `<i>see</i>` are stored as strings and rendered as italic text by Zotero when inserting into the word processor. Do not strip the HTML tags.

### bluebook-fixer flow

1. `startup()` adds a "Fix Bluebook Citations" menu item to `#menu_ToolsPopup` in every open Zotero window, and registers the window watcher for future windows
2. Clicking the menu item calls `fixCitations()`, which writes an AppleScript to a temp file and runs it via `nsIProcess` → `/bin/sh -c osascript ...`
3. The AppleScript reads all `ZOTERO_ITEM` field codes from the active Word document (body + footnotes) and returns them as a newline-delimited string
4. `shutdown()` removes the menu item from all open windows

### Signals list

Stored as a JSON array in the `extensions.bluebook-signals.signals` preference (set by `defaultprefs.js`). The menu shows each signal capitalized first, then lowercase.

## Releasing a New Version

1. Bump `"version"` in `manifest.json`
2. Run `./build.sh <new-version>`
3. Create GitHub release + upload XPI
4. Update `update.json` with the new version string and `update_link` URL
