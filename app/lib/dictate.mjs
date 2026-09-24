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

const PROMPT = 'Transcribe this voice note exactly as spoken, in the language(s) spoken (it is usually English, sometimes mixed with Hindi — write Hindi words in Latin letters). Add normal punctuation. Output only the transcript, nothing else. If there is no speech, output nothing.';

/**
 * Transcribe one recording. With `gemini` (a function that takes a
 * generateContent body and returns the response JSON), Gemini does it: fast,
 * and it tells languages apart properly. Otherwise — or if that fails — the
 * local Whisper model, hinted with the browser's language.
 */
export async function dictate(audio, type = 'audio/webm', { gemini, language } = {}) {
  const ext = /ogg/.test(type) ? '.ogg' : /mp4|m4a|aac/.test(type) ? '.m4a' : /wav/.test(type) ? '.wav' : '.webm';
  const file = path.join(os.tmpdir(), `elyps-dictation-${process.pid}-${Date.now()}${ext}`);
  fs.writeFileSync(file, audio);
  try {
    if (gemini) {
      try {
        const mp3 = await new Promise((resolve, reject) => {
          const p = spawn('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-b:a', '32k', '-f', 'mp3', 'pipe:1']);
          const out = []; p.stdout.on('data', (d) => out.push(d)); p.on('close', (c) => (c === 0 ? resolve(Buffer.concat(out)) : reject(new Error('ffmpeg failed'))));
        });
        const d = await gemini({
          contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/mp3', data: mp3.toString('base64') } }, { text: PROMPT }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 2000 },
        });
        const text = (d.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim();
        if (d.candidates) return { text, engine: 'gemini' };
      } catch { /* fall back to Whisper */ }
    }
    const lang = /^[a-z]{2}/.test(language || '') ? language.slice(0, 2) : null;
    const r = await ask({ path: file, language: lang }, 15 * 60_000);
    if (r.error) throw new Error(r.error);
    return { text: r.text || '', language: r.language, engine: 'whisper' };
  } finally {
    fs.rmSync(file, { force: true });
  }
}
