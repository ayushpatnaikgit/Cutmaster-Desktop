#!/usr/bin/env python3
"""Look at an image and critique it, using Gemini's vision model.

Usage: python3 scripts/look.py <image> [<image>...] ["question"]

Gives the agent eyes: render stills, then ask what's wrong with them — all the
stills of one graphic in a single call. Prints a short, specific critique on
stdout. Needs GEMINI_API_KEY in the environment.
"""
import base64, json, os, sys, urllib.request

args = sys.argv[1:]
paths = [a for a in args if os.path.isfile(a)]
extra = [a for a in args if not os.path.isfile(a)]
question = extra[-1] if extra else (
    "You are a demanding motion-graphics director reviewing "
    + ("one frame" if len(paths) == 1 else f"{len(paths)} frames, in time order,")
    + " of one graphic in an explainer video. Say specifically what looks empty, cramped, "
    "overlapping, cut off, off-brand, low-contrast or hard to read, and what to change. "
    "Only real problems a viewer would notice, most important first, at most five. "
    "If it looks good, say so in one line. Be concrete and brief."
)
model = os.environ.get("LOOK_MODEL", "gemini-3.1-pro-preview")
key = os.environ["GEMINI_API_KEY"]
parts = []
for path in paths:
    mime = "image/jpeg" if path.lower().endswith((".jpg", ".jpeg")) else "image/png"
    with open(path, "rb") as f:
        parts += [{"text": os.path.basename(path)}, {"inline_data": {"mime_type": mime, "data": base64.b64encode(f.read()).decode()}}]
if not parts:
    sys.exit("look.py: no image found — give it the path of a rendered still")

body = {"contents": [{"parts": parts + [{"text": question}]}]}
req = urllib.request.Request(
    f"{os.environ.get('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta')}/models/{model}:generateContent",
    data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": key},
)
try:
    with urllib.request.urlopen(req, timeout=120) as r:
        out = json.load(r)
    parts = out["candidates"][0]["content"]["parts"]
    print("\n".join(p.get("text", "") for p in parts).strip())
    try:  # one line per review, for the studio's usage view
        import datetime, pathlib
        logs = pathlib.Path(__file__).resolve().parents[1] / "logs"; logs.mkdir(exist_ok=True)
        with open(logs / "usage.jsonl", "a") as f:
            f.write(json.dumps({"t": datetime.datetime.utcnow().isoformat() + "Z", "job": os.environ.get("STUDIO_JOB_ID"), "kind": "look", "model": model}) + "\n")
    except Exception:
        pass
except Exception as e:  # report, don't crash the agent's loop
    print(f"look.py could not review the image: {e}", file=sys.stderr)
    sys.exit(1)
