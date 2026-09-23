#!/usr/bin/env bash
# Set up Cutmaster AI to run without Docker.
# Needs: Node 22, Python 3.12 or 3.13, ffmpeg, ImageMagick, Google Chrome or Chromium.
set -euo pipefail
cd "$(dirname "$0")/.."

need() { command -v "$1" >/dev/null || { echo "Missing: $1 — $2" >&2; exit 1; }; }
need node "install Node 22"
need ffmpeg "install ffmpeg"
need convert "install ImageMagick"

PY=""
for candidate in python3.13 python3.12; do command -v "$candidate" >/dev/null && { PY=$candidate; break; }; done
[ -n "$PY" ] || { echo "Missing: Python 3.12 or 3.13 (OpenHands needs it)" >&2; exit 1; }

echo "→ app dependencies"
(cd app && npm install)

echo "→ pipeline dependencies and Remotion's browser"
(cd pipeline && npm install && npx remotion browser ensure)

echo "→ OpenHands (agent) in app/.venv-oh"
"$PY" -m venv app/.venv-oh
app/.venv-oh/bin/pip install --upgrade pip "openhands-ai==1.11.0"

echo "→ transcription and audio sync in pipeline/.venv"
"$PY" -m venv pipeline/.venv
pipeline/.venv/bin/pip install faster-whisper numpy scipy

CHROME=$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)
echo
echo "Done. Start it with:"
echo "  cd app && ${CHROME:+CHROME_PATH=$CHROME }node server.mjs"
echo "then open http://localhost:4322"
