#!/usr/bin/env bash
# Render every HTML scene used in the edit to MP4, 4 at a time.
cd "$(dirname "$0")/.."
SCENES="$(node -e 'const fs=require("fs");const ep=JSON.parse(fs.readFileSync("episode.json"));const c=JSON.parse(fs.readFileSync("src/clips.json"));console.log([ep.intro,ep.outro,...c.map(x=>x.key)].join(" "))')"
# Pass scene names as arguments to re-render only those.
[ $# -gt 0 ] && SCENES="$*"
printf '%s\n' $SCENES | xargs -P 4 -I{} sh -c 'node scripts/render-html.mjs {} public/clips/{}.mp4 > logs/{}.log 2>&1 && echo done {}'
