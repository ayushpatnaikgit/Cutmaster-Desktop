// Projects and assets.
//
// Brand assets are shared by every episode (logos, fonts, series music, the
// house illustration style). Project assets belong to one episode. Both can be
// uploaded or generated with AI, and the worker copies both into the agent's
// workspace so the graphics can reference them by name.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getModels } from './models.mjs';
import { DATA } from './store.mjs';

export const BRAND_DIR = path.join(DATA, 'assets', 'brand');
export const PROJECTS_DIR = path.join(DATA, 'projects');
fs.mkdirSync(BRAND_DIR, { recursive: true });
fs.mkdirSync(PROJECTS_DIR, { recursive: true });

const IMAGE = /\.(png|jpe?g|webp|gif|svg)$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg)$/i;
const VIDEO = /\.(mp4|mov|mkv|webm)$/i;
export const kindOf = (name) => (IMAGE.test(name) ? 'image' : AUDIO.test(name) ? 'audio' : VIDEO.test(name) ? 'video' : 'file');

// ---------- projects ----------
const projectFile = (id) => path.join(PROJECTS_DIR, id, 'project.json');

export function createProject(fields = {}) {
  const id = (fields.name || 'episode').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    + '-' + crypto.randomBytes(2).toString('hex');
  fs.mkdirSync(path.join(PROJECTS_DIR, id, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(PROJECTS_DIR, id, 'media'), { recursive: true });
  const project = {
    id, name: fields.name || 'Untitled episode', speaker: fields.speaker || '', org: fields.org || '',
    title: fields.title || '', notes: fields.notes || '', createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(projectFile(id), JSON.stringify(project, null, 2));
  return project;
}

export function getProject(id) {
  try { return JSON.parse(fs.readFileSync(projectFile(id), 'utf8')); } catch { return null; }
}

export function updateProject(id, patch) {
  const p = { ...getProject(id), ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(projectFile(id), JSON.stringify(p, null, 2));
  return p;
}

export function listProjects() {
  return fs.readdirSync(PROJECTS_DIR)
    .filter((d) => fs.existsSync(projectFile(d)))
    .map((d) => {
      const p = getProject(d);
      const assets = listAssets('project', d);
      const thumb = assets.find((a) => a.kind === 'image')?.name || null;
      return { ...p, assetCount: assets.length, thumb, media: listMedia(d) };
    })
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export const mediaDir = (id) => path.join(PROJECTS_DIR, id, 'media');
export function listMedia(id) {
  const dir = mediaDir(id);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((name) => ({ name, kind: kindOf(name), size: fs.statSync(path.join(dir, name)).size }));
}

// ---------- asset folders ----------
export function assetDir(scope, projectId) {
  return scope === 'brand' ? BRAND_DIR : path.join(PROJECTS_DIR, projectId, 'assets');
}

const metaPath = (dir) => path.join(dir, '.meta.json');
const readMeta = (dir) => { try { return JSON.parse(fs.readFileSync(metaPath(dir), 'utf8')); } catch { return {}; } };
export function writeMeta(dir, name, entry) {
  const meta = readMeta(dir);
  meta[name] = { ...(meta[name] || {}), ...entry };
  fs.writeFileSync(metaPath(dir), JSON.stringify(meta, null, 2));
}

export function listAssets(scope, projectId) {
  const dir = assetDir(scope, projectId);
  if (!fs.existsSync(dir)) return [];
  const meta = readMeta(dir);
  return fs.readdirSync(dir)
    .filter((n) => !n.startsWith('.'))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return {
        name, scope, projectId: scope === 'project' ? projectId : undefined,
        kind: kindOf(name), size: st.size, createdAt: st.mtime.toISOString(),
        ...(meta[name] || { source: 'upload' }),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteAsset(scope, projectId, name) {
  const dir = assetDir(scope, projectId);
  const file = path.join(dir, path.basename(name));
  if (!file.startsWith(dir) || !fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  const meta = readMeta(dir);
  delete meta[path.basename(name)];
  fs.writeFileSync(metaPath(dir), JSON.stringify(meta, null, 2));
  return true;
}

// ---------- AI generation ----------

// One house style, so generated illustrations sit together as a set.
const STYLE = `Style: modern editorial pixel-art illustration, crisp square pixels, clean geometric
shapes, flat colours only from this strict palette: coral #F57D6A, black #000000, warm off-white
#F2F1F0, light grey #D6D6D6, mid grey #7A7A7A. Plenty of negative space on a warm off-white
#F2F1F0 background. Calm, thoughtful, research-institute aesthetic. Absolutely no text, letters,
numbers, logos or watermarks.`;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'asset';

export async function generateAsset({ scope, projectId, type, prompt, aspect = '1:1', style = true, apiKey }) {
  const dir = assetDir(scope, projectId);
  fs.mkdirSync(dir, { recursive: true });
  const model = type === 'music' ? getModels().music : getModels().image;
  const body = type === 'music'
    ? { contents: [{ parts: [{ text: prompt }] }] }
    : {
      contents: [{ parts: [{ text: style ? `${prompt}\n\n${STYLE}` : prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } },
    };

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) {
    const why = data.candidates?.[0]?.finishMessage || data.error?.message || 'the model returned no media';
    throw new Error(why);
  }
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' }[part.inlineData.mimeType] || 'bin';
  let name = `${slug(prompt)}.${ext}`;
  let n = 2;
  while (fs.existsSync(path.join(dir, name))) name = `${slug(prompt)}-${n++}.${ext}`;
  fs.writeFileSync(path.join(dir, name), Buffer.from(part.inlineData.data, 'base64'));
  writeMeta(dir, name, { source: 'ai', prompt, model, aspect: type === 'music' ? undefined : aspect, createdAt: new Date().toISOString() });
  return { name, kind: kindOf(name), scope, projectId, source: 'ai', prompt, model };
}

// ---------- handing assets to the agent ----------
// Images land in public/img and audio in public/audio, where the pipeline
// already looks for them; ASSETS.md tells the agent what each one is.
export function stageAssets(work, projectId) {
  const lines = ['# Assets available to this episode', ''];
  for (const scope of ['brand', 'project']) {
    const items = listAssets(scope, projectId);
    if (!items.length) continue;
    lines.push(`## ${scope === 'brand' ? 'Brand assets (shared by the series)' : 'Project assets (this episode)'}`, '');
    for (const a of items) {
      const from = path.join(assetDir(scope, projectId), a.name);
      const dest = a.kind === 'audio' ? path.join(work, 'public', 'audio', a.name)
        : a.kind === 'image' ? path.join(work, 'public', 'img', a.name)
          : path.join(work, 'assets', a.name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(from, dest);
      const where = path.relative(work, dest);
      lines.push(`- \`${where}\` — ${a.kind}${a.source === 'ai' ? `, generated from: "${a.prompt}"` : ', uploaded'}`);
    }
    lines.push('');
  }
  if (lines.length > 2) {
    lines.push('Use these before generating anything new. Illustrations still need their',
      'background keyed out (see README step 6) before `clips.js` references them.', '');
  }
  fs.writeFileSync(path.join(work, 'ASSETS.md'), lines.join('\n'));
  return lines.length > 2;
}
