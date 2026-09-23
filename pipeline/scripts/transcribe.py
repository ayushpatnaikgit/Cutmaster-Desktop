"""Transcribe the synced audio with word-level timings.

Usage: python3 scripts/transcribe.py [audio] [model]
Defaults to public/audio/clean.wav and the medium.en model, writes
transcript.json and prints the transcript so graphics can be timed to words.
Needs faster-whisper: python3 -m venv .venv && .venv/bin/pip install faster-whisper
"""
import json, sys
from faster_whisper import WhisperModel

audio = sys.argv[1] if len(sys.argv) > 1 else 'public/audio/clean.wav'
model = WhisperModel(sys.argv[2] if len(sys.argv) > 2 else 'medium.en', device='cpu', compute_type='int8')
segments, _ = model.transcribe(audio, word_timestamps=True, beam_size=5)
out = []
for s in segments:
    out.append({'start': s.start, 'end': s.end, 'text': s.text.strip(),
                'words': [{'w': w.word, 's': w.start, 'e': w.end} for w in s.words]})
    print(f'[{s.start:6.1f}-{s.end:6.1f}] {s.text.strip()}')
json.dump(out, open('transcript.json', 'w'), indent=1)
print('\nwrote transcript.json')
