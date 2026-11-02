#!/bin/sh
# Build a self-contained macOS release: dist/ocu-<version>-macos-<arch>.tar.gz
set -e
cd "$(dirname "$0")/.."
VERSION=${1:-$(git describe --tags --always)}
ARCH=$(uname -m)
OUT=dist/ocu-$VERSION-macos-$ARCH
rm -rf "$OUT" && mkdir -p "$OUT"
(cd mac && swift build -c release)
cp mac/.build/release/ocu-mac "$OUT/"
(cd core && bun install --frozen-lockfile >/dev/null && bun build src/cli.ts --compile --minify --outfile "../$OUT/ocu")
cp scripts/install.sh "$OUT/"
cp README.md "$OUT/"
tar -C dist -czf "$OUT.tar.gz" "$(basename "$OUT")"
echo "$OUT.tar.gz"
