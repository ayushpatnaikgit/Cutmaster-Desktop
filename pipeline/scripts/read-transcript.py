#!/usr/bin/env python3
"""Print the transcript compactly: one line per sentence with its time.

Usage: python3 scripts/read-transcript.py                 # the whole talk
       python3 scripts/read-transcript.py --from 40 --to 75

Read the talk with this, not by printing transcript.json: the JSON carries a
timing for every word, which is ten times longer and fills your context. For
exact word times use scripts/find-words.py "<phrase>".
"""
import json, sys

args = sys.argv[1:]
opt = lambda k, d: float(args[args.index(k) + 1]) if k in args else d
lo, hi = opt("--from", 0), opt("--to", 1e9)
data = json.load(open("transcript.json"))
for s in data["segments"] if isinstance(data, dict) else data:
    if s["end"] >= lo and s["start"] <= hi:
        print(f"{s['start']:6.1f}–{s['end']:6.1f}  {s['text'].strip()}")
