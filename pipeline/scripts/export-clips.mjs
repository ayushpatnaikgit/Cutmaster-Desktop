// Read the clip list out of html/clips.js and html/clips/*.js so Remotion
// knows each graphic's timing and layout. Run after any graphic changes.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
global.window = { XKDR_SCENES: { C: {}, SCENES: {}, H: {} } };
global.gsap = {};
eval(fs.readFileSync(path.join(root, 'html/clips.js'), 'utf8'));
Object.assign(globalThis, { XKDR_CLIP: window.XKDR_CLIP, XKDR_KIT: window.XKDR_KIT, XKDR_SCENES: window.XKDR_SCENES });
// one file per graphic (files starting with _ are examples)
const dir = path.join(root, 'html/clips');
let broken = 0;
for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !f.startsWith('_')).sort() : []) {
  const before = window.XKDR_CLIPS.length;
  try { eval(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { broken++; console.error(`html/clips/${f}: ${e.message}`); continue; }
  const added = window.XKDR_CLIPS.slice(before).map((c) => c.key);
  if (!added.includes(f.slice(0, -3))) console.error(`html/clips/${f}: the file name should match its clip key (it defines ${added.join(', ') || 'nothing'})`);
}
if (broken) process.exitCode = 1;
window.XKDR_CLIPS.sort((a, b) => a.start - b.start);
window.XKDR_CLIPS.forEach((c, i) => { const n = window.XKDR_CLIPS[i + 1]; if (n && n.start < c.end - 0.05) console.error(`overlap: ${c.key} ends at ${c.end}s but ${n.key} starts at ${n.start}s`); });
fs.writeFileSync(path.join(root, 'src/clips.json'), JSON.stringify(window.XKDR_CLIPS, null, 1));
console.log(`${window.XKDR_CLIPS.length} clips -> src/clips.json`);
const modes = window.XKDR_CLIPS.map((c) => c.mode);
let changes = 0;
window.XKDR_CLIPS.forEach((c, i) => { if (i === 0 || Math.abs(c.start - window.XKDR_CLIPS[i - 1].end) > 0.05) changes += 2; });
console.log(`speaker size changes: ${changes} (keep this low — grouping clips back to back avoids a change)`);
console.log('modes:', modes.join(', '));
