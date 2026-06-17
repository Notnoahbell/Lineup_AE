#!/usr/bin/env bash
# ── Lineup CEP Extension Installer (macOS) ─────────────────────────────────
# Copies the extension to the CEP extensions folder and enables debug mode
# so unsigned extensions are allowed.
#
# Usage:
#   bash install_mac.sh
#   — or —
#   chmod +x install_mac.sh && ./install_mac.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
EXT_ID="com.thinkingbox.lineup"
DEST="$EXT_DIR/$EXT_ID"

echo "Installing Lineup CEP extension..."

# Create extensions directory if it doesn't exist
mkdir -p "$EXT_DIR"

# Remove old version or dev symlink if present
if [ -d "$DEST" ] || [ -L "$DEST" ]; then
    echo "Removing old installation..."
    rm -rf "$DEST"
fi

# Copy extension files (exclude Windows scripts and macOS scripts)
echo "Copying extension files..."
rsync -a \
    --exclude='*.cmd' \
    --exclude='*.sh' \
    "$SCRIPT_DIR/" "$DEST/"

# Enable PlayerDebugMode for unsigned extensions. The manifest supports AE
# 15.0+ (CC 2018), which spans CSXS 6 through whatever's current — different
# machines' AE installs use different CSXS versions, and AE will list the
# extension either way but silently refuse to open an unsigned one unless
# its specific CSXS version has this key set. Cover the whole known range.
echo "Enabling debug mode for unsigned extensions..."
for v in 6 7 8 9 10 11 12 13; do
    defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1 2>/dev/null || true
done

# Verify the writes actually took — System Integrity Protection or an MDM
# profile can silently block "defaults write" with no visible error above,
# which is exactly what causes "shows in the menu but won't open".
echo ""
echo "Verifying debug mode was enabled..."
any_ok=0
for v in 6 7 8 9 10 11 12 13; do
    if defaults read "com.adobe.CSXS.$v" PlayerDebugMode >/dev/null 2>&1; then
        echo "  CSXS.$v - OK"
        any_ok=1
    else
        echo "  CSXS.$v - not set"
    fi
done
if [ "$any_ok" -eq 0 ]; then
    echo ""
    echo "WARNING: PlayerDebugMode could not be set for ANY CSXS version."
    echo "This is almost always System Integrity Protection or an MDM profile"
    echo "blocking 'defaults write'. Try running with sudo, or ask IT to allow it."
fi

echo ""
echo "Done! Restart After Effects, then open:"
echo "  Window > Extensions > Lineup"
echo ""
