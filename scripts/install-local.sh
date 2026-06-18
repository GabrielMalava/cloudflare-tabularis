#!/bin/sh
set -e

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

case "$(uname -s)" in
  Darwin) DEST="$HOME/Library/Application Support/com.debba.tabularis/plugins/tubularis-d1" ;;
  Linux)  DEST="$HOME/.local/share/tabularis/plugins/tubularis-d1" ;;
  *)      echo "Unsupported OS for this installer. Copy dist/index.cjs, launcher/tubularis-d1 and manifest.json manually." ; exit 1 ;;
esac

if [ ! -f "$ROOT/dist/index.cjs" ]; then
  echo "dist/index.cjs not found. Run 'npm run build' first." >&2
  exit 1
fi

NODE_BIN=$(command -v node || true)
if [ -z "$NODE_BIN" ]; then
  echo "node not found on PATH. Install Node.js first." >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp "$ROOT/manifest.json" "$DEST/manifest.json"
cp "$ROOT/dist/index.cjs" "$DEST/index.cjs"

if [ -d "$ROOT/ui" ]; then
  cp -R "$ROOT/ui" "$DEST/ui"
fi

# Generate a launcher with the absolute node path baked in. A GUI app launched
# from Finder/Dock does not inherit the shell PATH (and nvm node is never on it),
# so relying on `node` from PATH would make the plugin fail to spawn.
cat > "$DEST/tubularis-d1" <<EOF
#!/bin/sh
DIR=\$(CDPATH= cd -- "\$(dirname -- "\$0")" && pwd)
exec "$NODE_BIN" "\$DIR/index.cjs" "\$@"
EOF
chmod +x "$DEST/tubularis-d1"

echo "Installed Cloudflare D1 plugin to:"
echo "  $DEST"
echo "Using node: $NODE_BIN"
echo "Restart Tabularis to load it."
