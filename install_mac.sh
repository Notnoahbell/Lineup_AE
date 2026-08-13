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

# ── BBQC companion extension ────────────────────────────────────────────────
# BBQC ships bundled inside this repo (see BBQC_CEP/) but installs as its own
# separate CEP extension, matching what js/update.js's in-app self-updater
# does on every Lineup update: silently refresh it if it's already there,
# otherwise ask before installing it fresh.
BBQC_SRC="$SCRIPT_DIR/BBQC_CEP"
BBQC_DEST="$EXT_DIR/BBQC_CEP"
if [ -d "$BBQC_SRC" ]; then
    if [ -d "$BBQC_DEST" ]; then
        echo "Updating BBQC companion extension..."
        rsync -a "$BBQC_SRC/CSXS/"  "$BBQC_DEST/CSXS/"
        rsync -a "$BBQC_SRC/certs/" "$BBQC_DEST/certs/"
        rsync -a "$BBQC_SRC/css/"   "$BBQC_DEST/css/"
        rsync -a "$BBQC_SRC/js/"    "$BBQC_DEST/js/"
        rsync -a "$BBQC_SRC/jsx/"   "$BBQC_DEST/jsx/"
        cp -f "$BBQC_SRC/index.html" "$BBQC_DEST/index.html"
    else
        read -r -p "BBQC companion extension not found — install it too? [Y/n] " bbqc_answer || bbqc_answer=""
        if [[ ! "$bbqc_answer" =~ ^[Nn]$ ]]; then
            echo "Installing BBQC..."
            mkdir -p "$BBQC_DEST"
            rsync -a "$BBQC_SRC/" "$BBQC_DEST/"
            echo "BBQC installed."
        fi
    fi
fi

echo ""
echo "Done! Restart After Effects, then open:"
echo "  Window > Extensions > Lineup"
if [ -d "$BBQC_DEST" ]; then
    echo "  Window > Extensions > BBQC"
fi
echo ""
