#!/usr/bin/env python3
"""Ask the person watching this job a question, and block until they answer.

Usage:
  python3 scripts/ask-user.py --type beats --title "Beat sheet" --file beats.json
  python3 scripts/ask-user.py --type question --title "Which take?" --body "A or B?"

Writes the question to the job's gate.json and waits for the web app to write
the matching answer file, then prints the answer on stdout.
"""
import argparse, json, os, sys, time
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--type', default='question', choices=['beats', 'options', 'question'])
p.add_argument('--title', required=True)
p.add_argument('--body', default='')
p.add_argument('--file', default=None, help='a JSON or text file to show the user')
p.add_argument('--url', default=None, help='a path inside the workspace to preview, e.g. out/options.html')
p.add_argument('--timeout', type=int, default=int(os.environ.get('ASK_TIMEOUT', 7200)))
a = p.parse_args()

job_dir = Path(os.environ.get('STUDIO_JOB_DIR', Path(__file__).resolve().parents[2]))
gate_path = job_dir / 'gate.json'

n = 1
if gate_path.exists():
    try:
        n = json.loads(gate_path.read_text()).get('n', 0) + 1
    except Exception:
        n = 1

payload = a.body
if a.file:
    f = Path(a.file)
    if f.exists():
        payload = f.read_text()[:200000]
    else:
        print(f'ask-user: {a.file} not found', file=sys.stderr)

gate_path.write_text(json.dumps({
    'n': n, 'type': a.type, 'title': a.title, 'body': payload,
    'url': a.url, 'asked_at': time.time(),
}))
print(f'[waiting for the user: {a.title}]', file=sys.stderr, flush=True)

answer_path = job_dir / f'answer-{n}.json'
deadline = time.time() + a.timeout
while time.time() < deadline:
    if answer_path.exists():
        print(json.loads(answer_path.read_text()).get('answer', ''))
        sys.exit(0)
    time.sleep(2)

print('NO ANSWER: the user did not reply in time. Use your best judgement, '
      'follow the house style, and note the decision you made.', file=sys.stdout)
sys.exit(0)
