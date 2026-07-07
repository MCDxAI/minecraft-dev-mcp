#!/usr/bin/env bash
# Rebuild the Access Transformer fixture JAR from the stub sources.
# The compiled JAR (../summoningrituals-mc-stubs.jar) is committed so tests do
# not need a JDK at runtime; re-run this only when the stub sources change.
#   Requires JDK 17+ (records). Usage: bash build.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../summoningrituals-mc-stubs.jar"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mapfile -t srcs < <(find "$here" -name '*.java')
javac -d "$tmp" "${srcs[@]}"
( cd "$tmp" && jar --create --file "$out" . )
echo "Wrote $out"
