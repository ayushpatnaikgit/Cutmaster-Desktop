#!/usr/bin/env bash
# Render the finished episode. Pass an output path to override the default.
set -e
cd "$(dirname "$0")/.."
OUT="${1:-out/episode.mp4}"
mkdir -p out logs
node scripts/export-clips.mjs
npx remotion render src/index.ts BigIdeas "$OUT" \
  --codec=h264 --crf=18 --audio-codec=aac --audio-bitrate=256k \
  --concurrency=4 --timeout=120000 --log=error
ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT"
echo "wrote $OUT"
