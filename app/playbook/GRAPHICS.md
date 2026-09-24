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
- Everything you need to know about the kit is on this page — **don't open
  `scenes.js`, `scene.html`, `clips.js`, the examples or the scripts' source**.

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

**Vertical videos** (`"format": "vertical"` in episode.json — the short-form
mode): your stage is **1080×960**, the top half of the phone screen; the speaker
is in the bottom half. Use x 60–1020, y 60–900 (`GX` doesn't apply — lay out
for the narrow stage). Fewer, bigger elements: one number, three words, one
icon or one simple chart, 64 px text or larger. Captions are drawn separately;
don't put the spoken words in your graphic.

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
- Brand helpers in `XKDR_KIT` (every one returns the element; `p` is the
  parent, positions are absolute px):
  - `el(p, cssObject, html?, tag?)` — an absolutely positioned element
  - `text(p, x, y, html, css?)`, `head(p, x, y, html, size=56, color?, width=820)`,
    `serif(p, x, y, html, size=36, width=820)` (italic quote style),
    `eyebrow(p, x, y, 'LABEL')` (small caps label with a coral square)
  - `chip(p, x, y, label, filled?)`, `sq(p, x, y, size, color)`,
    `illustrative(p, x, y)` (the "Illustrative" tag)
  - `img(p, 'name.jpg', css)` — loads `public/img/clean/name.png`
  - `rise(tl, targets, at, { y: 14, d: 0.9, stagger: 0 })` — fade up into place
  - `C` = `{ bg '#f2f1f0', coral '#f57d6a', ink '#000', grey '#d6d6d6', mid '#7a7a7a', white '#fff' }`,
    `F` = `{ sans (Montserrat), serif (Merriweather), josefin, mono }`, `GX` = 990 (column left)
  - `H.rng(seed)` → a seeded `() => 0..1`
- Illustrations: `node scripts/gen-image.mjs <key>-<name> 1:1 "<subject, style, palette>"`,
  then key the background out (README step 6).
- Web captures the lead gives you (`public/web/*.png|mp4`) can be framed as a
  browser window inside your graphic.

## Illustrations that move

A still picture that fades in is the weakest thing you can put on screen.
Prefer illustrations **built in code**, so every part of them can move:

- **Draw it as SVG.** A globe with a satellite tracing its orbit
  (MotionPath), clouds drifting in layers, a wildfire spreading along a
  ridge, a molecule assembling atom by atom, a city whose lights switch on
  district by district, a river of data flowing between two systems. Build
  the shapes from paths, gradients and masks in the brand palette; keep the
  style flat and consistent (a few colours, rounded strokes, soft shadows).
- **Let it perform the idea.** The motion should *be* the explanation: the
  feedback loop actually loops, the rising line actually pushes the
  temperature up, the orbit actually sweeps the whole planet.
- **Keep it alive when it holds.** After it has built, a slow ambient motion
  (a drift, a rotation, a pulse, twinkling lights) driven by
  `S.draws.push((t) => …)` stops the frame from looking frozen.
- **Generated images, animated.** When a painted look is better
  (`scripts/gen-image.mjs`), don't just fade it in: reveal it through a
  mask as it's named, add a gentle push-in or parallax, or lay animated SVG
  on top of it (orbit lines, labels that point at parts, arrows that trace a
  path). You can generate separate layers (a background and a subject, each
  keyed out) and move them at different speeds.

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
- **Use the whole column.** Once built, the graphic should span the full
  height, from about y 110 to y 960. A half-empty column is the most common
  failure: make the visual bigger rather than leaving space under it.
- **Something on screen early.** The first visual element arrives within
  about a second of the clip starting, not only the title.
- **Readable.** Headlines 48–64 px, labels ≥ 22 px, strong contrast.
- **Honest.** Numbers the speaker didn't give carry `illustrative(...)`.
  Quotes are exact transcript words.
- The last 0.5 s fades out automatically; don't fight it.

## Work fast

The whole video waits for the slowest graphic, so aim to finish in about
**15 steps**:

1. Your brief has the words, timings, numbers and assets. Don't search the
   web, don't browse the workspace, don't re-read the transcript beyond your
   clip's range (one `read-transcript.py` call if the brief lacks timings).
   A number you don't have is shown with `illustrative(...)`, not looked up.
2. Write the whole file in one go.
3. Render the stills and look at them together, once (below). Fix, re-render
   only if something was broken, and deliver.

Don't prototype pieces in `node -e` or `python3 -c`; do the maths in the clip
itself. Don't generate images unless the brief asks for one — an SVG built
in code is faster and moves better.

## Keep your context lean

Every step re-sends everything you've seen, so print little: read the talk
with `python3 scripts/read-transcript.py --from <s> --to <e>`, view files in
ranges, and never print whole JSON files or logs.

## Prove it

1. Render 3–4 stills at the key moments — when each element has just
   arrived, and the busiest frame:
   `node scripts/render-html.mjs <key> --stills 1,3.5,6,9 --outdir review/<key>`
2. Look at all of them in **one** call:
   `python3 scripts/look.py review/<key>/*.png`
3. Fix what it says that a viewer would notice (overlaps, cut-off text, empty
   column, unreadable labels). **One round of looking**; look a second time
   only if you fixed something that was broken. Then deliver — the reviewer
   always finds something more, and the whole video is waiting for you.
4. A page error or a blank frame means your script threw — the render prints
   it. Fix it before anything else.

Don't render the full MP4 — the lead does that for all clips at once. Reply
with: the key, what it shows, when each element enters (source seconds), and
which stills you checked.
