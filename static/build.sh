#!/usr/bin/env bash
set -euo pipefail

# Always run from the directory this script lives in, then return
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
pushd "$SCRIPT_DIR" >/dev/null

# Require local esbuild binary
if [[ ! -x "./esbuild" ]]; then
  echo "esbuild not found (expected ./static/esbuild). Skipping build." >&2
  popd >/dev/null
  exit 1
fi

./esbuild app.ts --bundle --outfile=app.js --target=es2015

popd >/dev/null
