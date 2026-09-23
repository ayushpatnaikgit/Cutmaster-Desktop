# Big Ideas by XKDR — episode template

Everything needed to turn one talking-head recording into a finished episode:
XKDR-branded intro and outro, illustrations, animated graphics timed to the
speaker's words, and a final 1080p MP4 with music.

Copy this folder per episode:

```bash
cp -r big-ideas-template big-ideas-<guest>
cd big-ideas-<guest> && npm install
```

`.env` (in the project or its parent) needs one line: `GEMINI=<key>`. That key
generates illustrations (Nano Banana Flash) and music (Lyria).

## The pipeline

| Step | Command | Output |
|---|---|---|
| 1. Sync the mic to the camera | `python3 scripts/sync-audio.py <camera.mov> <mic.wav>` | `public/audio/clean.wav` |
| 2. Transcribe with word times | `python3 scripts/transcribe.py` | `transcript.json` |
| 3. Fill in `episode.json` | — | titles, speaker, trim points |
| 4. Cut footage and voice | `python3 scripts/prepare-footage.py <camera.mov>` | `public/footage/speaker.mp4`, `public/audio/voice.wav` |
| 5. Generate illustrations | `node scripts/gen-image.mjs <name> 1:1 "<subject>"` | `public/img/<name>.jpg` |
| 6. Key out image backgrounds | see below | `public/img/clean/<name>.png` |
| 7. Write the graphics | edit `html/clips.js` | one `clip()` per beat |
| 8. Check a frame | `node scripts/render-html.mjs <scene> --stills 4 --outdir /tmp/s` | PNG stills |
| 9. Render graphics to MP4 | `./scripts/render-all.sh` | `public/clips/*.mp4` |
| 10. Generate music | `node scripts/gen-music.mjs <name> default "<prompt>"` (uses the music model chosen in settings) | `public/audio/<name>.mp3` |
| 11. Build the music bed | `python3 scripts/music-mix.py <track> -21` | `public/audio/music_mix.wav` |
| 12. Render the episode | `./scripts/render-final.sh out/episode.mp4` | the finished MP4 |

Step 6, once per batch of images, so illustrations sit on the off-white
background instead of on a visible grey square:

```bash
cd public/img && mkdir -p clean
for f in *.jpg; do
  convert "$f" -fuzz 7% -fill white -opaque "$(convert "$f" -format '%[pixel:p{6,6}]' info:)" "clean/${f%.jpg}.png"
done
```

Transcription needs faster-whisper once per machine:
`python3 -m venv .venv && .venv/bin/pip install faster-whisper`, then run step 2
with `.venv/bin/python`.

## Files

- `episode.json` — the only per-episode configuration: titles, speaker, org,
  takeaway line, chosen intro/outro, music, and where to trim the source.
- `html/scenes.js` — the brand library: intro and outro scenes, XKDR pixel logo,
  coral braces, pixel type, helpers. Shared across episodes; edit only to change
  the series look.
- `html/clips.js` — this episode's graphics. The file you actually write.
- `html/assets.js` — logo geometry and social icons, extracted from xkdr.org.
- `src/BigIdeas.tsx` — the Remotion edit: intro, footage, graphics, lower third,
  outro, audio.
- `brand/` — XKDR logo files and site CSS the palette came from.

## Brand

| | |
|---|---|
| Background | `#f2f1f0` warm off-white |
| Accent | `#f57d6a` coral |
| Ink | `#000000` |
| Muted | `#7a7a7a` |
| Display / UI | Montserrat (800 for headlines, 600 for eyebrows) |
| Quotes, captions | Merriweather italic |
| Logo wordmark | Josefin Sans |
| Motif | the pixel grid and the coral `{ }` braces of the XKDR logo |

Motion stays calm: fades, small rises, one rule drawing, bars growing. No flying
pixels, wipes or shakes — an earlier round of those was rejected as "too much".

## Layout

The speaker is never hidden. Graphics live in the right-hand column
(x 990–1860) while he sits in a half-screen panel on the left
(x 60, y 60, 840×960). `half` is the only layout used now; `pip` (a small corner
panel) still works in `src/BigIdeas.tsx` if a graphic ever needs full width.

Group consecutive graphics so he changes size as little as possible.
`node scripts/export-clips.mjs` prints the number of size changes — episode 1
landed on 6 across 3:38, which felt right. 17 felt restless.

## Honesty rules that survived review

- Charts with invented numbers carry the `illustrative(...)` mark.
- Quote cards use the speaker's exact words from `transcript.json`; anything
  paraphrased is presented as a statement, not a quotation.
- The lower third names the speaker's own organisation, which is often not XKDR.
- Nothing is cut from the talk itself — only silence at the head and tail.
- Avoid generated maps of India; AI-drawn borders are unreliable and the mistake
  is a sensitive one.
