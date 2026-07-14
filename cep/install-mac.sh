#!/bin/bash
# BigHappy Launcher — dev install (macOS)
# Symlinks the extension into the user CEP folder and enables PlayerDebugMode
# so the unsigned extension loads. Restart After Effects afterwards.
set -e

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.bighappy.launcher"

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
ln -s "$SRC" "$DEST"
echo "Linked: $DEST -> $SRC"

# Allow unsigned extensions for every CEP runtime AE 2019-2025 might use
for v in 9 10 11 12; do
    defaults write com.adobe.CSXS.$v PlayerDebugMode 1 2>/dev/null || true
done
killall cfprefsd 2>/dev/null || true

echo "PlayerDebugMode enabled (CSXS 9-12)."
echo "Restart After Effects, then open: Window > Extensions > BigHappy Launcher"
