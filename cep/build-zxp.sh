#!/bin/bash
# Build a signed .zxp of the BigHappy Launcher extension (macOS).
#
#   ./cep/build-zxp.sh
#
# - Downloads Adobe's ZXPSignCmd on first run (cached in build/tools)
# - Creates a self-signed certificate on first run (build/cert.p12 — gitignored;
#   override the password with BH_CERT_PASS)
# - Stages cep/ without dev-only files and signs it to dist/
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
CEP="$REPO/cep"
BUILD="$REPO/build"
TOOLS="$BUILD/tools"
STAGE="$BUILD/stage"
DIST="$REPO/dist"
CERT="$BUILD/cert.p12"
PASS="${BH_CERT_PASS:-bighappy}"

VERSION=$(sed -n 's/.*ExtensionBundleVersion="\([^"]*\)".*/\1/p' "$CEP/CSXS/manifest.xml" | head -1)
OUT="$DIST/BigHappyLauncher_v$VERSION.zxp"

mkdir -p "$TOOLS" "$DIST"

# 1. ZXPSignCmd
SIGN="$TOOLS/ZXPSignCmd"
if [ ! -x "$SIGN" ]; then
    echo "Downloading ZXPSignCmd…"
    curl -L --fail -o "$SIGN" \
        "https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/ZXPSignCMD/4.1.3/macOS/ZXPSignCmd"
    chmod +x "$SIGN"
    xattr -d com.apple.quarantine "$SIGN" 2>/dev/null || true
fi

# 2. Self-signed certificate (once)
if [ ! -f "$CERT" ]; then
    echo "Creating self-signed certificate…"
    "$SIGN" -selfSignedCert US NY BigHappy "BigHappy Launcher" "$PASS" "$CERT"
fi

# 3. Stage without dev-only files
rm -rf "$STAGE"
mkdir -p "$STAGE"
rsync -a "$CEP/" "$STAGE/" \
    --exclude ".debug" --exclude "install-mac.sh" --exclude "install-win.bat" \
    --exclude "build-zxp.sh" --exclude "*.md" \
    --exclude "test" --exclude "package.json" --exclude "node_modules"

# 4. Sign (timestamped when the TSA is reachable, unsigned-timestamp fallback)
rm -f "$OUT"
"$SIGN" -sign "$STAGE" "$OUT" "$CERT" "$PASS" -tsa http://timestamp.digicert.com \
    || "$SIGN" -sign "$STAGE" "$OUT" "$CERT" "$PASS"

"$SIGN" -verify "$OUT"
echo ""
echo "Built: $OUT"

# 5. Prune superseded releases — the updater only ever fetches the version it is
# notifying about (dist/BigHappyLauncher_v<remote>.zxp), so older zxps are dead
# weight. Keep only the one we just built.
for old in "$DIST"/BigHappyLauncher_v*.zxp; do
    [ "$old" = "$OUT" ] && continue
    [ -e "$old" ] || continue
    rm -f "$old"
    echo "Pruned: $(basename "$old")"
done
