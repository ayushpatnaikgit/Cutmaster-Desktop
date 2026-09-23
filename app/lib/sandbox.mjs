// Keeping the Gemini key away from the agent.
//
// The agent runs code it writes itself, and it reads web pages that could try
// to talk it into things. So it never holds the key:
//
//  - Each job gets a random token. The agent and its scripts send that token
//    to the app's local proxy (/gemini), which swaps in the real key and
//    forwards the call to Google. The token only works from inside this
//    machine/container, only for Gemini generation calls, and only while its
//    job is running.
//  - In Docker the agent also runs as a separate user (AGENT_USER), so it
//    can't read the app's encrypted key store or the app's own processes.
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

export const AGENT_USER = process.env.AGENT_USER || '';
export const newJobToken = () => `cmjob_${crypto.randomBytes(24).toString('hex')}`;
export const proxyBase = () => `http://127.0.0.1:${process.env.PORT || 4322}/gemini`;

/** Environment for anything the agent runs: the job token instead of the key. */
export function agentEnv(base, token, extra = {}) {
  const env = { ...base };
  for (const k of Object.keys(env)) if (/^(GEMINI|GOOGLE_API_KEY|ELYPS_JOB_TOKEN$)/.test(k)) delete env[k];
  return {
    ...env,
    GEMINI_API_KEY: token,        // what the agent's LLM client and the scripts send…
    GEMINI: token,
    GEMINI_BASE_URL: proxyBase(), // …to the app, which adds the real key
    ...(AGENT_USER ? { HOME: `/home/${AGENT_USER}`, USER: AGENT_USER } : {}),
    ...extra,
  };
}

/** Run a command as the agent's user when one is configured (Docker). */
export function asAgent(cmd, args = []) {
  return AGENT_USER ? ['sudo', ['-n', '-E', '-u', AGENT_USER, '--', cmd, ...args]] : [cmd, args];
}

/**
 * Stop everything the agent is running — its shell, renders it detached,
 * browsers. Only one job runs at a time, so all of the agent user's
 * processes belong to it. Without a separate user, kill the worker's group.
 */
export function stopAgent(workerPid) {
  if (workerPid) { try { process.kill(-workerPid, 'SIGTERM'); } catch { try { process.kill(workerPid, 'SIGTERM'); } catch { /* gone */ } } }
  if (AGENT_USER) execFile('sudo', ['-n', '-u', AGENT_USER, 'pkill', '-TERM', '-u', AGENT_USER], () => {});
}

/** Google's error, in words a person can act on — or null if it isn't one we explain. */
export function explainGeminiError(status, message = '') {
  const m = String(message);
  if (/prepayment credits are depleted|billing|credit/i.test(m)) return 'Your Gemini credits have run out. Top up at ai.studio/projects (Billing), then send your request again.';
  if (status === 401 || status === 403 || /API key not valid|permission/i.test(m)) return 'Google rejected your Gemini key. Check it under Settings.';
  if (status === 429 && /quota/i.test(m)) return 'Your Gemini key hit its usage quota. It resets over time; you can also raise it in Google AI Studio.';
  if (status === 404 && /model/i.test(m)) return `This Gemini model isn't available to your key: ${m.slice(0, 160)}. Pick another under Settings → Models.`;
  return null;
}

const ALLOWED = /^\/models\/[\w.\-]+:(generateContent|streamGenerateContent|countTokens)$/;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Express handler for /gemini/*. `tokenJob(token)` returns the running job
 * the token belongs to, or null; `realKey()` returns the user's key.
 */
export function geminiProxy({ tokenJob, realKey, onCall }) {
  return async (req, res) => {
    if (!LOOPBACK.has(req.socket.remoteAddress)) return res.status(403).json({ error: { message: 'The Gemini proxy only serves this machine.' } });
    const token = req.get('x-goog-api-key') || req.query.key;
    const job = token ? tokenJob(String(token)) : null;
    if (!job) return res.status(401).json({ error: { message: 'Unknown or finished job token.' } });
    if (req.method !== 'POST' || !ALLOWED.test(req.path)) return res.status(403).json({ error: { message: `Not allowed through the proxy: ${req.method} ${req.path}` } });
    const key = realKey();
    if (!key) return res.status(400).json({ error: { message: 'No Gemini API key saved in Elyps.' } });
    const qs = new URLSearchParams(Object.entries(req.query).filter(([k]) => k !== 'key')).toString();
    try {
      const up = await fetch(`https://generativelanguage.googleapis.com/v1beta${req.path}${qs ? `?${qs}` : ''}`, {
        method: 'POST',
        headers: { 'content-type': req.get('content-type') || 'application/json', 'x-goog-api-key': key },
        body: req.body && req.body.length ? req.body : undefined,
      });
      res.status(up.status);
      res.set('content-type', up.headers.get('content-type') || 'application/json');
      if (!up.ok) {
        // Errors are small: read them so the app can explain them in plain words.
        const body = await up.text();
        let message = body;
        try { message = JSON.parse(body).error?.message || body; } catch { /* not JSON */ }
        onCall?.(job, req.path, up.status, message);
        return res.send(body);
      }
      onCall?.(job, req.path, up.status);
      if (!up.body) return res.end();
      const reader = up.body.getReader();
      for (;;) { const { value, done } = await reader.read(); if (done) break; res.write(value); }
      res.end();
    } catch (e) {
      if (!res.headersSent) res.status(502).json({ error: { message: `Couldn't reach Google: ${e.message}` } });
      else res.end();
    }
  };
}
