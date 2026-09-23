// Which Gemini models each part of the job uses. Chosen in the app's settings,
// snapshotted onto each job when it starts, and passed to the agent and the
// pipeline scripts through the environment.
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './store.mjs';

const FILE = path.join(DATA, 'models.json');

export const ROLES = {
  agent: { label: 'Agent', hint: 'Plans the edit, writes and runs the code. Flash is fast and cheap; Pro is stronger on hard problems.', default: 'gemini-3.8-flash' },
  quick: { label: 'Quick edits & research', hint: 'Subagents for small, clear-cut changes (a colour, a label, timing) and for web research. A cheaper model with light thinking; the agent hands bigger work to its own model.', default: 'gemini-3.5-flash-lite' },
  look: { label: 'Frame checks', hint: 'Looks at rendered frames and critiques them.', default: 'gemini-3.1-pro-preview' },
  image: { label: 'Illustrations', hint: 'Generates illustrations (Nano Banana).', default: 'gemini-3.1-flash-image' },
  music: { label: 'Music', hint: 'Composes background music (Lyria).', default: 'lyria-3-pro-preview' },
};
export const DEFAULT_MODELS = Object.fromEntries(Object.entries(ROLES).map(([k, r]) => [k, r.default]));
const VALID = /^[a-z0-9][a-z0-9.\-]{1,80}$/i;

export function getModels() {
  try { return { ...DEFAULT_MODELS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { return { ...DEFAULT_MODELS }; }
}

export function setModels(patch) {
  const next = getModels();
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in ROLES)) continue;
    if (v === '' || v == null) next[k] = ROLES[k].default;
    else if (typeof v === 'string' && VALID.test(v.trim())) next[k] = v.trim();
    else throw new Error(`"${v}" isn't a valid model name`);
  }
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}

/** Environment for a job's agent and scripts. */
export const modelEnv = (m = getModels()) => ({
  AGENT_MODEL: m.agent, QUICK_MODEL: m.quick, LOOK_MODEL: m.look, IMAGE_MODEL: m.image, MUSIC_MODEL: m.music,
});

// ---------- what the key can use ----------
let cache = null;

/**
 * Models this key can call, grouped by role, from Google's model list.
 * Cached for ten minutes; falls back to just the defaults when offline.
 */
export async function availableModels(apiKey) {
  if (cache && cache.key === apiKey && Date.now() - cache.at < 600_000) return cache.list;
  const all = [];
  let pageToken = '';
  try {
    do {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`, { headers: { 'x-goog-api-key': apiKey } });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      all.push(...(d.models || []));
      pageToken = d.nextPageToken || '';
    } while (pageToken);
  } catch {
    return Object.fromEntries(Object.keys(ROLES).map((k) => [k, [{ id: ROLES[k].default, name: ROLES[k].default }]]));
  }
  const item = (m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name });
  const gen = all.filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'));
  const isText = (id) => /^gemini-/.test(id) && !/(image|tts|audio|embedding|live|native|robotics|computer-use)/.test(id);
  // Pinned versions newest first; floating aliases (-latest) after them.
  const byNewest = (a, b) => (/latest/.test(a.id) - /latest/.test(b.id)) || b.id.localeCompare(a.id, undefined, { numeric: true });
  const list = {
    agent: gen.map(item).filter((m) => isText(m.id)).sort(byNewest),
    quick: gen.map(item).filter((m) => isText(m.id)).sort(byNewest),
    look: gen.map(item).filter((m) => isText(m.id)).sort(byNewest),
    image: gen.map(item).filter((m) => /image/.test(m.id) && /^gemini-/.test(m.id)).sort(byNewest),
    // realtime models stream live audio; they can't make a whole track
    music: all.map(item).filter((m) => /^lyria/.test(m.id) && !/realtime/.test(m.id)).sort(byNewest),
  };
  // The default first, then the rest.
  for (const k of Object.keys(ROLES)) list[k] = [{ id: ROLES[k].default, name: ROLES[k].default }, ...list[k].filter((m) => m.id !== ROLES[k].default)];
  cache = { key: apiKey, at: Date.now(), list };
  return list;
}
