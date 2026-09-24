#!/usr/bin/env python3
"""Everything before the plan, in about a minute — run by the app when an edit
starts, before the agent. Steps run in parallel:

  - probe the files in raw/ (camera, separate mic, images)
  - audio: sync the mic to the camera, or take the camera's audio
      → public/audio/clean.wav, then start the exact word-timed transcript in
        the background (./scripts/check-long.sh transcribe → transcript.json)
  - a quick transcript with rough timestamps, by Gemini → transcript-draft.txt
  - a few frames of the video → review/frames/
  - the plan: one Gemini call (with Google Search, to look up the speaker)
      that reads the brief, the mode, the draft transcript, the frames and the
      logo → plan.md (shown to the person) and plan.json (for the agent)

Prints one line per step. Exit code 0 means plan.md is ready.
"""
import base64, concurrent.futures as cf, json, os, re, subprocess, sys, time, urllib.request
from pathlib import Path

T0 = time.time()
W = Path('.')
RAW = W / 'raw'
say = lambda s: print(f'[{time.time() - T0:5.1f}s] {s}', flush=True)
BASE = os.environ.get('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta')
KEY = os.environ.get('GEMINI_API_KEY', '')
AGENT_MODEL = os.environ.get('AGENT_MODEL') or 'gemini-3.8-flash'
QUICK_MODEL = os.environ.get('QUICK_MODEL') or 'gemini-3.5-flash-lite'


def gemini(model, parts, tools=None, temperature=0.4, timeout=240):
    body = {'contents': [{'role': 'user', 'parts': parts}], 'generationConfig': {'temperature': temperature}}
    if tools:
        body['tools'] = tools
    req = urllib.request.Request(f'{BASE}/models/{model}:generateContent', data=json.dumps(body).encode(),
                                 headers={'content-type': 'application/json', 'x-goog-api-key': KEY})
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                out = json.load(r)
            return ''.join(p.get('text', '') for p in out['candidates'][0]['content']['parts']).strip()
        except Exception as e:
            last = e
            time.sleep(2 * (attempt + 1))
    raise last


def probe(path):
    try:
        d = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate',
                                                '-of', 'json', str(path)]))
        kinds = {s['codec_type'] for s in d.get('streams', [])}
        v = next((s for s in d.get('streams', []) if s['codec_type'] == 'video'), {})
        return {'file': path.name, 'duration': float(d.get('format', {}).get('duration') or 0), 'video': 'video' in kinds,
                'audio': 'audio' in kinds, 'size': f"{v.get('width')}x{v.get('height')}" if v else None}
    except Exception:
        return {'file': path.name, 'duration': 0, 'video': False, 'audio': False}


# ---------------------------------------------------------------- files
files = sorted(p for p in RAW.iterdir() if p.is_file() or p.is_symlink())
IMAGE = re.compile(r'\.(png|jpe?g|webp|svg|gif)$', re.I)
media = [probe(p) for p in files if not IMAGE.search(p.name)]
images = [p for p in files if IMAGE.search(p.name)]
videos = sorted([m for m in media if m['video']], key=lambda m: -m['duration'])
audios = [m for m in media if not m['video'] and m['audio']]
cam = videos[0] if videos else (audios[0] if audios else None)
if not cam:
    say('No footage or audio found in raw/')
    sys.exit(2)
mic = next((a for a in audios if a is not cam), None)
say(f"Footage: {cam['file']} ({cam['duration']:.0f}s{', ' + cam['size'] if cam.get('size') else ''})" + (f"; separate audio: {mic['file']}" if mic else ''))
(W / 'public' / 'audio').mkdir(parents=True, exist_ok=True)
(W / 'logs').mkdir(exist_ok=True)


def audio_step():
    """clean.wav on the camera's timeline, then the exact transcript in the background."""
    if mic:
        r = subprocess.run(['python3', 'scripts/sync-audio.py', str(RAW / cam['file']), str(RAW / mic['file'])], capture_output=True, text=True)
        say('Synced the mic to the camera' if r.returncode == 0 else f'Mic sync failed, using the camera audio: {r.stderr[-200:]}')
        if r.returncode == 0:
            pass
        else:
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(RAW / cam['file']), '-vn', '-ac', '1', '-ar', '48000', 'public/audio/clean.wav'], check=True)
    else:
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(RAW / cam['file']), '-vn', '-ac', '1', '-ar', '48000',
                        '-af', 'highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11', 'public/audio/clean.wav'], check=True)
        say('Took the audio from the camera file')
    subprocess.Popen(['./scripts/run-long.sh', 'transcribe', 'python3', 'scripts/transcribe.py', 'public/audio/clean.wav'],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    say('Started the word-timed transcript in the background (check-long.sh transcribe)')


def draft_transcript():
    """Gemini, straight from the camera audio: seconds, not minutes."""
    mp3 = W / 'logs' / 'draft.mp3'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(RAW / (mic or cam)['file']), '-vn', '-ac', '1', '-ar', '16000', '-b:a', '24k', str(mp3)], check=True)
    text = gemini(QUICK_MODEL, [
        {'inlineData': {'mimeType': 'audio/mp3', 'data': base64.b64encode(mp3.read_bytes()).decode()}},
        {'text': 'Transcribe this audio. One line per sentence, each starting with its start time as [mm:ss]. '
                 'Verbatim, in the language spoken (Hindi in Latin letters). No other text.'}], temperature=0)
    (W / 'transcript-draft.txt').write_text(text + '\n')
    say(f'Quick transcript: {len(text.splitlines())} sentences')
    return text


def frames():
    if not cam['video']:
        return []
    out = W / 'review' / 'frames'
    out.mkdir(parents=True, exist_ok=True)
    n, got = 6, []
    for i in range(n):
        t = cam['duration'] * (i + 0.5) / n
        f = out / f'frame_{int(t):04d}.jpg'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t:.1f}', '-i', str(RAW / cam['file']), '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', str(f)])
        if f.exists():
            got.append(f)
    say(f'Took {len(got)} frames of the video')
    return got


def logo_parts():
    parts = []
    for p in images[:3]:
        src = p
        if p.suffix.lower() == '.svg':
            png = W / 'logs' / (p.stem + '.png')
            subprocess.run(['convert', '-background', 'white', '-density', '200', str(p), '-resize', '600x600', str(png)], capture_output=True)
            src = png if png.exists() else None
        if src:
            parts.append({'inlineData': {'mimeType': 'image/png' if src.suffix.lower() == '.png' else 'image/jpeg', 'data': base64.b64encode(src.read_bytes()).decode()}})
            parts.append({'text': f'(Image above: {p.name})'})
    return parts


with cf.ThreadPoolExecutor(max_workers=4) as ex:
    fa = ex.submit(audio_step)
    ft = ex.submit(draft_transcript)
    ff = ex.submit(frames)
    try:
        draft = ft.result()
    except Exception as e:
        say(f'Quick transcript failed: {e}')
        sys.exit(3)
    shots = ff.result()

# ---------------------------------------------------------------- who is speaking?
# Names come only from a source that contains the speaker's own words (or from
# the brief). A plausible-sounding expert found by searching the topic is a guess.
def identify(draft):
    lines = [re.sub(r'^\[[\d:]+\]\s*', '', l).strip() for l in draft.splitlines()]
    quotes = sorted([l for l in lines if 60 <= len(l) <= 200], key=len, reverse=True)[:3]
    if not quotes:
        return 'No distinctive sentences to search for.'
    q = ' '.join(f'"{x}"' for x in quotes[:2])
    return gemini(QUICK_MODEL, [{'text': f'''Search the web for pages that contain these exact sentences, spoken in a video interview: {q}

Answer in this format and nothing else:
SPEAKER: <full name as written on a page that contains these words, or UNKNOWN>
ROLE: <their role and organisation as stated on that page, or UNKNOWN>
SOURCE: <the URL of the page that contains the words>
EVIDENCE: <the sentence from that page that ties the words to the person>

Only name someone if a page that contains these exact words (or a transcript of this video) names them as the speaker. If you only find pages about the topic, answer UNKNOWN.'''}], tools=[{'google_search': {}}], temperature=0)

try:
    who = identify(draft)
except Exception as e:
    who = f'Search failed: {e}'
(W / 'logs' / 'speaker.txt').write_text(who + '\n')
say('Looked up the speaker: ' + (re.search(r'SPEAKER:\s*(.*)', who).group(1).strip() if re.search(r'SPEAKER:\s*(.*)', who) else 'unknown'))

# ---------------------------------------------------------------- the plan, in one call
brief = (W / 'TASK.md').read_text()
mode = (W / 'MODE.md').read_text() if (W / 'MODE.md').exists() else ''
agents = (W / 'AGENTS.md').read_text()
quality = agents[agents.find('## 3. The quality bar'):agents.find('## 3b.')] if '## 3. The quality bar' in agents else ''
parts = []
for f in shots:
    parts += [{'inlineData': {'mimeType': 'image/jpeg', 'data': base64.b64encode(f.read_bytes()).decode()}}, {'text': f'(Frame at {int(f.stem.split("_")[1])}s)'}]
parts += logo_parts()
parts.append({'text': f"""You are the lead editor of Elyps, an AI video editor, planning an edit. Write the plan the person will approve before anything is built.

THE REQUEST (in their words, with the files they gave):
{brief}

{('THE KIND OF VIDEO (follow this):' + chr(10) + mode) if mode else ''}

FILES: {json.dumps(media)}; images: {[p.name for p in images]}

THE QUALITY BAR FOR GRAPHICS:
{quality[:3500]}

TRANSCRIPT (rough timestamps):
{draft[:60000]}

WHO IS SPEAKING — the result of searching the web for their exact words:
{who}

Rules for naming the speaker: if the request names them, use that. Otherwise use the search result above only if it names someone AND gives a source containing their words; say so ("identified from <source>"). If it says UNKNOWN or has no such source, write "Speaker: not confirmed" and ask for their name and role in Questions. Never guess a speaker from the topic, and never invent a title or affiliation. You may use Google Search for facts in the talk worth showing (with sources).

Write the plan in Markdown with exactly these sections:
# Plan: <a short title for the video>
### What I found
- the footage (length, look), the speaker (name, role, organisation — with the source URL), the talk in two lines, the brand (palette as hex codes and fonts, from their logo or site)
### Beat sheet
A table: At (m:ss, from the transcript) | What is said (a short quote) | Graphic (what it shows and how it moves — specific: numbers, parts, the visual). One graphic per key idea; group neighbouring ones.
### Intro, outro and music
One line each.
### Questions
Only what you truly can't decide (at most three), or "None — reply 'Looks good' to start."

Then, after the Markdown, a JSON block fenced with ```json containing:
{{"title": str, "speaker": str, "org": str, "palette": [hex...], "fonts": [str...], "source": {{"start": seconds, "end": seconds}}, "beats": [{{"at": seconds, "says": str, "graphic": str}}], "research": [{{"fact": str, "url": str}}]}}
"source" = just before the first word and just after the last (camera seconds)."""})
plan = gemini(AGENT_MODEL, parts, tools=[{'google_search': {}}], temperature=0.5, timeout=300)
m = re.search(r'```json\s*(\{.*\})\s*```', plan, re.S)
md = plan[:m.start()].strip() if m else plan
(W / 'plan.md').write_text(md + '\n')
try:
    (W / 'plan.json').write_text(json.dumps(json.loads(m.group(1)), indent=1) if m else '{}')
except Exception:
    (W / 'plan.json').write_text('{}')
fa.result() if not fa.done() else None
say(f'Plan drafted ({len(md.splitlines())} lines)')
