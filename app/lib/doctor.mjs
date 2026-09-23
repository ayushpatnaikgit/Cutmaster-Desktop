// System check: everything a job needs, verified up front so problems show on
// the home page instead of twenty minutes into a render.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { ROOT, DATA, keyStatus } from './store.mjs';

const PIPELINE = path.resolve(process.env.PIPELINE_DIR || path.join(ROOT, '..', 'pipeline'));
const AGENT_PY = process.env.OPENHANDS_PYTHON || path.join(ROOT, '.venv-oh', 'bin', 'python');
const PIPE_PY = path.join(PIPELINE, '.venv', 'bin', 'python');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const GB = 1024 ** 3;

const run = (cmd, args, timeout = 20000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}`.trim() }));
});
const freeBytes = (dir) => { try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch { return null; } };
const firstLine = (s) => s.split('\n')[0].slice(0, 120);

let cache = null;

/**
 * Returns { ok, checks: [{ id, label, status: 'ok'|'warn'|'fail', detail, fix? }] }.
 * 'fail' blocks new jobs; 'warn' is shown but doesn't.
 */
export async function doctor({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.result;
  const checks = [];
  const add = (id, label, status, detail, fix) => checks.push({ id, label, status, detail, ...(fix ? { fix } : {}) });

  const key = keyStatus();
  add('key', 'Gemini API key', key.present ? 'ok' : 'fail', key.present ? `Saved (ends ${key.tail})` : 'Not added yet',
    key.present ? null : 'Click API key (bottom left) and paste a key from aistudio.google.com/apikey');

  const [ffmpeg, chrome, agent, pipe] = await Promise.all([
    run('ffmpeg', ['-version']),
    run(CHROME, ['--version']),
    run(AGENT_PY, ['-c', 'import openhands.sdk, openhands.tools; print("ok")'], 60000),
    run(fs.existsSync(PIPE_PY) ? PIPE_PY : 'python3', ['-c', 'import faster_whisper, numpy, scipy; print("ok")'], 60000),
  ]);
  add('ffmpeg', 'ffmpeg (audio and video)', ffmpeg.ok ? 'ok' : 'fail', ffmpeg.ok ? firstLine(ffmpeg.out) : 'Not found', ffmpeg.ok ? null : 'Install ffmpeg, or use the Docker image, which includes it');
  add('chrome', 'Chrome (renders the graphics)', chrome.ok ? 'ok' : 'fail', chrome.ok ? firstLine(chrome.out) : `Not found at ${CHROME}`, chrome.ok ? null : 'Install Chrome or set CHROME_PATH');
  add('agent', 'Agent (OpenHands)', agent.ok ? 'ok' : 'fail', agent.ok ? 'Installed' : firstLine(agent.out) || 'Not installed', agent.ok ? null : 'Use the Docker image, or run scripts/setup-local.sh');
  add('whisper', 'Transcription and sync (Python)', pipe.ok ? 'ok' : 'fail', pipe.ok ? 'Installed' : firstLine(pipe.out) || 'Not installed', pipe.ok ? null : 'Use the Docker image, or run scripts/setup-local.sh');
  const remotion = fs.existsSync(path.join(PIPELINE, 'node_modules', 'remotion'));
  add('remotion', 'Video renderer (Remotion)', remotion ? 'ok' : 'fail', remotion ? 'Installed' : 'pipeline/node_modules missing', remotion ? null : 'Run npm ci in pipeline/');

  fs.mkdirSync(DATA, { recursive: true });
  const free = freeBytes(DATA);
  if (free != null) {
    const g = free / GB;
    add('disk', 'Free disk space', g < 3 ? 'fail' : g < 10 ? 'warn' : 'ok', `${g.toFixed(1)} GB free`,
      g < 10 ? 'Each video needs a few GB while it works. Free up space, or delete old videos (in Docker: Docker Desktop → Settings → Resources)' : null);
  }
  const mem = os.totalmem() / GB;
  add('memory', 'Memory', mem < 4 ? 'warn' : 'ok', `${mem.toFixed(1)} GB`, mem < 4 ? 'Renders may fail with less than 4 GB. In Docker Desktop: Settings → Resources → Memory' : null);
  add('cpu', 'Processors', os.cpus().length < 2 ? 'warn' : 'ok', `${os.cpus().length} cores`, os.cpus().length < 2 ? 'Renders will be slow; give Docker more CPUs' : null);

  const shm = freeBytes('/dev/shm');
  if (shm != null && process.platform === 'linux') {
    add('shm', 'Shared memory for Chrome', shm < 512 * 1024 ** 2 ? 'warn' : 'ok', `${(shm / 1024 ** 2).toFixed(0)} MB`,
      shm < 512 * 1024 ** 2 ? 'Start the container with shm_size: 2gb (the provided docker-compose.yml does)' : null);
  }
  if (fs.existsSync('/media')) {
    let n = 0;
    try { n = fs.readdirSync('/media').filter((f) => !f.startsWith('.')).length; } catch { /* unreadable */ }
    add('media', 'Footage folder', 'ok', n ? `${n} file${n === 1 ? '' : 's'} in your media folder` : 'Empty — put large camera files in your Cutmaster media folder and use "From disk"');
  }

  const result = { ok: !checks.some((c) => c.status === 'fail'), version: version(), checks };
  cache = { at: Date.now(), result };
  return result;
}

export function version() {
  if (process.env.CUTMASTER_VERSION) return process.env.CUTMASTER_VERSION;
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || 'dev'; } catch { return 'dev'; }
}

/** Invalidate after something that changes the result (e.g. the key). */
export const resetDoctor = () => { cache = null; };
