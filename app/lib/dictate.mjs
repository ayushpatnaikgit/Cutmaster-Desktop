// The prompt box's microphone: audio in, text out, on this machine.
// One long-lived faster-whisper process (scripts/dictate.py) serves every
// request, so the model loads once; it starts on first use.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './store.mjs';

const PIPELINE = path.resolve(process.env.PIPELINE_DIR || path.join(ROOT, '..', 'pipeline'));
const PIPE_PY = path.join(PIPELINE, '.venv', 'bin', 'python');
let proc = null, buf = '', seq = 0;
const waiting = new Map();

function worker() {
  if (proc && proc.exitCode == null) return proc;
  const py = fs.existsSync(PIPE_PY) ? PIPE_PY : 'python3';
  proc = spawn(py, [path.join(ROOT, 'scripts', 'dictate.py')], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } });
  buf = '';
  proc.stdout.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const r = JSON.parse(line); const w = waiting.get(r.id); if (w) { waiting.delete(r.id); w(r); } } catch { /* not ours */ }
    }
  });
  proc.stderr.on('data', () => {});
  proc.on('exit', () => { for (const w of waiting.values()) w({ error: 'Speech recognition stopped unexpectedly' }); waiting.clear(); proc = null; });
  return proc;
}

function ask(req, ms) {
  const id = String(++seq);
  return new Promise((resolve) => {
    const t = setTimeout(() => { waiting.delete(id); resolve({ error: 'Speech recognition took too long' }); }, ms);
    waiting.set(id, (r) => { clearTimeout(t); resolve(r); });
    worker().stdin.write(JSON.stringify({ ...req, id }) + '\n');
  });
}

/** Load the model ahead of time (the first load may download it). */
export const warmDictation = () => ask({ warm: true }, 15 * 60_000);

/** Transcribe one recording (any format ffmpeg/PyAV reads). */
export async function dictate(audio, type = 'audio/webm') {
  const ext = /ogg/.test(type) ? '.ogg' : /mp4|m4a|aac/.test(type) ? '.m4a' : /wav/.test(type) ? '.wav' : '.webm';
  const file = path.join(os.tmpdir(), `elyps-dictation-${process.pid}-${Date.now()}${ext}`);
  fs.writeFileSync(file, audio);
  try {
    const r = await ask({ path: file }, 15 * 60_000);
    if (r.error) throw new Error(r.error);
    return { text: r.text || '', language: r.language };
  } finally {
    fs.rmSync(file, { force: true });
  }
}
