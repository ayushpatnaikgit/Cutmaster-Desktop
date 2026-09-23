#!/usr/bin/env python3
"""Look at an image and critique it, using Gemini's vision model.

Usage: python3 scripts/look.py <image> ["question"]

Gives the agent eyes: render a still, then ask what's wrong with it. Prints a
short, specific critique on stdout. Needs GEMINI_API_KEY in the environment.
"""
import base64, json, os, sys, urllib.request

path = sys.argv[1]
question = sys.argv[2] if len(sys.argv) > 2 else (
    "You are a demanding motion-graphics director reviewing one frame of an explainer video. "
    "Is it well composed? Say specifically what looks empty, cramped, overlapping, cut off, "
    "off-brand, low-contrast or hard to read, and what you would change. Be concrete and brief."
)
model = os.environ.get("LOOK_MODEL", "gemini-3.1-pro-preview")
key = os.environ["GEMINI_API_KEY"]
mime = "image/jpeg" if path.lower().endswith((".jpg", ".jpeg")) else "image/png"
with open(path, "rb") as f:
    data = base64.b64encode(f.read()).decode()

body = {"contents": [{"parts": [{"inline_data": {"mime_type": mime, "data": data}}, {"text": question}]}]}
req = urllib.request.Request(
    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
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
