#!/bin/sh
# Install into ~/.local/share/ocu and link ~/.local/bin/ocu.
set -e
SRC=$(cd "$(dirname "$0")" && pwd)
DEST=${OCU_HOME:-$HOME/.local/share/ocu}
mkdir -p "$DEST" "$HOME/.local/bin"
# Remove first: overwriting a signed binary in place makes macOS kill it on launch (exit 137).
for f in ocu ocu-mac; do
  rm -f "$DEST/$f"
  cp "$SRC/$f" "$DEST/$f"
  xattr -d com.apple.quarantine "$DEST/$f" 2>/dev/null || true
  codesign --force -s - "$DEST/$f" 2>/dev/null || true
done
ln -sf "$DEST/ocu" "$HOME/.local/bin/ocu"
echo "installed: $DEST (ocu -> ~/.local/bin/ocu)"
echo
echo "Next:"
echo "  1. Grant Accessibility (and Screen Recording, for the screenshot fallback) to the terminal / app that will run ocu:"
echo "     System Settings > Privacy & Security."
echo "  2. ocu doctor"
echo "  3. Register the MCP server in your agent:  command = $DEST/ocu, args = [\"mcp\"]"
