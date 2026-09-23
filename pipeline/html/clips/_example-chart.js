// Example graphic (never loaded: the file name starts with _).
// Copy the pattern into html/clips/<key>.js, named after the clip key.
(() => {
  const { C, el, rise, eyebrow, head, img, illustrative, GX } = XKDR_KIT;

  // Example: a chart beat. Invented numbers always carry the Illustrative mark.
  XKDR_CLIP('clipChart', 'half', 89.2, 107.0, ({ tl, at, stage }) => {
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
})();
