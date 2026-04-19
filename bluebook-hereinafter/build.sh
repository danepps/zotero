#!/bin/bash
# Usage: ./build.sh 0.1.0
VERSION=${1:-0.1.0}
cd "$(dirname "$0")"
mkdir -p releases
zip -r "releases/Bluebook_Hereinafter_v${VERSION}.xpi" \
    manifest.json bootstrap.js chrome.manifest
echo "Built releases/Bluebook_Hereinafter_v${VERSION}.xpi"
echo "Next steps:"
echo "  1. Create GitHub release tagged hereinafter-v${VERSION}"
echo "  2. Upload the XPI as a release asset"
echo "  3. Update update-hereinafter.json with the new version"
