#!/usr/bin/env bash
# ── Lineup CEP Extension Updater (macOS) ───────────────────────────────────
# Copies changed files to the installed location.
# No AE restart needed — just right-click inside the Lineup panel
# and choose "Reload Extension".
#
# TIP: Run dev_setup_mac.sh once to symlink the source folder instead,
#      then you never need to run this update script at all.
# Run install_mac.sh first if this is a fresh machine.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
EXT_ID="com.thinkingbox.lineup"
DEST="$EXT_DIR/$EXT_ID"

# Fall back to full install if not yet installed
if [ ! -d "$DEST" ] && [ ! -L "$DEST" ]; then
    echo "Extension not installed yet. Running install_mac.sh instead..."
    bash "$SCRIPT_DIR/install_mac.sh"
    exit 0
fi

# Dev symlink detected — source edits are already live, nothing to copy
if [ -L "$DEST" ]; then
    echo "Dev symlink detected — source edits are already live."
    echo "Right-click inside the Lineup panel and choose Reload Extension."
    exit 0
fi

echo "Updating Lineup CEP extension..."

rsync -a "$SCRIPT_DIR/CSXS/" "$DEST/CSXS/"
rsync -a "$SCRIPT_DIR/host/" "$DEST/host/"
rsync -a "$SCRIPT_DIR/css/"  "$DEST/css/"
rsync -a "$SCRIPT_DIR/js/"   "$DEST/js/"
rsync -a "$SCRIPT_DIR/bin/"  "$DEST/bin/"
cp    -f "$SCRIPT_DIR/index.html" "$DEST/index.html"
# Re-stage BBQC's files inside Lineup's own folder — same staging spot the
# in-app self-updater uses (js/update.js), whether or not BBQC is actually
# installed as its own extension below.
if [ -d "$SCRIPT_DIR/BBQC_CEP" ]; then
    rsync -a "$SCRIPT_DIR/BBQC_CEP/" "$DEST/BBQC_CEP/"
fi

# ── BBQC companion extension ────────────────────────────────────────────────
# Mirrors js/update.js: silently refresh BBQC if it's already installed as its
# own extension, otherwise ask before installing it fresh.
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
        read -r -p "BBQC companion extension not found — install it now? [Y/n] " bbqc_answer || bbqc_answer=""
        if [[ ! "$bbqc_answer" =~ ^[Nn]$ ]]; then
            echo "Installing BBQC..."
            mkdir -p "$BBQC_DEST"
            rsync -a "$BBQC_SRC/" "$BBQC_DEST/"
            echo "BBQC installed."
        fi
    fi
fi

echo ""
echo "Done! To pick up the changes in After Effects:"
echo "  1. Close the Lineup panel  (click X on the panel tab)"
echo "  2. Reopen via  Window > Extensions > Lineup"
echo ""
