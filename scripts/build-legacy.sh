#!/usr/bin/env bash
# Builds the deployable static site into build/.
# Only allowlisted files are copied, so docs, supabase/, CSV exports and
# tooling never get published.
set -eu

cd "$(dirname "$0")/.."

rm -rf build
mkdir build

cp -- *.html config.js nav.js style.css icon-192.png icon-512.png manifest.json _headers build/

echo "Built $(ls build | wc -l) files into build/"
