"""Line an external mic recording up with the camera audio.

Usage: python3 scripts/sync-audio.py <camera.mov> <mic.wav>

Cross-correlates the two at 8 kHz to find where the camera starts inside the
mic recording, then writes public/audio/clean.wav: the mic audio trimmed to the
camera, high-passed and loudness-normalised. Prints the offset and a confidence
ratio; anything above ~50 is a solid match.
"""
import subprocess, sys, tempfile, os
import numpy as np
from scipy.io import wavfile
from scipy.signal import fftconvolve

cam_path, mic_path = sys.argv[1], sys.argv[2]
tmp = tempfile.mkdtemp()
def to8k(src, dst):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vn', '-ac', '1', '-ar', '8000', dst], check=True)
to8k(cam_path, f'{tmp}/cam.wav'); to8k(mic_path, f'{tmp}/mic.wav')

_, cam = wavfile.read(f'{tmp}/cam.wav'); _, mic = wavfile.read(f'{tmp}/mic.wav')
cam = cam.astype(float) / max(1, np.abs(cam).max()); mic = mic.astype(float) / max(1, np.abs(mic).max())
x = fftconvolve(mic, cam[::-1], mode='full')
offset = (np.argmax(np.abs(x)) - (len(cam) - 1)) / 8000
confidence = np.abs(x).max() / np.abs(x).mean()

cam_dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', cam_path]))
os.makedirs('public/audio', exist_ok=True)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(offset), '-t', str(cam_dur), '-i', mic_path,
                '-af', 'highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-ac', '2',
                '-c:a', 'pcm_s16le', 'public/audio/clean.wav'], check=True)
print(f'camera starts {offset:.3f}s into the mic recording (confidence {confidence:.0f})')
print('wrote public/audio/clean.wav')
