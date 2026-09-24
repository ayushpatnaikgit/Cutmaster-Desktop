// Worker: prepares a workspace from the episode template, then hands it to an
// agent driver. Everything the agent does happens inside jobs/<id>/work.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { ROOT, jobDir, getJob, updateJob, emit } from './lib/store.mjs';
import { stageAssets } from './lib/assets.mjs';
import { runOpenHands } from './drivers/openhands.mjs';
import { runGemini } from './drivers/gemini.mjs';
import { AGENT_USER, asAgent, agentEnv, proxyBase } from './lib/sandbox.mjs';
import { getModels, modelEnv } from './lib/models.mjs';

const id = process.argv[2];
const log = (text, kind = 'worker') => { emit(id, { kind, text: String(text) }); console.log(text); };
const job = getJob(id);
if (!job) { console.error('No such job'); process.exit(1); }

const TEMPLATE = path.resolve(process.env.PIPELINE_DIR || path.join(ROOT, '..', 'pipeline'));
const work = job.work || path.join(jobDir(id), 'work');
const isRevision = !!job.baseJob;

function prepare() {
  log(`Preparing workspace from ${TEMPLATE}`, 'status');
  // Copy the pipeline's own files; link its heavy, read-only dependencies
  // (node_modules, the Python venv) instead of copying hundreds of MB per job.
  const heavy = ['node_modules', '.venv'];
  fs.cpSync(TEMPLATE, work, {
    recursive: true, dereference: false,
    filter: (src) => !heavy.includes(path.relative(TEMPLATE, src).split(path.sep)[0]),
  });
  for (const dir of heavy) {
    const from = path.join(TEMPLATE, dir);
    if (fs.existsSync(from) && !fs.existsSync(path.join(work, dir))) fs.symlinkSync(from, path.join(work, dir));
  }
  fs.mkdirSync(path.join(work, 'raw'), { recursive: true });
  for (const f of fs.readdirSync(path.join(jobDir(id), 'raw'))) {
    const src = fs.realpathSync(path.join(jobDir(id), 'raw', f));
    fs.symlinkSync(src, path.join(work, 'raw', f));
  }
  fs.mkdirSync(path.join(work, 'scripts'), { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'playbook')).filter((f) => f.endsWith('.md'))) fs.copyFileSync(path.join(ROOT, 'playbook', f), path.join(work, f));
  for (const helper of ['ask-user.py', 'run-long.sh', 'check-long.sh', 'look.py']) {
    fs.copyFileSync(path.join(ROOT, 'scripts', helper), path.join(work, 'scripts', helper));
    fs.chmodSync(path.join(work, 'scripts', helper), 0o755);
  }

  // Seed episode.json with what the form already told us.
  const ep = JSON.parse(fs.readFileSync(path.join(work, 'episode.json'), 'utf8'));
  if (job.speaker) ep.speaker = job.speaker;
  if (job.org) ep.org = job.org;
  if (job.title) ep.title = job.title;
  fs.writeFileSync(path.join(work, 'episode.json'), JSON.stringify(ep, null, 2));

  // The kind of video (interview, short, podcast, talk, product): its own playbook.
  const modeFile = path.join(ROOT, 'playbook', 'modes', `${job.mode || 'interview'}.md`);
  if (fs.existsSync(modeFile)) fs.copyFileSync(modeFile, path.join(work, 'MODE.md'));
  fs.writeFileSync(path.join(work, 'TASK.md'), taskBrief());
  if (job.projectId && stageAssets(work, job.projectId)) {
    log('Copied brand and project assets into the workspace (see ASSETS.md)', 'status');
  }
  log('Workspace ready', 'status');
}

// The task is the person's own words. How to do the job well lives in the
// playbook (AGENTS.md), not in per-job instructions.
function taskBrief() {
  const files = fs.readdirSync(path.join(work, 'raw')).map((f) => `- \`raw/${f}\``).join('\n') || '- (none yet)';
  const known = [
    job.speaker && `- Speaker: ${job.speaker}`,
    job.org && `- Speaker's organisation: ${job.org}`,
    job.title && `- Title: ${job.title}`,
  ].filter(Boolean).join('\n');
  const mode = job.mode && job.mode !== 'interview' ? `\n## Kind of video\n\nThey chose **${job.mode}**. Read \`MODE.md\` — it overrides the playbook's defaults for format, pacing and graphics.\n` : '';
  return `# The request

${job.prompt || '(The person attached footage but did not say anything yet. Ask them what they want.)'}

## Files they gave you
${files}
${known ? `\n## Already known\n${known}\n` : ''}${mode}
Read \`AGENTS.md\` first — it is how you work. Talk to the person with
\`scripts/ask-user.py\`; they are watching and will answer.
`;
}

const driver = { openhands: runOpenHands, gemini: runGemini }[job.driver] || runOpenHands;

// A revision works in the existing workspace: refresh the helpers, then brief
// the agent on the one change that was asked for.
function prepareRevision() {
  for (const f of fs.readdirSync(path.join(ROOT, 'playbook')).filter((f) => f.endsWith('.md'))) fs.copyFileSync(path.join(ROOT, 'playbook', f), path.join(work, f));
  for (const helper of ['ask-user.py', 'run-long.sh', 'check-long.sh', 'look.py']) {
    fs.copyFileSync(path.join(ROOT, 'scripts', helper), path.join(work, 'scripts', helper));
  }
  const t = job.target || {};
  const where = t.type === 'clip' ? `the ${t.label} graphic (scene \`${t.key}\`, ${Math.round(t.start)}–${Math.round(t.end)}s in the finished video)`
    : t.type === 'time' ? `the moment at ${Math.floor(t.t / 60)}:${String(Math.floor(t.t % 60)).padStart(2, '0')} in the finished video`
      : t.type === 'asset' ? `the asset \`${t.name}\``
        : 'the video as a whole';
  fs.writeFileSync(path.join(work, 'REVISION.md'), `# A change was asked for

The person clicked on ${where} and wrote:

> ${job.prompt}

This workspace already holds the finished video and everything that made it
(TASK.md is the original request). Make this change and only this change, and
keep it cheap — don't re-read the project:

1. Find what produces that part (a graphic is \`html/clips/<key>.js\`).
2. Don't edit it yourself: hand it to a subagent with the \`task\` tool and a
   short brief (the file, the change in their words, the timings if relevant).
   A tweak — a colour, a word, a size, a timing, labels — goes to
   \`quick-edit\`; a redesign or a new graphic goes to \`graphics\`.
3. When it reports back, re-render just what it affects
   (\`./scripts/render-all.sh <scene>\`, then the final cut), look at one frame
   of the result with scripts/look.py, and tell them what you changed.

Ask with scripts/ask-user.py only if the request is genuinely ambiguous.
`);
  log(`Revising ${where}`, 'status');
}

// ---------- a change to one graphic: no lead agent ----------
// The person clicked a graphic and said what to change. One specialist makes
// the change (quick-edit for a tweak, graphics for a redesign), then scripts
// re-render — no agent steps spent exploring the project or waiting on renders.
const clipTarget = isRevision && job.target?.type === 'clip' && /^[\w-]+$/.test(job.target.key || '') && fs.existsSync(path.join(work, 'html', 'clips', `${job.target.key}.js`)) ? job.target : null;

async function tweakOrRedesign(request) {
  const quick = { ...getModels(), ...(job.models || {}) }.quick;
  try {
    const r = await fetch(`${proxyBase()}/models/${quick}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.ELYPS_JOB_TOKEN },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `Someone asked for this change to one animated graphic in a video:\n\n"${request}"\n\nIs it a TWEAK (colours, words, sizes, positions, timing, adding labels — the graphic stays the same idea and layout) or a REDESIGN (new layout, new visual, substantially different)? Answer with one word: TWEAK or REDESIGN.` }] }], generationConfig: { maxOutputTokens: 400 } }),
    });
    const d = await r.json();
    return /TWEAK/i.test(d.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '') ? 'quick-edit' : 'graphics';
  } catch { return 'graphics'; }
}

function directBrief(t, kind) {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(work, f), 'utf8')); } catch { return null; } };
  const clip = (read('src/clips.json') || []).find((c) => c.key === t.key) || {};
  const said = (read('transcript.json') || []).filter((s) => clip.start != null && s.end >= clip.start && s.start <= clip.end).map((s) => `${s.start.toFixed(1)}–${s.end.toFixed(1)}  ${s.text.trim()}`).join('\n');
  return `# Change one graphic

The person clicked the **${t.label}** graphic in their finished video and wrote:

> ${job.prompt}

- File: \`html/clips/${t.key}.js\` (clip key \`${t.key}\`, source seconds ${clip.start ?? '?'}–${clip.end ?? '?'}). Change only this file.
- What is said during it:
${said ? said.split('\n').map((l) => `    ${l}`).join('\n') : '    (see transcript.json)'}
- The rules for graphics are in GRAPHICS.md (${kind === 'quick-edit' ? "read 'Where your work goes', 'Every frame is a function of time' and 'Prove it'" : 'read it first'}).

Make the change, render two or three stills with \`node scripts/render-html.mjs ${t.key} --stills <t,…> --outdir review/${t.key}\`, look at them with scripts/look.py, fix what's broken, and stop. Don't render the MP4 or the final video — that happens automatically after you finish. Reply in one or two sentences saying what you changed, for the person.
`;
}

function runAs(cmd, label) {
  return new Promise((resolve) => {
    const [c, a] = asAgent('bash', ['-lc', cmd]);
    const p = spawn(c, a, { cwd: work, env: agentEnv(process.env, process.env.ELYPS_JOB_TOKEN) });
    let tail = '';
    const out = (b) => { tail = (tail + b).slice(-4000); };
    p.stdout.on('data', out); p.stderr.on('data', out);
    log(label, 'status');
    p.on('close', (code) => resolve({ ok: code === 0, tail }));
  });
}

async function directRevision(t) {
  for (const f of fs.readdirSync(path.join(ROOT, 'playbook')).filter((f) => f.endsWith('.md'))) fs.copyFileSync(path.join(ROOT, 'playbook', f), path.join(work, f));
  let kind = await tweakOrRedesign(job.prompt);
  for (let attempt = 0; attempt < 2; attempt++) {
    log(`${kind === 'quick-edit' ? 'A quick edit' : 'A redesign'} of the ${t.label} graphic`, 'status');
    fs.writeFileSync(path.join(work, 'REVISION.md'), directBrief(t, kind));
    if (AGENT_USER) { try { execFileSync('chgrp', ['-Rf', 'studio', work]); } catch { /* ok */ } try { execFileSync('chmod', ['-Rf', 'g+rwX', work]); } catch { /* ok */ } }
    await runOpenHands({ job, work, jobPath: jobDir(id), taskFile: 'REVISION.md', token: process.env.ELYPS_JOB_TOKEN, log, env: { ELYPS_DIRECT: kind } });
    const clip = await runAs(`node scripts/export-clips.mjs && ./scripts/render-all.sh ${t.key}`, `Rendering the ${t.label} graphic`);
    if (clip.ok) {
      const fin = await runAs('./scripts/render-final.sh out/episode.mp4', 'Rendering the final video');
      if (fin.ok) return true;
      log(`The final render failed: ${fin.tail.slice(-600)}`, 'worker-err');
      return false;
    }
    log(`The ${t.label} graphic didn't render: ${clip.tail.slice(-600)}`, 'worker-err');
    if (kind === 'graphics') return false;
    kind = 'graphics';   // escalate once
  }
  return false;
}

// ---------- the plan, before the agent (about a minute) ----------
// Everything before the plan is the same for every video, so a script does it
// in parallel (scripts/quickstart.py): footage, audio, a quick transcript,
// frames, the brand, and a plan drafted in one Gemini call. The person sees
// the plan within a minute or two; the exact word-timed transcript finishes
// in the background while they read it; the agent starts after they answer.
const QUICK_STEPS = [
  [/^Footage:/, 'Looking at the footage'], [/^Synced the mic|^Mic sync/, 'Syncing the camera and the mic'], [/^Took the audio/, 'Preparing the audio'],
  [/^Quick transcript/, 'Transcribing the talk'], [/^Took \d+ frames/, 'Watching the video'], [/^Looked up the speaker/, 'Looking up the speaker'], [/^Started the word-timed/, 'Timing every word (in the background)'], [/^Plan drafted/, 'Drafting the plan'],
];
function agentRun(cmd, onLine) {
  return new Promise((resolve) => {
    const [c, a] = asAgent('bash', ['-lc', cmd]);
    const p = spawn(c, a, { cwd: work, env: agentEnv(process.env, process.env.ELYPS_JOB_TOKEN, { ...modelEnv({ ...getModels(), ...(job.models || {}) }), STUDIO_JOB_DIR: jobDir(id), STUDIO_JOB_ID: id }) });
    let out = '', buf = '';
    const eat = (d) => { out += d; buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine?.(buf.slice(0, i)); buf = buf.slice(i + 1); } };
    p.stdout.on('data', eat); p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ ok: code === 0, out }));
  });
}
async function planFirst() {
  if (AGENT_USER) { try { execFileSync('chgrp', ['-Rf', 'studio', jobDir(id)]); } catch { /* ok */ } try { execFileSync('chmod', ['-Rf', 'g+rwX', jobDir(id)]); } catch { /* ok */ } }
  log('Understanding the footage and drafting a plan', 'status');
  const r = await agentRun('python3 scripts/quickstart.py', (line) => {
    const t = line.replace(/^\[\s*[\d.]+s\]\s*/, '');
    const step = QUICK_STEPS.find(([re]) => re.test(t));
    if (step) log(`• ${step[1]}`, 'status');
    console.log(line);
  });
  if (!r.ok || !fs.existsSync(path.join(work, 'plan.md'))) { log('The quick plan didn\'t work out — the agent will plan it instead', 'status'); console.log(r.out.slice(-1500)); return false; }
  const a = await agentRun('python3 scripts/ask-user.py --type beats --title "Plan" --file plan.md');
  const answer = a.out.trim().split('\n').filter(Boolean).at(-1) || '';
  fs.writeFileSync(path.join(work, 'ANSWER.txt'), answer + '\n');   // for the quick edit
  fs.appendFileSync(path.join(work, 'TASK.md'), `
## Already done for you — start building

- The footage is probed and the audio is ready: \`public/audio/clean.wav\` (camera timeline).
- The exact word-timed transcript is being made in the background:
  \`./scripts/check-long.sh transcribe\` → \`transcript.json\` (read it with
  \`scripts/read-transcript.py\`). \`transcript-draft.txt\` has the same talk with rough times.
- A plan was drafted and **sent to the person**: \`plan.md\` (and \`plan.json\`: title, speaker,
  org, palette, fonts, source trim, beats, research with sources). Frames are in \`review/frames/\`.
- **Their answer to the plan:**

> ${answer.replace(/\n/g, '\n> ')}

So don't re-explore or re-plan: skip sections 1–2 of AGENTS.md. Apply their answer (if they
changed something, adjust the plan — no need to ask again unless it's genuinely unclear), put the
plan's details into \`episode.json\`, then build: graphics via subagents, music, render, check,
deliver. You don't need to read README.md; the scripts you need are named in AGENTS.md.
Send every graphics brief in one step as soon as the beats are set, each with the numbers and word
timings it needs (from \`plan.json\` and \`scripts/find-words.py\`), so they build in parallel.
Don't read \`scenes.js\`, \`clips.js\` or the example clips yourself — that's the subagents' job.
`);
  log(job.speed === 'deep' ? 'Plan approved — the agent is building it' : 'Plan approved — building it', 'status');
  return true;
}

// ---------- the lead's review, after a quick edit ----------
// The first cut is already watchable. The lead agent looks at it and, only
// if something a viewer would notice is off, sends graphics subagents (all
// at once) to fix those parts, then re-renders. Bounded: a short pass, not
// a second edit. The first cut stays in place until a better one is done.
const REVIEW = `# Review the quick cut

A script already made the whole video from the approved plan: \`out/episode.mp4\`
(its decisions are in \`logs/fastcut.json\`, the graphics in \`html/clips/*.js\`,
their stills in \`review/<key>/\`). You're the lead editor: check it, and improve
only what a viewer would notice. Be quick: **you have 15 steps**. Don't open or
grep the graphics' source files, the scripts or src/ — judging is done by looking;
fixing is the subagents' job.

1. Take 6 frames spread across \`out/episode.mp4\` (ffmpeg, into \`review/final/\`)
   and look at them in **one** call: \`python3 scripts/look.py review/final/*.png\`.
   Look at the graphics' stills the same way, in one call.
2. If nothing a viewer would notice is wrong (overlaps, cut-off or unreadable
   text, an empty or broken graphic, a caption over a graphic, a wrong fact),
   stop now and say in one line that the cut is good.
3. Otherwise, in **one step**, send a \`graphics\` subagent for each graphic that
   needs work — they run in parallel. Give each its key, start and end, its brief
   from \`logs/fastcut.json\`, and the exact problems. Don't edit clips yourself,
   and don't add graphics, research, re-plan or change the cut.
4. When they're back: \`node scripts/export-clips.mjs\`, then
   \`./scripts/render-all.sh <the keys that changed>\`, then render to a new file and
   swap it in only when it's done:
   \`./scripts/run-long.sh final "./scripts/render-final.sh out/next.mp4 && mv out/next.mp4 out/episode.mp4"\`
   and \`./scripts/check-long.sh final\`.
5. Say in two lines what you changed.
`;

async function leadReview() {
  log('First cut ready — the lead agent is checking it', 'status');
  fs.writeFileSync(path.join(work, 'REVIEW.md'), REVIEW);
  if (AGENT_USER) { try { execFileSync('chgrp', ['-Rf', 'studio', work]); } catch { /* ok */ } try { execFileSync('chmod', ['-Rf', 'g+rwX', work]); } catch { /* ok */ } }
  const r = await runOpenHands({ job, work, jobPath: jobDir(id), taskFile: 'REVIEW.md', token: process.env.ELYPS_JOB_TOKEN, log, env: { ELYPS_MAX_STEPS: '25' } }).catch((e) => ({ ok: false, error: e.message }));
  // the first cut is there whatever happened in the review
  if (!fs.existsSync(path.join(work, 'out', 'episode.mp4'))) log('The review lost the video — this is a bug', 'worker-err');
  log(r?.ok === false ? 'The review stopped early; the first cut is the video' : 'Review finished', 'status');
}

// ---------- the quick edit (the default) ----------
// From the approved plan to the finished video with a script and a handful
// of model calls (scripts/fastcut.py): a few minutes instead of an agent's
// half hour. If it stops, the agent finishes from where it got to.
async function quickEdit() {
  const r = await agentRun(`python3 scripts/fastcut.py --mode ${job.mode || 'interview'} --answer ANSWER.txt`, (line) => {
    const m = /^STEP (.*)/.exec(line.trim());
    if (m) log(`• ${m[1]}`, 'status');
    console.log(line);
  });
  if (r.ok && fs.existsSync(path.join(work, 'out', 'episode.mp4'))) return true;
  const note = fs.existsSync(path.join(work, 'FASTCUT.md')) ? fs.readFileSync(path.join(work, 'FASTCUT.md'), 'utf8') : `# The quick edit stopped\n\n${r.out.slice(-1500)}\n`;
  const why = (/\*\*Stopped at:\*\* (.*)/.exec(note) || [])[1] || 'an error';
  log(`The quick edit stopped (${why.slice(0, 160)}) — the agent is finishing it`, 'status');
  fs.appendFileSync(path.join(work, 'TASK.md'), `\n${note}\nPick up from there: don't redo what's done. Read FASTCUT.md, finish what's left, then deliver.\n`);
  return false;
}

try {
  if (clipTarget) {
    updateJob(id, { work });
    const ok = await directRevision(clipTarget);
    log(`Driver finished: ${JSON.stringify({ ok })}`, 'status');
    process.exit(ok ? 0 : 1);
  }
  if (isRevision) prepareRevision();
  else {
    prepare();
    const planned = process.env.ELYPS_QUICKSTART !== '0' && await planFirst();
    if (planned && job.speed !== 'deep') {
      updateJob(id, { work });
      if (await quickEdit()) {
        if (process.env.ELYPS_REVIEW !== '0') await leadReview();
        log('Driver finished: {"ok":true,"quick":true}', 'status');
        process.exit(0);
      }
    }
  }
  // The agent runs as its own user (Docker): let it write its workspace.
  if (AGENT_USER) {
    // files the agent already made are its own (and already group-writable): skip what we can't change
    try { execFileSync('chgrp', ['-Rf', 'studio', jobDir(id)]); } catch { /* ok */ }
    try { execFileSync('chmod', ['-Rf', 'g+rwX', jobDir(id)]); } catch { /* ok */ }
  }
  updateJob(id, { work });
  const result = await driver({ job, work, jobPath: jobDir(id), taskFile: isRevision ? 'REVISION.md' : 'TASK.md', token: process.env.ELYPS_JOB_TOKEN, log });
  log(`Driver finished: ${JSON.stringify(result)}`, 'status');
  process.exit(result?.ok === false ? 1 : 0);
} catch (err) {
  log(`Worker failed: ${err.stack || err.message}`, 'worker-err');
  process.exit(1);
}
