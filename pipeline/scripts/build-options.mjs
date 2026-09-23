// Inline scenes, logo data and Lyria previews into a single-file options artifact.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const audio = {};
for (const k of ['lightIntroGrid', 'lightOutroTake'].flatMap((s) => ['bright-keys', 'corp-pulse', 'corp-future', 'corp-uplift'].map((m) => `${s}-${m}`)))
  audio[k] = 'data:audio/mpeg;base64,' + fs.readFileSync(path.join(root, `public/audio/${k}.mp3`)).toString('base64');
const html = read('html/options.template.html')
  .replace('/*ASSETS*/', () => read('html/assets.js'))
  .replace('/*SCENES*/', () => read('html/scenes.js'))
  .replace('/*AUDIO*/', () => JSON.stringify(audio));
fs.mkdirSync(path.join(root, 'out'), { recursive: true });
fs.writeFileSync(path.join(root, 'out/big-ideas-openers.html'), html);
console.log('wrote out/big-ideas-openers.html', (html.length / 1024).toFixed(0) + 'KB');
