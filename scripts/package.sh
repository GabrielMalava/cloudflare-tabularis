#!/bin/sh
set -e

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

BIN_NAME="cloudflare-d1-http"
DIST="$ROOT/release"
STAGE_ROOT="$ROOT/.stage"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun not found on PATH. Install it: https://bun.sh" >&2
  exit 1
fi
if ! command -v zip >/dev/null 2>&1; then
  echo "zip not found on PATH." >&2
  exit 1
fi

PLATFORMS="${*:-linux-x64 linux-arm64 darwin-x64 darwin-arm64 win-x64}"

rm -rf "$DIST" "$STAGE_ROOT"
mkdir -p "$DIST"

for PLATFORM in $PLATFORMS; do
  case "$PLATFORM" in
    linux-x64)    TARGET="bun-linux-x64";    EXE="$BIN_NAME" ;;
    linux-arm64)  TARGET="bun-linux-arm64";  EXE="$BIN_NAME" ;;
    darwin-x64)   TARGET="bun-darwin-x64";   EXE="$BIN_NAME" ;;
    darwin-arm64) TARGET="bun-darwin-arm64"; EXE="$BIN_NAME" ;;
    win-x64)      TARGET="bun-windows-x64";  EXE="$BIN_NAME.exe" ;;
    *) echo "Unknown platform: $PLATFORM" >&2; exit 1 ;;
  esac

  echo "==> $PLATFORM ($TARGET)"
  STAGE="$STAGE_ROOT/$PLATFORM"
  mkdir -p "$STAGE/ui/dist"

  bun build ./src/index.ts --compile --target="$TARGET" --outfile "$STAGE/$EXE"
  chmod +x "$STAGE/$EXE" 2>/dev/null || true
  cp manifest.json "$STAGE/manifest.json"
  cp .tabularium "$STAGE/.tabularium"
  cp ui/dist/d1-db-field.js "$STAGE/ui/dist/d1-db-field.js"

  (cd "$STAGE" && zip -q -r "$DIST/$BIN_NAME-$PLATFORM.zip" .)
  echo "    $DIST/$BIN_NAME-$PLATFORM.zip"
done

rm -rf "$STAGE_ROOT"
echo ""
echo "Artifacts:"
ls -lh "$DIST"
