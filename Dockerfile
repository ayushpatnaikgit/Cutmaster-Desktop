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
      tini procps git sudo \
    && rm -rf /var/lib/apt/lists/*

# Node 22 from the official image, without disturbing this image's Python.
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && node -v && npm -v

# Python: the agent harness, transcription and the audio-sync maths.
RUN pip install "openhands-ai==1.11.0" faster-whisper numpy scipy

# Two users. The app runs as `cutmaster` and holds the encrypted Gemini key.
# The agent runs code it writes itself, so it runs as `agent`: it can write
# job workspaces (shared group `studio`) but can't read the key files, and it
# reaches Gemini only through the app's local proxy with a per-job token.
RUN groupadd --gid 1500 studio \
 && useradd --create-home --uid 1000 --gid studio cutmaster \
 && useradd --create-home --uid 1001 --gid studio --shell /bin/bash agent \
 && printf 'Defaults:cutmaster !env_reset\ncutmaster ALL=(agent) NOPASSWD:SETENV: ALL\n' > /etc/sudoers.d/cutmaster-agent \
 && chmod 440 /etc/sudoers.d/cutmaster-agent && visudo -cf /etc/sudoers.d/cutmaster-agent
WORKDIR /app

COPY --chown=cutmaster:studio app/package*.json app/
COPY --chown=cutmaster:studio pipeline/package*.json pipeline/
USER cutmaster
# umask 002: the agent (same group) may write caches under pipeline/node_modules.
RUN umask 002 && cd app && npm ci --omit=dev \
 && cd ../pipeline && npm ci \
 && npx remotion browser ensure

COPY --chown=cutmaster:studio app/ app/
COPY --chown=cutmaster:studio pipeline/ pipeline/

# The pipeline's scripts call .venv/bin/python; point it at the image's Python.
RUN umask 002 && python -m venv --system-site-packages /app/pipeline/.venv

ENV PORT=4322 \
    CUTMASTER_VERSION=$VERSION \
    AGENT_USER=agent \
    DATA_DIR=/data \
    PIPELINE_DIR=/app/pipeline \
    OPENHANDS_PYTHON=python \
    CHROME_PATH=/usr/bin/chromium \
    CHROME_NO_SANDBOX=1 \
    OPENHANDS_SUPPRESS_BANNER=1 \
    HF_HOME=/home/cutmaster/.cache/huggingface

USER root
RUN mkdir -p /data/jobs /media /home/cutmaster/.cache/huggingface \
 && chown -R cutmaster:studio /data /home/cutmaster/.cache \
 && chmod 2775 /data /data/jobs /home/cutmaster/.cache /home/cutmaster/.cache/huggingface \
 && chmod 711 /home/cutmaster
USER cutmaster

EXPOSE 4322
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fs http://localhost:4322/api/version || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "app/server.mjs"]
