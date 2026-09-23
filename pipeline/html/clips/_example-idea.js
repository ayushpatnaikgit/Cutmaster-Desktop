// Example graphic (never loaded: the file name starts with _).
// Copy the pattern into html/clips/<key>.js, named after the clip key.
(() => {
  const { C, el, rise, eyebrow, head, img, illustrative, GX } = XKDR_KIT;

  // Example: a headline beat with an illustration.
  XKDR_CLIP('clipIdea', 'half', 7.4, 25.6, ({ tl, at, stage }) => {
    const e = eyebrow(stage, GX, 130, 'The big idea');
    const h1 = head(stage, GX, 190, 'The claim, in the speaker\u2019s own framing', 54);
    const h2 = head(stage, GX, 318, 'the part worth colouring', 54, C.coral);
    rise(tl, e, at(7.6)); rise(tl, h1, at(7.9)); rise(tl, h2, at(11.2));
    const illo = img(stage, 'ledger.jpg', { left: GX + 'px', top: '490px', width: '460px', height: '460px' });
    rise(tl, illo, at(12.0), { y: 16, d: 1.2 });
  });
})();
