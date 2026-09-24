// Render a seekable HTML scene to MP4 (or stills) with headless Chrome + ffmpeg.
// Usage: node scripts/render-html.mjs <scene> <out.mp4> [--w 1920 --h 1080 --fps 25]
//        node scripts/render-html.mjs <scene> --stills 0.5,2,4 --outdir dir
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

// Keep html/episode.js in sync with episode.json before rendering anything.
const ep = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../episode.json'), 'utf8'));
fs.writeFileSync(path.resolve(import.meta.dirname, '../html/episode.js'), `window.XKDR_EPISODE=${JSON.stringify(ep)};\n`);

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const scene = args[0];
// Vertical episodes: intro/outro fill 1080×1920; graphics fill the top half, 1080×960.
const VERT = ep.format === 'vertical', whole = [ep.intro, ep.outro].includes(scene);
const w = +opt('w', VERT ? 1080 : 1920), h = +opt('h', VERT ? (whole ? 1920 : 960) : 1080), fps = +opt('fps', 25);
const url = `file://${path.resolve(import.meta.dirname, '../html/scene.html')}?s=${scene}&w=${w}&h=${h}`;

const browser = await puppeteer.launch({
  // the image sets CHROME_PATH (Chromium); outside it, the first browser found
  executablePath: process.env.CHROME_PATH || ['/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p)),
  headless: true,
  args: ['--allow-file-access-from-files', '--disable-web-security', '--hide-scrollbars', '--force-color-profile=srgb',
    ...(process.env.CHROME_NO_SANDBOX ? ['--no-sandbox', '--disable-dev-shm-usage'] : [])],
});
const page = await browser.newPage();
page.on('pageerror', (e) => { console.error('PAGE ERROR', e.message); process.exitCode = 1; });
await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
await page.goto(url);
await page.waitForFunction('window.__ready === true', { timeout: 30000 });
const duration = await page.evaluate('window.__duration');
const shot = async (t) => { await page.evaluate((t) => window.__seek(t), t); return page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: w, height: h } }); };

if (opt('stills')) {
  const dir = opt('outdir', '.'); fs.mkdirSync(dir, { recursive: true });
  for (const t of opt('stills').split(',').map(Number)) fs.writeFileSync(path.join(dir, `${scene}_${t}.png`), await shot(t));
} else {
  const out = args[1];
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const frames = Math.round(duration * fps);
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    const buf = await shot(f / fps);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 50 === 0) process.stdout.write(`\r${scene}: ${f}/${frames}`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log(`\r${scene}: ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${out}`);
}
await browser.close();
