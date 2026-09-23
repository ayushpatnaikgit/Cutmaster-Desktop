// Big Ideas by XKDR — in-video graphics, timed to the transcript.
// Each clip is a full 1920x1080 off-white frame; Remotion lays Mayank on top:
//   half: speaker at x60 y60 840x960, graphics live in x 990..1840
// Times inside each clip are written in SOURCE seconds (transcript time) via at().
(function () {
  const { C, SCENES, H } = window.XKDR_SCENES;
  const { el, makeTL, gridBg, F, rise, softBraces } = H;
  const IMG = '../public/img/clean/';

  const CLIPS = [];
  function clip(key, mode, start, end, build) {
    CLIPS.push({ key, mode, start, end });
    SCENES[key] = {
      kind: 'clip',
      build(stage) {
        const S = makeTL(end - start), { tl } = S;
        stage.style.background = C.bg;
        const grid = gridBg(stage, 'rgba(0,0,0,0.028)');
        const at = (src) => Math.max(0, src - start);
        const layer = el(stage, { inset: 0 });
        build({ tl, at, stage: layer, S });
        tl.fromTo(layer, { opacity: 1 }, { opacity: 0, duration: 0.5, ease: 'power1.in' }, end - start - 0.55);
        tl.fromTo(grid, { opacity: 0 }, { opacity: 1, duration: 0.6 }, 0);
        return S;
      },
    };
  }

  // ---------- shared pieces ----------
  const eyebrow = (p, x, y, text) =>
    el(p, { left: x + 'px', top: y + 'px', display: 'flex', alignItems: 'center', gap: '14px', font: `700 20px ${F.sans}`, letterSpacing: '0.24em', textTransform: 'uppercase', color: C.ink },
      `<span style="width:14px;height:14px;background:${C.coral};display:inline-block"></span>${text}`);
  const text = (p, x, y, html, css) => el(p, Object.assign({ left: x + 'px', top: y + 'px' }, css), html);
  const head = (p, x, y, html, size, color, w) => text(p, x, y, html, { font: `800 ${size || 56}px/1.12 ${F.sans}`, letterSpacing: '-0.015em', color: color || C.ink, width: (w || 820) + 'px' });
  const serif = (p, x, y, html, size, w) => text(p, x, y, html, { font: `italic 400 ${size || 36}px/1.45 ${F.serif}`, color: C.ink, width: (w || 820) + 'px' });
  const img = (p, src, css) => { const i = el(p, Object.assign({ mixBlendMode: 'multiply', objectFit: 'contain' }, css), null, 'img'); i.src = IMG + src.replace('.jpg', '.png'); return i; };
  const chip = (p, x, y, label, filled) =>
    el(p, { left: x + 'px', top: y + 'px', padding: '12px 20px 11px', font: `700 24px ${F.sans}`, letterSpacing: '0.02em', border: `3px solid ${C.coral}`, background: filled ? C.coral : 'transparent', color: filled ? C.white : C.coral, whiteSpace: 'nowrap' }, label);
  const sq = (p, x, y, s, color) => el(p, { left: x + 'px', top: y + 'px', width: s + 'px', height: s + 'px', background: color });
  const illustrative = (p, x, y) => text(p, x, y, 'Illustrative', { font: `600 16px ${F.sans}`, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.mid, padding: '6px 10px', border: `1.5px solid ${C.grey}` });
  const GX = 990; // half-mode graphics column

  // ---------------------------------------------------------------------------
  // Episode graphics. One clip() per beat, in source-time order.
  //   clip(key, 'half', startSec, endSec, build)
  // Group clips back to back (one clip's end == the next one's start) so the
  // speaker settles into half-screen once and stays there — moving him in and
  // out for every beat reads as restless.
  // at(sourceSeconds) converts a transcript timestamp into clip time, so write
  // the times you got from scripts/find-words.py directly.
  // ---------------------------------------------------------------------------

  // Example: a headline beat with an illustration.
  clip('clipIdea', 'half', 7.4, 25.6, ({ tl, at, stage }) => {
    const e = eyebrow(stage, GX, 130, 'The big idea');
    const h1 = head(stage, GX, 190, 'The claim, in the speaker\u2019s own framing', 54);
    const h2 = head(stage, GX, 318, 'the part worth colouring', 54, C.coral);
    rise(tl, e, at(7.6)); rise(tl, h1, at(7.9)); rise(tl, h2, at(11.2));
    const illo = img(stage, 'ledger.jpg', { left: GX + 'px', top: '490px', width: '460px', height: '460px' });
    rise(tl, illo, at(12.0), { y: 16, d: 1.2 });
  });

  // Example: a chart beat. Invented numbers always carry the Illustrative mark.
  clip('clipChart', 'half', 89.2, 107.0, ({ tl, at, stage }) => {
    const e = eyebrow(stage, GX, 130, 'What the numbers do');
    const il = illustrative(stage, 1690, 124);
    rise(tl, [e, il], at(89.5));
    const base = 880, maxH = 400;
    const axis = el(stage, { left: GX + 'px', top: base + 'px', width: '850px', height: '3px', background: C.ink });
    rise(tl, axis, at(90.5), { y: 0 });
    [0.9, 0.35, 0.7, 0.22, 0.58, 0.8].forEach((v, i) => {
      const bar = el(stage, { left: GX + 16 + i * 140 + 'px', top: base - v * maxH + 'px', width: '54px', height: v * maxH + 'px', background: C.coral, transformOrigin: '50% 100%' });
      tl.from(bar, { scaleY: 0, duration: 0.9, ease: 'power3.out' }, at(93.8) + i * 0.08);
    });
  });

  window.XKDR_CLIPS = CLIPS;
})();
