// Usage: node scripts/gen-image.mjs <name> <aspect> "<subject>"
// Generates an on-brand illustration with Nano Banana (IMAGE_MODEL, default gemini-3.1-flash-image).
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
// In the app this is its local key proxy; run by hand, Google directly.
const BASE = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';

const MODEL = process.env.IMAGE_MODEL || 'gemini-3.1-flash-image';  // set in the app's Models settings

const STYLE = `Style: modern editorial pixel-art illustration, crisp square pixels, clean geometric shapes,
flat colours only from this strict palette: coral #F57D6A, black #000000, warm off-white #F2F1F0,
light grey #D6D6D6, mid grey #7A7A7A. Plenty of negative space on a warm off-white #F2F1F0 background.
Calm, thoughtful, research-institute aesthetic. Absolutely no text, letters, numbers, logos or watermarks.`;

const [name, aspect, subject] = process.argv.slice(2);
const res = await fetch(`${BASE}/models/${MODEL}:generateContent`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
  body: JSON.stringify({
    contents: [{ parts: [{ text: `${subject}\n\n${STYLE}` }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } },
  }),
});
const data = await res.json();
const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
if (!part) { console.error(JSON.stringify(data).slice(0, 800)); process.exit(1); }
const out = path.resolve(import.meta.dirname, `../public/img/${name}.${part.inlineData.mimeType.split("/")[1].replace("jpeg","jpg")}`);
fs.writeFileSync(out, Buffer.from(part.inlineData.data, 'base64'));
recordUsage({ kind: 'image', model: MODEL, name: path.basename(out) });
console.log('wrote', out);
