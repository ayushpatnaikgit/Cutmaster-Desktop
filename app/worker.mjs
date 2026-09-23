// Worker: prepares a workspace from the episode template, then hands it to an
// agent driver. Everything the agent does happens inside jobs/<id>/work.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, jobDir, getJob, updateJob, emit } from './lib/store.mjs';
import { stageAssets } from './lib/assets.mjs';
import { runOpenHands } from './drivers/openhands.mjs';
import { runGemini } from './drivers/gemini.mjs';

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
  fs.copyFileSync(path.join(ROOT, 'playbook', 'AGENTS.md'), path.join(work, 'AGENTS.md'));
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
  return `# The request

${job.prompt || '(The person attached footage but did not say anything yet. Ask them what they want.)'}

## Files they gave you
${files}
${known ? `\n## Already known\n${known}\n` : ''}
Read \`AGENTS.md\` first — it is how you work. Talk to the person with
\`scripts/ask-user.py\`; they are watching and will answer.
`;
}

const driver = { openhands: runOpenHands, gemini: runGemini }[job.driver] || runOpenHands;

// A revision works in the existing workspace: refresh the helpers, then brief
// the agent on the one change that was asked for.
function prepareRevision() {
  fs.copyFileSync(path.join(ROOT, 'playbook', 'AGENTS.md'), path.join(work, 'AGENTS.md'));
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
(TASK.md is the original request). Make this change and only this change:
find what produces that part, edit it, re-render just what it affects
(\`./scripts/render-all.sh <scene>\` for one graphic, then the final cut), look
at the result with scripts/look.py, and tell them what you changed. Ask with
scripts/ask-user.py only if the request is genuinely ambiguous.
`);
  log(`Revising ${where}`, 'status');
}

try {
  if (isRevision) prepareRevision(); else prepare();
  updateJob(id, { work });
  const result = await driver({ job, work, jobPath: jobDir(id), taskFile: isRevision ? 'REVISION.md' : 'TASK.md', apiKey: process.env.GEMINI_API_KEY, log });
  log(`Driver finished: ${JSON.stringify(result)}`, 'status');
  process.exit(result?.ok === false ? 1 : 0);
} catch (err) {
  log(`Worker failed: ${err.stack || err.message}`, 'worker-err');
  process.exit(1);
}
