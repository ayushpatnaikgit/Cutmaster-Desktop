// Capture a web page for the video: a still, or a smooth scrolling recording,
// with an optional highlighter-pen mark on the words that matter.
//
//   node scripts/web-capture.mjs shot   <url> <out.png> [--highlight "exact words"] [--full]
//   node scripts/web-capture.mjs scroll <url> <out.mp4> [--to "words"] [--highlight "words"] [--seconds 6]
//
// Options: --w 1600 --h 1000 (viewport), --scale 2 (sharpness), --fps 30,
// --color "#ffe066" (highlight), --wait 1500 (ms after load), --selector "css"
// (highlight an element instead of words).
//
// The scroll is stepped frame by frame, so it is perfectly smooth: it holds on
// the top of the page, glides to the target, marks the highlight, then holds.
// Cookie banners and sticky overlays are removed first. Prints what it made.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const [mode, url, out] = args;
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes('--' + k);
if (!['shot', 'scroll'].includes(mode) || !url || !out) {
  console.error('usage: web-capture.mjs shot|scroll <url> <out> [--highlight "words"] [--to "words"] [--full] [--seconds 6]');
  process.exit(2);
}
const w = +opt('w', 1600), h = +opt('h', 1000), scale = +opt('scale', mode === 'shot' ? 2 : 1.2), fps = +opt('fps', 30);
const highlight = opt('highlight'), selector = opt('selector'), to = opt('to') || highlight, color = opt('color', '#ffe066');
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

const browser = await puppeteer.launch({
  // the image sets CHROME_PATH (Chromium); outside it, the first browser found
  executablePath: process.env.CHROME_PATH || ['/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p)),
  headless: true,
  args: ['--hide-scrollbars', '--force-color-profile=srgb', '--lang=en-US',
    ...(process.env.CHROME_NO_SANDBOX ? ['--no-sandbox', '--disable-dev-shm-usage'] : [])],
});
try {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36');
  await page.setViewport({ width: w, height: h, deviceScaleFactor: scale });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch((e) => console.error(`load: ${e.message} (continuing with what loaded)`));
  await new Promise((r) => setTimeout(r, +opt('wait', 1500)));

  // Tidy the page: no cookie banners, chat bubbles or sticky pop-ups; no smooth-scroll CSS.
  await page.evaluate(() => {
    const kill = /cookie|consent|gdpr|onetrust|cmp|newsletter|subscribe|modal|popup|chat-widget|intercom/i;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if ((cs.position === 'fixed' || cs.position === 'sticky') && (kill.test(el.id + ' ' + el.className) || /accept|cookie|consent/i.test(el.textContent.slice(0, 400)))) el.remove();
    }
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.overflow = 'auto';
    const st = document.createElement('style');
    st.textContent = '*{scroll-behavior:auto!important;caret-color:transparent!important} ::-webkit-scrollbar{display:none}';
    document.head.appendChild(st);
  });

  // Find the words (or element), wrap them in a mark we can sweep in.
  const found = await page.evaluate((words, sel, color) => {
    let target = null;
    if (sel) target = document.querySelector(sel);
    if (words && !target) {
      // the words as typed, tolerant of line breaks and extra spaces in the page
      const re = new RegExp(words.trim().split(/\s+/).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'i');
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = walker.nextNode());) {
        const m = re.exec(n.textContent);
        if (!m || !n.parentElement || n.parentElement.closest('script,style,noscript')) continue;
        const r = n.parentElement.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const range = document.createRange();
        range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
        const mark = document.createElement('mark');
        try { range.surroundContents(mark); } catch { continue; }
        target = mark; break;
      }
    }
    if (!target) return null;
    target.classList.add('__hl');
    const st = document.createElement('style');
    st.textContent = `.__hl{background:linear-gradient(90deg, ${color}cc, ${color}cc) no-repeat 0 60% / var(--hl, 0%) 78%; color:inherit; border-radius:3px; padding:0 .08em; box-decoration-break:clone; -webkit-box-decoration-break:clone}
      .__hl.__box{outline:3px solid ${color}; outline-offset:6px; background:none}`;
    document.head.appendChild(st);
    if (sel) target.classList.add('__box');
    const r = target.getBoundingClientRect();
    return { top: r.top + scrollY, height: r.height, text: target.textContent.trim().slice(0, 120) };
  }, highlight, selector, color);
  if ((highlight || selector) && !found) console.error(`could not find ${selector ? `"${selector}"` : `the words "${highlight}"`} on the page — captured without a highlight`);
  const title = await page.title();

  // where a scroll should end: the --to words, the highlight, or one screen down
  let targetY = 0;
  if (to && to !== highlight) {
    targetY = await page.evaluate((words) => {
      const want = words.toLowerCase();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = walker.nextNode());) if (n.textContent.replace(/\s+/g, ' ').toLowerCase().includes(want) && n.parentElement?.getBoundingClientRect().height) return n.parentElement.getBoundingClientRect().top + scrollY;
      return null;
    }, to);
    if (targetY == null) { console.error(`could not find "${to}" to scroll to — scrolling one screen instead`); targetY = h * 0.8; }
  } else if (found) targetY = found.top;
  const maxY = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const endY = Math.max(0, Math.min(maxY, targetY - h * 0.38));

  const setHl = (p) => page.evaluate((p) => document.querySelectorAll('.__hl').forEach((m) => m.style.setProperty('--hl', (p * 100).toFixed(1) + '%')), p);

  if (mode === 'shot') {
    if (!flag('full')) await page.evaluate((y) => scrollTo(0, y), endY);
    await setHl(1);
    await page.screenshot({ path: out, fullPage: flag('full') });
    console.log(`${out} · "${title}"${found ? ` · highlighted "${found.text}"` : ''}`);
  } else {
    const secs = +opt('seconds', 6), n = Math.round(secs * fps);
    const hold = 0.8, glide = Math.max(1.2, Math.min(secs - 2.6, 1.2 + Math.abs(endY) / 900)), mark = 0.7;
    const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const clamp = (x) => Math.max(0, Math.min(1, x));
    const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
      '-vf', `scale=${Math.round(w * 1.2) & ~1}:-2:flags=lanczos`, '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
      { stdio: ['pipe', 'inherit', 'inherit'] });
    for (let f = 0; f < n; f++) {
      const t = f / fps;
      await page.evaluate((y) => scrollTo(0, y), endY * ease(clamp((t - hold) / glide)));
      await setHl(ease(clamp((t - hold - glide - 0.15) / mark)));
      const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    console.log(`${out} · ${secs}s scroll of "${title}"${found ? ` · highlights "${found.text}"` : ''}`);
  }
} finally {
  await browser.close();
}
