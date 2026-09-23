# Cutmaster AI — desktop edition.
# One image with everything the agent needs to edit a video end to end:
# Node (app + Remotion), Python 3.13 (OpenHands, faster-whisper, audio sync),
# ffmpeg, Chromium (HTML graphics) and Remotion's own headless browser.
FROM python:3.13-slim-bookworm

ARG VERSION=dev
LABEL org.opencontainers.image.title="Cutmaster AI" \
      org.opencontainers.image.description="An AI video editor: drop a talk, describe the video, get a finished edit with branded graphics." \
      org.opencontainers.image.source="https://github.com/ayushpatnaikgit/Cutmaster-Desktop" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="$VERSION"

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1

# System tools: ffmpeg for audio/video, ImageMagick for keying illustration
# backgrounds, Chromium for rendering graphics, tini to reap child processes.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl ffmpeg imagemagick chromium fonts-liberation fonts-noto-core \
      tini procps git \
    && rm -rf /var/lib/apt/lists/*

# Node 22 from the official image, without disturbing this image's Python.
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && node -v && npm -v

# Python: the agent harness, transcription and the audio-sync maths.
RUN pip install "openhands-ai==1.11.0" faster-whisper numpy scipy

# Run as an ordinary user: the agent executes commands it writes itself.
RUN useradd --create-home --uid 1000 cutmaster
WORKDIR /app

COPY --chown=cutmaster:cutmaster app/package*.json app/
COPY --chown=cutmaster:cutmaster pipeline/package*.json pipeline/
USER cutmaster
RUN cd app && npm ci --omit=dev \
 && cd ../pipeline && npm ci \
 && npx remotion browser ensure

COPY --chown=cutmaster:cutmaster app/ app/
COPY --chown=cutmaster:cutmaster pipeline/ pipeline/

# The pipeline's scripts call .venv/bin/python; point it at the image's Python.
RUN python -m venv --system-site-packages /app/pipeline/.venv

ENV PORT=4322 \
    CUTMASTER_VERSION=$VERSION \
    DATA_DIR=/data \
    PIPELINE_DIR=/app/pipeline \
    OPENHANDS_PYTHON=python \
    CHROME_PATH=/usr/bin/chromium \
    CHROME_NO_SANDBOX=1 \
    OPENHANDS_SUPPRESS_BANNER=1 \
    HF_HOME=/home/cutmaster/.cache/huggingface

USER root
RUN mkdir -p /data /media /home/cutmaster/.cache/huggingface && chown -R cutmaster:cutmaster /data /home/cutmaster/.cache
USER cutmaster

EXPOSE 4322
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fs http://localhost:4322/api/version || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "app/server.mjs"]
