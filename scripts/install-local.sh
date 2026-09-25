#!/bin/sh
set -e

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BIN_NAME="cloudflare-d1-http"

case "$(uname -s)" in
  Darwin) DEST="$HOME/Library/Application Support/com.debba.tabularis/plugins/$BIN_NAME" ;;
  Linux)  DEST="$HOME/.local/share/tabularis/plugins/$BIN_NAME" ;;
  *)      echo "Unsupported OS for this installer. Run 'npm run package' and copy a zip's contents manually." ; exit 1 ;;
esac

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  TARGET="bun-darwin-arm64" ;;
  Darwin-x86_64) TARGET="bun-darwin-x64" ;;
  Linux-x86_64)  TARGET="bun-linux-x64" ;;
  Linux-aarch64) TARGET="bun-linux-arm64" ;;
  *)             echo "Unsupported host arch: $(uname -s)-$(uname -m)" >&2 ; exit 1 ;;
esac

if ! command -v bun >/dev/null 2>&1; then
  echo "bun not found on PATH. Install it: https://bun.sh" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST/ui/dist"

echo "Compiling native binary ($TARGET)..."
bun build "$ROOT/src/index.ts" --compile --target="$TARGET" --outfile "$DEST/$BIN_NAME"
chmod +x "$DEST/$BIN_NAME"
cp "$ROOT/manifest.json" "$DEST/manifest.json"
cp "$ROOT/.tabularium" "$DEST/.tabularium"
cp "$ROOT/ui/dist/d1-db-field.js" "$DEST/ui/dist/d1-db-field.js"

echo "Installed Cloudflare D1 plugin to:"
echo "  $DEST"
echo "Restart Tabularis to load it."
