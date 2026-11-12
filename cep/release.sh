#!/bin/bash
# Prepare a CEP release (macOS): the four things that must agree, in one step.
#
#   ./cep/release.sh 0.4.11
#
# A release is the manifest version (twice), BH_VERSION in js/core.js, a
# CHANGELOG entry in js/update-ui.js, and the built zxp in dist/. CI rejects a
# push where they disagree, and users' updates abort on one that slips through.
#
# This script: checks the CHANGELOG entry exists (you write that — it is the
# What's New text), sets the version in the manifest and core.js, runs the
# tests, and builds the signed zxp. It does NOT commit or push; it prints the
# commands, so the last step before users see an update is still yours.
#
# Re-running with the current version just re-tests and rebuilds.
set -euo pipefail

VERSION="${1:-}"
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Usage: ./cep/release.sh <version>   e.g. 0.4.11" >&2
    exit 1
fi

REPO="$(cd "$(dirname "$0")/.." && pwd)"
CEP="$REPO/cep"
MANIFEST="$CEP/CSXS/manifest.xml"
CORE="$CEP/js/core.js"
CHANGELOG="$CEP/js/update-ui.js"

CURRENT=$(sed -n 's/.*ExtensionBundleVersion="\([^"]*\)".*/\1/p' "$MANIFEST" | head -1)

# 1. The What's New entry has to exist before anything is changed.
if ! grep -qF "\"$VERSION\": [" "$CHANGELOG"; then
    echo "No CHANGELOG entry for $VERSION in cep/js/update-ui.js." >&2
    echo "Add one at the top of CHANGELOG first:" >&2
    echo "        \"$VERSION\": [" >&2
    echo "            \"What changed, in the user's words\"" >&2
    echo "        ]," >&2
    exit 1
fi

# 2. Version in the manifest (bundle + extension) and core.js.
sed -i '' -E "s/(ExtensionBundleVersion=\")[0-9.]+(\")/\1$VERSION\2/" "$MANIFEST"
sed -i '' -E "s/(<Extension [^>]*Version=\")[0-9.]+(\")/\1$VERSION\2/" "$MANIFEST"
sed -i '' -E "s/(BH_VERSION = \")[0-9.]+(\")/\1$VERSION\2/" "$CORE"

[ "$(grep -c "\"$VERSION\"" "$MANIFEST")" -ge 2 ] || { echo "manifest.xml was not updated in both places" >&2; exit 1; }
grep -qF "BH_VERSION = \"$VERSION\"" "$CORE" || { echo "BH_VERSION was not updated in core.js" >&2; exit 1; }
echo "Version: $CURRENT -> $VERSION"

# 3. Tests — a failing suite stops here, before a zxp exists to push by mistake.
echo "Running tests…"
(cd "$CEP" && node --test >/dev/null) || { echo "Tests failed — run: cd cep && npm test" >&2; exit 1; }
echo "Tests passed."

# 4. Build (also prunes the previous version's zxp).
"$CEP/build-zxp.sh"

cat <<NEXT

Release v$VERSION is prepared, not published. If host.jsx changed, run
cep/test/ae-smoke.jsx inside After Effects first. Then:

    git add -A cep dist
    git commit -m "release(cep): v$VERSION — <summary>"
    git push origin main
NEXT
