#!/bin/bash
# Usage: ./build.sh 1.3.3.1          (side-load test)
#        ./build.sh --release 2.0   (release artifact; does not publish)
#
# The required version argument is INJECTED into
# the staged manifest.json before zipping, so the archived add-on version
# always matches the artifact name. Zotero orders add-ons by the manifest
# version, not the filename — a test build whose archive still said "1.3.1"
# would silently defeat the fourth-component test-build convention.
# The working-tree manifest.json is never touched.
set -euo pipefail
cd "$(dirname "$0")"

usage() {
    echo "Usage: $0 <X.Y.Z.N> | --release <X.Y[.Z]>" >&2
    exit 1
}

MODE=test
if [ "${1:-}" = "--release" ]; then
    MODE=release
    shift
fi
[ "$#" -eq 1 ] || usage
VERSION=$1
COMPONENT='(0|[1-9][0-9]*)'
if [ "$MODE" = test ]; then
    [[ "$VERSION" =~ ^$COMPONENT\.$COMPONENT\.$COMPONENT\.[1-9][0-9]*$ ]] || usage
else
    [[ "$VERSION" =~ ^$COMPONENT\.$COMPONENT(\.$COMPONENT)?$ ]] || usage
fi

read_version() {
    sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -n1
}

MANIFEST_VERSION=$(read_version manifest.json)
if [ "$MODE" = release ] && [ "$VERSION" != "$MANIFEST_VERSION" ]; then
    echo "ERROR: release version must match manifest.json ($MANIFEST_VERSION)" >&2
    exit 1
fi
OUT="$(pwd)/releases/Bluebook_Citations_Fixer_v${VERSION}.xpi"

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

(cd "$STAGE" && zip -rq artifact.xpi \
    manifest.json \
    chrome.manifest \
    prefs.js \
    prefs.xhtml \
    prefs-pane.js \
    bootstrap.js \
    locale \
    lib \
    COPYING.txt)

ARCHIVED_VERSION=$(unzip -p "$STAGE/artifact.xpi" manifest.json | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)
if [ "$ARCHIVED_VERSION" != "$VERSION" ]; then
    echo "ERROR: archived manifest version '$ARCHIVED_VERSION' != requested '$VERSION'" >&2
    exit 1
fi

mkdir -p releases
mv "$STAGE/artifact.xpi" "$OUT"
echo "Built $OUT (manifest version $VERSION)"
if [ "$MODE" = test ]; then
    echo "Side-load this test XPI in Zotero. Keep it untracked."
    echo "Do not publish this test version through the production update manifest."
else
    echo "Release artifact only; nothing has been published."
    echo "After release checks pass:"
    echo "  1. Create GitHub release tagged bluebook-citations-fixer-v${VERSION}"
    echo "  2. Upload the verified XPI and confirm its download URL and hash"
    echo "  3. Push the matching update-bluebook-citations.json to main"
fi
