#!/bin/bash
# Usage: ./build.sh 1.3.3.1   (ALWAYS pass a version; see CLAUDE.md "Version numbering")
#
# The version argument (default: the manifest's own version) is INJECTED into
# the staged manifest.json before zipping, so the archived add-on version
# always matches the artifact name. Zotero orders add-ons by the manifest
# version, not the filename — a test build whose archive still said "1.3.1"
# would silently defeat the fourth-component test-build convention.
# The working-tree manifest.json is never touched.
set -e
cd "$(dirname "$0")"

read_version() {
    sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -n1
}

MANIFEST_VERSION=$(read_version manifest.json)
VERSION=${1:-${MANIFEST_VERSION:?could not read version from manifest.json}}
mkdir -p releases
OUT="$(pwd)/releases/Bluebook_Citations_Fixer_v${VERSION}.xpi"
rm -f "$OUT"

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -R manifest.json chrome.manifest prefs.js prefs.xhtml prefs-pane.js \
      bootstrap.js locale lib COPYING.txt "$STAGE"/

if [ "$VERSION" != "$MANIFEST_VERSION" ]; then
    sed 's/"version"[[:space:]]*:[[:space:]]*"[^"]*"/"version": "'"$VERSION"'"/' \
        "$STAGE/manifest.json" > "$STAGE/manifest.json.tmp"
    mv "$STAGE/manifest.json.tmp" "$STAGE/manifest.json"
fi

STAGED_VERSION=$(read_version "$STAGE/manifest.json")
if [ "$STAGED_VERSION" != "$VERSION" ]; then
    echo "ERROR: staged manifest version '$STAGED_VERSION' != requested '$VERSION'" >&2
    exit 1
fi

(cd "$STAGE" && zip -rq "$OUT" \
    manifest.json \
    chrome.manifest \
    prefs.js \
    prefs.xhtml \
    prefs-pane.js \
    bootstrap.js \
    locale \
    lib \
    COPYING.txt)

ARCHIVED_VERSION=$(unzip -p "$OUT" manifest.json | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)
if [ "$ARCHIVED_VERSION" != "$VERSION" ]; then
    echo "ERROR: archived manifest version '$ARCHIVED_VERSION' != requested '$VERSION'" >&2
    exit 1
fi

echo "Built $OUT (manifest version $VERSION)"
echo "Next steps:"
echo "  1. Create GitHub release tagged bluebook-citations-fixer-v${VERSION}"
echo "  2. Upload the XPI as a release asset"
echo "  3. Push update-bluebook-citations.json so the update URL serves this release"
