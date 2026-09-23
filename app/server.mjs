// Cutmaster AI — web front end for the video pipeline.
// The server takes uploads, keeps projects and assets, queues jobs and streams
// events. The agent itself runs in worker.mjs, detached, so restarting the
// server never kills a render in progress.
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import {
  ROOT, DATA, JOBS, jobDir, createJob, getJob, updateJob, listJobs, emit, readEvents,
  currentGate, answerGate, saveKey, readKey, keyStatus, clearKey,
} from './lib/store.mjs';
import {
  createProject, getProject, updateProject, listProjects, listMedia, mediaDir,
  assetDir, listAssets, deleteAsset, writeMeta, generateAsset, kindOf,
} from './lib/assets.mjs';
import { usageSummary, getPrices, setPrices, recordUsage } from './lib/usage.mjs';
import { doctor, resetDoctor, version } from './lib/doctor.mjs';
import { ROLES, getModels, setModels, availableModels } from './lib/models.mjs';
import { geminiProxy, newJobToken, proxyBase, stopAgent, AGENT_USER } from './lib/sandbox.mjs';

const app = express();
const PORT = process.env.PORT || 4321;
// Files the agent (a separate user in Docker) must be able to write — job
// workspaces — are group-writable; the key files set their own 0600.
if (AGENT_USER) {
  process.umask(0o002);
  // Data from before the agent had its own user: hand the shared folders to
  // the shared group so the agent can write its workspaces.
  for (const d of [DATA, JOBS]) {
    try { execFileSync('chgrp', ['studio', d]); fs.chmodSync(d, 0o2775); } catch { /* not ours to change */ }
  }
}

// The agent reaches Gemini only through here, with its job's token (see lib/sandbox.mjs).
// Registered before the JSON parser: request bodies pass through untouched.
const tokenJob = (token) => {
  const j = listJobs().find((x) => x.proxyToken === token && (x.status === 'running' || x.status === 'queued'));
  return j || null;
};
app.use('/gemini', express.raw({ type: () => true, limit: '64mb' }), geminiProxy({ tokenJob, realKey: readKey }));
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(ROOT, 'public')));
// Markdown rendering for agent messages and plans (sanitised in the page).
app.get('/vendor/marked.js', (req, res) => res.sendFile(path.join(ROOT, 'node_modules/marked/lib/marked.umd.js')));
app.get('/vendor/purify.js', (req, res) => res.sendFile(path.join(ROOT, 'node_modules/dompurify/dist/purify.min.js')));

const uploadTo = (dirFor) => multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { const d = dirFor(req); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
    filename: (req, file, cb) => {
      const clean = file.originalname.replace(/[^\w.\- ]/g, '_');
      const dir = dirFor(req);
      let name = clean, n = 2;
      while (fs.existsSync(path.join(dir, name))) {
        const ext = path.extname(clean);
        name = `${path.basename(clean, ext)}-${n++}${ext}`;
      }
      cb(null, name);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 * 1024 },
});

// ---------- key ----------
app.get('/api/key', (req, res) => res.json(keyStatus()));
app.post('/api/key', async (req, res) => {
  const key = (req.body.key || '').trim();
  if (!key) return res.status(400).json({ error: 'Paste a key first' });
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key } });
    if (!r.ok) return res.status(400).json({ error: `Google rejected this key (${r.status})` });
  } catch { return res.status(502).json({ error: 'Could not reach Google to check the key' }); }
  saveKey(key);
  resetDoctor();
  res.json(keyStatus());
});
app.delete('/api/key', (req, res) => { clearKey(); resetDoctor(); res.json(keyStatus()); });

// ---------- models ----------
app.get('/api/models', async (req, res) => {
  const key = readKey();
  res.json({ selected: getModels(), roles: ROLES, available: key ? await availableModels(key) : null });
});
app.put('/api/models', (req, res) => {
  try { res.json({ selected: setModels(req.body) }); } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- system check ----------
app.get('/api/doctor', async (req, res) => res.json(await doctor({ fresh: req.query.fresh === '1' })));
app.get('/api/version', (req, res) => res.json({ version: version() }));
// Refuse to start work the machine can't finish.
const blocked = async () => {
  const d = await doctor();
  const bad = d.checks.filter((c) => c.status === 'fail');
  return bad.length ? `This computer isn't ready: ${bad.map((c) => `${c.label} — ${c.fix || c.detail}`).join('; ')}` : null;
};

// ---------- projects ----------
app.get('/api/projects', (req, res) => res.json(listProjects()));
app.post('/api/projects', (req, res) => res.json(createProject(req.body)));
app.get('/api/projects/:id', (req, res) => {
  const p = getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'No such project' });
  res.json({
    ...p,
    media: listMedia(p.id),
    assets: listAssets('project', p.id),
    brand: listAssets('brand'),
    jobs: listJobs().filter((j) => j.projectId === p.id).map((j) => ({ ...j, gate: j.status === 'running' ? currentGate(j.id) : null })),
  });
});
app.patch('/api/projects/:id', (req, res) => res.json(updateProject(req.params.id, req.body)));

app.post('/api/projects/:id/media', (req, res, next) => {
  if (!getProject(req.params.id)) return res.status(404).json({ error: 'No such project' });
  uploadTo((r) => mediaDir(r.params.id)).array('files', 10)(req, res, (err) => {
    if (err) return next(err);
    res.json(listMedia(req.params.id));
  });
});

// Reference media already on this machine instead of copying gigabytes around.
app.post('/api/projects/:id/media/link', (req, res) => {
  const { paths = [] } = req.body;
  const dir = mediaDir(req.params.id);
  for (const p of paths) {
    if (!p || !fs.existsSync(p)) return res.status(400).json({ error: `Not found on disk: ${p}` });
    const dest = path.join(dir, path.basename(p));
    if (!fs.existsSync(dest)) fs.symlinkSync(fs.realpathSync(p), dest);
  }
  res.json(listMedia(req.params.id));
});

app.delete('/api/projects/:id/media/:name', (req, res) => {
  const f = path.join(mediaDir(req.params.id), path.basename(req.params.name));
  if (fs.existsSync(f)) fs.unlinkSync(f);
  res.json(listMedia(req.params.id));
});

// ---------- assets (brand + project) ----------
const scopeOf = (req) => (req.query.scope === 'brand' || req.params.scope === 'brand' ? 'brand' : 'project');

app.get('/api/assets', (req, res) => res.json(listAssets(scopeOf(req), req.query.projectId)));

app.post('/api/assets', (req, res, next) => {
  const scope = scopeOf(req);
  if (scope === 'project' && !getProject(req.query.projectId)) return res.status(400).json({ error: 'Unknown project' });
  uploadTo((r) => assetDir(scopeOf(r), r.query.projectId)).array('files', 40)(req, res, (err) => {
    if (err) return next(err);
    const dir = assetDir(scope, req.query.projectId);
    (req.files || []).forEach((f) => writeMeta(dir, f.filename, { source: 'upload', createdAt: new Date().toISOString() }));
    res.json(listAssets(scope, req.query.projectId));
  });
});

app.post('/api/assets/generate', async (req, res) => {
  const apiKey = readKey();
  if (!apiKey) return res.status(400).json({ error: 'Add your Gemini API key first' });
  const { scope = 'project', projectId, type = 'image', prompt, aspect, style } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Describe what to create' });
  if (scope === 'project' && !getProject(projectId)) return res.status(400).json({ error: 'Unknown project' });
  try {
    const asset = await generateAsset({ scope, projectId, type, prompt, aspect, style, apiKey });
    recordUsage({ kind: type === 'music' ? 'music' : 'image', scope, projectId, model: asset.model, name: asset.name });
    res.json(asset);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.delete('/api/assets', (req, res) => {
  deleteAsset(scopeOf(req), req.query.projectId, req.query.name);
  res.json(listAssets(scopeOf(req), req.query.projectId));
});

app.get('/api/assets/file', (req, res) => {
  const dir = assetDir(scopeOf(req), req.query.projectId);
  const file = path.join(dir, path.basename(req.query.name || ''));
  if (!file.startsWith(dir) || !fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

app.get('/api/projects/:id/media/file', (req, res) => {
  const file = path.join(mediaDir(req.params.id), path.basename(req.query.name || ''));
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

// ---------- jobs ----------
const queue = [];
let running = null;

app.post('/api/projects/:id/produce', async (req, res) => {
  if (!keyStatus().present) return res.status(400).json({ error: 'Add your Gemini API key first' });
  const why = await blocked();
  if (why) return res.status(400).json({ error: why });
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'No such project' });
  const media = listMedia(project.id);
  const video = media.find((m) => m.kind === 'video');
  if (!video) return res.status(400).json({ error: 'Upload or link a camera file first' });
  const audio = media.find((m) => m.kind === 'audio');
  const job = createJob({
    projectId: project.id, status: 'queued',
    prompt: req.body.prompt || project.notes || '',
    speaker: project.speaker, org: project.org, title: project.title,
    driver: req.body.driver || 'openhands',
    model: req.body.model || getModels().agent,
    models: { ...getModels(), ...(req.body.model ? { agent: req.body.model } : {}) },
    video: video.name, audio: audio?.name || null,
  });
  const raw = path.join(jobDir(job.id), 'raw');
  fs.mkdirSync(raw, { recursive: true });
  media.forEach((m) => fs.symlinkSync(fs.realpathSync(path.join(mediaDir(project.id), m.name)), path.join(raw, m.name)));
  emit(job.id, { kind: 'status', text: `Queued "${project.name}" with ${media.length} media file(s)` });
  queue.push(job.id);
  pump();
  res.json(job);
});

app.get('/api/jobs', (req, res) => res.json(listJobs().map((j) => ({ ...j, gate: j.status === 'running' ? currentGate(j.id) : null }))));
app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'No such job' });
  res.json({ ...job, gate: currentGate(job.id) });
});

app.get('/api/jobs/:id/log', (req, res) => res.json(readEvents(req.params.id)));

app.get('/api/jobs/:id/events', (req, res) => {
  const { id } = req.params;
  if (!getJob(id)) return res.status(404).end();
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  let sent = Number(req.query.since || 0);
  const flush = () => {
    readEvents(id, sent).forEach((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
    sent = readEvents(id).length;
    const job = getJob(id);
    res.write(`event: state\ndata: ${JSON.stringify({ status: job?.status, gate: currentGate(id), sent })}\n\n`);
  };
  flush();
  const timer = setInterval(flush, 800);
  req.on('close', () => clearInterval(timer));
});

app.post('/api/jobs/:id/answer', (req, res) => {
  const gate = currentGate(req.params.id);
  if (!gate) return res.status(400).json({ error: 'Nothing is waiting for an answer' });
  answerGate(req.params.id, gate.n, req.body.answer ?? '');
  emit(req.params.id, { kind: 'answer', text: `You answered: ${String(req.body.answer).slice(0, 500)}` });
  res.json({ ok: true });
});

app.post('/api/jobs/:id/cancel', (req, res) => {
  const job = getJob(req.params.id);
  if (job?.pid) stopAgent(job.pid);
  updateJob(req.params.id, { status: 'cancelled' });
  res.json({ ok: true });
});

app.get('/api/jobs/:id/outputs', (req, res) => {
  const work = workOf(req.params.id);
  const out = [];
  for (const dir of ['out', 'public/clips', 'public/img/clean', 'public/img']) {
    const d = path.join(work, dir);
    if (fs.existsSync(d)) fs.readdirSync(d).filter((f) => !fs.statSync(path.join(d, f)).isDirectory())
      .forEach((f) => out.push({ path: `${dir}/${f}`, kind: kindOf(f) }));
  }
  res.json(out);
});

// The cut as it stands: intro, each graphic beat and the outro on one output
// timeline, marked rendered or not, plus the speech segments underneath.
app.get('/api/jobs/:id/timeline', (req, res) => {
  const work = workOf(req.params.id);
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(work, f), 'utf8')); } catch { return null; } };
  const ep = read('episode.json');
  if (!ep) return res.json({ ready: false });
  const clips = read('src/clips.json') || [];
  const intro = ep.introSeconds ?? 6, outro = ep.outroSeconds ?? 8;
  const s0 = ep.source?.start ?? 0, s1 = ep.source?.end ?? 0;
  const footage = Math.max(0, s1 - s0);
  const at = (src) => intro + (src - s0);
  const rendered = (key) => fs.existsSync(path.join(work, 'public', 'clips', `${key}.mp4`));
  const blocks = [
    { key: ep.intro, label: 'Intro', start: 0, end: intro, kind: 'intro', rendered: rendered(ep.intro) },
    ...clips.map((c) => ({ key: c.key, label: c.key.replace(/^clip/, ''), start: at(c.start), end: at(c.end), kind: c.mode, rendered: rendered(c.key) })),
    { key: ep.outro, label: 'Outro', start: intro + footage, end: intro + footage + outro, kind: 'outro', rendered: rendered(ep.outro) },
  ];
  const transcript = (read('transcript.json') || []).map((s) => [at(s.start), at(s.end)]);
  res.json({
    ready: true, total: intro + footage + outro, blocks, speech: transcript,
    final: fs.existsSync(path.join(work, 'out', 'episode.mp4')),
  });
});

app.get('/api/jobs/:id/files/*', (req, res) => {
  const work = workOf(req.params.id);
  const file = path.join(work, req.params[0]);
  if (!file.startsWith(work) || !fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

// ---------- usage ----------
app.get('/api/usage', (req, res) => res.json(usageSummary()));
app.put('/api/usage/prices', (req, res) => res.json(setPrices(req.body || {})));

// ---------- revisions ----------
// A revision is a new job that works in the same workspace as the job it
// revises, so a small change re-renders one clip instead of the whole video.
function workOf(id) {
  const job = getJob(id);
  return job?.work || path.join(jobDir(id), 'work');
}

app.post('/api/jobs/:id/revise', (req, res) => {
  const base = getJob(req.params.id);
  if (!base) return res.status(404).json({ error: 'No such job' });
  if (!fs.existsSync(workOf(base.id))) return res.status(400).json({ error: 'That run has no workspace to revise' });
  const { prompt, target } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Say what to change' });
  const job = createJob({
    projectId: base.projectId, status: 'queued', baseJob: base.id, work: workOf(base.id),
    prompt, target: target || null, speaker: base.speaker, org: base.org, title: base.title,
    driver: base.driver, model: base.model, models: base.models, video: base.video, audio: base.audio,
  });
  const what = target?.label ? ` on ${target.label}` : target?.t != null ? ` at ${Math.floor(target.t / 60)}:${String(Math.floor(target.t % 60)).padStart(2, '0')}` : '';
  emit(job.id, { kind: 'status', text: `Revision${what}` });
  queue.push(job.id);
  pump();
  res.json(job);
});

// ---------- asset edits ----------
// Clicking an image and describing a change edits that image directly with
// Nano Banana; the original is kept and the edit saved alongside it.
app.post('/api/assets/edit', async (req, res) => {
  const apiKey = readKey();
  if (!apiKey) return res.status(400).json({ error: 'Add your Gemini API key first' });
  const { scope = 'project', projectId, name, prompt } = req.body;
  const dir = assetDir(scope, projectId);
  const file = path.join(dir, path.basename(name || ''));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'No such asset' });
  if (kindOf(file) !== 'image') return res.status(400).json({ error: 'Only images can be edited in place; ask for a new version instead' });
  try {
    const mime = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg';
    const imageModel = getModels().image;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${imageModel}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ inlineData: { mimeType: mime, data: fs.readFileSync(file).toString('base64') } }, { text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    });
    const data = await r.json();
    const part = data.candidates?.[0]?.content?.parts?.find((x) => x.inlineData);
    if (!part) return res.status(502).json({ error: data.candidates?.[0]?.finishMessage || data.error?.message || 'No image came back' });
    const ext = part.inlineData.mimeType === 'image/png' ? 'png' : 'jpg';
    const stem = path.basename(file).replace(/\.[^.]+$/, '').replace(/-edit\d*$/, '');
    let out = `${stem}-edit.${ext}`, n = 2;
    while (fs.existsSync(path.join(dir, out))) out = `${stem}-edit${n++}.${ext}`;
    fs.writeFileSync(path.join(dir, out), Buffer.from(part.inlineData.data, 'base64'));
    writeMeta(dir, out, { source: 'ai', prompt: `Edit of ${path.basename(file)}: ${prompt}`, model: imageModel, createdAt: new Date().toISOString() });
    recordUsage({ kind: 'image', scope, projectId, model: imageModel, name: out, edit: true });
    res.json({ name: out });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- queue ----------
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

function pump() {
  if (running || queue.length === 0) return;
  const id = queue.shift();
  const job = getJob(id);
  if (!job || job.status === 'cancelled') return pump();
  const logFile = fs.openSync(path.join(jobDir(id), 'worker.log'), 'a');
  // The worker (and the agent it starts) get a job token for the local
  // Gemini proxy, never the key itself.
  const token = job.proxyToken || newJobToken();
  if (!job.proxyToken) updateJob(id, { proxyToken: token });
  // Detached with no pipes: the run survives a server restart.
  const proc = spawn(process.execPath, [path.join(ROOT, 'worker.mjs'), id], {
    cwd: ROOT,
    env: { ...process.env, CUTMASTER_JOB_TOKEN: token, GEMINI_BASE_URL: proxyBase() },
    detached: true,
    stdio: ['ignore', logFile, logFile],
  });
  proc.unref();
  updateJob(id, { status: 'running', pid: proc.pid, startedAt: new Date().toISOString() });
  emit(id, { kind: 'status', text: `Worker started (pid ${proc.pid}, ${job.driver}, ${job.model})` });
  running = { id, pid: proc.pid };
  const watch = setInterval(() => {
    if (alive(proc.pid)) return;
    clearInterval(watch);
    stopAgent();   // nothing of the agent's outlives its job
    const j = getJob(id);
    const done = fs.existsSync(path.join(jobDir(id), 'work', 'out', 'episode.mp4'));
    const final = j.status === 'cancelled' ? 'cancelled' : done ? 'done' : (j.status === 'running' ? 'failed' : j.status);
    updateJob(id, { status: final, finishedAt: new Date().toISOString() });
    emit(id, { kind: 'status', text: `Worker finished (${final})` });
    running = null;
    pump();
  }, 3000);
}

// A job marked running whose process is gone died with the machine or the server.
for (const job of listJobs()) {
  // Only jobs we know the pid of; a job from an older server is left alone.
  if (job.status === 'running' && job.pid && !alive(job.pid)) {
    updateJob(job.id, { status: 'failed' });
    emit(job.id, { kind: 'status', text: 'Marked failed: its worker process is no longer running' });
  }
}

app.listen(PORT, () => {
  console.log(`Cutmaster AI ${version()} on http://localhost:${PORT}`);
  doctor().then((d) => d.checks.filter((c) => c.status !== 'ok').forEach((c) => console.log(`  [${c.status}] ${c.label}: ${c.detail}`)));
});
