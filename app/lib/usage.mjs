// What each video has cost, estimated from what actually ran.
//
// - The agent's own model spend comes from the running dollar figure OpenHands
//   prints (LiteLLM's estimate from real token counts, cache hits included).
// - Images and music are counted per call: calls the studio makes directly are
//   recorded in usage.jsonl; calls the agent makes through the pipeline scripts
//   are counted from its command log.
// - Prices are Google's published per-call rates, editable in prices.json.
// These are estimates. The authoritative bill is in the user's Google account.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, listJobs, readEvents, jobDir } from './store.mjs';

const USAGE = path.join(DATA, 'usage.jsonl');
const PRICES = path.join(DATA, 'prices.json');

// Checked against ai.google.dev/gemini-api/docs/pricing on 2026-09-23.
export const DEFAULT_PRICES = {
  checkedOn: '2026-09-23',
  image: 0.067,          // gemini-3.1-flash-image, one 1K image
  musicSong: 0.08,       // lyria-3-pro-preview / lyria-3.5, per song
  musicClip: 0.04,       // lyria-3-clip-preview, per clip
  look: 0.01,            // one vision review of a still (≈1.5k tokens in, ≈400 out on 3.1 Pro)
  monthlyBudget: 0,      // 0 = no budget set
};

export function getPrices() {
  try { return { ...DEFAULT_PRICES, ...JSON.parse(fs.readFileSync(PRICES, 'utf8')) }; } catch { return { ...DEFAULT_PRICES }; }
}
export function setPrices(patch) {
  const next = { ...getPrices() };
  for (const [k, v] of Object.entries(patch)) if (k in DEFAULT_PRICES && k !== 'checkedOn' && Number.isFinite(+v) && +v >= 0) next[k] = +v;
  fs.writeFileSync(PRICES, JSON.stringify(next, null, 2));
  return next;
}

// Direct generations from the studio (bins, click-to-edit).
export function recordUsage(entry) {
  fs.appendFileSync(USAGE, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
}
function directUsage() {
  if (!fs.existsSync(USAGE)) return [];
  return fs.readFileSync(USAGE, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

const toNum = (s) => { const m = String(s).match(/([\d.]+)\s*([KMB]?)/i); if (!m) return 0; return +m[1] * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()] || 1); };

// Read one run's log for what it spent.
export function jobUsage(job, prices = getPrices()) {
  const events = readEvents(job.id);
  let agent = 0, tokensIn = 0, tokensOut = 0, images = 0, songs = 0, clips = 0, looks = 0;
  for (const e of events) {
    const t = (e.text || '').trim();
    const dollars = t.match(/^\$\s*([\d.]+)\s*$/) || t.match(/•\s*\$\s*([\d.]+)\s*$/);
    if (dollars) agent = Math.max(agent, +dollars[1]);          // cumulative per conversation
    if (/^Tokens:/.test(t)) {
      const i = t.match(/input\s+([\d.]+[KMB]?)/i), o = t.match(/output\s+([\d.]+[KMB]?)/i);
      if (i) tokensIn = Math.max(tokensIn, toNum(i[1]));
      if (o) tokensOut = Math.max(tokensOut, toNum(o[1]));
    }
  }

  // Media calls: the generators record themselves in the workspace. Runs from
  // before that existed are counted by the files their calls actually wrote.
  const work = job.work || path.join(jobDir(job.id), 'work');
  const rec = path.join(work, 'logs', 'usage.jsonl');
  const lines = fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const mine = lines.filter((u) => u.job === job.id || (!u.job && !job.baseJob));
  if (mine.length) {
    for (const u of mine) {
      if (u.kind === 'image') images++;
      else if (u.kind === 'music') (u.clip ? clips++ : songs++);
      else if (u.kind === 'look') looks++;
    }
  } else if (!job.baseJob) {
    const wrote = new Set();
    for (const e of events) for (const m of (e.text || '').matchAll(/wrote (\S+\/public\/(img|audio)\/[^\s'"\\]+)/g)) wrote.add(m[1]);
    for (const f of wrote) {
      if (/\/img\//.test(f)) images++;
      else if (/\.(mp3|wav)$/.test(f)) songs++;
    }
    for (const e of events) { const c = (e.text || '').match(/^\$\s+(.+)/); if (c) looks += (c[1].match(/look\.py\s/g) || []).length; }
  }
  const media = images * prices.image + songs * prices.musicSong + clips * prices.musicClip + looks * prices.look;
  return { jobId: job.id, projectId: job.projectId, createdAt: job.createdAt, revision: !!job.baseJob,
    agent, tokensIn, tokensOut, images, songs, clips, looks, total: agent + media };
}

export function usageSummary() {
  const prices = getPrices();
  const jobs = listJobs().map((j) => jobUsage(j, prices));
  const direct = directUsage().map((u) => ({ ...u, cost: u.kind === 'image' ? prices.image : u.kind === 'music' ? (u.clip ? prices.musicClip : prices.musicSong) : 0 }));
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const inMonth = (iso) => new Date(iso) >= monthStart;

  const byProject = {};
  const bucket = (pid) => (byProject[pid || 'unassigned'] ||= { projectId: pid || null, agent: 0, images: 0, music: 0, looks: 0, direct: 0, total: 0, runs: 0, tokensIn: 0, tokensOut: 0 });
  for (const j of jobs) {
    const b = bucket(j.projectId);
    b.agent += j.agent; b.images += j.images; b.music += j.songs + j.clips; b.looks += j.looks;
    b.total += j.total; b.runs += 1; b.tokensIn += j.tokensIn; b.tokensOut += j.tokensOut;
  }
  for (const u of direct) {
    const b = bucket(u.scope === 'brand' ? 'brand' : u.projectId);
    if (u.kind === 'image') b.images += 1; else if (u.kind === 'music') b.music += 1;
    b.direct += u.cost; b.total += u.cost;
  }
  const month = jobs.filter((j) => inMonth(j.createdAt)).reduce((s, j) => s + j.total, 0)
    + direct.filter((u) => inMonth(u.t)).reduce((s, u) => s + u.cost, 0);
  const all = Object.values(byProject).reduce((s, b) => s + b.total, 0);
  return { prices, month, all, byProject: Object.values(byProject).sort((a, b) => b.total - a.total), jobs };
}
