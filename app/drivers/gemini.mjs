// Fallback driver: a minimal agent loop against the Gemini API.
// Same shape as any harness — the model asks for a tool, we run it in the
// workspace, the result goes back — but with no dependencies beyond fetch.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { agentEnv, asAgent, proxyBase } from '../lib/sandbox.mjs';
import { getModels, modelEnv } from '../lib/models.mjs';

// Through the app's key proxy (lib/sandbox.mjs), never with the key itself.
const API = () => `${process.env.GEMINI_BASE_URL || proxyBase()}/models`;
const MAX_OUT = 12000;     // characters of tool output handed back to the model
const MAX_STEPS = 400;

const clip = (s, n = MAX_OUT) => (s.length > n ? s.slice(0, n) + `\n…[${s.length - n} more characters]` : s);

const TOOLS = [{
  functionDeclarations: [
    {
      name: 'bash',
      description: 'Run a shell command in the workspace. Use this for the pipeline scripts, ffmpeg, node, python and git.',
      parameters: {
        type: 'OBJECT',
        properties: {
          command: { type: 'STRING', description: 'The command to run, executed with bash -lc' },
          timeout_s: { type: 'NUMBER', description: 'Seconds to allow. Renders can need 3600.' },
        },
        required: ['command'],
      },
    },
    {
      name: 'write_file',
      description: 'Create or overwrite a file in the workspace.',
      parameters: {
        type: 'OBJECT',
        properties: { path: { type: 'STRING' }, content: { type: 'STRING' } },
        required: ['path', 'content'],
      },
    },
    {
      name: 'read_file',
      description: 'Read a UTF-8 file from the workspace.',
      parameters: {
        type: 'OBJECT',
        properties: { path: { type: 'STRING' }, start: { type: 'NUMBER' }, max_bytes: { type: 'NUMBER' } },
        required: ['path'],
      },
    },
    {
      name: 'list_dir',
      description: 'List a directory in the workspace.',
      parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } }, required: ['path'] },
    },
  ],
}];

function runBash(command, cwd, env, timeout_s = 900) {
  return new Promise((resolve) => {
    const [cmd, args] = asAgent('bash', ['-lc', `umask 002; ${command}`]);
    execFile(cmd, args, { cwd, env, timeout: timeout_s * 1000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({
        exit_code: err?.code ?? (err ? 1 : 0),
        timed_out: err?.killed === true,
        stdout: clip(stdout || ''),
        stderr: clip(stderr || '', 4000),
      }));
  });
}

const safe = (work, p) => {
  const full = path.resolve(work, p);
  if (!full.startsWith(work)) throw new Error('Path escapes the workspace');
  return full;
};

async function callTool(name, args, { work, env }) {
  try {
    if (name === 'bash') return await runBash(args.command, work, env, args.timeout_s);
    if (name === 'write_file') {
      const full = safe(work, args.path);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, args.content);
      return { ok: true, bytes: Buffer.byteLength(args.content), path: args.path };
    }
    if (name === 'read_file') {
      const buf = fs.readFileSync(safe(work, args.path), 'utf8');
      const start = args.start || 0;
      return { content: clip(buf.slice(start, start + (args.max_bytes || MAX_OUT))), total_bytes: buf.length };
    }
    if (name === 'list_dir') {
      return {
        entries: fs.readdirSync(safe(work, args.path), { withFileTypes: true })
          .map((d) => (d.isDirectory() ? d.name + '/' : d.name)),
      };
    }
    return { error: `Unknown tool ${name}` };
  } catch (e) {
    return { error: e.message };
  }
}

export async function runGemini({ job, work, jobPath, taskFile = 'TASK.md', token, log }) {
  const env = agentEnv(process.env, token, { ...modelEnv({ ...getModels(), ...(job.models || {}) }), STUDIO_JOB_DIR: jobPath || path.dirname(work), STUDIO_JOB_ID: job.id });
  const model = job.model || job.models?.agent || 'gemini-3.8-flash';
  const system = `You are an expert video editor working inside a prepared workspace.
Read AGENTS.md first — it is how you work — then ${taskFile}, which is the request
in the person's own words. Work in small verifiable steps and check every result.
Long renders are normal: pass a generous timeout_s (up to 3600). Talk to the
person with scripts/ask-user.py when you need a decision. When the work is
finished and verified, reply with the text TASK COMPLETE and a short summary.`;

  const contents = [{ role: 'user', parts: [{ text: `Begin. The workspace is your current directory.\n\n${fs.readFileSync(path.join(work, taskFile), 'utf8')}` }] }];

  // Messages the person sends while this runs (see /api/jobs/:id/message).
  const inbox = path.join(jobPath || path.dirname(work), 'inbox');
  const seenNotes = new Set();
  const newNotes = () => {
    if (!fs.existsSync(inbox)) return [];
    return fs.readdirSync(inbox).filter((f) => f.endsWith('.json') && !seenNotes.has(f)).sort().map((f) => {
      seenNotes.add(f);
      try { return JSON.parse(fs.readFileSync(path.join(inbox, f), 'utf8')).text || ''; } catch { return ''; }
    }).filter(Boolean);
  };

  for (let step = 1; step <= MAX_STEPS; step++) {
    for (const text of newNotes()) {
      const note = { text: `The person just sent you a message while you were working:\n\n"${text}"\n\nTake it into account from now on; adjust now if needed and say in one line what you're changing, then carry on.` };
      const last = contents[contents.length - 1];
      if (last?.role === 'user') last.parts.push(note); else contents.push({ role: 'user', parts: [note] });
      log('[status] The agent has your message');
    }
    const res = await fetch(`${API()}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': token },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: TOOLS,
        generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      log(`Gemini API error ${res.status}: ${body.slice(0, 500)}`);
      if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 20000)); continue; }
      return { ok: false, reason: `api_${res.status}` };
    }
    const data = await res.json();
    const cand = data.candidates?.[0];
    const parts = cand?.content?.parts || [];
    if (cand?.content) contents.push(cand.content);

    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
    const text = parts.filter((p) => p.text).map((p) => p.text).join('\n').trim();
    if (text) log(`[${step}] ${text.slice(0, 1200)}`);

    if (calls.length === 0) {
      if (/TASK COMPLETE/i.test(text)) return { ok: true, steps: step };
      contents.push({ role: 'user', parts: [{ text: 'Continue with the next step. If the work is finished and verified, reply TASK COMPLETE.' }] });
      continue;
    }

    const responses = [];
    for (const call of calls) {
      const preview = call.name === 'bash' ? call.args.command : call.args.path;
      log(`[${step}] ${call.name}: ${String(preview).slice(0, 300)}`);
      const result = await callTool(call.name, call.args, { work, env });
      if (result.exit_code !== undefined) log(`      exit ${result.exit_code}${result.timed_out ? ' (timed out)' : ''}`);
      if (result.error) log(`      error: ${result.error}`);
      responses.push({ functionResponse: { name: call.name, response: result } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return { ok: false, reason: 'step_limit' };
}
