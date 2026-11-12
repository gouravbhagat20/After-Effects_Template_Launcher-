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
# Exclusions live in cep/.zxpignore so that CI's package-drift check can
# stage the tree exactly the same way before comparing it to the zxp.
rsync -a "$CEP/" "$STAGE/" --exclude-from="$CEP/.zxpignore"

# 4. Sign (timestamped when the TSA is reachable, unsigned-timestamp fallback)
# ZXPSignCmd exits 0 even when the timestamp authority's reply "could not be
# verified", leaving a package other tools are "likely to reject" — so the
# exit code is not enough. Read its output, and move on to the next authority
# (then to an untimestamped signature) until one signs cleanly.
sign_with() {   # $1 = TSA url, or empty for no timestamp
    rm -f "$OUT"
    local log
    if [ -n "$1" ]; then
        log="$("$SIGN" -sign "$STAGE" "$OUT" "$CERT" "$PASS" -tsa "$1" 2>&1)" || return 1
    else
        log="$("$SIGN" -sign "$STAGE" "$OUT" "$CERT" "$PASS" 2>&1)" || return 1
    fi
    if echo "$log" | grep -qi "could not be verified"; then return 1; fi
    [ -f "$OUT" ]
}
SIGNED_WITH=""
# Several authorities, because this ZXPSignCmd (4.1.3) cannot verify the
# replies of some of them — which ones varies over time. Certum and Apple
# verified when DigiCert, Sectigo and GlobalSign did not (2026-11).
for tsa in http://timestamp.digicert.com http://time.certum.pl http://timestamp.apple.com/ts01 \
           http://timestamp.sectigo.com ""; do
    if sign_with "$tsa"; then SIGNED_WITH="${tsa:-no timestamp}"; break; fi
    echo "Signing with ${tsa:-no timestamp} failed — trying the next option…"
done
[ -n "$SIGNED_WITH" ] || { echo "Could not sign the package." >&2; exit 1; }
echo "Signed (timestamp: $SIGNED_WITH)"

"$SIGN" -verify "$OUT"

# 5. Publish the SHA-256 next to the zxp — the panel's updater refuses to
# install a download whose hash doesn't match this file.
shasum -a 256 "$OUT" | awk '{print $1}' > "$OUT.sha256"

echo ""
echo "Built: $OUT"
echo "SHA-256: $(cat "$OUT.sha256")"

# 6. Prune superseded releases — the updater only ever fetches the version it is
# notifying about (dist/BigHappyLauncher_v<remote>.zxp), so older zxps are dead
# weight. Keep only the one we just built (and its checksum).
for old in "$DIST"/BigHappyLauncher_v*.zxp; do
    [ "$old" = "$OUT" ] && continue
    [ -e "$old" ] || continue
    rm -f "$old" "$old.sha256"
    echo "Pruned: $(basename "$old")"
done
