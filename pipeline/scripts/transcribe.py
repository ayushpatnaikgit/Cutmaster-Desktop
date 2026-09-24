"""Transcribe the synced audio with word-level timings.

Usage: python3 scripts/transcribe.py [audio] [--whisper-model small] [--no-gemini]

Two passes run at the same time:
  - Gemini writes down what was said: fast (seconds), verbatim, good with
    names, jargon, accents and mixed Hindi-English.
  - Whisper (small, batched, on this machine) finds when each word was said.
The words come from Gemini and the timings from Whisper, matched word by word;
a word only Gemini heard is placed between its neighbours. Without Gemini (no
key, no network) Whisper does both, as before.

Writes transcript.json — [{start, end, text, words: [{w, s, e}]}] in seconds —
and prints a short summary. Read it with scripts/read-transcript.py.
"""
import base64, concurrent.futures as cf, difflib, json, os, re, subprocess, sys, tempfile, time, urllib.request

args = [a for a in sys.argv[1:] if not a.startswith('--')]
opt = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
audio = args[0] if args else 'public/audio/clean.wav'
WHISPER = opt('--whisper-model', 'small')
use_gemini = '--no-gemini' not in sys.argv and os.environ.get('GEMINI_API_KEY')
t0 = time.time()

PROMPT = ('Transcribe this audio verbatim, exactly as spoken: keep every word, including repeats, false starts '
          'and fillers like "um" and "you know". Do not summarise, correct or tidy anything. Use normal '
          'punctuation. If it is in Hindi or mixed Hindi-English, write the Hindi in Latin letters. '
          'Plain text only: no timestamps, no speaker labels, no notes.')
CHUNK = 12 * 60  # seconds of audio per Gemini request


def duration(path):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).strip())


def gemini_chunk(start, length):
    with tempfile.NamedTemporaryFile(suffix='.mp3') as f:
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-t', str(length), '-i', audio, '-ac', '1', '-ar', '16000', '-b:a', '32k', f.name], check=True)
        data = base64.b64encode(open(f.name, 'rb').read()).decode()
    model = os.environ.get('QUICK_MODEL') or 'gemini-3.5-flash-lite'
    base = os.environ.get('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta')
    body = {'contents': [{'role': 'user', 'parts': [{'inlineData': {'mimeType': 'audio/mp3', 'data': data}}, {'text': PROMPT}]}],
            'generationConfig': {'temperature': 0}}
    req = urllib.request.Request(f'{base}/models/{model}:generateContent', data=json.dumps(body).encode(),
                                 headers={'content-type': 'application/json', 'x-goog-api-key': os.environ['GEMINI_API_KEY']})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                out = json.load(r)
            return ''.join(p.get('text', '') for p in out['candidates'][0]['content']['parts']).strip()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(3 * (attempt + 1))


def gemini_text():
    total = duration(audio)
    starts = [s for s in range(0, int(total) + 1, CHUNK) if s < total]
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        parts = list(ex.map(lambda s: gemini_chunk(s, min(CHUNK, total - s) + 1), starts))
    return ' '.join(parts)


def whisper_words(language=None):
    from faster_whisper import WhisperModel, BatchedInferencePipeline
    # Half the cores, with threads that sleep while they wait: two edits
    # transcribing at once with every core each (and OpenMP's spin-waiting)
    # ran 15x slower than this (218 s vs 14 s for a minute of audio).
    os.environ.setdefault('OMP_WAIT_POLICY', 'PASSIVE')
    m = WhisperModel(WHISPER, device='cpu', compute_type='int8', cpu_threads=max(2, (os.cpu_count() or 4) // 2))
    segs, info = BatchedInferencePipeline(model=m).transcribe(audio, word_timestamps=True, batch_size=8, language=language)
    segs = list(segs)
    return segs, info.language


norm = lambda w: re.sub(r"[^\w']", '', w.lower())

with cf.ThreadPoolExecutor(max_workers=2) as ex:
    g_future = ex.submit(gemini_text) if use_gemini else None
    w_future = ex.submit(whisper_words, None)
    text = None
    if g_future:
        try:
            text = g_future.result()
        except Exception as e:
            print(f'(Gemini transcription failed — using Whisper alone: {e})')
    segs, lang = w_future.result()

wwords = [{'w': w.word.strip(), 's': w.start, 'e': w.end} for s in segs for w in s.words]

if text:
    # Gemini's words, Whisper's timings.
    gw = [w for w in re.findall(r"\S+", text) if norm(w)]
    a, b = [norm(w) for w in gw], [norm(w['w']) for w in wwords]
    timed = [None] * len(gw)
    for blk in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_matching_blocks():
        for i in range(blk.size):
            timed[blk.a + i] = (wwords[blk.b + i]['s'], wwords[blk.b + i]['e'])
    matched = sum(1 for t in timed if t)
    # words only Gemini heard: spread them between their timed neighbours
    i = 0
    while i < len(gw):
        if timed[i]:
            i += 1
            continue
        j = i
        while j < len(gw) and not timed[j]:
            j += 1
        lo = timed[i - 1][1] if i > 0 else (wwords[0]['s'] if wwords else 0.0)
        hi = timed[j][0] if j < len(gw) else (wwords[-1]['e'] if wwords else lo + 0.3 * (j - i))
        step = max(hi - lo, 0.05) / (j - i)
        for k in range(i, j):
            timed[k] = (lo + step * (k - i), lo + step * (k - i + 1))
        i = j
    words = [{'w': w, 's': round(t[0], 3), 'e': round(t[1], 3)} for w, t in zip(gw, timed)]
    engine = f'gemini text + whisper {WHISPER} timings ({matched}/{len(gw)} words matched)'
else:
    words = [{'w': w['w'], 's': round(w['s'], 3), 'e': round(w['e'], 3)} for w in wwords]
    engine = f'whisper {WHISPER}'

# Sentences: break at . ? ! (or every ~30 words), with a pause over 1.2 s also ending one.
out, cur = [], []
for n, w in enumerate(words):
    cur.append(w)
    nxt = words[n + 1] if n + 1 < len(words) else None
    if not nxt or re.search(r'[.?!]["\')]*$', w['w']) or len(cur) >= 30 or (nxt['s'] - w['e'] > 1.2):
        out.append({'start': cur[0]['s'], 'end': cur[-1]['e'], 'text': ' '.join(x['w'] for x in cur), 'words': cur})
        cur = []

json.dump(out, open('transcript.json', 'w'), indent=1)
print(f'wrote transcript.json: {len(out)} sentences, {len(words)} words, {out[-1]["end"] if out else 0:.1f}s of speech, language {lang}')
print(f'engine: {engine}; took {time.time() - t0:.0f}s')
print('Read it with: python3 scripts/read-transcript.py  (or --from <s> --to <s>)')
