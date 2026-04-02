#!/bin/bash
# Usage: ./build.sh 3.0.1
VERSION=${1:-3.0.0}
cd "$(dirname "$0")"
zip -r "releases/Bluebook_Signals_v${VERSION}.xpi" \
    manifest.json bootstrap.js chrome.manifest chrome/ version/
echo "Built releases/Bluebook_Signals_v${VERSION}.xpi"
echo "Next steps:"
echo "  1. Create GitHub release tagged v${VERSION}"
echo "  2. Upload the XPI as a release asset"
echo "  3. Update update.json with the new version"
