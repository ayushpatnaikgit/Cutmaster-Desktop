#!/bin/sh
# Elyps AI installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/ayushpatnaikgit/Elyps-AI/main/install.sh | sh
#
# Sets up ~/Elyps (your footage folder and settings), downloads the app
# as a Docker image, starts it and opens it in your browser. Your videos,
# assets and key live in a Docker volume, so updating never loses them.
#
# Options (environment variables):
#   ELYPS_HOME   where to put Elyps        (default: ~/Elyps)
#   ELYPS_PORT   port for the app              (default: 4322, or the next free one)
#   ELYPS_IMAGE  image to run                  (default: the latest release)
#   ELYPS_NO_OPEN=1  don't open the browser at the end
set -eu

IMAGE="${ELYPS_IMAGE:-ghcr.io/ayushpatnaikgit/elyps:latest}"
HOME_DIR="${ELYPS_HOME:-$HOME/Elyps}"
PORT="${ELYPS_PORT:-}"

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

say "Installing Elyps AI"

# ---------------------------------------------------------------- Docker
os="$(uname -s)"
if ! command -v docker >/dev/null 2>&1; then
  case "$os" in
    Darwin) die "Elyps runs inside Docker, which isn't installed.
Install Docker Desktop for Mac: https://docs.docker.com/desktop/setup/install/mac-install/
Open it once, wait for it to say it's running, then run this installer again." ;;
    *) die "Elyps runs inside Docker, which isn't installed.
Install Docker Engine: https://docs.docker.com/engine/install/  (or Docker Desktop for Linux)
Then run this installer again." ;;
  esac
fi
if ! docker info >/dev/null 2>&1; then
  if [ "$os" = Darwin ]; then
    info "Starting Docker Desktop…"
    open -a Docker 2>/dev/null || true
    i=0; while ! docker info >/dev/null 2>&1; do i=$((i + 1)); [ $i -gt 60 ] && break; sleep 2; done
  fi
  docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start Docker Desktop (or the docker service), then run this again.
On Linux you may also need to add yourself to the docker group: sudo usermod -aG docker \$USER (then log out and in)."
fi
docker compose version >/dev/null 2>&1 || die "Your Docker is missing the 'compose' plugin. Update Docker Desktop, or install docker-compose-plugin."
info "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) is running"

# ---------------------------------------------------------------- port
in_use() {
  if command -v lsof >/dev/null 2>&1; then lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then ss -ltn 2>/dev/null | grep -q ":$1 "
  else return 1; fi
}
if [ -f "$HOME_DIR/.env" ] && [ -z "$PORT" ]; then PORT="$(sed -n 's/^PORT=//p' "$HOME_DIR/.env")"; fi
if [ -z "$PORT" ]; then
  PORT=4322
  # a running Elyps already owns its port — reuse it; otherwise find a free one
  if ! docker ps --format '{{.Names}}' | grep -qx elyps-app; then
    while in_use "$PORT"; do PORT=$((PORT + 1)); done
  fi
fi

# ---------------------------------------------------------------- files
mkdir -p "$HOME_DIR/media"
cat > "$HOME_DIR/.env" <<EOF
# Elyps settings. Run 'elyps restart' after changing them.
PORT=$PORT
IMAGE=$IMAGE
# Seconds the agent waits for your answer before carrying on alone.
ASK_TIMEOUT=7200
# How many edits run at the same time (each needs about 2-3 GB of memory).
MAX_EDITS=3
# Where Elyps is installed (the updater mounts it at the same path).
ELYPS_DIR=$HOME_DIR
EOF

cat > "$HOME_DIR/docker-compose.yml" <<'EOF'
# Elyps AI. Managed by the 'elyps' command; settings are in .env.
name: elyps
services:
  app:
    image: ${IMAGE}
    container_name: elyps-app
    ports:
      - "127.0.0.1:${PORT}:4322"   # only this computer can reach it
    environment:
      ASK_TIMEOUT: "${ASK_TIMEOUT:-7200}"
      MAX_EDITS: "${MAX_EDITS:-3}"
    volumes:
      - data:/data                                  # videos, assets, brand kit, key, usage
      - models:/home/elyps/.cache/huggingface   # speech model, downloaded once
      - ./media:/media:ro                           # your footage: use "From disk" with /media/<file>
    shm_size: "2gb"
    restart: unless-stopped
  # The "Update" button: the app leaves a note in its data folder, and this
  # small helper pulls the new version and restarts the app. It's the only
  # piece with access to Docker; the editing agent can't reach it.
  updater:
    image: docker:27-cli
    container_name: elyps-updater
    working_dir: ${ELYPS_DIR}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ${ELYPS_DIR}:${ELYPS_DIR}
      - data:/data
    command:
      - sh
      - -c
      - |
        while true; do
          date +%s > /data/.updater-alive
          if [ -f /data/.update-requested ]; then
            rm -f /data/.update-requested
            echo "updating $$(date)" > /data/.update-status
            if docker compose --project-directory "$$PWD" pull app >> /data/.update-status 2>&1 && docker compose --project-directory "$$PWD" up -d app >> /data/.update-status 2>&1; then
              echo done >> /data/.update-status
            else
              echo failed >> /data/.update-status
            fi
          fi
          sleep 5
        done
    restart: unless-stopped
volumes:
  data:
  models:
EOF

cat > "$HOME_DIR/elyps" <<'EOF'
#!/bin/sh
# Elyps AI — start, stop, update and check the app.
set -eu
DIR="$(cd "$(dirname "$0")" && pwd -P)"
# follow a symlink (e.g. ~/.local/bin/elyps) back to the install folder
[ -L "$0" ] && DIR="$(cd "$(dirname "$(readlink "$0")")" && pwd -P)"
cd "$DIR"
PORT="$(sed -n 's/^PORT=//p' .env)"
URL="http://localhost:$PORT"
dc() { docker compose --project-directory "$DIR" "$@"; }
open_url() { command -v open >/dev/null 2>&1 && open "$1" || { command -v xdg-open >/dev/null 2>&1 && xdg-open "$1" >/dev/null 2>&1; } || echo "Open $1 in your browser"; }
wait_up() {
  printf 'Starting'; i=0
  until curl -fs "$URL/api/version" >/dev/null 2>&1; do
    i=$((i + 1)); [ $i -gt 90 ] && { echo; echo "It's taking a while — see 'elyps logs'."; return 1; }
    printf '.'; sleep 2
  done; echo " ready at $URL"
}
case "${1:-help}" in
  start)   dc up -d && wait_up && open_url "$URL" ;;
  stop)    dc stop ;;
  restart) dc up -d --force-recreate && wait_up ;;
  update)  dc pull && dc up -d && wait_up && echo "Now running $(curl -fs "$URL/api/version")" ;;
  logs)    dc logs -f --tail 100 ;;
  open)    open_url "$URL" ;;
  media)   open_url "$DIR/media" ;;
  status)
    dc ps
    # the container has Node, so format the system check there
    docker exec elyps-app node -e 'fetch("http://localhost:4322/api/doctor?fresh=1").then(r=>r.json()).then(d=>{console.log(`\nElyps ${d.version}`);for(const c of d.checks)console.log(`  ${c.status==="ok"?"✓":c.status==="warn"?"!":"✗"} ${c.label}: ${c.detail}${c.fix?`\n      → ${c.fix}`:""}`)})' 2>/dev/null \
      || echo "Not running — 'elyps start'" ;;
  uninstall)
    printf 'Remove Elyps? Your videos and settings are kept unless you also type "delete" (y/N/delete): '
    read -r a
    case "$a" in
      delete) dc down -v --rmi all; echo "Removed, including all videos. You can delete $DIR." ;;
      y|Y)    dc down --rmi all; echo "Removed the app. Your videos are kept in Docker; reinstall to get them back." ;;
      *)      echo "Nothing changed." ;;
    esac ;;
  *) cat <<USAGE
Elyps AI — $URL
  elyps start      start it and open the browser
  elyps stop       stop it
  elyps update     download the latest version
  elyps status     is it running, and is everything it needs working?
  elyps logs       what it's doing (Ctrl-C to leave)
  elyps open       open it in the browser
  elyps media      open your footage folder
  elyps uninstall  remove it
USAGE
  ;;
esac
EOF
chmod +x "$HOME_DIR/elyps"

# Put 'elyps' on the PATH when there's a user bin directory for it.
linked=""
for bin in "$HOME/.local/bin" "$HOME/bin"; do
  case ":$PATH:" in *":$bin:"*) mkdir -p "$bin"; ln -sf "$HOME_DIR/elyps" "$bin/elyps"; linked="$bin"; break ;; esac
done
if [ -z "$linked" ] && [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
  ln -sf "$HOME_DIR/elyps" /usr/local/bin/elyps; linked=/usr/local/bin
fi

# ---------------------------------------------------------------- image
say "Downloading Elyps (a couple of GB the first time)…"
if ! docker pull "$IMAGE"; then
  docker image inspect "$IMAGE" >/dev/null 2>&1 || die "Couldn't download $IMAGE. Check your internet connection and try again."
  info "Couldn't reach the registry — using the copy already on this computer."
fi

# ---------------------------------------------------------------- moving from Cutmaster
# Elyps used to be called Cutmaster. Bring an old install's videos and key along.
if docker volume inspect cutmaster_data >/dev/null 2>&1 && ! docker volume inspect elyps_data >/dev/null 2>&1; then
  say "Moving your videos from Cutmaster…"
  docker rm -f cutmaster-app >/dev/null 2>&1 || true
  docker volume create elyps_data >/dev/null
  docker run --rm --user 0 --entrypoint sh -v cutmaster_data:/from:ro -v elyps_data:/to "$IMAGE" -c 'cp -a /from/. /to/'
  for old in "$HOME/.local/bin/cutmaster" "$HOME/bin/cutmaster" /usr/local/bin/cutmaster; do
    [ -L "$old" ] && rm -f "$old" 2>/dev/null || true
  done
  info "Done. The old copy is kept (Docker volume cutmaster_data); remove it any time with: docker volume rm cutmaster_data"
fi

say "Starting…"
docker compose --project-directory "$HOME_DIR" up -d
i=0
until curl -fs "http://localhost:$PORT/api/version" >/dev/null 2>&1; do
  i=$((i + 1)); [ $i -gt 90 ] && die "Elyps didn't start. See: docker logs elyps-app"
  sleep 2
done

cmd="$HOME_DIR/elyps"; [ -n "$linked" ] && cmd="elyps"
say "Elyps AI is running at http://localhost:$PORT"
info "Put camera files in $HOME_DIR/media and use \"From disk\" with /media/<file name>."
info "Add your Gemini API key under \"Settings\" (bottom left) — get one at aistudio.google.com/apikey."
info "Manage it with: $cmd start | stop | update | status"
if [ "${ELYPS_NO_OPEN:-}" != 1 ]; then
  (command -v open >/dev/null 2>&1 && open "http://localhost:$PORT") || (command -v xdg-open >/dev/null 2>&1 && xdg-open "http://localhost:$PORT" >/dev/null 2>&1) || true
fi
