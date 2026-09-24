#!/usr/bin/env python3
"""The quick edit: from an approved plan to a finished video in a few minutes,
with a handful of model calls instead of an agent loop. The app runs it after
the person answers the plan that scripts/quickstart.py drafted.

  1. wait for the word-timed transcript (quickstart started it)
  2. one call decides the cut: trim, graphics (key, timing, brief), music,
     titles → episode.json and logs/fastcut.json
  3. at the same time: trim the footage, make the music, and write every
     graphic (one call each, all at once); check each graphic with rendered
     stills, and fix it once if a still errors or looks broken
  4. render the graphics and the final video → out/episode.mp4, out/youtube.md

Prints "STEP <what>" lines for the app. Exit code 0 means out/episode.mp4 is
done. On failure everything made so far stays in place and FASTCUT.md says
what's left, so the agent can finish it.

Usage: python3 scripts/fastcut.py [--mode short] [--answer logs/answer.txt]
"""
import base64, concurrent.futures as cf, json, os, re, shutil, subprocess, sys, threading, time, urllib.request
from pathlib import Path

T0 = time.time()
W = Path('.')
BASE = os.environ.get('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta')
KEY = os.environ.get('GEMINI_API_KEY', '')
AGENT_MODEL = os.environ.get('AGENT_MODEL') or 'gemini-3.8-flash'
QUICK_MODEL = os.environ.get('QUICK_MODEL') or 'gemini-3.5-flash-lite'
LOOK_MODEL = AGENT_MODEL  # the settings' look model is often Pro: too slow for a quick check
args = sys.argv[1:]
opt = lambda k, d=None: args[args.index(k) + 1] if k in args and args.index(k) + 1 < len(args) else d
MODE = opt('--mode', 'interview')
VERTICAL = MODE == 'short'
ANSWER = Path(opt('--answer', 'logs/answer.txt'))
done_steps, left = [], []


def say(s):
    print(f'[{time.time() - T0:5.1f}s] {s}', flush=True)


def step(s):
    print(f'STEP {s}', flush=True)
    say(s)


def gemini(model, parts, temperature=0.4, timeout=300, json_out=False):
    cfg = {'temperature': temperature}
    if json_out:
        cfg['responseMimeType'] = 'application/json'
    body = {'contents': [{'role': 'user', 'parts': parts}], 'generationConfig': cfg}
    req = urllib.request.Request(f'{BASE}/models/{model}:generateContent', data=json.dumps(body).encode(),
                                 headers={'content-type': 'application/json', 'x-goog-api-key': KEY})
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                out = json.load(r)
            return ''.join(p.get('text', '') for p in out['candidates'][0]['content']['parts'] if not p.get('thought')).strip()
        except Exception as e:
            last = e
            time.sleep(3 * (attempt + 1))
    raise last


def run(cmd, timeout=1800):
    r = subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True, timeout=timeout)
    return r.returncode == 0, (r.stdout + r.stderr)


def image_part(p):
    return {'inlineData': {'mimeType': 'image/png', 'data': base64.b64encode(Path(p).read_bytes()).decode()}}


def fail(what):
    """Leave a note for the agent and stop."""
    (W / 'FASTCUT.md').write_text('# The quick edit got this far\n\n' + ''.join(f'- done: {d}\n' for d in done_steps)
                                  + f'\n**Stopped at:** {what}\n\nStill to do: ' + (', '.join(left) or 'check and render') + '.\n')
    say(f'Stopped: {what}')
    sys.exit(1)


# ---------------------------------------------------------------- 1. transcript
step('Timing every word')
t = time.time()
while time.time() - t < 900 and not (W / 'logs' / 'transcribe.done').exists():
    time.sleep(1)
try:
    segments = json.load(open(W / 'transcript.json'))
    segments = segments['segments'] if isinstance(segments, dict) else segments
    words = [w for s in segments for w in s.get('words', [])]
    assert words
except Exception as e:
    fail(f'the word-timed transcript is missing ({e})')
done_steps.append(f'transcript.json ({len(words)} words)')
duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', 'public/audio/clean.wav']).strip() or 0)

# ---------------------------------------------------------------- 2. the cut, in one call
step('Deciding the cut')
plan_md = (W / 'plan.md').read_text() if (W / 'plan.md').exists() else ''
try:
    plan = json.loads((W / 'plan.json').read_text())
except Exception:
    plan = {}
answer = ANSWER.read_text().strip() if ANSWER.exists() else 'Looks good.'
mode_md = (W / 'MODE.md').read_text() if (W / 'MODE.md').exists() else ''
talk = '\n'.join(f"{s['start']:.1f}-{s['end']:.1f} {s['text'].strip()}" for s in segments)
rules = ('Vertical short (9:16): pick the strongest continuous stretch of 25-60 s (unless they asked for another length), '
         'starting on a hook. 1-3 graphics, each 2.5-6 s: a big number, three words, one simple chart or icon.') if VERTICAL else (
         'Keep the whole talk (trim only silence at the head and tail) unless they asked for a cut. About one graphic per 25-40 s '
         'of talk (at most 8), each 6-20 s, on the key ideas; neighbouring graphics back to back so the speaker changes size rarely.')
decision = gemini(AGENT_MODEL, [{'text': f"""You are the editor of Elyps, an AI video editor. The person approved this plan (their answer is below). Decide the exact cut from the word-timed transcript. Answer with JSON only.

PLAN:
{plan_md[:12000]}

PLAN DATA: {json.dumps(plan)[:6000]}

THEIR ANSWER TO THE PLAN: {answer[:3000]}

THE KIND OF VIDEO:
{mode_md[:4000]}

RULES: {rules}
The footage plays as one continuous stretch from source.start to source.end (no cuts inside it). Graphics must lie inside that stretch, must not overlap, and each starts when its idea is first said. Every number, name or label a graphic shows must come from the talk or the plan's research; anything else is marked illustrative. Speaker and organisation only as confirmed in the plan or their answer — otherwise empty strings.

TRANSCRIPT (seconds, camera time; {duration:.1f} s in all):
{talk[:90000]}

JSON shape:
{{"needs_agent": false, "why": "", "title": str, "subtitle": str, "speaker": str, "org": str, "takeaway": [two or three short lines for the closing card],
 "source": {{"start": seconds, "end": seconds}},
 "music": "a one-line music prompt: genre, mood, tempo, instruments; instrumental, no vocals",
 "graphics": [{{"key": "clipCamelCase", "start": seconds, "end": seconds, "idea": "the one idea it lands", "visual": "exactly what is on screen and how it moves", "facts": ["every number, name and label to show"], "illustrative": false}}],
 "youtube": "Markdown: a title, a two-line description, {'three hashtags' if VERTICAL else 'chapters with times in the finished video, from 0:00'}"}}
Set needs_agent to true (with why) only if their answer asks for something this can't do: web captures, research beyond the plan, generated images, reordering the talk, several separate cuts."""}], temperature=0.3, json_out=True)
try:
    cut = json.loads(re.sub(r'^```(?:json)?|```$', '', decision.strip()).strip())
except Exception:
    fail('the cut decision was not valid JSON')
(W / 'logs' / 'fastcut.json').write_text(json.dumps(cut, indent=1))
if cut.get('needs_agent'):
    fail(f"their answer needs the agent: {cut.get('why', '')}")

# snap the trim to the words: just before the first, just after the last
src = cut.get('source') or plan.get('source') or {}
lo, hi = float(src.get('start', 0)), float(src.get('end', duration) or duration)
inside = [w for w in words if w['s'] >= lo - 1.0 and w['e'] <= hi + 1.0] or words
start = max(0.0, round(inside[0]['s'] - 0.3, 2))
end = min(duration, round(inside[-1]['e'] + 0.5, 2))

# graphics: inside the stretch, starting on a word, no overlaps, sensible length
graphics, keys = [], set()
lo_len, hi_len = (2.0, 8.0) if VERTICAL else (4.0, 24.0)
for g in sorted(cut.get('graphics') or [], key=lambda g: float(g.get('start', 0))):
    try:
        gs, ge = float(g['start']), float(g['end'])
    except Exception:
        continue
    w = next((w for w in words if w['s'] >= gs - 0.4), None)
    gs = round(max(start + 0.5, w['s'] if w else gs), 2)
    if graphics and gs < graphics[-1]['end']:
        gs = graphics[-1]['end']
    ge = round(min(end - 0.6, gs + hi_len, max(ge, gs + lo_len)), 2)
    key = re.sub(r'[^A-Za-z0-9]', '', str(g.get('key') or 'clip'))
    key = key if key.startswith('clip') else 'clip' + key[:1].upper() + key[1:]
    while key in keys:
        key += 'B'
    if ge - gs >= lo_len * 0.75:
        keys.add(key)
        graphics.append({**g, 'key': key, 'start': gs, 'end': ge})

ep = json.load(open('episode.json'))
for k in ('title', 'subtitle', 'speaker', 'org', 'takeaway'):
    if cut.get(k):
        ep[k] = cut[k]
ep['source'] = {'start': start, 'end': end}
ep['lowerThird'] = {**ep.get('lowerThird', {}), 'atSource': round(start + (0.8 if VERTICAL else 1.5), 2), 'seconds': 4.6 if ep.get('speaker') else 0}
if VERTICAL:
    ep.update({'format': 'vertical', 'introSeconds': 0, 'outroSeconds': 0, 'captions': True})
json.dump(ep, open('episode.json', 'w'), indent=2)
Path('html/episode.js').write_text(f'window.XKDR_EPISODE={json.dumps(ep)};\n')
(W / 'out').mkdir(exist_ok=True)
(W / 'out' / 'youtube.md').write_text(str(cut.get('youtube') or ep.get('title', '')) + '\n')
done_steps.append(f'episode.json: {start:.1f}-{end:.1f} s, {len(graphics)} graphics planned')
step(f'Cut decided: {end - start:.0f} s with {len(graphics)} graphic{"s" if len(graphics) != 1 else ""}')
left[:] = ['footage', 'music', 'graphics', 'render']


# ---------------------------------------------------------------- 3a. footage and music
def footage():
    raw = sorted((p for p in (W / 'raw').iterdir()), key=lambda p: -p.stat().st_size)
    cam = next((p for p in raw if re.search(r'\.(mp4|mov|mkv|webm|m4v|avi|mts)$', p.name, re.I)), None)
    if not cam:
        raise RuntimeError('no camera file in raw/')
    ok, out = run(['python3', 'scripts/prepare-footage.py', str(cam), '--fast'])
    if not ok:
        raise RuntimeError(out[-500:])
    say('Footage trimmed')


def music():
    total = float(ep.get('introSeconds', 0)) + (end - start) + float(ep.get('outroSeconds', 0))
    prompt = (cut.get('music') or 'calm, modern corporate pulse, light piano and soft synth, 100 bpm') + '. Instrumental, no vocals.'
    ok, out = run(['node', 'scripts/gen-music.mjs', 'bed', 'default', prompt], timeout=300)
    if ok:
        ok, out = run(['python3', 'scripts/music-mix.py', 'bed', '-21'])
    if not ok:  # a quiet bed rather than no video
        say(f'Music failed, using silence: {out[-200:]}')
        run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', f'{total:.2f}', 'public/audio/music_mix.wav'])
    say('Music ready')


# ---------------------------------------------------------------- 3b. graphics, one call each
GUIDE = (W / 'GRAPHICS.md').read_text() if (W / 'GRAPHICS.md').exists() else ''
GUIDE = GUIDE[:GUIDE.find('## Work fast')] if '## Work fast' in GUIDE else GUIDE
EXAMPLES = '\n\n'.join(p.read_text() for p in sorted((W / 'html' / 'clips').glob('_example-*.js')))
STAGE = (1080, 960) if VERTICAL else (1920, 1080)
AREA = ('the whole 1080×960 stage (x 60–1020, y 60–900): it is the top half of a phone screen, the speaker is below it. '
        'Few, big elements: 64 px text or larger. Captions are drawn separately — never put the spoken words on screen.') if VERTICAL else (
        'the right-hand column x 990–1860, y 90–990 (the speaker is on the left, never cover them). Use the column\'s full height.')


def said(g):
    ws = [w for w in words if g['start'] - 0.2 <= w['s'] <= g['end']]
    return ' '.join(f"{w['w']}@{w['s']:.1f}" for w in ws)


def code_of(text):
    m = re.search(r'```(?:js|javascript)?\s*\n(.*?)```', text, re.S)
    return (m.group(1) if m else text).strip() + '\n'


def stills(g):
    d = g['end'] - g['start']
    ts = sorted({round(min(1.6, d * 0.25), 1), round(d * 0.55, 1), round(max(0.5, d - 0.8), 1)})
    out = W / 'review' / g['key']
    shutil.rmtree(out, ignore_errors=True)
    ok, log = run(['node', 'scripts/render-html.mjs', g['key'], '--stills', ','.join(map(str, ts)), '--outdir', str(out)], timeout=180)
    errors = [l for l in log.splitlines() if 'PAGE ERROR' in l or 'Error' in l][:5]
    shots = sorted(out.glob('*.png'), key=lambda p: float(p.stem.rsplit('_', 1)[1]))
    return (ok and not errors and len(shots) == len(ts)), '\n'.join(errors) or log[-600:], shots


# Rendering starts as soon as something is ready — the intro and outro right
# after the cut, each graphic the moment it passes its check — two at a time
# (each render already uses several browsers).
RENDERS = threading.Semaphore(2)


def render_clip(key):
    with RENDERS:
        ok, out = run(['node', 'scripts/render-html.mjs', key, f'public/clips/{key}.mp4'], timeout=1800)
    if not ok or not (W / 'public' / 'clips' / f'{key}.mp4').exists():
        raise RuntimeError(f'{key} did not render: {out[-300:]}')
    say(f'Rendered {key}')


def graphic(g):
    brief = f"""Write one animated graphic for a video, as the file html/clips/{g['key']}.js.

HOW GRAPHICS WORK (the playbook):
{GUIDE}

TWO EXAMPLE FILES:
{EXAMPLES}

THIS GRAPHIC:
- Key {g['key']}; call XKDR_CLIP('{g['key']}', 'half', {g['start']}, {g['end']}, ({{ tl, at, stage, S }}) => {{ ... }}) — times are source seconds, use at(seconds) to place tweens.
- Your area: {AREA}
- The idea it must land: {g.get('idea', '')}
- What is on screen and how it moves: {g.get('visual', '')}
- Facts to show (nothing else as fact): {json.dumps(g.get('facts') or [])}{' — these are illustrative: add illustrative(...)' if g.get('illustrative') else ''}
- The words spoken meanwhile (word@second): {said(g)}
- Brand palette: {', '.join(plan.get('palette') or []) or 'the kit colours C'}; fonts: use F.sans / F.serif from the kit.
- Something visible within the first second; every element enters as its word is said; a calm ambient motion once built.

Return only the complete file in one ```js block."""
    path = W / 'html' / 'clips' / f"{g['key']}.js"
    path.write_text(code_of(gemini(AGENT_MODEL, [{'text': brief}], temperature=0.6)))
    ok, err, shots = stills(g)
    problem = None
    if not ok:
        problem = f'Rendering it failed:\n{err}'
    else:
        verdict = gemini(LOOK_MODEL, [*[p for s in shots for p in (image_part(s), {'text': s.name})], {'text':
            f'Frames (in time order) of one animated graphic on a {STAGE[0]}x{STAGE[1]} stage. {("The speaker is below it." if VERTICAL else "The left part of the frame is covered by the speaker; only x 990-1860 is the graphic.")} '
            'First line exactly OK or FIX. FIX only for what a viewer would notice: overlapping or cut-off text, elements off the stage, '
            'a blank or nearly empty final frame, unreadable text. After FIX, list at most four concrete problems.'}], temperature=0)
        if verdict.strip().upper().startswith('FIX'):
            problem = 'A reviewer looked at the rendered frames and found:\n' + verdict.strip()[3:].strip()
    if problem:
        first = path.read_text()
        path.write_text(code_of(gemini(AGENT_MODEL, [*[p for s in shots for p in (image_part(s), {'text': s.name})], {'text':
            f"{brief}\n\nYOUR FIRST VERSION:\n```js\n{first}```\n\n{problem}\n\nFix these problems. Return only the complete corrected file in one ```js block."}], temperature=0.4)))
        ok2, err2, _ = stills(g)
        if not ok2:
            if ok:  # the fix broke a file that rendered: keep the first version
                path.write_text(first)
            else:
                path.unlink(missing_ok=True)
                raise RuntimeError(f"{g['key']} doesn't render: {err2[:300]}")
    render_clip(g['key'])
    return g['key']


with cf.ThreadPoolExecutor(max_workers=10) as ex:
    step(f'Making {len(graphics)} graphic{"s" if len(graphics) != 1 else ""}, the music and the footage, all at once')
    (W / 'public' / 'clips').mkdir(parents=True, exist_ok=True)
    ff, fm = ex.submit(footage), ex.submit(music)
    fs_ = [ex.submit(render_clip, sc) for sc in (ep.get('intro') if ep.get('introSeconds') else None, ep.get('outro') if ep.get('outroSeconds') else None) if sc]
    fg = {ex.submit(graphic, g): g for g in graphics}
    made = []
    for f in cf.as_completed(fg):
        try:
            made.append(f.result())
            step(f'Graphic ready: {fg[f].get("idea", fg[f]["key"])[:60]}')
        except Exception as e:
            say(f"Dropped {fg[f]['key']}: {e}")
            (W / 'html' / 'clips' / f"{fg[f]['key']}.js").unlink(missing_ok=True)
    try:
        ff.result()
        done_steps.append('public/footage/speaker.mp4 and public/audio/voice.wav')
    except Exception as e:
        fail(f'trimming the footage: {e}')
    fm.result()
    done_steps.append('public/audio/music_mix.wav')
    for f in fs_:
        try:
            f.result()
        except Exception as e:
            fail(f'the intro/outro: {e}')
done_steps.append(f'graphics: {", ".join(made) or "none"}')
left[:] = ['render the graphics (./scripts/render-all.sh)', 'the final render']

# ---------------------------------------------------------------- 4. render
ok, out = run(['node', 'scripts/export-clips.mjs'])   # clips.json and captions.json
done_steps.append('graphics rendered to public/clips/')
left[:] = ['the final render (./scripts/render-final.sh out/episode.mp4)']
step('Rendering the video')
ok, out = run(['./scripts/render-final.sh', 'out/episode.mp4'], timeout=5400)
if not ok or not (W / 'out' / 'episode.mp4').exists():
    fail(f'the final render: {out[-600:]}')
step(f'Done in {time.time() - T0:.0f} s')
