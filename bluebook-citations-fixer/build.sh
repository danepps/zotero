#!/bin/bash
# Usage: ./build.sh 0.1.0
set -e
VERSION=${1:-0.1.0}
cd "$(dirname "$0")"
mkdir -p releases
OUT="releases/Bluebook_Citations_Fixer_v${VERSION}.xpi"
rm -f "$OUT"
zip -r "$OUT" \
    manifest.json \
    chrome.manifest \
    prefs.js \
    bootstrap.js \
    locale \
    lib
echo "Built $OUT"
echo "Next steps:"
echo "  1. Create GitHub release tagged bluebook-cite-v${VERSION}"
echo "  2. Upload the XPI as a release asset"
echo "  3. Update update-bluebook-citations.json with the new version + download link"
