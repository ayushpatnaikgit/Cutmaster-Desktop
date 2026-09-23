"""Cut the camera footage and the synced voice track to the episode's trim points.

Usage: python3 scripts/prepare-footage.py <camera.mov>
Reads source.start/source.end from episode.json and writes
public/footage/speaker.mp4 (video only) and public/audio/voice.wav.
"""
import json, subprocess, sys

ep = json.load(open('episode.json'))
start, dur = ep['source']['start'], ep['source']['end'] - ep['source']['start']
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-t', str(dur), '-i', sys.argv[1], '-an',
                '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17',
                '-movflags', '+faststart', 'public/footage/speaker.mp4'], check=True)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-t', str(dur), '-i', 'public/audio/clean.wav',
                '-af', f'afade=t=in:d=0.3,afade=t=out:st={dur - 0.5}:d=0.5', '-c:a', 'pcm_s16le',
                'public/audio/voice.wav'], check=True)
print(f'trimmed {start}s .. {ep["source"]["end"]}s -> public/footage/speaker.mp4 + public/audio/voice.wav')
