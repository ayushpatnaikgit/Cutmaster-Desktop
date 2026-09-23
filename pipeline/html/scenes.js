// Big Ideas by XKDR — seekable intro/outro scenes.
// Every scene builds DOM into a 1920x1080 stage and returns a paused GSAP
// timeline plus canvas draw hooks, so the same code drives live previews and
// frame-accurate MP4 renders (seek(t) is deterministic; randomness is seeded).
(function () {
  const C = { bg: '#f2f1f0', coral: '#f57d6a', ink: '#000000', grey: '#d6d6d6', mid: '#7a7a7a', white: '#ffffff' };
  const W = 1920, H = 1080;
  const EP = window.XKDR_EPISODE; // set by html/episode.js, generated from episode.json

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);

  function el(parent, css, html, tag) {
    const d = document.createElement(tag || 'div');
    Object.assign(d.style, { position: 'absolute' }, css || {});
    if (html != null) d.innerHTML = html;
    parent.appendChild(d);
    return d;
  }
  function canvas(parent, z) {
    const c = el(parent, { left: 0, top: 0, width: W + 'px', height: H + 'px', zIndex: z || 0 }, null, 'canvas');
    c.width = W; c.height = H;
    return c;
  }
  function gridBg(parent, color) {
    return el(parent, {
      inset: 0,
      backgroundImage: `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`,
      backgroundSize: '40px 40px',
    });
  }

  function makeTL(duration) {
    const draws = [];
    const tl = gsap.timeline({ paused: true, onUpdate() { const t = tl.time(); draws.forEach((f) => f(t)); } });
    tl.set({}, {}, duration);
    const seek = (t) => { tl.time(t, true); draws.forEach((f) => f(t)); };
    return { tl, draws, duration, seek };
  }

  // ---------- pixel type ----------
  const GLYPHS = {
    B: ['1111.', '1...1', '1...1', '1111.', '1...1', '1...1', '1111.'],
    I: ['111', '.1.', '.1.', '.1.', '.1.', '.1.', '111'],
    G: ['.1111', '1....', '1....', '1.111', '1...1', '1...1', '.1111'],
    D: ['1111.', '1...1', '1...1', '1...1', '1...1', '1...1', '1111.'],
    E: ['11111', '1....', '1....', '1111.', '1....', '1....', '11111'],
    A: ['.111.', '1...1', '1...1', '11111', '1...1', '1...1', '1...1'],
    S: ['.1111', '1....', '1....', '.111.', '....1', '....1', '1111.'],
  };
  function glyphCells(text) {
    const cells = []; let x = 0;
    [...text].forEach((ch, i) => {
      if (ch === ' ') { x += 2; return; }
      const g = GLYPHS[ch];
      g.forEach((row, y) => [...row].forEach((v, cx) => { if (v === '1') cells.push({ x: x + cx, y, letter: i }); }));
      x += g[0].length + 1;
    });
    return { cells, w: x - 1, h: 7 };
  }
  function pixelWord(parent, text, cell, cx, top, color) {
    const g = glyphCells(text);
    const left = cx - (g.w * cell) / 2;
    const divs = g.cells.map((c) => {
      const d = el(parent, { left: left + c.x * cell + 'px', top: top + c.y * cell + 'px', width: cell + 0.5 + 'px', height: cell + 0.5 + 'px', background: color || C.ink });
      d._cell = c; d._abs = { x: left + c.x * cell, y: top + c.y * cell };
      return d;
    });
    return { divs, w: g.w * cell, h: 7 * cell, left, top };
  }

  // ---------- logo ----------
  function buildLogo(parent, s, cx, cy, ink) {
    const L = window.XKDR_LOGO;
    const w = L.w * s, h = L.h * s;
    const wrap = el(parent, { left: cx - w / 2 + 'px', top: cy - h / 2 + 'px', width: w + 'px', height: h + 'px' });
    const cxs = L.rects.filter((r) => r[4] === 'c').map((r) => r[0]).sort((a, b) => a - b);
    const mid = (cxs[0] + cxs[cxs.length - 1]) / 2;
    const rects = L.rects.map((r) => {
      const d = el(wrap, { left: r[0] * s + 'px', top: r[1] * s + 'px', width: r[2] * s + 0.6 + 'px', height: r[3] * s + 0.6 + 'px', background: r[4] === 'c' ? C.coral : ink || C.ink });
      d._c = r[4] === 'c'; d._r = r; d._side = r[0] < mid ? 'L' : 'R';
      return d;
    });
    return { wrap, rects, w, h, s, left: cx - w / 2, top: cy - h / 2 };
  }
  // Coral braces from the logo, drawn standalone at scale k.
  function buildBraces(parent, k) {
    const L = window.XKDR_LOGO;
    const coral = L.rects.filter((r) => r[4] === 'c');
    const xs = coral.map((r) => r[0]).sort((a, b) => a - b);
    const mid = (xs[0] + xs[xs.length - 1]) / 2;
    const out = {};
    ['L', 'R'].forEach((side) => {
      const rs = coral.filter((r) => (side === 'L' ? r[0] < mid : r[0] >= mid));
      const x0 = Math.min(...rs.map((r) => r[0])), y0 = Math.min(...rs.map((r) => r[1]));
      const x1 = Math.max(...rs.map((r) => r[0] + r[2])), y1 = Math.max(...rs.map((r) => r[1] + r[3]));
      const wrap = el(parent, { left: 0, top: 0, width: (x1 - x0) * k + 'px', height: (y1 - y0) * k + 'px' });
      const divs = rs.map((r) => el(wrap, { left: (r[0] - x0) * k + 'px', top: (r[1] - y0) * k + 'px', width: r[2] * k + 0.6 + 'px', height: r[3] * k + 0.6 + 'px', background: C.coral }));
      out[side] = { wrap, divs, w: (x1 - x0) * k, h: (y1 - y0) * k, x0, y0 };
    });
    return out;
  }

  // ---------- canvas pixel wipe (cover = fills to solid, uncover = clears from solid) ----------
  function pixelWipe(stage, draws, { start, dur = 0.7, color = C.coral, mode = 'cover', seed = 3, size = 40, z = 50 }) {
    const cv = canvas(stage, z), ctx = cv.getContext('2d'), R = rng(seed);
    const cols = W / size, rows = Math.ceil(H / size);
    const delays = Array.from({ length: cols * rows }, () => R() * (dur - 0.22));
    draws.push((t) => {
      ctx.clearRect(0, 0, W, H); ctx.fillStyle = color;
      for (let i = 0; i < delays.length; i++) {
        let p = clamp((t - start - delays[i]) / 0.22);
        if (mode === 'uncover') p = 1 - p;
        if (p <= 0) continue;
        const s = size * easeOut(p) + (p >= 1 ? 1 : 0);
        const x = (i % cols) * size + (size - s) / 2, y = Math.floor(i / cols) * size + (size - s) / 2;
        ctx.fillRect(x, y, s, s);
      }
    });
  }

  // ---------- text helpers ----------
  function wordsLine(parent, text, css) {
    const line = el(parent, Object.assign({ whiteSpace: 'nowrap' }, css));
    const spans = text.split(' ').map((w, i, a) => {
      const mask = document.createElement('span');
      Object.assign(mask.style, { display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.12em' });
      const inner = document.createElement('span');
      inner.textContent = w + (i < a.length - 1 ? ' ' : '');
      inner.style.display = 'inline-block';
      mask.appendChild(inner); line.appendChild(mask);
      return inner;
    });
    return { line, spans };
  }
  const centered = (css) => Object.assign({ left: 0, width: W + 'px', textAlign: 'center' }, css);
  const F = {
    sans: "'Montserrat', 'Helvetica Neue', Arial, sans-serif",
    serif: "'Merriweather', Georgia, serif",
    josefin: "'Josefin Sans', 'Montserrat', sans-serif",
    mono: "'JetBrains Mono', 'DejaVu Sans Mono', monospace",
  };

  function socialRow(parent, top, color) {
    const row = el(parent, centered({ top: top + 'px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '36px', color }));
    const site = el(row, { position: 'relative', font: `700 38px ${F.sans}`, letterSpacing: '0.04em' }, 'xkdr.org');
    const sep = el(row, { position: 'relative', width: '10px', height: '10px', background: C.coral });
    const icons = ['linkedin', 'x', 'youtube'].map((n) => el(row, { position: 'relative', width: '40px', height: '40px' }, window.XKDR_ICONS[n]));
    return { row, items: [site, sep, ...icons] };
  }

  // Shared series lockup: BIG IDEAS / by {X}KDR / divider / title / subtitle
  function lockup(stage, tl, R, { t0, dark, logoFrom }) {
    const ink = dark ? C.white : C.ink;
    const big = pixelWord(stage, 'BIG IDEAS', 30, W / 2, 238, ink);
    big.divs.forEach((d) => {
      const at = t0 + d._cell.x * 0.016 + R() * 0.08;
      tl.fromTo(d, { scale: 0, rotation: 90, backgroundColor: C.coral }, { scale: 1, rotation: 0, duration: 0.35, ease: 'back.out(3)' }, at);
      tl.to(d, { backgroundColor: ink, duration: 0.45, ease: 'none' }, at + 0.25);
    });
    const by = el(stage, { left: '754px', top: '505px', font: `700 52px ${F.josefin}`, color: ink }, 'by');
    tl.fromTo(by, { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.5, ease: 'power3.out' }, t0 + 0.55);
    let logo = logoFrom;
    if (!logo) {
      logo = buildLogo(stage, 0.55, 1004, 540, ink);
      logo.rects.forEach((d) => tl.fromTo(d, { scale: 0 }, { scale: 1, duration: 0.3, ease: 'back.out(2)' }, t0 + 0.6 + R() * 0.35));
    }
    const rule = el(stage, { left: W / 2 - 48 + 'px', top: '648px', width: '96px', height: '6px', background: C.coral });
    tl.fromTo(rule, { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: 'expo.out' }, t0 + 0.95);
    const title = wordsLine(stage, EP.title, centered({ top: '690px', font: `italic 400 62px ${F.serif}`, color: ink }));
    tl.from(title.spans, { yPercent: 115, duration: 0.7, stagger: 0.07, ease: 'expo.out' }, t0 + 1.05);
    const sub = el(stage, centered({ top: '800px', font: `600 22px ${F.sans}`, letterSpacing: '0.28em', textTransform: 'uppercase', color: dark ? '#bdbdbd' : C.mid }), `${EP.subtitle} &nbsp;·&nbsp; with ${EP.speaker}`);
    tl.fromTo(sub, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, t0 + 1.5);
    return { big, logo, by, rule, title, sub };
  }

  const SCENES = {};

  // ===== INTRO A — Pixel Assembly =====
  SCENES.introA = {
    name: 'Pixel Assembly', kind: 'intro',
    blurb: 'Scattered pixels fly in and lock into the XKDR logo; the braces snap on last. The logo tucks into the series lockup as BIG IDEAS builds column by column.',
    build(stage) {
      const S = makeTL(7), { tl, draws } = S, R = rng(11);
      stage.style.background = C.bg;
      const grid = gridBg(stage, 'rgba(0,0,0,0.045)');
      tl.fromTo(grid, { opacity: 0 }, { opacity: 1, duration: 0.8 }, 0);
      const logo = buildLogo(stage, 2.4, 960, 500);
      logo.rects.forEach((d) => {
        const t0 = d._c ? 1.45 + R() * 0.3 : 0.1 + R() * 1.15;
        const a = R() * Math.PI * 2, dist = 900 + R() * 700;
        tl.fromTo(d,
          { x: Math.cos(a) * dist, y: Math.sin(a) * dist, rotation: (R() - 0.5) * 540, scale: 0.3, opacity: 0, backgroundColor: d._c || R() < 0.5 ? C.coral : C.mid },
          { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, backgroundColor: d._c ? C.coral : C.ink, duration: d._c ? 0.55 : 1.0, ease: d._c ? 'back.out(2.5)' : 'expo.out' }, t0);
      });
      tl.to(logo.wrap, { scale: 1.035, duration: 0.1, yoyo: true, repeat: 1, ease: 'power2.out' }, 2.02);
      tl.to(logo.wrap, { scale: 0.55 / 2.4, x: 44, y: 40, duration: 0.85, ease: 'expo.inOut' }, 2.5);
      lockup(stage, tl, R, { t0: 3.0, logoFrom: logo });
      pixelWipe(stage, draws, { start: 6.2, dur: 0.75, mode: 'cover', seed: 5 });
      return S;
    },
  };

  // ===== INTRO B — Brace Frame =====
  SCENES.introB = {
    name: 'Brace Frame', kind: 'intro',
    blurb: 'A live data heatmap flickers on black until two giant coral braces slam in and clear a frame. BIG IDEAS types into the gap, then the braces snap shut.',
    build(stage) {
      const S = makeTL(7), { tl, draws } = S, R = rng(21);
      stage.style.background = C.ink;
      const cv = canvas(stage), ctx = cv.getContext('2d');
      const seeds = Array.from({ length: 48 * 27 }, () => R());
      const clearAt = (i) => 1.75 + Math.abs((i % 48) - 23.5) * 0.012 + seeds[i] * 0.15;
      draws.push((t) => {
        ctx.clearRect(0, 0, W, H);
        const fade = 1 - clamp((t - 2.6) / 0.6);
        if (fade <= 0) return;
        for (let i = 0; i < seeds.length; i++) {
          const x = i % 48, y = Math.floor(i / 48);
          const v = 0.5 + 0.5 * Math.sin(x * 0.33 + t * 3.1 + Math.sin(y * 0.45 + t * 1.3) * 1.8 + seeds[i] * 2.5);
          const inFrame = x >= 9 && x <= 38 && y >= 6 && y <= 20;
          const keep = inFrame ? 1 - clamp((t - clearAt(i)) / 0.25) : 1;
          const intro = clamp((t - seeds[i] * 0.5) / 0.3);
          const a = keep * intro * fade;
          if (a <= 0) continue;
          ctx.fillStyle = v > 0.94 && seeds[i] > 0.55 ? C.coral : `rgba(255,255,255,${0.04 + v * 0.16})`;
          ctx.globalAlpha = a;
          ctx.fillRect(x * 40 + 3, y * 40 + 3, 34, 34);
        }
        ctx.globalAlpha = 1;
      });
      const br = buildBraces(stage, 3.9);
      const bTop = 470 - br.L.h / 2;
      gsap.set(br.L.wrap, { left: 220, top: bTop }); gsap.set(br.R.wrap, { left: W - 220 - br.R.w, top: bTop });
      tl.fromTo(br.L.wrap, { x: -700 }, { x: 0, duration: 0.55, ease: 'expo.out' }, 1.35);
      tl.fromTo(br.R.wrap, { x: 700 }, { x: 0, duration: 0.55, ease: 'expo.out' }, 1.35);
      tl.to([br.L.wrap, br.R.wrap], { y: 6, duration: 0.05, yoyo: true, repeat: 3 }, 1.88);
      const txt = el(stage, { top: '372px', font: `900 150px ${F.sans}`, color: C.white, letterSpacing: '0.01em', whiteSpace: 'nowrap' });
      const chars = [...'BIG IDEAS'].map((ch) => { const s = document.createElement('span'); s.textContent = ch === ' ' ? '\u00a0' : ch; txt.appendChild(s); return s; });
      const cursor = document.createElement('span');
      Object.assign(cursor.style, { display: 'inline-block', width: '0.5em', height: '0.74em', background: C.coral, marginLeft: '0.06em', verticalAlign: '-0.02em', opacity: 0 });
      txt.appendChild(cursor);
      txt.style.left = W / 2 - txt.offsetWidth / 2 + 'px'; // measure the finished word, then type into it left-to-right
      chars.forEach((c) => (c.style.display = 'none'));
      tl.set(cursor, { opacity: 1 }, 2.1);
      chars.forEach((c, i) => tl.set(c, { display: 'inline' }, 2.25 + i * 0.09));
      [3.2, 3.5, 3.8, 4.1, 4.4, 4.7, 5.0, 5.3, 5.6, 5.9].forEach((t, i) => tl.set(cursor, { opacity: i % 2 }, t));
      const by = el(stage, { left: '762px', top: '600px', font: `700 46px ${F.josefin}`, color: C.white }, 'by');
      tl.fromTo(by, { opacity: 0 }, { opacity: 1, duration: 0.4 }, 3.25);
      const logo = buildLogo(stage, 0.5, 1004, 630, C.white);
      logo.rects.forEach((d) => tl.fromTo(d, { scale: 0 }, { scale: 1, duration: 0.3, ease: 'back.out(2)' }, 3.3 + R() * 0.35));
      const title = wordsLine(stage, EP.title, centered({ top: '800px', font: `italic 400 56px ${F.serif}`, color: C.white }));
      tl.from(title.spans, { yPercent: 115, duration: 0.7, stagger: 0.07, ease: 'expo.out' }, 3.9);
      const sub = el(stage, centered({ top: '900px', font: `600 21px ${F.sans}`, letterSpacing: '0.28em', textTransform: 'uppercase', color: '#a8a8a8' }), `${EP.subtitle} &nbsp;·&nbsp; with ${EP.speaker}`);
      tl.fromTo(sub, { opacity: 0 }, { opacity: 1, duration: 0.6 }, 4.4);
      const shut = 6.05;
      tl.to(br.L.wrap, { x: 960 - 220 - br.L.w, duration: 0.35, ease: 'expo.in' }, shut);
      tl.to(br.R.wrap, { x: -(960 - 220 - br.R.w), duration: 0.35, ease: 'expo.in' }, shut);
      tl.to([txt, by, logo.wrap], { scaleX: 0, opacity: 0, duration: 0.3, ease: 'expo.in' }, shut + 0.02);
      tl.to([title.line, sub], { opacity: 0, duration: 0.25 }, shut);
      pixelWipe(stage, draws, { start: 6.35, dur: 0.6, mode: 'cover', seed: 9 });
      return S;
    },
  };

  // ===== INTRO C — Ledger to Insight =====
  SCENES.introC = {
    name: 'Ledger to Insight', kind: 'intro',
    blurb: 'Opens on a scrolling government ledger, which gets stamped AUDITED. Its figures dissolve into rising bars, and the bars re-form into BIG IDEAS: accounting turning into anticipation.',
    build(stage) {
      const S = makeTL(7), { tl, draws } = S, R = rng(31);
      stage.style.background = C.bg;
      gridBg(stage, 'rgba(0,0,0,0.035)');
      const box = el(stage, { left: '240px', top: '150px', width: '1440px', height: '760px', overflow: 'hidden' });
      const head = el(box, { left: 0, top: 0, width: '100%', height: '64px', display: 'grid', gridTemplateColumns: '2.2fr 1fr 1fr 1fr 1fr', alignItems: 'center', font: `700 18px ${F.sans}`, letterSpacing: '0.16em', color: C.ink, borderBottom: `3px solid ${C.ink}`, background: C.bg, zIndex: 2 },
        ['Head of account', 'Sanctioned', 'Released', 'Spent', 'Balance'].map((h, i) => `<div style="text-align:${i ? 'right' : 'left'};text-transform:uppercase">${h}</div>`).join(''));
      const body = el(box, { left: 0, top: '64px', width: '100%' });
      const fmt = (n) => n.toLocaleString('en-IN');
      for (let i = 0; i < 44; i++) {
        const major = 2200 + Math.floor(R() * 900), a = Math.floor(R() * 90000) + 8000, b = Math.floor(a * (0.5 + R() * 0.5)), c = Math.floor(b * (0.4 + R() * 0.6));
        el(body, { position: 'relative', display: 'grid', gridTemplateColumns: '2.2fr 1fr 1fr 1fr 1fr', height: '52px', alignItems: 'center', font: `400 24px ${F.mono}`, color: C.mid, borderBottom: '1px solid rgba(0,0,0,0.12)', fontVariantNumeric: 'tabular-nums' },
          `<div>${major}-${String(Math.floor(R() * 99)).padStart(2, '0')}-${100 + Math.floor(R() * 800)}</div><div style="text-align:right">${fmt(a)}</div><div style="text-align:right">${fmt(b)}</div><div style="text-align:right">${fmt(c)}</div><div style="text-align:right">${fmt(a - c)}</div>`);
      }
      tl.fromTo(body, { y: 0 }, { y: -1100, duration: 2.2, ease: 'power1.in' }, 0);
      tl.fromTo(box, { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0);
      const stamp = el(stage, { left: '1180px', top: '560px', padding: '10px 26px', border: `7px solid ${C.coral}`, color: C.coral, font: `800 64px ${F.sans}`, letterSpacing: '0.12em', zIndex: 3 }, 'AUDITED');
      tl.fromTo(stamp, { scale: 2.4, rotation: -4, opacity: 0 }, { scale: 1, rotation: -11, opacity: 1, duration: 0.28, ease: 'power4.in' }, 0.85);
      tl.to(box, { y: 8, duration: 0.05, yoyo: true, repeat: 1 }, 1.13);
      tl.to([box, stamp], { opacity: 0, duration: 0.45, ease: 'power2.in' }, 1.75);

      // bars → letters
      const cell = 30, g = glyphCells('BIG IDEAS'), N = g.cells.length;
      const wordLeft = W / 2 - (g.w * cell) / 2, wordTop = 238;
      const target = g.cells.map((c) => ({ x: wordLeft + c.x * cell, y: wordTop + c.y * cell })).sort((a, b) => a.x - b.x || a.y - b.y);
      const shape = [0.3, 0.45, 0.4, 0.6, 0.55, 0.75, 0.7, 0.9, 1];
      const half = Math.floor(N / 2), sum = shape.reduce((a, b) => a + b, 0);
      const hts = shape.map((v) => Math.max(1, Math.round((v / sum) * half)));
      hts[hts.length - 1] += half - hts.reduce((a, b) => a + b, 0);
      const barsW = (shape.length * 3 - 1) * cell, bx0 = W / 2 - barsW / 2, base = 880;
      const barCells = [];
      hts.forEach((h, k) => { for (let r = 0; r < h; r++) for (let c = 0; c < 2; c++) barCells.push({ x: bx0 + k * 3 * cell + c * cell, y: base - (r + 1) * cell, k, r }); });
      if (N % 2) barCells.push({ x: bx0 + (shape.length - 1) * 3 * cell, y: base - (hts[hts.length - 1] + 1) * cell, k: shape.length - 1, r: hts[hts.length - 1] });
      barCells.sort((a, b) => a.x - b.x || a.y - b.y);
      const baseLine = el(stage, { left: bx0 - 40 + 'px', top: base + 'px', width: barsW + 80 + 'px', height: '4px', background: C.ink });
      tl.fromTo(baseLine, { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: 'expo.out' }, 1.85);
      tl.to(baseLine, { opacity: 0, duration: 0.3 }, 2.95);
      barCells.forEach((b, i) => {
        const t = target[i];
        const d = el(stage, { left: 0, top: 0, width: cell + 0.5 + 'px', height: cell + 0.5 + 'px', background: C.coral });
        gsap.set(d, { x: b.x, y: b.y });
        tl.fromTo(d, { opacity: 0, y: b.y + 60 }, { opacity: 1, y: b.y, duration: 0.3, ease: 'power3.out' }, 1.95 + b.k * 0.06 + b.r * 0.02);
        const m = 3.0 + R() * 0.25 + (t.x - wordLeft) / (g.w * cell) * 0.25;
        tl.to(d, { x: t.x, y: t.y, duration: 0.8, ease: 'expo.inOut' }, m);
        tl.to(d, { backgroundColor: C.ink, duration: 0.5 }, m + 0.5);
      });
      lockup(stage, tl, R, { t0: 3.35, logoFrom: null }).big.divs.forEach((d) => (d.style.display = 'none'));
      pixelWipe(stage, draws, { start: 6.2, dur: 0.75, mode: 'cover', seed: 13 });
      return S;
    },
  };

  // ===== OUTRO A — Takeaway & Rebuild =====
  SCENES.outroA = {
    name: 'Takeaway & Rebuild', kind: 'outro',
    blurb: 'Pixels clear to reveal the one-line takeaway. The XKDR logo then reassembles with the series name, xkdr.org and socials, and at the end the logo scatters back into pixels.',
    build(stage) {
      const S = makeTL(8), { tl, draws } = S, R = rng(41);
      stage.style.background = C.bg;
      gridBg(stage, 'rgba(0,0,0,0.04)');
      pixelWipe(stage, draws, { start: 0, dur: 0.7, mode: 'uncover', seed: 17 });
      const l1 = wordsLine(stage, EP.takeaway[0], centered({ top: '400px', font: `italic 400 72px ${F.serif}`, color: C.ink }));
      const l2 = wordsLine(stage, EP.takeaway[1], centered({ top: '510px', font: `800 72px ${F.sans}`, color: C.coral, letterSpacing: '-0.01em' }));
      tl.from(l1.spans, { yPercent: 115, duration: 0.8, stagger: 0.08, ease: 'expo.out' }, 0.45);
      tl.from(l2.spans, { yPercent: 115, duration: 0.8, stagger: 0.1, ease: 'expo.out' }, 1.05);
      tl.to([l1.line, l2.line], { y: -40, opacity: 0, duration: 0.5, ease: 'power2.in' }, 2.9);
      const big = pixelWord(stage, 'BIG IDEAS', 16, W / 2, 250, C.ink);
      big.divs.forEach((d) => tl.fromTo(d, { scale: 0 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' }, 3.3 + d._cell.x * 0.012));
      const by = el(stage, centered({ top: '392px', font: `700 40px ${F.josefin}`, color: C.ink }), 'by');
      tl.fromTo(by, { opacity: 0 }, { opacity: 1, duration: 0.4 }, 3.6);
      const logo = buildLogo(stage, 1.5, 960, 560);
      logo.rects.forEach((d) => {
        const a = R() * Math.PI * 2, dist = 700 + R() * 600;
        tl.fromTo(d, { x: Math.cos(a) * dist, y: Math.sin(a) * dist, rotation: (R() - 0.5) * 360, opacity: 0, backgroundColor: C.coral },
          { x: 0, y: 0, rotation: 0, opacity: 1, backgroundColor: d._c ? C.coral : C.ink, duration: 0.9, ease: 'expo.out' }, 3.4 + R() * 0.8);
        tl.to(d, { x: Math.cos(a) * dist * 0.9, y: Math.sin(a) * dist * 0.9, rotation: (R() - 0.5) * 360, opacity: 0, duration: 0.8, ease: 'expo.in' }, 7.1 + R() * 0.3);
      });
      const soc = socialRow(stage, 760, C.ink);
      tl.from(soc.items, { opacity: 0, y: 20, duration: 0.5, stagger: 0.08, ease: 'power3.out' }, 4.7);
      tl.to([...big.divs, by, ...soc.items], { opacity: 0, duration: 0.5 }, 7.1);
      return S;
    },
  };

  // ===== OUTRO B — Braces Close =====
  SCENES.outroB = {
    name: 'Braces Close', kind: 'outro',
    blurb: 'Two large coral braces frame the takeaway, then close in and shrink onto the X, becoming the braces of the XKDR logo as the other letters pop in around them.',
    build(stage) {
      const S = makeTL(8), { tl, draws } = S, R = rng(51);
      stage.style.background = C.bg;
      gridBg(stage, 'rgba(0,0,0,0.04)');
      pixelWipe(stage, draws, { start: 0, dur: 0.7, mode: 'uncover', seed: 19 });
      const s = 1.8, logo = buildLogo(stage, s, 960, 470);
      const k = 3.4, bigH = 125 * k;
      const L = window.XKDR_LOGO;
      const coral = logo.rects.filter((d) => d._c);
      const side = (sd) => coral.filter((d) => d._side === sd);
      const bbox = (ds) => ({ x0: Math.min(...ds.map((d) => d._r[0])), y0: Math.min(...ds.map((d) => d._r[1])) });
      const bb = { L: bbox(side('L')), R: bbox(side('R')) };
      const bigPos = { L: { x: 250, y: 470 - bigH / 2 }, R: { x: W - 250 - 22 * k, y: 470 - bigH / 2 } };
      coral.forEach((d) => {
        const b = bb[d._side], r = d._r;
        const fx = logo.left + r[0] * s, fy = logo.top + r[1] * s;
        const sx = bigPos[d._side].x + (r[0] - b.x0) * k, sy = bigPos[d._side].y + (r[1] - b.y0) * k;
        gsap.set(d, { transformOrigin: '0 0' });
        tl.fromTo(d, { x: sx - fx, y: sy - fy, scale: k / s, opacity: 0 }, { opacity: 1, duration: 0.3 }, 0.35 + R() * 0.3);
        tl.to(d, { x: 0, y: 0, scale: 1, duration: 0.9, ease: 'expo.inOut' }, 3.0 + (d._side === 'L' ? 0 : 0.04));
      });
      const q1 = wordsLine(stage, EP.takeaway[0], centered({ top: '380px', font: `italic 400 64px ${F.serif}`, color: C.ink }));
      const q2 = wordsLine(stage, EP.takeaway[1], centered({ top: '478px', font: `800 64px ${F.sans}`, color: C.coral }));
      tl.from(q1.spans, { yPercent: 115, duration: 0.8, stagger: 0.08, ease: 'expo.out' }, 0.8);
      tl.from(q2.spans, { yPercent: 115, duration: 0.8, stagger: 0.1, ease: 'expo.out' }, 1.35);
      tl.to([q1.line, q2.line], { scaleX: 0.2, opacity: 0, duration: 0.55, ease: 'expo.in' }, 2.95);
      logo.rects.filter((d) => !d._c).forEach((d) => tl.fromTo(d, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(2.5)' }, 3.75 + (d._r[0] / L.w) * 0.5 + R() * 0.12));
      const big = pixelWord(stage, 'BIG IDEAS', 12, W / 2, 196, C.ink);
      tl.from(big.divs, { scale: 0, duration: 0.25, stagger: { each: 0.004, from: 'start' }, ease: 'back.out(3)' }, 4.5);
      const line = el(stage, centered({ top: '640px', font: `600 24px ${F.sans}`, letterSpacing: '0.28em', textTransform: 'uppercase', color: C.mid }), `A series by XKDR &nbsp;·&nbsp; Featuring ${EP.speaker}`);
      tl.fromTo(line, { opacity: 0 }, { opacity: 1, duration: 0.5 }, 4.9);
      const soc = socialRow(stage, 740, C.ink);
      tl.from(soc.items, { opacity: 0, y: 20, duration: 0.5, stagger: 0.08, ease: 'power3.out' }, 5.1);
      return S;
    },
  };

  // ===== OUTRO C — Heatmap Credits =====
  SCENES.outroC = {
    name: 'Heatmap Credits', kind: 'outro',
    blurb: 'A coral data heatmap sweeps across a black field, then an off-white credits card builds itself out of pixels with the series lockup, speaker, xkdr.org and socials.',
    build(stage) {
      const S = makeTL(8), { tl, draws } = S, R = rng(61);
      stage.style.background = C.ink;
      const cv = canvas(stage), ctx = cv.getContext('2d');
      const seeds = Array.from({ length: 48 * 27 }, () => R());
      const cardX = 460, cardY = 170, cardW = 1000, cardH = 740;
      draws.push((t) => {
        ctx.clearRect(0, 0, W, H);
        for (let i = 0; i < seeds.length; i++) {
          const x = i % 48, y = Math.floor(i / 48);
          const sweep = clamp((t * 26 - x - seeds[i] * 6) / 6);
          if (sweep <= 0) continue;
          const v = 0.5 + 0.5 * Math.sin(x * 0.21 + y * 0.35 + t * 1.6) * Math.cos(y * 0.18 - t * 0.9 + seeds[i]);
          ctx.globalAlpha = sweep * (0.1 + v * 0.9);
          ctx.fillStyle = v > 0.72 ? C.coral : v > 0.45 ? '#5a3029' : '#1d1d1d';
          ctx.fillRect(x * 40 + 2, y * 40 + 2, 36, 36);
        }
        ctx.globalAlpha = 1;
        // card builds from pixels
        const cols = cardW / 40, rows = Math.ceil(cardH / 40);
        ctx.fillStyle = C.bg;
        for (let i = 0; i < cols * rows; i++) {
          const cx = i % cols, cy = Math.floor(i / cols);
          const p = clamp((t - 1.1 - (cx + cy) * 0.018 - seeds[i] * 0.2) / 0.25);
          if (p <= 0) continue;
          const sz = 40 * easeOut(p) + (p >= 1 ? 1 : 0);
          ctx.fillRect(cardX + cx * 40 + (40 - sz) / 2, cardY + cy * 40 + (40 - sz) / 2, sz, sz);
        }
      });
      const card = el(stage, { left: cardX + 'px', top: cardY + 'px', width: cardW + 'px', height: cardH + 'px' });
      const inner = (css, html) => el(card, Object.assign({ left: 0, width: cardW + 'px', textAlign: 'center' }, css), html);
      const big = pixelWord(card, 'BIG IDEAS', 18, cardW / 2, 80, C.ink);
      tl.from(big.divs, { scale: 0, duration: 0.3, stagger: { each: 0.005 }, ease: 'back.out(3)' }, 2.3);
      const by = el(card, { left: '300px', top: '262px', font: `700 40px ${F.josefin}`, color: C.ink }, 'by');
      const logo = buildLogo(card, 0.62, 548, 282);
      tl.fromTo(by, { opacity: 0 }, { opacity: 1, duration: 0.4 }, 2.8);
      logo.rects.forEach((d) => tl.fromTo(d, { scale: 0 }, { scale: 1, duration: 0.3, ease: 'back.out(2)' }, 2.8 + R() * 0.35));
      const rule = inner({ top: '370px', left: cardW / 2 - 48 + 'px', width: '96px', height: '6px', background: C.coral });
      tl.fromTo(rule, { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: 'expo.out' }, 3.3);
      const t1 = inner({ top: '410px', font: `italic 400 44px ${F.serif}`, color: C.ink }, EP.title);
      const t2 = inner({ top: '490px', font: `600 22px ${F.sans}`, letterSpacing: '0.26em', textTransform: 'uppercase', color: C.mid }, `Featuring ${EP.speaker}`);
      tl.from([t1, t2], { opacity: 0, y: 16, duration: 0.6, stagger: 0.15, ease: 'power3.out' }, 3.45);
      const soc = socialRow(card, 590, C.ink);
      Object.assign(soc.row.style, { width: cardW + 'px' });
      tl.from(soc.items, { opacity: 0, y: 16, duration: 0.5, stagger: 0.08, ease: 'power3.out' }, 3.9);
      return S;
    },
  };


  // ================= Calm set (v2) — fades, small rises, one coral rule =================
  const soft = 'power2.out';
  function rise(tl, targets, at, opts) {
    tl.fromTo(targets, { opacity: 0, y: (opts && opts.y) || 14 }, { opacity: 1, y: 0, duration: (opts && opts.d) || 0.9, ease: soft, stagger: (opts && opts.stagger) || 0 }, at);
  }
  function fadeAll(tl, stage, at, d) {
    tl.to(stage.children, { opacity: 0, duration: d || 0.7, ease: 'power1.inOut' }, at);
  }

  // ===== INTRO D — Quiet Title =====
  SCENES.introD = {
    name: 'Quiet Title', kind: 'intro',
    blurb: 'The series name fades up, the small XKDR logo settles beneath it, a coral rule draws, and the episode title follows. Then it crossfades into the footage.',
    build(stage) {
      const S = makeTL(5), { tl } = S;
      stage.style.background = C.bg;
      const name = el(stage, centered({ top: '330px', font: `800 104px ${F.sans}`, letterSpacing: '-0.015em', color: C.ink }), 'Big Ideas');
      const by = el(stage, { left: '812px', top: '482px', font: `700 34px ${F.josefin}`, color: C.mid }, 'by');
      const logo = buildLogo(stage, 0.42, 1000, 494);
      const rule = el(stage, { left: W / 2 - 32 + 'px', top: '576px', width: '64px', height: '4px', background: C.coral });
      const title = el(stage, centered({ top: '616px', font: `italic 400 48px ${F.serif}`, color: C.ink }), EP.title);
      const sub = el(stage, centered({ top: '706px', font: `600 19px ${F.sans}`, letterSpacing: '0.26em', textTransform: 'uppercase', color: C.mid }), `${EP.subtitle} &nbsp;·&nbsp; with ${EP.speaker}`);
      rise(tl, name, 0.3, { y: 18, d: 1.1 });
      rise(tl, [by, logo.wrap], 0.75, { y: 10 });
      tl.fromTo(rule, { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: 'power3.inOut' }, 1.15);
      rise(tl, title, 1.45);
      rise(tl, sub, 1.75, { y: 8 });
      fadeAll(tl, stage, 4.2, 0.8);
      return S;
    },
  };

  // ===== INTRO E — Brace Reveal =====
  SCENES.introE = {
    name: 'Brace Reveal', kind: 'intro',
    blurb: "A pair of XKDR's coral braces glides gently apart to reveal the series name, and the title settles in underneath. One slow movement, nothing else.",
    build(stage) {
      const S = makeTL(5), { tl } = S;
      stage.style.background = C.bg;
      const br = buildBraces(stage, 1.9);
      const cy = 400, bTop = cy - br.L.h / 2, gap = 330;
      gsap.set(br.L.wrap, { left: W / 2 - gap - br.L.w, top: bTop });
      gsap.set(br.R.wrap, { left: W / 2 + gap, top: bTop });
      tl.fromTo(br.L.wrap, { x: gap - 8, opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'none' }, 0.2);
      tl.fromTo(br.R.wrap, { x: -(gap - 8), opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'none' }, 0.2);
      tl.to([br.L.wrap, br.R.wrap], { x: 0, duration: 1.4, ease: 'power3.inOut' }, 0.6);
      const name = el(stage, centered({ top: cy - 64 + 'px', font: `800 100px ${F.sans}`, letterSpacing: '-0.015em', color: C.ink }), 'Big Ideas');
      tl.fromTo(name, { opacity: 0, scale: 0.97 }, { opacity: 1, scale: 1, duration: 1.1, ease: soft }, 1.0);
      const by = el(stage, { left: '836px', top: '560px', font: `700 30px ${F.josefin}`, color: C.mid }, 'by');
      const logo = buildLogo(stage, 0.36, 1000, 570);
      rise(tl, [by, logo.wrap], 1.6, { y: 8 });
      const title = el(stage, centered({ top: '660px', font: `italic 400 46px ${F.serif}`, color: C.ink }), EP.title);
      const sub = el(stage, centered({ top: '744px', font: `600 18px ${F.sans}`, letterSpacing: '0.26em', textTransform: 'uppercase', color: C.mid }), `${EP.subtitle} &nbsp;·&nbsp; with ${EP.speaker}`);
      rise(tl, title, 1.95);
      rise(tl, sub, 2.2, { y: 8 });
      fadeAll(tl, stage, 4.2, 0.8);
      return S;
    },
  };

  // ===== INTRO F — Editorial Card =====
  SCENES.introF = {
    name: 'Editorial Card', kind: 'intro',
    blurb: "A left-aligned title page in the style of an XKDR publication. The logo's pixels fade in from left to right, and the type follows line by line.",
    build(stage) {
      const S = makeTL(5), { tl } = S;
      stage.style.background = C.bg;
      const x = 200;
      const logo = buildLogo(stage, 0.5, x + 152.75, 250);
      logo.rects.forEach((d) => tl.fromTo(d, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: 'none' }, 0.25 + (d._r[0] / 611) * 0.7));
      const name = el(stage, { left: x + 'px', top: '360px', font: `800 150px ${F.sans}`, letterSpacing: '-0.025em', color: C.ink, lineHeight: 1 }, 'Big Ideas');
      const rule = el(stage, { left: x + 'px', top: '552px', width: '96px', height: '5px', background: C.coral, transformOrigin: '0 50%' });
      const title = el(stage, { left: x + 'px', top: '594px', font: `italic 400 58px ${F.serif}`, color: C.ink }, EP.title);
      const sub = el(stage, { left: x + 'px', top: '700px', font: `600 20px ${F.sans}`, letterSpacing: '0.24em', textTransform: 'uppercase', color: C.mid }, `${EP.subtitle} &nbsp;·&nbsp; with ${EP.speaker}`);
      rise(tl, name, 0.7, { y: 20, d: 1.1 });
      tl.fromTo(rule, { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: 'power3.inOut' }, 1.2);
      rise(tl, title, 1.4);
      rise(tl, sub, 1.7, { y: 8 });
      fadeAll(tl, stage, 4.2, 0.8);
      return S;
    },
  };

  // ===== OUTRO D — Quiet Close =====
  SCENES.outroD = {
    name: 'Quiet Close', kind: 'outro',
    blurb: 'The footage fades to off-white, the XKDR logo settles in with the series name, and xkdr.org and the social links fade up underneath. Holds, then fades out.',
    build(stage) {
      const S = makeTL(6), { tl } = S;
      stage.style.background = C.bg;
      const logo = buildLogo(stage, 1.0, 960, 430);
      const series = el(stage, centered({ top: '540px', font: `600 22px ${F.sans}`, letterSpacing: '0.34em', textTransform: 'uppercase', color: C.mid }), 'Big Ideas');
      const rule = el(stage, { left: W / 2 - 32 + 'px', top: '598px', width: '64px', height: '4px', background: C.coral });
      const soc = socialRow(stage, 640, C.ink);
      rise(tl, logo.wrap, 0.4, { y: 12, d: 1.1 });
      rise(tl, series, 0.9, { y: 8 });
      tl.fromTo(rule, { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: 'power3.inOut' }, 1.1);
      rise(tl, soc.items, 1.35, { y: 8, stagger: 0.08 });
      fadeAll(tl, stage, 5.2, 0.8);
      return S;
    },
  };

  // ===== OUTRO E — Takeaway, then Logo =====
  SCENES.outroE = {
    name: 'Takeaway, then Logo', kind: 'outro',
    blurb: 'One quiet line sums up the episode and then fades away. The XKDR logo and xkdr.org take its place.',
    build(stage) {
      const S = makeTL(7), { tl } = S;
      stage.style.background = C.bg;
      const l1 = el(stage, centered({ top: '420px', font: `italic 400 60px ${F.serif}`, color: C.ink }), EP.takeaway[0]);
      const l2 = el(stage, centered({ top: '512px', font: `700 60px ${F.sans}`, color: C.coral }), EP.takeaway[1]);
      rise(tl, l1, 0.3, { d: 1.1 });
      rise(tl, l2, 0.8, { d: 1.1 });
      tl.to([l1, l2], { opacity: 0, duration: 0.7, ease: 'power1.inOut' }, 3.0);
      const logo = buildLogo(stage, 0.9, 960, 440);
      const series = el(stage, centered({ top: '540px', font: `600 22px ${F.sans}`, letterSpacing: '0.34em', textTransform: 'uppercase', color: C.mid }), `Big Ideas &nbsp;·&nbsp; with ${EP.speaker}`);
      const soc = socialRow(stage, 620, C.ink);
      rise(tl, logo.wrap, 3.7, { y: 12, d: 1.1 });
      rise(tl, series, 4.1, { y: 8 });
      rise(tl, soc.items, 4.4, { y: 8, stagger: 0.08 });
      fadeAll(tl, stage, 6.3, 0.7);
      return S;
    },
  };

  // ===== OUTRO F — Editorial Credits =====
  SCENES.outroF = {
    name: 'Editorial Credits', kind: 'outro',
    blurb: "Matches the Editorial Card intro. The episode credits sit on the left, the XKDR logo and links sit on the right, and a thin coral rule divides them.",
    build(stage) {
      const S = makeTL(6), { tl } = S;
      stage.style.background = C.bg;
      const x = 200;
      const eyebrow = el(stage, { left: x + 'px', top: '360px', font: `600 20px ${F.sans}`, letterSpacing: '0.26em', textTransform: 'uppercase', color: C.mid }, 'Big Ideas');
      const title = el(stage, { left: x + 'px', top: '404px', font: `italic 400 54px ${F.serif}`, color: C.ink, width: '760px', lineHeight: 1.3 }, EP.title);
      const who = el(stage, { left: x + 'px', top: '600px', font: `700 30px ${F.sans}`, color: C.ink }, EP.speaker);
      const role = el(stage, { left: x + 'px', top: '644px', font: `400 22px ${F.sans}`, color: C.mid }, 'eGov Foundation');
      const divider = el(stage, { left: '1060px', top: '330px', width: '4px', height: '380px', background: C.coral, transformOrigin: '50% 0' });
      const logo = buildLogo(stage, 0.95, 1150 + 290, 470);
      const site = el(stage, { left: '1150px', top: '580px', font: `700 34px ${F.sans}`, letterSpacing: '0.04em', color: C.ink }, 'xkdr.org');
      const icons = ['linkedin', 'x', 'youtube'].map((n, i) => el(stage, { left: 1150 + i * 64 + 'px', top: '646px', width: '38px', height: '38px', color: C.ink }, window.XKDR_ICONS[n]));
      rise(tl, [eyebrow, title], 0.3, { stagger: 0.15 });
      rise(tl, [who, role], 0.8, { y: 8, stagger: 0.1 });
      tl.fromTo(divider, { scaleY: 0 }, { scaleY: 1, duration: 0.9, ease: 'power3.inOut' }, 0.5);
      rise(tl, logo.wrap, 1.0, { y: 10 });
      rise(tl, [site, ...icons], 1.3, { y: 8, stagger: 0.07 });
      fadeAll(tl, stage, 5.2, 0.8);
      return S;
    },
  };


  // ================= Brace Frame, softened (v3) =================
  // Faint breathing data grid on black; a few coral cells drift in and out slowly.
  function softGrid(stage, draws, R, { inAt = 0, outAt = 99, level = 1 } = {}) {
    const cv = canvas(stage), ctx = cv.getContext('2d');
    const seeds = Array.from({ length: 48 * 27 }, () => R());
    draws.push((t) => {
      ctx.clearRect(0, 0, W, H);
      const g = clamp((t - inAt) / 1.2) * (1 - clamp((t - outAt) / 0.8)) * level;
      if (g <= 0) return;
      for (let i = 0; i < seeds.length; i++) {
        const x = i % 48, y = Math.floor(i / 48), sd = seeds[i];
        const v = 0.5 + 0.5 * Math.sin(x * 0.22 + y * 0.31 + t * 0.9 + sd * 6.28);
        const edge = Math.min(1, Math.hypot((x - 23.5) / 24, (y - 13) / 13.5) * 1.15); // quieter in the centre
        const coral = sd > 0.965;
        ctx.globalAlpha = g * edge * (coral ? 0.18 + 0.4 * v : 0.035 + 0.06 * v);
        ctx.fillStyle = coral ? C.coral : C.white;
        ctx.fillRect(x * 40 + 3, y * 40 + 3, 34, 34);
      }
      ctx.globalAlpha = 1;
    });
  }
  function softBraces(stage, tl, { cy, gap, k, at }) {
    const br = buildBraces(stage, k), top = cy - br.L.h / 2;
    gsap.set(br.L.wrap, { left: W / 2 - gap - br.L.w, top });
    gsap.set(br.R.wrap, { left: W / 2 + gap, top });
    tl.fromTo(br.L.wrap, { x: 70, opacity: 0 }, { x: 0, opacity: 1, duration: 1.5, ease: 'power3.out' }, at);
    tl.fromTo(br.R.wrap, { x: -70, opacity: 0 }, { x: 0, opacity: 1, duration: 1.5, ease: 'power3.out' }, at);
    return br;
  }
  function typeWord(stage, tl, text, { top, size, at, cps = 0.085, cursorOff }) {
    const txt = el(stage, { top: top + 'px', font: `900 ${size}px ${F.sans}`, color: C.white, letterSpacing: '0.01em', whiteSpace: 'nowrap' });
    const chars = [...text].map((ch) => { const s = document.createElement('span'); s.textContent = ch === ' ' ? ' ' : ch; txt.appendChild(s); return s; });
    const cursor = document.createElement('span');
    Object.assign(cursor.style, { display: 'inline-block', width: '0.12em', height: '0.74em', background: C.coral, marginLeft: '0.08em', verticalAlign: '-0.02em', opacity: 0 });
    txt.appendChild(cursor);
    txt.style.left = W / 2 - txt.offsetWidth / 2 + 'px';
    chars.forEach((c) => (c.style.display = 'none'));
    tl.to(cursor, { opacity: 1, duration: 0.2 }, at - 0.25);
    chars.forEach((c, i) => tl.set(c, { display: 'inline' }, at + i * cps));
    tl.to(cursor, { opacity: 0, duration: 0.5 }, cursorOff);
    return txt;
  }
  function darkLockup(stage, tl, { at, byTop, titleTop }) {
    const by = el(stage, { left: '836px', top: byTop + 'px', font: `700 34px ${F.josefin}`, color: '#9a9a9a' }, 'by');
    const logo = buildLogo(stage, 0.4, 1004, byTop + 20, C.white);
    const title = el(stage, centered({ top: titleTop + 'px', font: `italic 400 50px ${F.serif}`, color: C.white }), EP.title);
    const sub = el(stage, centered({ top: titleTop + 90 + 'px', font: `600 19px ${F.sans}`, letterSpacing: '0.28em', textTransform: 'uppercase', color: '#9a9a9a' }), `${EP.subtitle} &nbsp;·&nbsp; with ${EP.speaker}`);
    rise(tl, [by, logo.wrap], at, { y: 10 });
    rise(tl, title, at + 0.4, { y: 12 });
    rise(tl, sub, at + 0.7, { y: 8 });
  }

  function braceIntro(stage, { grid, typed }) {
    const S = makeTL(6), { tl, draws } = S, R = rng(71);
    stage.style.background = C.ink;
    if (grid) softGrid(stage, draws, R, { inAt: 0, outAt: 5.0 });
    softBraces(stage, tl, { cy: 478, gap: 540, k: 3.2, at: 0.35 });
    if (typed) typeWord(stage, tl, 'BIG IDEAS', { top: 350, size: 150, at: 1.25, cursorOff: 2.6 });
    else {
      const name = el(stage, centered({ top: '350px', font: `900 150px ${F.sans}`, color: C.white, letterSpacing: '0.01em' }), 'BIG IDEAS');
      tl.fromTo(name, { opacity: 0, scale: 0.97 }, { opacity: 1, scale: 1, duration: 1.3, ease: soft }, 1.0);
    }
    darkLockup(stage, tl, { at: 2.2, byTop: 548, titleTop: 700 });
    fadeAll(tl, stage, 5.1, 0.9);
    return S;
  }
  function braceOutro(stage, { takeaway }) {
    const D = takeaway ? 8 : 6, S = makeTL(D), { tl, draws } = S, R = rng(81);
    stage.style.background = C.ink;
    softGrid(stage, draws, R, { inAt: 0, outAt: D - 1 });
    softBraces(stage, tl, { cy: 470, gap: 580, k: 3.2, at: 0.3 });
    let t = 0.9;
    if (takeaway) {
      const l1 = el(stage, centered({ top: '392px', font: `italic 400 64px ${F.serif}`, color: C.white }), EP.takeaway[0]);
      const l2 = el(stage, centered({ top: '490px', font: `700 64px ${F.sans}`, color: C.coral }), EP.takeaway[1]);
      rise(tl, l1, 0.9, { d: 1.1 });
      rise(tl, l2, 1.4, { d: 1.1 });
      tl.to([l1, l2], { opacity: 0, duration: 0.7, ease: 'power1.inOut' }, 3.6);
      t = 4.3;
    }
    const logo = buildLogo(stage, 0.85, 960, 420, C.white);
    const series = el(stage, centered({ top: '520px', font: `600 22px ${F.sans}`, letterSpacing: '0.32em', textTransform: 'uppercase', color: '#9a9a9a' }), `Big Ideas &nbsp;·&nbsp; with ${EP.speaker}`);
    const soc = socialRow(stage, 600, C.white);
    rise(tl, logo.wrap, t, { y: 12, d: 1.1 });
    rise(tl, series, t + 0.4, { y: 8 });
    rise(tl, soc.items, t + 0.7, { y: 8, stagger: 0.08 });
    fadeAll(tl, stage, D - 0.9, 0.9);
    return S;
  }

  SCENES.braceIntroSoft = { name: 'Brace Frame · Soft', kind: 'intro', blurb: 'Brace Frame, calmed down. A faint grid breathes on black, the coral braces glide in, BIG IDEAS types gently, and everything fades softly into the footage.', build: (st) => braceIntro(st, { grid: true, typed: true }) };
  SCENES.braceIntroQuiet = { name: 'Brace Frame · Quieter', kind: 'intro', blurb: 'Even quieter. Plain black with no grid, the braces glide in and BIG IDEAS fades up rather than typing. The simplest version.', build: (st) => braceIntro(st, { grid: false, typed: false }) };
  SCENES.braceOutroTake = { name: 'Brace Frame · Takeaway', kind: 'outro', blurb: 'The braces frame a one-line takeaway, which then gives way to the XKDR logo, xkdr.org and the social links.', build: (st) => braceOutro(st, { takeaway: true }) };
  SCENES.braceOutroLogo = { name: 'Brace Frame · Logo only', kind: 'outro', blurb: 'A shorter close with no takeaway line: the braces frame the XKDR logo and links, hold, then fade out.', build: (st) => braceOutro(st, { takeaway: false }) };


  // ================= Brace Frame, light (v4) — off-white, typewriter kept =================
  function lightGrid(stage, draws, R, { inAt = 0, outAt = 99 } = {}) {
    const cv = canvas(stage), ctx = cv.getContext('2d');
    const seeds = Array.from({ length: 48 * 27 }, () => R());
    draws.push((t) => {
      ctx.clearRect(0, 0, W, H);
      const g = clamp((t - inAt) / 1.0) * (1 - clamp((t - outAt) / 0.8));
      if (g <= 0) return;
      for (let i = 0; i < seeds.length; i++) {
        const x = i % 48, y = Math.floor(i / 48), sd = seeds[i];
        const v = 0.5 + 0.5 * Math.sin(x * 0.22 + y * 0.31 + t * 1.3 + sd * 6.28);
        const edge = Math.min(1, Math.hypot((x - 23.5) / 24, (y - 13) / 13.5) * 1.2);
        const coral = sd > 0.955;
        ctx.globalAlpha = g * edge * (coral ? 0.22 + 0.5 * v : 0.025 + 0.05 * v);
        ctx.fillStyle = coral ? C.coral : C.ink;
        ctx.fillRect(x * 40 + 3, y * 40 + 3, 34, 34);
      }
      ctx.globalAlpha = 1;
    });
  }
  function typeInk(stage, tl, text, { top, size, at, cps = 0.085, cursorOff }) {
    const txt = el(stage, { top: top + 'px', font: `900 ${size}px ${F.sans}`, color: C.ink, letterSpacing: '0.01em', whiteSpace: 'nowrap' });
    const chars = [...text].map((ch) => { const s = document.createElement('span'); s.textContent = ch === ' ' ? ' ' : ch; txt.appendChild(s); return s; });
    const cursor = document.createElement('span');
    Object.assign(cursor.style, { display: 'inline-block', width: '0.5em', height: '0.74em', background: C.coral, marginLeft: '0.06em', verticalAlign: '-0.02em', opacity: 0 });
    txt.appendChild(cursor);
    txt.style.left = W / 2 - txt.offsetWidth / 2 + 'px';
    chars.forEach((c) => (c.style.display = 'none'));
    tl.set(cursor, { opacity: 1 }, at - 0.3);
    chars.forEach((c, i) => tl.set(c, { display: 'inline' }, at + i * cps));
    // a few calm blinks, then the cursor bows out
    [0.35, 0.7, 1.05, 1.4].forEach((d, i) => tl.set(cursor, { opacity: i % 2 ? 1 : 0 }, at + text.length * cps + d));
    tl.set(cursor, { opacity: 0 }, cursorOff);
    return txt;
  }
  function inkLockup(stage, tl, { at, byTop, titleTop }) {
    const by = el(stage, { left: '836px', top: byTop + 'px', font: `700 34px ${F.josefin}`, color: C.mid }, 'by');
    const logo = buildLogo(stage, 0.4, 1004, byTop + 20);
    const title = el(stage, centered({ top: titleTop + 'px', font: `italic 400 50px ${F.serif}`, color: C.ink }), EP.title);
    const sub = el(stage, centered({ top: titleTop + 90 + 'px', font: `600 19px ${F.sans}`, letterSpacing: '0.28em', textTransform: 'uppercase', color: C.mid }), `${EP.subtitle} &nbsp;·&nbsp; with ${EP.speaker}`);
    rise(tl, [by, logo.wrap], at, { y: 10 });
    rise(tl, title, at + 0.4, { y: 12 });
    rise(tl, sub, at + 0.7, { y: 8 });
  }
  function braceIntroLight(stage, { grid }) {
    const S = makeTL(6), { tl, draws } = S, R = rng(91);
    stage.style.background = C.bg;
    if (grid) lightGrid(stage, draws, R, { inAt: 0, outAt: 5.0 });
    softBraces(stage, tl, { cy: 478, gap: 540, k: 3.2, at: 0.3 });
    typeInk(stage, tl, 'BIG IDEAS', { top: 350, size: 150, at: 1.2, cursorOff: 3.4 });
    inkLockup(stage, tl, { at: 2.25, byTop: 548, titleTop: 700 });
    fadeAll(tl, stage, 5.1, 0.9);
    return S;
  }
  function braceOutroLight(stage, { takeaway }) {
    const D = takeaway ? 8 : 6, S = makeTL(D), { tl, draws } = S, R = rng(101);
    stage.style.background = C.bg;
    lightGrid(stage, draws, R, { inAt: 0, outAt: D - 1 });
    softBraces(stage, tl, { cy: 470, gap: 580, k: 3.2, at: 0.3 });
    let t = 0.9;
    if (takeaway) {
      const l1 = el(stage, centered({ top: '392px', font: `italic 400 64px ${F.serif}`, color: C.ink }), EP.takeaway[0]);
      const l2 = el(stage, centered({ top: '490px', font: `800 64px ${F.sans}`, color: C.coral }), EP.takeaway[1]);
      rise(tl, l1, 0.9, { d: 1.1 });
      rise(tl, l2, 1.4, { d: 1.1 });
      tl.to([l1, l2], { opacity: 0, duration: 0.7, ease: 'power1.inOut' }, 3.6);
      t = 4.3;
    }
    const logo = buildLogo(stage, 0.85, 960, 420);
    const series = el(stage, centered({ top: '520px', font: `600 22px ${F.sans}`, letterSpacing: '0.32em', textTransform: 'uppercase', color: C.mid }), `Big Ideas &nbsp;·&nbsp; with ${EP.speaker}`);
    const soc = socialRow(stage, 600, C.ink);
    rise(tl, logo.wrap, t, { y: 12, d: 1.1 });
    rise(tl, series, t + 0.4, { y: 8 });
    rise(tl, soc.items, t + 0.7, { y: 8, stagger: 0.08 });
    fadeAll(tl, stage, D - 0.9, 0.9);
    return S;
  }
  SCENES.lightIntroGrid = { name: 'Brace Frame · Light', kind: 'intro', blurb: 'On XKDR off-white, with a faint grid that breathes and a few coral cells glowing. The braces glide in, BIG IDEAS types out with the coral cursor, and the title settles below.', build: (st) => braceIntroLight(st, { grid: true }) };
  SCENES.lightIntroPlain = { name: 'Brace Frame · Light, no grid', kind: 'intro', blurb: 'The same typewriter and braces on plain off-white, with no grid behind them. Cleaner, with a little less texture.', build: (st) => braceIntroLight(st, { grid: false }) };
  SCENES.lightOutroTake = { name: 'Brace Frame · Takeaway', kind: 'outro', blurb: 'The braces frame a one-line takeaway, which then gives way to the XKDR logo, xkdr.org and the social links.', build: (st) => braceOutroLight(st, { takeaway: true }) };
  SCENES.lightOutroLogo = { name: 'Brace Frame · Logo only', kind: 'outro', blurb: 'A shorter close: just the XKDR logo, the series name and links inside the braces.', build: (st) => braceOutroLight(st, { takeaway: false }) };

  window.XKDR_SCENES = {
    C, EP, SCENES, build: (name, stage) => SCENES[name].build(stage),
    H: { el, canvas, gridBg, makeTL, rng, clamp, easeOut, buildLogo, buildBraces, wordsLine, F, rise, softBraces, pixelWord, socialRow },
  };
})();
