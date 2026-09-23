// Usage: node scripts/gen-music.mjs <name> <model> "<prompt>"
// Generates music with Google Lyria via the Gemini API.
import fs from 'node:fs';
import path from 'node:path';

// Record the call for the studio's usage view (one line per successful call).
function recordUsage(entry) {
  try {
    const dir = path.resolve(import.meta.dirname, '../logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'usage.jsonl'), JSON.stringify({ t: new Date().toISOString(), job: process.env.STUDIO_JOB_ID || null, ...entry }) + '\n');
  } catch {}
}


// The key comes from the environment when the studio app runs this, or from a
// .env file (GEMINI=<key>) in the project or its parent when run by hand.
function loadKey() {
  const fromEnv = process.env.GEMINI_API_KEY || process.env.GEMINI;
  if (fromEnv) return fromEnv.trim();
  const envPath = ['../.env', '../../.env'].map((p) => path.resolve(import.meta.dirname, p)).find(fs.existsSync);
  if (!envPath) throw new Error('No GEMINI key: set GEMINI_API_KEY or add GEMINI=<key> to .env');
  return fs.readFileSync(envPath, 'utf8').match(/^GEMINI=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '');
}
const KEY = loadKey();

const [name, model, prompt] = process.argv.slice(2);

const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
  body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
});
const data = await res.json();
const parts = data.candidates?.[0]?.content?.parts ?? [];
const audio = parts.find((p) => p.inlineData);
if (!audio) { console.error(JSON.stringify(data).slice(0, 1200)); process.exit(1); }
const ext = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' }[audio.inlineData.mimeType] ?? 'bin';
fs.mkdirSync(path.resolve(import.meta.dirname, '../public/audio'), { recursive: true });
const out = path.resolve(import.meta.dirname, `../public/audio/${name}.${ext}`);
fs.writeFileSync(out, Buffer.from(audio.inlineData.data, 'base64'));
recordUsage({ kind: 'music', model, clip: /clip/.test(model), name: path.basename(out) });
parts.filter((p) => p.text).forEach((p) => console.log('note:', p.text.slice(0, 300)));
console.log('wrote', out, audio.inlineData.mimeType);
