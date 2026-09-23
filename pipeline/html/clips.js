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
  // Episode graphics: one file per graphic, html/clips/<key>.js, each calling
  //   XKDR_CLIP(key, 'half', startSec, endSec, ({ tl, at, stage, S }) => { ... })
  // One file each means several agents can write graphics at the same time
  // without touching each other's work. html/clips/_example-*.js show the
  // pattern (files starting with _ are never loaded).
  // Group clips back to back (one clip's end == the next one's start) so the
  // speaker settles into half-screen once and stays there.
  // at(sourceSeconds) converts a transcript timestamp into clip time, so write
  // the times you got from scripts/find-words.py directly.
  // ---------------------------------------------------------------------------

  window.XKDR_CLIP = clip;
  window.XKDR_KIT = { C, H, el, makeTL, gridBg, F, rise, softBraces, IMG, GX, eyebrow, text, head, serif, img, chip, sq, illustrative };
  window.XKDR_CLIPS = CLIPS;
})();
