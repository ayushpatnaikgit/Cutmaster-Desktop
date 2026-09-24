"""Build the full-length music bed for the edit.

Usage: python3 scripts/music-mix.py <track-name> [under_db]
Keeps the track's opening for the intro and its natural ending for the outro,
crossfades a repeat in the middle to reach the full runtime (or loops a short
track), and ducks the bed under the voice. Lengths come from episode.json.
"""
import json, os, subprocess, sys

FPS = 25
ep = json.load(open('episode.json'))
INTRO, OUTRO = float(ep.get('introSeconds', 0)), float(ep.get('outroSeconds', 0))
FOOTAGE = round((ep['source']['end'] - ep['source']['start']) * FPS) / FPS
TOTAL = INTRO + FOOTAGE + OUTRO
XF = 4.0

name = sys.argv[1]
under_db = float(sys.argv[2]) if len(sys.argv) > 2 else -19
src = next((f'public/audio/{name}.{x}' for x in ('mp3', 'wav') if os.path.exists(f'public/audio/{name}.{x}')), f'public/audio/{name}.mp3')

def probe(args):
    return subprocess.run(['ffmpeg', '-hide_banner', '-i', src, *args, '-f', 'null', '-'], capture_output=True, text=True).stderr

dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]))
sil = probe(['-af', 'silencedetect=n=-40dB:d=0.2'])
lead = next((float(l.split('silence_end: ')[1].split()[0]) for l in sil.splitlines() if 'silence_end' in l), 0.0)
lead = lead if lead < 3 else 0.0
tails = [float(l.split('silence_start: ')[1]) for l in probe(['-af', 'silencedetect=n=-45dB:d=0.3']).splitlines() if 'silence_start' in l]
end = tails[-1] if tails and tails[-1] > dur - 5 else dur
usable = end - lead

g = 10 ** (under_db / 20)
down0, down1 = INTRO - 0.5, INTRO + 0.7           # duck as the footage fades up
up0, up1 = INTRO + FOOTAGE - 0.6, INTRO + FOOTAGE + 0.2
if INTRO <= 0:                                     # no intro: under the voice from the start
    down0, down1 = -2.0, -1.0
if OUTRO <= 0:                                     # no outro: stay under to the end
    up0, up1 = TOTAL + 1, TOTAL + 2
vol = (f"volume='if(lt(t,{down0}),1,if(lt(t,{down1}),1-(t-{down0})/{down1 - down0}*(1-{g}),"
       f"if(lt(t,{up0}),{g},if(lt(t,{up1}),{g}+(t-{up0})/{up1 - up0}*(1-{g}),1))))':eval=frame")

inputs = ['-i', src]
if usable >= TOTAL:
    graph = f"[0:a]atrim={lead}:{lead + TOTAL},asetpts=N/SR/TB[m]"
elif 2 * usable - XF < TOTAL + 12:                 # too short to stretch: loop it
    inputs = ['-stream_loop', '-1', '-i', src]
    graph = f"[0:a]atrim={lead}:{lead + TOTAL},asetpts=N/SR/TB[m]"
else:
    a = (TOTAL + XF) / 2 + 6            # head a little longer than the tail
    b = TOTAL + XF - a
    graph = (f"[0:a]atrim={lead}:{lead + a},asetpts=N/SR/TB[h];"
             f"[0:a]atrim={end - b}:{end},asetpts=N/SR/TB[t];"
             f"[h][t]acrossfade=d={XF}:c1=tri:c2=tri[m]")
graph += (f";[m]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,{vol},"
          f"afade=t=out:st={TOTAL - 1.2}:d=1.2,atrim=0:{TOTAL}[out]")
subprocess.run(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex', graph, '-map', '[out]', '-ac', '2', '-c:a', 'pcm_s16le', 'public/audio/music_mix.wav'], check=True)
print(f'{name}: lead={lead:.2f} end={end:.2f} total={TOTAL:.2f}s under={under_db}dB -> public/audio/music_mix.wav')
