#!/usr/bin/env bash
# Intel macOS dev setup: upstream ships no x86_64 ONNX Runtime prebuilts
# (>=1.24), so fetch the community build (same one CI uses) and export the
# env that cargo needs to link `ort` against it.
#
# Usage (must be sourced so the exports persist in your shell):
#   source scripts/setup-ort-intel-mac.sh
# Then:
#   pnpm tauri:dev
set -u

ORT_VERSION="1.24.2"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
ORT_DIR="$ROOT/third-party/onnxruntime-osx-x86_64-${ORT_VERSION}"

if [ ! -f "$ORT_DIR/lib/libonnxruntime.${ORT_VERSION}.dylib" ]; then
  echo "Downloading ONNX Runtime ${ORT_VERSION} for Intel macOS..."
  mkdir -p "$ROOT/third-party"
  curl -L -o /tmp/ort-intel-mac.tgz \
    "https://blob.handy.computer/onnxruntime-osx-x86_64-${ORT_VERSION}.tgz"
  tar xzf /tmp/ort-intel-mac.tgz -C "$ROOT/third-party"
  rm -f /tmp/ort-intel-mac.tgz
fi

export ORT_LIB_LOCATION="$ORT_DIR/lib"
export ORT_PREFER_DYNAMIC_LINK=1
export DYLD_LIBRARY_PATH="$ORT_DIR/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"

echo "ORT ready: $ORT_LIB_LOCATION"
echo "Now run: pnpm tauri:dev"
