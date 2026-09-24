// Render a seekable HTML scene to MP4 (or stills) with headless Chrome + ffmpeg.
// Usage: node scripts/render-html.mjs <scene> <out.mp4> [--w 1920 --h 1080 --fps 25]
//        node scripts/render-html.mjs <scene> --stills 0.5,2,4 --outdir dir
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

// Keep html/episode.js in sync with episode.json before rendering anything.
const ep = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../episode.json'), 'utf8'));
// (only when it changed: several renders may run at once, and a file being
// rewritten can be read half-written by another)
const epJs = path.resolve(import.meta.dirname, '../html/episode.js'), epSrc = `window.XKDR_EPISODE=${JSON.stringify(ep)};\n`;
if (!fs.existsSync(epJs) || fs.readFileSync(epJs, 'utf8') !== epSrc) fs.writeFileSync(epJs, epSrc);

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const scene = args[0];
// Vertical episodes: intro/outro fill 1080×1920; graphics fill the top half, 1080×960.
const VERT = ep.format === 'vertical', whole = [ep.intro, ep.outro].includes(scene);
const w = +opt('w', VERT ? 1080 : 1920), h = +opt('h', VERT ? (whole ? 1920 : 960) : 1080), fps = +opt('fps', 25);
const url = `file://${path.resolve(import.meta.dirname, '../html/scene.html')}?s=${scene}&w=${w}&h=${h}`;

const launch = () => puppeteer.launch({
  // the image sets CHROME_PATH (Chromium); outside it, the first browser found
  executablePath: process.env.CHROME_PATH || ['/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p)),
  headless: true,
  args: ['--allow-file-access-from-files', '--disable-web-security', '--hide-scrollbars', '--force-color-profile=srgb',
    ...(process.env.CHROME_NO_SANDBOX ? ['--no-sandbox', '--disable-dev-shm-usage'] : [])],
});
// A scene is a pure function of time, so a clip renders in parallel: several
// browsers (one each — a background tab doesn't paint) take a stretch of
// frames and encode their own segment, and the segments are joined without
// re-encoding. (--workers, default 4)
const browsers = [];
async function openPage() {
  const b = await launch(); browsers.push(b);
  const page = await b.newPage();
  page.on('pageerror', (e) => { console.error('PAGE ERROR', e.message); process.exitCode = 1; });
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto(url);
  await page.waitForFunction('window.__ready === true', { timeout: 30000 });
  return page;
}
const shot = async (page, t, type = 'png') => { await page.evaluate((t) => window.__seek(t), t); return page.screenshot({ type, ...(type === 'jpeg' ? { quality: 92 } : {}), clip: { x: 0, y: 0, width: w, height: h } }); };

if (opt('stills')) {
  const page = await openPage();
  const dir = opt('outdir', '.'); fs.mkdirSync(dir, { recursive: true });
  for (const t of opt('stills').split(',').map(Number)) fs.writeFileSync(path.join(dir, `${scene}_${t}.png`), await shot(page, t));
} else {
  const out = args[1];
  const first = await openPage();
  const duration = await first.evaluate('window.__duration');
  const frames = Math.round(duration * fps);
  const workers = Math.max(1, Math.min(+opt('workers', process.env.RENDER_WORKERS || 4), Math.ceil(frames / 50)));
  const per = Math.ceil(frames / workers);
  const t0 = Date.now();
  const segs = await Promise.all(Array.from({ length: workers }, async (_, i) => {
    const page = i === 0 ? first : await openPage();
    const seg = `${out}.part${i}.mp4`;
    const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(fps), '-i', '-',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', seg], { stdio: ['pipe', 'inherit', 'inherit'] });
    for (let f = i * per; f < Math.min(frames, (i + 1) * per); f++) {
      const buf = await shot(page, f / fps, 'jpeg');
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    return seg;
  }));
  const list = `${out}.parts.txt`;
  fs.writeFileSync(list, segs.map((s) => `file '${path.resolve(s)}'`).join('\n') + '\n');
  await new Promise((r) => spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { stdio: 'inherit' }).on('close', r));
  for (const s of [...segs, list]) fs.rmSync(s, { force: true });
  console.log(`${scene}: ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s with ${workers} browsers -> ${out}`);
}
await Promise.all(browsers.map((b) => b.close()));
