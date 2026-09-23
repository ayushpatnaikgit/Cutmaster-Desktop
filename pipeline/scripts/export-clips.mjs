// Read the clip list out of html/clips.js so Remotion knows each graphic's
// timing and layout. Run after any edit to clips.js.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
global.window = { XKDR_SCENES: { C: {}, SCENES: {}, H: {} } };
global.gsap = {};
eval(fs.readFileSync(path.join(root, 'html/clips.js'), 'utf8'));
fs.writeFileSync(path.join(root, 'src/clips.json'), JSON.stringify(window.XKDR_CLIPS, null, 1));
console.log(`${window.XKDR_CLIPS.length} clips -> src/clips.json`);
const modes = window.XKDR_CLIPS.map((c) => c.mode);
let changes = 0;
window.XKDR_CLIPS.forEach((c, i) => { if (i === 0 || Math.abs(c.start - window.XKDR_CLIPS[i - 1].end) > 0.05) changes += 2; });
console.log(`speaker size changes: ${changes} (keep this low — grouping clips back to back avoids a change)`);
console.log('modes:', modes.join(', '));
