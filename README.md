# Bluebook Signals for Zotero

A Zotero plugin that adds a Bluebook signal picker to the citation dialog prefix field. Press **Ctrl+S** while the prefix field is focused to open a menu of signals (*E.g.*, *Accord*, *See*, etc.).

## Installation

1. Download the latest `.xpi` from [Releases](https://github.com/danepps/zotero/releases)
2. In Zotero: Tools → Plugins → gear icon → Install Plugin From File
3. Select the downloaded `.xpi`

## Usage

1. Open the Add Citation dialog in your word processor
2. Search for and select a citation
3. Click into the **Prefix** field
4. Press **Ctrl+S** to open the signal picker
5. Click a signal to insert it

## Releasing a new version

1. Bump `"version"` in `manifest.json`
2. Rebuild the XPI: `cd src && zip -r ../releases/Bluebook_Signals_vX.Y.Z.xpi manifest.json bootstrap.js chrome.manifest chrome/ version/`
3. Create a GitHub release tagged `vX.Y.Z` and upload the XPI as a release asset
4. Update `update.json` with the new version and release download URL
