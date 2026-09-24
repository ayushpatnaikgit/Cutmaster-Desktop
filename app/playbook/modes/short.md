# Mode: influencer · short-form (9:16)

A vertical video for Reels, Shorts and TikTok. People decide in the first
second whether to keep watching, and most watch with the sound off.

## Format
- **Vertical 1080×1920.** In `episode.json` set `"format": "vertical"`,
  `"introSeconds": 0` and `"outroSeconds": 0`. The renderer frames the speaker
  full-height; while a graphic is on (clip mode `half`), the screen splits —
  graphic in the top half (a 1080×960 stage, see GRAPHICS.md), speaker in the
  bottom half. Word-by-word captions are drawn automatically from the
  transcript (`"captions": true` is the default in vertical).
- **Length:** 30–60 s unless they asked otherwise. Pick the strongest
  stretch of the talk; cut everything else.

## Editing
- **Hook first.** Open on the most surprising or useful sentence, even if it
  comes later in the talk — then the context. No intro card, no logo sting;
  a small logo in a corner is enough. The outro is one line and a handle.
- **Tight cuts.** Remove every pause, "um", false start and repeated phrase.
  Jump cuts are fine and expected; a slight zoom (1.0 → 1.08) on alternate
  cuts keeps them from feeling like mistakes.
- **Word-by-word captions, always** — the renderer draws them (big, bold, two
  to four words, the spoken word highlighted). Your job is to make sure the
  transcript's words are right: fix misheard names and jargon in
  `transcript.json` before the final render.
- **Graphics are punchy, not diagrams:** a big number, three words, an
  emoji-free icon, a quick chart with one bar that matters. On screen for
  1.5–3 s each.
- **Music:** upbeat, low under the voice, no long intro.

## Deliver
`out/episode.mp4` at 1080×1920, plus `out/youtube.md` with a short title,
three hashtags and a one-line description.
