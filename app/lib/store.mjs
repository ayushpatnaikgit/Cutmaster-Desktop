// Job store and credential handling for Big Ideas Studio.
// Jobs live as one directory each under jobs/; events are an append-only JSONL
// file so the browser can tail them and reconnect without losing anything.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '..');
// Everything the app writes lives under DATA_DIR (a Docker volume in compose),
// never inside the code folder.
export const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, '..', 'data'));
export const JOBS = path.join(DATA, 'jobs');
const SECRET_FILE = path.join(DATA, '.secret');
const KEY_FILE = path.join(DATA, '.credentials');

fs.mkdirSync(JOBS, { recursive: true });

// ---------- credentials ----------
// The user's Gemini key is encrypted at rest with a local secret and only ever
// decrypted into the worker's environment. It is never written into a job
// directory, where the agent could read it back.
function secret() {
  if (!fs.existsSync(SECRET_FILE)) {
    fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32), { mode: 0o600 });
  }
  return fs.readFileSync(SECRET_FILE);
}

export function saveKey(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secret(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  fs.writeFileSync(KEY_FILE, JSON.stringify({
    iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'),
    data: enc.toString('base64'), tail: plain.slice(-4), savedAt: new Date().toISOString(),
  }), { mode: 0o600 });
}

export function readKey() {
  if (!fs.existsSync(KEY_FILE)) return null;
  const j = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  const d = crypto.createDecipheriv('aes-256-gcm', secret(), Buffer.from(j.iv, 'base64'));
  d.setAuthTag(Buffer.from(j.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(j.data, 'base64')), d.final()]).toString('utf8');
}

export function keyStatus() {
  if (!fs.existsSync(KEY_FILE)) return { present: false };
  const j = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  return { present: true, tail: j.tail, savedAt: j.savedAt };
}

export function clearKey() {
  if (fs.existsSync(KEY_FILE)) fs.unlinkSync(KEY_FILE);
}

// Anything key-shaped must never reach the browser or the log files.
export function redact(text) {
  return String(text).replace(/AIza[0-9A-Za-z_\-]{10,}/g, 'AIza…redacted');
}

// ---------- jobs ----------
export const jobDir = (id) => path.join(JOBS, id);
const metaFile = (id) => path.join(jobDir(id), 'job.json');

export function createJob(fields) {
  const id = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14) + '-' + crypto.randomBytes(3).toString('hex');
  fs.mkdirSync(path.join(jobDir(id), 'raw'), { recursive: true });
  const job = { id, status: 'queued', createdAt: new Date().toISOString(), ...fields };
  fs.writeFileSync(metaFile(id), JSON.stringify(job, null, 2));
  return job;
}

export function getJob(id) {
  try { return JSON.parse(fs.readFileSync(metaFile(id), 'utf8')); } catch { return null; }
}

export function updateJob(id, patch) {
  const job = { ...getJob(id), ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(metaFile(id), JSON.stringify(job, null, 2));
  return job;
}

export function listJobs() {
  return fs.readdirSync(JOBS).filter((d) => fs.existsSync(metaFile(d)))
    .map((d) => getJob(d)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------- events ----------
export function emit(id, event) {
  const line = JSON.stringify({ t: Date.now(), ...event, ...(event.text ? { text: redact(event.text) } : {}) });
  fs.appendFileSync(path.join(jobDir(id), 'events.jsonl'), line + '\n');
}

export function readEvents(id, from = 0) {
  const f = path.join(jobDir(id), 'events.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(from).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

// ---------- approval gates ----------
// The agent asks a question by writing gate.json (via scripts/ask-user.py in
// its workspace) and blocks until the browser writes the matching answer.
export const gateFile = (id) => path.join(jobDir(id), 'gate.json');
export const answerFile = (id, n) => path.join(jobDir(id), `answer-${n}.json`);

export function currentGate(id) {
  try {
    const g = JSON.parse(fs.readFileSync(gateFile(id), 'utf8'));
    return fs.existsSync(answerFile(id, g.n)) ? null : g;
  } catch { return null; }
}

export function answerGate(id, n, answer) {
  fs.writeFileSync(answerFile(id, n), JSON.stringify({ answer, at: new Date().toISOString() }));
}
