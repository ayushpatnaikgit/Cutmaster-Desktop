# Cutmaster AI — Desktop

An AI video editor that runs on your own machine. Drop in a camera file and a
separate audio recording, describe the video you want, and an agent syncs the
audio, transcribes the talk, proposes a plan, generates illustrations and
music, animates graphics timed to the speaker's words, and renders a finished
1080p MP4 — stopping to ask you whenever a decision is yours.

It runs as a local web app: start it, then open it in your browser.

## Install

You need **Docker**: [Docker Desktop](https://www.docker.com/products/docker-desktop/) on Mac and Windows, or Docker Engine on Linux. Install it, open it once, then run the installer.

**macOS / Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/ayushpatnaikgit/Cutmaster-Desktop/main/install.sh | sh
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/ayushpatnaikgit/Cutmaster-Desktop/main/install.ps1 | iex
```

The installer:

1. creates a `Cutmaster` folder in your home folder, with a `media` folder inside it for your footage;
2. downloads the app (a few GB, once);
3. starts it and opens **http://localhost:4322** in your browser.

If port 4322 is taken, it uses the next free one.

Click **API key** (bottom left) and paste a [Gemini API key](https://aistudio.google.com/apikey). That one key runs the agent, the illustrations (Nano Banana) and the music (Lyria). It is stored encrypted on your computer.

Then drop your footage on the home page, write a brief the way you'd brief an editor, and press **Start editing**.

### Everyday commands

| | |
|---|---|
| `cutmaster start` | start it and open the browser |
| `cutmaster stop` | stop it (it also stops when Docker quits) |
| `cutmaster update` | download the latest version; your videos are kept |
| `cutmaster status` | is it running, and is everything it needs working? |
| `cutmaster logs` | what it's doing right now |
| `cutmaster media` | open your footage folder |
| `cutmaster uninstall` | remove it, keeping your videos unless you say otherwise |

The app is only reachable from your own computer (it listens on `127.0.0.1`).

### From source (developers)

```bash
cp .env.example .env          # optional: set MEDIA_DIR to your footage folder
docker compose up --build     # the first build installs a browser and the agent
```

### Large camera files

Uploading a 1 GB camera file through the browser is slow and pointless when
it's already on your disk. Put your footage in the `media` folder (`~/Cutmaster/media`
after installing; `MEDIA_DIR` when running from source). It's mounted read-only
at `/media` inside the app. On the home page choose **From disk** and enter
`/media/<file name>`.

## What's inside

```
app/        the web app, job queue and agent drivers (Node)
  server.mjs        HTTP API, uploads, projects, assets, usage, live event stream
  worker.mjs        prepares a workspace per job and runs the agent in it
  drivers/          OpenHands (default) and a dependency-free Gemini loop
  playbook/AGENTS.md  how the agent is told to work — the thing to tune
  public/index.html the whole UI
pipeline/   the editing toolkit copied into every job's workspace
  scripts/          audio sync, transcription, image/music generation,
                    HTML→MP4 graphics rendering, music mixing, final render
  html/             the graphics library (intro/outro scenes, helpers)
  src/              the Remotion edit
```

The agent is [OpenHands](https://github.com/OpenHands/OpenHands) driving
`gemini-3.8-flash`, with `gemini-3.1-pro-preview` reviewing rendered frames.
Both are set in `app/`; the model is also selectable per job.

## Using it

- **Home** — drop files (videos, audio, photos), write a brief, start.
- **A video** — the agent's conversation in the centre; it asks you for a plan
  and for a look before it builds. The timeline along the bottom fills in as
  graphics render. **Click any block, image or moment to change just that.**
- **Brand** — logos, fonts, music and reference images shared by every video.
- **Usage** — estimated Gemini spend per video, editable prices, a monthly budget.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `4322` | Port the app is served on |
| `MEDIA_DIR` | `./media` | Host folder mounted read-only at `/media` |
| `ASK_TIMEOUT` | `7200` | Seconds the agent waits for your answer before deciding alone |
| `DATA_DIR` | `/data` (in Docker) | Where projects, jobs, assets and the key are stored |
| `PIPELINE_DIR` | `/app/pipeline` | The toolkit copied into each job |
| `OPENHANDS_PYTHON` | `python` (in Docker) | Python that has `openhands-ai` installed |
| `CHROME_PATH` | `/usr/bin/chromium` | Browser used to render HTML graphics |

## Your data

Everything the app creates lives in the `cutmaster-data` Docker volume:
projects, job workspaces (with every intermediate file), the brand kit, usage
records and your Gemini key — encrypted at rest with a key generated on first
run. Rebuilding the image doesn't touch it.

```bash
docker compose down            # stop, keep data
docker compose down -v         # stop and delete all data, including your key
```

## Running without Docker

You need Node 22, Python 3.12 or 3.13, ffmpeg, ImageMagick and Chrome.

```bash
./scripts/setup-local.sh       # installs dependencies into app/ and pipeline/
cd app && node server.mjs      # http://localhost:4322
```

## Releasing

`.github/workflows/release.yml` builds the image for Intel/AMD and Apple Silicon on native runners and smoke-tests each build: every tool the agent needs must pass the system check. It then publishes one multi-architecture image to `ghcr.io/ayushpatnaikgit/cutmaster-desktop`.

- Push to `main` → `:edge`
- Tag `vX.Y.Z` → `:X.Y.Z`, `:X.Y` and `:latest`

The installers pull `:latest`. After the first release, set the package to **public** under GitHub → Packages → cutmaster-desktop → Package settings, so the installers can download it without logging in.

## Security

The agent runs commands it writes itself. In Docker it does so as an
unprivileged user inside the container, with your footage mounted read-only.
Run without Docker only on a machine you're comfortable handing a shell to.

## Licence

MIT — see [LICENSE](LICENSE).
