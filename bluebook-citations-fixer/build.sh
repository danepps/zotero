#!/bin/bash
# Usage: ./build.sh 0.1.14
set -e
cd "$(dirname "$0")"
# Default to the version in manifest.json so an argument-less build never
# produces a stale, misleadingly-named artifact.
MANIFEST_VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' manifest.json | head -n1)
VERSION=${1:-${MANIFEST_VERSION:?could not read version from manifest.json}}
mkdir -p releases
OUT="releases/Bluebook_Citations_Fixer_v${VERSION}.xpi"
rm -f "$OUT"
zip -r "$OUT" \
    manifest.json \
    chrome.manifest \
    prefs.js \
    prefs.xhtml \
    prefs-pane.js \
    bootstrap.js \
    locale \
    lib \
    COPYING.txt
echo "Built $OUT"
echo "Next steps:"
echo "  1. Create GitHub release tagged bluebook-citations-fixer-v${VERSION}"
echo "  2. Upload the XPI as a release asset"
echo "  3. Push update-bluebook-citations.json so the update URL serves this release"
