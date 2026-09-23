# How to make one graphic

You are the motion designer for **one** graphic in a video. The lead editor
gave you a brief: the clip key, its start and end (source seconds), what the
speaker says with word timings, what the graphic should make land, the brand
palette and fonts, and any assets to use. Your job is to turn it into a
beautiful, calm, well-timed animation — and to prove it looks right.

## Where your work goes

- Write **only** `html/clips/<key>.js` (the file name is the key). Other
  designers are writing other clips in the same folder at the same time; never
  touch their files, `html/clips.js`, `html/scenes.js`, `episode.json` or `src/`.
- New images: `public/img/<key>-<name>.jpg`, and their keyed-out versions in
  `public/img/clean/`. Review stills go in `review/<key>/`.
- `html/clips/_example-*.js` show the pattern. Read one first.

```js
// html/clips/clipCo2.js
(() => {
  const { C, F, el, rise, eyebrow, head, img, illustrative, GX } = XKDR_KIT;
  XKDR_CLIP('clipCo2', 'half', 56.2, 68.9, ({ tl, at, stage, S }) => {
    // build the frame in `stage` (1920x1080); animate with `tl` (a paused GSAP
    // timeline); `at(sourceSeconds)` turns a transcript time into clip time.
  });
})();
```

In `half` mode the speaker sits on the left (x 60, y 60, 840×960) and your
graphic owns the column **x 990–1860, y 90–990**. Never put anything over the
speaker.

## Every frame is a function of time

The clip is rendered by seeking to each frame and taking a screenshot. So:

- Everything that moves must be driven by `tl` (GSAP tweens placed with
  `at(...)`) or by a draw function: `S.draws.push((t) => { ... })` is called
  with the clip time on every frame — use it for canvas, SVG paths computed
  from `t`, counters, anything procedural.
- **Never** use CSS animations or transitions, `requestAnimationFrame`,
  `setTimeout`, `Date.now()` or unseeded `Math.random()`. They don't seek, so
  the render will stutter or freeze. Seeded randomness: `XKDR_KIT.H.rng(seed)`.

## What you have

- Plain HTML, CSS and SVG — build anything. Inline `<svg>` via `innerHTML`,
  gradients, masks, clip-paths, filters, blend modes, `backdrop-filter`.
- **GSAP 3** with DrawSVG (lines drawing themselves), MorphSVG, MotionPath
  (things travelling along a path), SplitText (words/letters arriving),
  ScrambleText, TextPlugin, CustomEase — all registered.
- **d3** (`d3.scaleLinear`, `d3.line`, `d3.area`, `d3.curveCatmullRom`,
  `d3.geoPath`…) for charts and layouts — use d3 for the maths and GSAP for
  the motion.
- Brand helpers in `XKDR_KIT`: `eyebrow`, `head`, `serif`, `chip`, `img`,
  `illustrative`, `rise`, colours `C`, fonts `F`.
- Illustrations: `node scripts/gen-image.mjs <key>-<name> 1:1 "<subject, style, palette>"`,
  then key the background out (README step 6).
- Web captures the lead gives you (`public/web/*.png|mp4`) can be framed as a
  browser window inside your graphic.

## What good looks like

- **One idea per graphic, landed hard.** A headline, a supporting line, and a
  visual that fills most of the column: a chart with every value labelled, a
  diagram whose parts arrive as they are named, an illustration at 400–650px.
- **Time to the words.** Each element enters when its word is spoken (the
  brief has the word timings; `python3 scripts/find-words.py "<phrase>"` finds
  more). Nothing arrives before it's said.
- **Calm, confident motion.** Ease out (`power2.out`, `power3.out`,
  `expo.out`), 0.5–1.2 s entrances, small rises (12–24 px), lines drawing,
  numbers counting, bars growing, a gentle scale from 0.98. Stagger siblings by
  60–120 ms. No bounces, shakes, spins, flying particles or wipes.
- **Rich, not busy.** Depth from soft shadows and layering; a subtle ambient
  motion (a slow drift, a breathing highlight) keeps a held frame alive.
- **Readable.** Headlines 48–64 px, labels ≥ 22 px, strong contrast.
- **Honest.** Numbers the speaker didn't give carry `illustrative(...)`.
  Quotes are exact transcript words.
- The last 0.5 s fades out automatically; don't fight it.

## Prove it

1. Render stills at the key moments — when each element has just arrived, and
   the busiest frame:
   `node scripts/render-html.mjs <key> --stills 1,3.5,6,9 --outdir review/<key>`
2. Look at each: `python3 scripts/look.py review/<key>/<key>_6.png`
3. Fix what it says. Look again. **At most three rounds of looking** — then
   deliver. The reviewer always finds something; past the third round you're
   polishing details nobody will notice while the whole video waits for you.
4. A page error or a blank frame means your script threw — the render prints
   it. Fix it before anything else.

Don't render the full MP4 — the lead does that for all clips at once. Reply
with: the key, what it shows, when each element enters (source seconds), and
which stills you checked.
