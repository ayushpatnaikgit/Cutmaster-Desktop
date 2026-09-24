#!/usr/bin/env python3
"""Render the finished episode with ffmpeg: the layout of src/BigIdeas.tsx
(intro, footage, graphics beside the speaker, name card, captions, outro,
voice and music), several times faster than rendering every frame in a
browser. The speaker moves between full screen and the graphics layout with
a short dissolve.

Usage: python3 scripts/compose.py [out/episode.mp4]
Exit code 3: src/BigIdeas.tsx has been customised, so the layout here would
not match — render with Remotion instead (scripts/render-final.sh does).
"""
import hashlib, json, math, os, shutil, subprocess, sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
OUT = sys.argv[1] if len(sys.argv) > 1 else 'out/episode.mp4'

# The layout below mirrors this exact version of BigIdeas.tsx. If the file was
# edited (by an agent, for one episode), let Remotion render it instead.
TSX_SHA = 'e37723099cf8e734ad29d74af7fb4bfde555dfdd7895dbca795359972a244f20'
if TSX_SHA != '__TSX_SHA__' and hashlib.sha256(Path('src/BigIdeas.tsx').read_bytes()).hexdigest() != TSX_SHA:
    print('src/BigIdeas.tsx was customised: render with Remotion', file=sys.stderr)
    sys.exit(3)

FPS = 25
ep = json.load(open('episode.json'))
clips = sorted(json.load(open('src/clips.json')), key=lambda c: c['start'])
try:
    words = json.load(open('src/captions.json'))
except Exception:
    words = []
VERT = ep.get('format') == 'vertical'
W, H = (1080, 1920) if VERT else (1920, 1080)
CAPTIONS = ep.get('captions', VERT)
BG, BG_HEX = (242, 241, 240), '0xf2f1f0'
CORAL = (245, 125, 106)
INTRO, OUTRO = float(ep.get('introSeconds', 0) or 0), float(ep.get('outroSeconds', 0) or 0)
S0, S1 = float(ep['source']['start']), float(ep['source']['end'])
F = round((S1 - S0) * FPS)            # footage frames
src = lambda s: round((s - S0) * FPS)  # footage frame of a source time
RECTS = ({'full': (0, 0, 1080, 1920), 'half': (0, 960, 1080, 960), 'pip': (700, 1380, 320, 420)} if VERT else
         {'full': (0, 0, 1920, 1080), 'half': (60, 60, 840, 960), 'pip': (1500, 600, 360, 420)})
POS = (0.5, 0.3) if VERT else (0.48, 0.4)   # objectPosition of the speaker
FONTS = ROOT / 'node_modules' / '@fontsource' / 'montserrat' / 'files'
font = lambda weight, size: ImageFont.truetype(str(FONTS / f'montserrat-latin-{weight}-normal.woff'), size)
TMP = ROOT / 'logs' / 'compose'
shutil.rmtree(TMP, ignore_errors=True)
TMP.mkdir(parents=True)


def probe_size(p):
    out = subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', p], text=True)
    return tuple(int(x) for x in out.strip().split(',')[:2])


SW, SH = probe_size('public/footage/speaker.mp4')


def cover(rw, rh):
    """object-fit: cover into rw×rh at the speaker's object position."""
    k = max(rw / SW, rh / SH)
    w, h = max(rw, 2 * math.ceil(SW * k / 2)), max(rh, 2 * math.ceil(SH * k / 2))
    return f'scale={w}:{h}:flags=bicubic,crop={rw}:{rh}:{int((w - rw) * POS[0])}:{int((h - rh) * POS[1])}'


# ------------------------------------------------------------ name card
def ease_out(p):
    return 1 - (1 - p) ** 3


def interp(f, a, b, v0, v1, ease=None):
    p = min(1.0, max(0.0, (f - a) / (b - a)))
    return v0 + (v1 - v0) * (ease(p) if ease else p)


def lower_third():
    """PNG frames of the name card: wipes on, name and organisation rise in, fades out."""
    lt = ep.get('lowerThird') or {}
    if not ep.get('speaker') or not lt.get('seconds'):
        return None
    n = round(float(lt['seconds']) * FPS)
    fn, fo = font(800, 44), font(600, 19)
    name, org = ep['speaker'], str(ep.get('org') or '').upper()
    track = 0.26 * 19
    org_w = sum(fo.getlength(ch) + track for ch in org) - (track if org else 0)
    tw = max(fn.getlength(name), org_w)
    bw, bh = int(30 + 16 + 20 + tw + 34), 22 + 54 + 6 + 24 + 22
    d = TMP / 'lt'
    d.mkdir()
    for f in range(n):
        im = Image.new('RGBA', (bw, bh), (0, 0, 0, 0))
        box = Image.new('RGBA', (bw, bh), BG + (255,))
        dr = ImageDraw.Draw(box)
        dr.rectangle([30, 22 + 14, 30 + 15, 22 + 14 + 15], fill=CORAL)
        x = 30 + 16 + 20
        for dy, txt in ((0, 'name'), (4, 'org')):
            rise, alpha = interp(f, 4 + dy, 20 + dy, 14, 0, ease_out), interp(f, 4 + dy, 20 + dy, 0, 1)
            layer = Image.new('RGBA', (bw, bh), (0, 0, 0, 0))
            ld = ImageDraw.Draw(layer)
            if txt == 'name':
                ld.text((x, 22 + rise), name, font=fn, fill=(0, 0, 0, 255))
            else:
                cx = x
                for ch in org:
                    ld.text((cx, 22 + 54 + 6 + rise), ch, font=fo, fill=(122, 122, 122, 255))
                    cx += fo.getlength(ch) + track
            if alpha < 1:
                layer.putalpha(layer.getchannel('A').point(lambda v, a=alpha: int(v * a)))
            box.alpha_composite(layer)
        wipe = int(bw * interp(f, 0, 14, 0, 1, ease_out))
        if wipe > 0:
            im.paste(box.crop((0, 0, wipe, bh)), (0, 0))
        out = interp(f, 100, 114, 1, 0)
        if out < 1:
            im.putalpha(im.getchannel('A').point(lambda v, a=out: int(v * a)))
        im.save(d / f'{f:04d}.png', compress_level=1)
    return {'dir': d, 'at': src(float(lt.get('atSource', S0 + 2))), 'x': 50 if VERT else 80, 'y': 120 if VERT else 826}


# ------------------------------------------------------------ captions
SIZE = 76 if VERT else 52
BAND_Y = 1330 if VERT else 900
BAND_H = int(SIZE * 1.15 * 3 + 60)


def chunks():
    out, cur = [], []
    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        if len(cur) >= 3 or str(w['w']).strip()[-1:] in '.,!?;:' or not nxt or nxt['s'] - w['e'] > 0.45:
            out.append(cur)
            cur = []
    return out


def draw_caption(args):
    """One caption state: a chunk of words, the spoken ones highlighted (same look as the TSX)."""
    chunk, on, path = args
    fnt = font(800, SIZE)
    toks = [(str(w['w']).strip().upper() if VERT else str(w['w']).strip()) for w in chunk]
    pad_x, pad_y, gap, lh = 10, 2, 18, int(SIZE * 1.15)
    widths = [fnt.getlength(t) + 2 * pad_x for t in toks]
    lines, cur, cw = [], [], 0
    for i, wdt in enumerate(widths):   # flex-wrap within W - 120
        if cur and cw + gap + wdt > W - 120:
            lines.append((cur, cw))
            cur, cw = [], 0
        cw = cw + (gap if cur else 0) + wdt
        cur.append(i)
    if cur:
        lines.append((cur, cw))
    im = Image.new('RGBA', (W, BAND_H), (0, 0, 0, 0))
    glyphs = Image.new('L', (W, BAND_H), 0)
    boxes = ImageDraw.Draw(im)
    gd = ImageDraw.Draw(glyphs)
    stroke = 2 if VERT else 1
    placed = []
    for li, (idx, lw) in enumerate(lines):
        x, y = (W - lw) / 2, li * (lh + 2 * pad_y)
        for i in idx:
            if on[i]:
                boxes.rounded_rectangle([x, y, x + widths[i], y + lh + 2 * pad_y], radius=12, fill=CORAL + (255,))
            placed.append((i, x + pad_x, y + pad_y + (lh - SIZE) / 2 - SIZE * 0.08))
            gd.text((x + pad_x, y + pad_y + (lh - SIZE) / 2 - SIZE * 0.08), toks[i], font=fnt, fill=255)
            x += widths[i] + gap
    shadow = Image.new('RGBA', (W, BAND_H), (0, 0, 0, 0))
    shadow.putalpha(glyphs.filter(ImageFilter.GaussianBlur(9)).point(lambda v: int(v * 0.45)).transform((W, BAND_H), Image.AFFINE, (1, 0, 0, 0, 1, -6)))
    out = Image.alpha_composite(shadow, im)
    td = ImageDraw.Draw(out)
    for i, x, y in placed:
        td.text((x, y), toks[i], font=fnt, fill=(255, 255, 255, 255), stroke_width=0 if on[i] else stroke, stroke_fill=(0, 0, 0, 255))
    out.save(path, compress_level=1)


def captions():
    """A caption track: one image per state, each held for as long as it shows."""
    if not CAPTIONS or not words:
        return None
    cs = chunks()
    states, runs = {}, []
    for f in range(F):
        t = S0 + f / FPS
        ci = next((i for i, c in enumerate(cs) if c[0]['s'] - 0.05 <= t <= c[-1]['e'] + 0.15), None)
        key = None if ci is None else (ci, tuple(w['s'] <= t <= w['e'] + 0.08 for w in cs[ci]))
        if runs and runs[-1][0] == key:
            runs[-1][1] += 1
        else:
            runs.append([key, 1])
        if key is not None and key not in states:
            states[key] = TMP / f'cap{len(states):05d}.png'
    blank = TMP / 'cap_blank.png'
    Image.new('RGBA', (W, BAND_H), (0, 0, 0, 0)).save(blank)
    with ProcessPoolExecutor() as ex:
        list(ex.map(draw_caption, [(cs[k[0]], k[1], p) for k, p in states.items()], chunksize=8))
    lst = TMP / 'captions.txt'
    with open(lst, 'w') as fh:
        for key, n in runs:
            fh.write(f"file '{states[key] if key else blank}'\nduration {n / FPS:.4f}\n")
        fh.write(f"file '{blank}'\n")
    return lst


# ------------------------------------------------------------ the filter graph
def main():
    inputs, graph = [], []

    def inp(*a):
        inputs.extend(a)
        return sum(1 for x in inputs if x == '-i') - 1

    norm = f'fps={FPS},setsar=1,format=yuv420p'
    spk = inp('-i', 'public/footage/speaker.mp4')
    graph.append(f'[{spk}:v]{norm},{cover(*RECTS["full"][2:])},trim=end_frame={F},setpts=PTS-STARTPTS[base]')

    # graphics: runs of back-to-back clips, each with the speaker beside it
    groups = []
    for c in clips:
        if groups and abs(c['start'] - groups[-1][-1]['end']) <= 0.05:
            groups[-1].append(c)
        else:
            groups.append([c])
    last = 'base'
    D = 0.64   # the dissolve between layouts (the TSX's 16 frames)
    for gi, g in enumerate(groups):
        parts = []
        for ci, c in enumerate(g):
            a, b = src(c['start']), src(c['end'])
            n = b - a
            if n <= 0:
                continue
            ck = inp('-i', f"public/clips/{c['key']}.mp4")
            sk = inp('-ss', f'{a / FPS:.3f}', '-t', f'{n / FPS + 1:.3f}', '-i', 'public/footage/speaker.mp4')
            x, y, rw, rh = RECTS.get(c.get('mode', 'half'), RECTS['half'])
            lab = f'g{gi}c{ci}'
            gfx = f'[{ck}:v]{norm},tpad=stop_mode=clone:stop_duration=5,trim=end_frame={n},setpts=PTS-STARTPTS'
            if VERT:   # the graphic fills the top half of the phone screen
                gfx += f',scale=1080:960,pad={W}:{H}:0:0:color={BG_HEX}'
            else:
                gfx += f',scale={W}:{H}'
            graph.append(gfx + f'[{lab}g]')
            graph.append(f'[{sk}:v]{norm},{cover(rw, rh)},trim=end_frame={n},setpts=PTS-STARTPTS[{lab}s]')
            graph.append(f'[{lab}g][{lab}s]overlay={x}:{y}:shortest=1,drawbox=x={max(0, x - 9)}:y={max(0, y - 9)}:w={18 + min(0, x - 9)}:h={18 + min(0, y - 9)}:color=0xf57d6a:t=fill[{lab}]')
            parts.append(lab)
        if not parts:
            continue
        a, b = src(g[0]['start']), src(g[-1]['end'])
        n = b - a
        cat = ''.join(f'[{p}]' for p in parts) + (f'concat=n={len(parts)}:v=1:a=0' if len(parts) > 1 else 'null')
        d = min(D, n / FPS / 3)
        graph.append(f'{cat},format=yuva420p,fade=t=in:st=0:d={d:.2f}:alpha=1,fade=t=out:st={n / FPS - d:.3f}:d={d:.2f}:alpha=1,'
                     f'setpts=PTS-STARTPTS+{a / FPS:.4f}/TB[grp{gi}]')
        graph.append(f"[{last}][grp{gi}]overlay=0:0:eof_action=pass:enable='between(t,{a / FPS - 0.02:.3f},{b / FPS:.3f})'[after{gi}]")
        last = f'after{gi}'

    lt = lower_third()
    if lt:
        li = inp('-framerate', str(FPS), '-i', str(lt['dir'] / '%04d.png'))
        graph.append(f'[{li}:v]format=yuva420p,setpts=PTS-STARTPTS+{lt["at"] / FPS:.4f}/TB[lt]')
        graph.append(f'[{last}][lt]overlay={lt["x"]}:{lt["y"]}:eof_action=pass[withlt]')
        last = 'withlt'
    cap = captions()
    if cap:
        cp = inp('-f', 'concat', '-safe', '0', '-i', str(cap))
        graph.append(f'[{cp}:v]fps={FPS},format=yuva420p,setpts=PTS-STARTPTS[caps]')
        graph.append(f'[{last}][caps]overlay=0:{BAND_Y}:eof_action=pass[withcaps]')
        last = 'withcaps'
    # the footage fades up from the page colour and back down (the TSX's veil)
    graph.append(f'[{last}]fade=t=in:s=0:n=15:color={BG_HEX},fade=t=out:s={max(0, F - 15)}:n=15:color={BG_HEX},trim=end_frame={F},format=yuv420p[foot]')

    seq = []
    if INTRO > 0:
        ii = inp('-i', f"public/clips/{ep['intro']}.mp4")
        graph.append(f'[{ii}:v]{norm},scale={W}:{H},tpad=stop_mode=clone:stop_duration=3,trim=end_frame={round(INTRO * FPS)},setpts=PTS-STARTPTS[intro]')
        seq.append('intro')
    seq.append('foot')
    if OUTRO > 0:
        oi = inp('-i', f"public/clips/{ep['outro']}.mp4")
        graph.append(f'[{oi}:v]{norm},scale={W}:{H},tpad=stop_mode=clone:stop_duration=3,trim=end_frame={round(OUTRO * FPS)},setpts=PTS-STARTPTS[outro]')
        seq.append('outro')
    graph.append(''.join(f'[{s}]' for s in seq) + (f'concat=n={len(seq)}:v=1:a=0' if len(seq) > 1 else 'null') + '[v]')

    total = INTRO + F / FPS + OUTRO
    vi = inp('-i', 'public/audio/voice.wav')
    audio = [f'[{vi}:a]adelay={int(INTRO * 1000)}:all=1[voice]']
    mix = ['[voice]']
    if Path('public/audio/music_mix.wav').exists():
        mi = inp('-i', 'public/audio/music_mix.wav')
        mix.append(f'[{mi}:a]')
    audio.append(''.join(mix) + (f'amix=inputs={len(mix)}:normalize=0:duration=longest' if len(mix) > 1 else 'anull') + f',atrim=0:{total:.3f}[a]')
    script = TMP / 'graph.txt'
    script.write_text(';\n'.join(graph + audio))
    Path(OUT).parent.mkdir(parents=True, exist_ok=True)
    cmd = ['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex_script', str(script), '-map', '[v]', '-map', '[a]',
           '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', str(FPS),
           '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-t', f'{total:.3f}', OUT]
    subprocess.run(cmd, check=True)
    print(f'wrote {OUT} ({total:.1f}s, {len(clips)} graphics)')


if __name__ == '__main__':
    main()
