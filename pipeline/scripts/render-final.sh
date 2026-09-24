#!/usr/bin/env bash
# Render the finished episode. Pass an output path to override the default.
# ffmpeg composes it (scripts/compose.py) — several times faster; Remotion
# renders it when the layout in src/BigIdeas.tsx was customised, or if
# composing fails.
set -e
cd "$(dirname "$0")/.."
OUT="${1:-out/episode.mp4}"
mkdir -p out logs
node scripts/export-clips.mjs
if [ "${ELYPS_RENDERER:-compose}" = compose ] && python3 scripts/compose.py "$OUT"; then
  :
else
  echo "rendering with Remotion"
  npx remotion render src/index.ts BigIdeas "$OUT" \
    --codec=h264 --crf=18 --audio-codec=aac --audio-bitrate=256k \
    --concurrency=${RENDER_CONCURRENCY:-100%} --timeout=120000 --log=error
fi
ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT"
echo "wrote $OUT"
