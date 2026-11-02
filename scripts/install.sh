#!/bin/sh
# Install into ~/.local/share/ocu and link ~/.local/bin/ocu.
set -e
SRC=$(cd "$(dirname "$0")" && pwd)
DEST=${OCU_HOME:-$HOME/.local/share/ocu}
mkdir -p "$DEST" "$HOME/.local/bin"
cp "$SRC/ocu" "$SRC/ocu-mac" "$DEST/"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
ln -sf "$DEST/ocu" "$HOME/.local/bin/ocu"
echo "installed: $DEST (ocu -> ~/.local/bin/ocu)"
echo
echo "Next:"
echo "  1. Grant Accessibility (and Screen Recording, for the screenshot fallback) to the terminal / app that will run ocu:"
echo "     System Settings > Privacy & Security."
echo "  2. ocu doctor"
echo "  3. Register the MCP server in your agent:  command = $DEST/ocu, args = [\"mcp\"]"
