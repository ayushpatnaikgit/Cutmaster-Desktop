"""Print the timestamp of every word starting with the given prefixes.

Usage: python3 scripts/find-words.py floods evidence loudest
Use these timestamps as the source times inside html/clips.js, so each graphic
lands on the word it illustrates.
"""
import json, sys
words = [(w['w'].strip().lower().strip('.,?'), w['s']) for s in json.load(open('transcript.json')) for w in s['words']]
for key in sys.argv[1:]:
    print(key, [round(t, 2) for w, t in words if w.startswith(key.lower())][:8])
