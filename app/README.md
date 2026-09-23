# Elyps AI

A web app around the episode pipeline: drop in a camera file and a mic file,
type what you want, and an agent produces the episode — syncing audio,
transcribing, generating illustrations and music, writing the graphics, and
rendering the final MP4. It streams every step to the browser and stops to ask
you when a decision is yours.

```bash
npm install
node server.mjs          # http://localhost:4321
```

Paste a Gemini API key in the browser. That one key drives everything: the agent
itself, Nano Banana for illustrations, Lyria for music.

## How it fits together

```
browser  ──uploads, prompt, answers──▶  server.mjs  ──queue (one at a time)──▶  worker.mjs
   ▲                                        │                                      │
   └──────── SSE event stream ──────────────┘                            prepares jobs/<id>/work
                                                                          from ../pipeline
                                                                                   │
                                                                    driver: OpenHands ── or ── Gemini
                                                                                   │
                                                          ffmpeg · Chrome · Remotion · whisper
```

- **`server.mjs`** — uploads, job queue, SSE stream, approval gates, serving outputs. Never runs the agent itself.
- **`worker.mjs`** — copies the template into `jobs/<id>/work`, links the media into `raw/`, writes `TASK.md`, then hands over to a driver.
- **`drivers/openhands.mjs`** + **`openhands_runner.py`** — the [OpenHands](https://github.com/OpenHands/OpenHands) SDK agent (terminal, file editor, task tracker) in a local workspace, with Gemini as the model via LiteLLM.
- **`drivers/gemini.mjs`** — a dependency-free fallback: a direct Gemini tool-calling loop with `bash`, `write_file`, `read_file`, `list_dir`. Useful when OpenHands can't start, and as a reference for how small the loop really is.
- **`lib/store.mjs`** — jobs on disk, events as append-only JSONL, encrypted key storage.

## Approval gates

The agent asks you things by running, inside its workspace:

```bash
python3 scripts/ask-user.py --type beats --title "Beat sheet" --file beats.json
python3 scripts/ask-user.py --type options --title "Pick an opener" --url out/big-ideas-openers.html
```

That writes `jobs/<id>/gate.json` and blocks. The browser shows the question —
rendering the options page in an iframe when there is one — and your answer is
written back as `answer-<n>.json`, which the script prints on stdout so the
agent reads it as the tool's output. If nobody answers within `ASK_TIMEOUT`
(default 7200s; set it lower for unattended runs), the script tells the agent to
use its judgment and carry on.

## The key

- Encrypted at rest with AES-256-GCM under `.secret` (mode 0600), never in the jobs table.
- Decrypted only into the worker's environment, never written into the workspace where the agent could read it.
- Redacted from the event stream by `redact()` in `lib/store.mjs`.
- Validated against Google when you save it, so a bad key fails at the form rather than mid-render.
- The UI shows only the last four characters, and "Remove" actually deletes it.

## Running it for real

This runs the agent's shell commands **on this machine**, not in a sandbox. That
is fine for you on your own laptop. Before anyone else can submit prompts, give
each job its own container — that is what OpenHands' Docker runtime is for, and
the container image needs ffmpeg, Chrome, Remotion, whisper and the fonts baked
in, because a missing font silently changes the video.

## Settings worth knowing

| Env var | Default | What it does |
|---|---|---|
| `PORT` | 4321 | Web port |
| `PIPELINE_DIR` | `../pipeline` | Which pipeline to copy per job |
| `ASK_TIMEOUT` | 7200 | Seconds a question waits before the agent proceeds alone |

`jobs/<id>/` holds everything for a run: the uploads, the workspace, the event
log, the gate and the answers. Delete the directory to delete the run.
