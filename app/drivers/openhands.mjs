// OpenHands driver: runs the agent in a local workspace through the SDK.
// Falls back to nothing — if OpenHands cannot start, the worker reports it and
// the job can be re-run with the `gemini` driver.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { ROOT } from '../lib/store.mjs';

export function runOpenHands({ job, work, jobPath, taskFile = 'TASK.md', apiKey, log }) {
  // In Docker OpenHands is installed into the image's Python; locally, into .venv-oh.
  const python = process.env.OPENHANDS_PYTHON || path.join(ROOT, '.venv-oh', 'bin', 'python');
  if (python.includes(path.sep) && !fs.existsSync(python)) {
    log(`OpenHands is not installed (${python} missing) — re-run this job with the Gemini driver.`);
    return Promise.resolve({ ok: false, reason: 'openhands_missing' });
  }
  const runner = path.join(ROOT, 'drivers', 'openhands_runner.py');
  return new Promise((resolve) => {
    const proc = spawn(python, [runner, work, job.model || 'gemini-3.8-flash'], {
      cwd: work,
      env: {
        ...process.env,
        GEMINI_API_KEY: apiKey,
        GEMINI: apiKey,                      // the pipeline's own generation scripts
        STUDIO_JOB_DIR: jobPath || path.dirname(work),  // so scripts/ask-user.py finds this job's gate
        TASK_FILE: taskFile,
        STUDIO_JOB_ID: job.id,
        OH_STATE_DIR: path.join(jobPath || path.dirname(work), 'openhands-state'),
        OPENHANDS_SUPPRESS_BANNER: '1',
        PYTHONUNBUFFERED: '1',
      },
    });
    const relay = (chunk) => String(chunk).split('\n').filter(Boolean).forEach((line) => {
      try {
        const e = JSON.parse(line);
        log(`[${e.kind}] ${e.text}`);
      } catch {
        log(line);
      }
    });
    proc.stdout.on('data', relay);
    proc.stderr.on('data', (c) => log(String(c).trim().split('\n').slice(-3).join('\n')));
    proc.on('close', (code) => resolve({ ok: code === 0, code }));
  });
}
