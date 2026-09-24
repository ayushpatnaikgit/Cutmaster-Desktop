import React from 'react';
import { AbsoluteFill, Audio, Easing, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/800.css';
import clips from './clips.json';
import captionWords from './captions.json';
import episode from '../episode.json';

export const FPS = 25;
// "format": "vertical" in episode.json → 1080×1920 for Reels/Shorts/TikTok:
// the speaker fills the frame, and while a graphic is on, the frame splits —
// graphic in the top half, speaker in the bottom half.
const EP = episode as typeof episode & { format?: string; captions?: boolean };
export const VERTICAL = EP.format === 'vertical';
export const W = VERTICAL ? 1080 : 1920, H = VERTICAL ? 1920 : 1080;
const CAPTIONS = EP.captions ?? VERTICAL;
const BG = '#f2f1f0';
const CORAL = '#f57d6a';

// Timeline (seconds). Source = camera/transcript time.
const INTRO = episode.introSeconds; // length of the rendered intro clip
const OUTRO = episode.outroSeconds;
const SRC_START = episode.source.start;
const SRC_END = episode.source.end;
if (!(SRC_END > SRC_START)) {
  throw new Error('episode.json source.end is not set. Set source.start and source.end (seconds in the camera file) from the transcript: just before the first word and just after the last.');
}
const FOOTAGE_FROM = INTRO * FPS;
const FOOTAGE_FRAMES = Math.round((SRC_END - SRC_START) * FPS);
const OUTRO_FROM = FOOTAGE_FROM + FOOTAGE_FRAMES;
export const TOTAL_FRAMES = OUTRO_FROM + OUTRO * FPS;

/** Frame (within the footage sequence) for a source timestamp. */
const src = (s: number) => Math.round((s - SRC_START) * FPS);

type Mode = 'full' | 'half' | 'pip';
type Rect = { x: number; y: number; w: number; h: number };
const RECTS: Record<Mode, Rect> = VERTICAL ? {
  full: { x: 0, y: 0, w: 1080, h: 1920 },
  half: { x: 0, y: 960, w: 1080, h: 960 },
  pip: { x: 700, y: 1380, w: 320, h: 420 },
} : {
  full: { x: 0, y: 0, w: 1920, h: 1080 },
  half: { x: 60, y: 60, w: 840, h: 960 },
  pip: { x: 1500, y: 600, w: 360, h: 420 },
};
const MOVE = 16; // frames for the speaker to change size

// Contiguous segments of speaker modes covering the footage.
const segments: { from: number; mode: Mode }[] = (() => {
  const out: { from: number; mode: Mode }[] = [{ from: 0, mode: 'full' }];
  clips.forEach((c, i) => {
    out.push({ from: src(c.start), mode: c.mode as Mode });
    const next = clips[i + 1];
    if (!next || Math.abs(next.start - c.end) > 0.05) out.push({ from: src(c.end), mode: 'full' });
  });
  return out;
})();

const lerp = (a: Rect, b: Rect, p: number): Rect => ({
  x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, w: a.w + (b.w - a.w) * p, h: a.h + (b.h - a.h) * p,
});
const ease = Easing.inOut(Easing.cubic);

function speakerRect(f: number): { rect: Rect; fullness: number } {
  let i = 0;
  while (i + 1 < segments.length && segments[i + 1].from <= f) i++;
  const cur = segments[i], prev = segments[Math.max(0, i - 1)];
  const p = i === 0 ? 1 : ease(Math.min(1, Math.max(0, (f - cur.from) / MOVE)));
  const rect = lerp(RECTS[prev.mode], RECTS[cur.mode], p);
  return { rect, fullness: VERTICAL ? rect.h / 1920 : rect.w / 1920 };
}

const Speaker: React.FC = () => {
  const f = useCurrentFrame();
  const { rect, fullness } = speakerRect(f);
  const accent = interpolate(fullness, [0.2, 0.9], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <>
      <div style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, overflow: 'hidden' }}>
        <OffthreadVideo src={staticFile('footage/speaker.mp4')} muted style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: VERTICAL ? '50% 30%' : '48% 40%' }} />
      </div>
      <div style={{ position: 'absolute', left: rect.x - 9, top: rect.y - 9, width: 18, height: 18, background: CORAL, opacity: accent }} />
    </>
  );
};

const LowerThird: React.FC = () => {
  const f = useCurrentFrame();
  const inP = interpolate(f, [0, 14], [0, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const out = interpolate(f, [100, 114], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const rise = (d: number) => interpolate(f, [4 + d, 20 + d], [14, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const fade = (d: number) => interpolate(f, [4 + d, 20 + d], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: VERTICAL ? 50 : 80, top: VERTICAL ? 120 : 826, opacity: out }}>
      <div style={{ background: BG, padding: '22px 34px 22px 30px', clipPath: `inset(0 ${100 - inP * 100}% 0 0)`, display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ width: 16, height: 16, background: CORAL, marginTop: 14 }} />
        <div>
          <div style={{ font: "800 44px 'Montserrat', sans-serif", color: '#000', transform: `translateY(${rise(0)}px)`, opacity: fade(0) }}>{episode.speaker}</div>
          <div style={{ font: "600 19px 'Montserrat', sans-serif", letterSpacing: '0.26em', textTransform: 'uppercase', color: '#7a7a7a', marginTop: 6, transform: `translateY(${rise(4)}px)`, opacity: fade(4) }}>
            {episode.org}
          </div>
        </div>
      </div>
    </div>
  );
};

// Word-by-word captions: two to four words at a time, the spoken word
// highlighted. Timings come from the transcript (scripts/export-clips.mjs).
type Word = { w: string; s: number; e: number };
const CHUNKS: Word[][] = (() => {
  const out: Word[][] = []; let cur: Word[] = [];
  (captionWords as Word[]).forEach((w, i, all) => {
    cur.push(w);
    const next = all[i + 1];
    if (cur.length >= 3 || /[.,!?;:]$/.test(w.w.trim()) || !next || next.s - w.e > 0.45) { out.push(cur); cur = []; }
  });
  return out;
})();
const Captions: React.FC = () => {
  const f = useCurrentFrame();
  const t = SRC_START + f / FPS;
  const chunk = CHUNKS.find((c) => t >= c[0].s - 0.05 && t <= c[c.length - 1].e + 0.15);
  if (!chunk) return null;
  const size = VERTICAL ? 76 : 52;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: VERTICAL ? 1330 : 900, display: 'flex', justifyContent: 'center', padding: '0 60px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0 18px', font: `800 ${size}px/1.15 'Montserrat', sans-serif`, color: '#fff', textAlign: 'center', textTransform: VERTICAL ? 'uppercase' : 'none', WebkitTextStroke: `${VERTICAL ? 3 : 2}px #000`, paintOrder: 'stroke fill', textShadow: '0 6px 18px rgba(0,0,0,.45)' }}>
        {chunk.map((w, i) => {
          const on = t >= w.s && t <= w.e + 0.08;
          return <span key={i} style={{ padding: '2px 10px', borderRadius: 12, background: on ? CORAL : 'transparent', WebkitTextStroke: on ? '0px' : undefined }}>{w.w.trim()}</span>;
        })}
      </div>
    </div>
  );
};

const Footage: React.FC = () => {
  const f = useCurrentFrame();
  const veil = Math.max(
    interpolate(f, [0, 15], [1, 0], { extrapolateRight: 'clamp' }),
    interpolate(f, [FOOTAGE_FRAMES - 15, FOOTAGE_FRAMES], [0, 1], { extrapolateLeft: 'clamp' }),
  );
  return (
    <AbsoluteFill style={{ background: BG }}>
      {clips.map((c) => (
        <Sequence key={c.key} from={src(c.start)} durationInFrames={src(c.end) - src(c.start)} layout="none">
          <AbsoluteFill>
            <OffthreadVideo src={staticFile(`clips/${c.key}.mp4`)} muted style={VERTICAL ? { position: 'absolute', left: 0, top: 0, width: 1080, height: 960, objectFit: 'cover' } : undefined} />
          </AbsoluteFill>
        </Sequence>
      ))}
      <Speaker />
      <Sequence from={src(episode.lowerThird.atSource)} durationInFrames={Math.round(episode.lowerThird.seconds * FPS)} layout="none">
        <LowerThird />
      </Sequence>
      {CAPTIONS ? <Captions /> : null}
      <AbsoluteFill style={{ background: BG, opacity: veil }} />
    </AbsoluteFill>
  );
};

export const BigIdeas: React.FC = () => (
  <AbsoluteFill style={{ background: BG }}>
    {FOOTAGE_FROM > 0 ? (
      <Sequence durationInFrames={FOOTAGE_FROM}>
        <OffthreadVideo src={staticFile(`clips/${episode.intro}.mp4`)} muted />
      </Sequence>
    ) : null}
    <Sequence from={FOOTAGE_FROM} durationInFrames={FOOTAGE_FRAMES}>
      <Footage />
      <Audio src={staticFile('audio/voice.wav')} />
    </Sequence>
    {OUTRO > 0 ? (
      <Sequence from={OUTRO_FROM} durationInFrames={OUTRO * FPS}>
        <OffthreadVideo src={staticFile(`clips/${episode.outro}.mp4`)} muted />
      </Sequence>
    ) : null}
    <Audio src={staticFile('audio/music_mix.wav')} />
  </AbsoluteFill>
);
