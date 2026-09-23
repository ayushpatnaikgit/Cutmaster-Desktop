#!/usr/bin/env python3
"""Speech-to-text for the prompt box's microphone, with faster-whisper.

Runs as one long-lived process started by the app (lib/dictate.mjs), so the
model loads once. Reads one JSON request per line on stdin:
    {"id": "...", "path": "/tmp/x.webm"}
and answers one JSON line per request on stdout:
    {"id": "...", "text": "...", "language": "en"}   or   {"id": "...", "error": "..."}

The model is multilingual ("small" by default, ELYPS_DICTATION_MODEL to change)
so Indian English, Hindi-English and names come through better than with an
English-only model. It downloads once, into the models volume.
"""
import json, os, sys

model = None


def load():
    global model
    if model is None:
        from faster_whisper import WhisperModel
        name = os.environ.get("ELYPS_DICTATION_MODEL", "small")
        model = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=max(2, (os.cpu_count() or 4) // 2))
    return model


for line in sys.stdin:
    try:
        req = json.loads(line)
    except ValueError:
        continue
    try:
        if req.get("warm"):
            load()
            out = {"id": req.get("id"), "ready": True}
        else:
            segments, info = load().transcribe(req["path"], beam_size=1, vad_filter=True,
                                               condition_on_previous_text=False)
            text = " ".join(s.text.strip() for s in segments).strip()
            out = {"id": req["id"], "text": text, "language": info.language}
    except Exception as e:  # report, keep serving
        out = {"id": req.get("id"), "error": str(e)[:300]}
    print(json.dumps(out), flush=True)
