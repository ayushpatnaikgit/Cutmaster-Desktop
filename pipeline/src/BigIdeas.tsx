import React from 'react';
import { AbsoluteFill, Audio, Easing, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/800.css';
import clips from './clips.json';
import episode from '../episode.json';

export const FPS = 25;
const BG = '#f2f1f0';
const CORAL = '#f57d6a';

// Timeline (seconds). Source = camera/transcript time.
const INTRO = episode.introSeconds; // length of the rendered intro clip
const OUTRO = episode.outroSeconds;
const SRC_START = episode.source.start;
const SRC_END = episode.source.end;
const FOOTAGE_FROM = INTRO * FPS;
const FOOTAGE_FRAMES = Math.round((SRC_END - SRC_START) * FPS);
const OUTRO_FROM = FOOTAGE_FROM + FOOTAGE_FRAMES;
export const TOTAL_FRAMES = OUTRO_FROM + OUTRO * FPS;

/** Frame (within the footage sequence) for a source timestamp. */
const src = (s: number) => Math.round((s - SRC_START) * FPS);

type Mode = 'full' | 'half' | 'pip';
type Rect = { x: number; y: number; w: number; h: number };
const RECTS: Record<Mode, Rect> = {
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
  return { rect, fullness: rect.w / 1920 };
}

const Speaker: React.FC = () => {
  const f = useCurrentFrame();
  const { rect, fullness } = speakerRect(f);
  const accent = interpolate(fullness, [0.2, 0.9], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <>
      <div style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, overflow: 'hidden' }}>
        <OffthreadVideo src={staticFile('footage/speaker.mp4')} muted style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '48% 40%' }} />
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
    <div style={{ position: 'absolute', left: 80, top: 826, opacity: out }}>
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
            <OffthreadVideo src={staticFile(`clips/${c.key}.mp4`)} muted />
          </AbsoluteFill>
        </Sequence>
      ))}
      <Speaker />
      <Sequence from={src(episode.lowerThird.atSource)} durationInFrames={Math.round(episode.lowerThird.seconds * FPS)} layout="none">
        <LowerThird />
      </Sequence>
      <AbsoluteFill style={{ background: BG, opacity: veil }} />
    </AbsoluteFill>
  );
};

export const BigIdeas: React.FC = () => (
  <AbsoluteFill style={{ background: BG }}>
    <Sequence durationInFrames={FOOTAGE_FROM}>
      <OffthreadVideo src={staticFile(`clips/${episode.intro}.mp4`)} muted />
    </Sequence>
    <Sequence from={FOOTAGE_FROM} durationInFrames={FOOTAGE_FRAMES}>
      <Footage />
      <Audio src={staticFile('audio/voice.wav')} />
    </Sequence>
    <Sequence from={OUTRO_FROM} durationInFrames={OUTRO * FPS}>
      <OffthreadVideo src={staticFile(`clips/${episode.outro}.mp4`)} muted />
    </Sequence>
    <Audio src={staticFile('audio/music_mix.wav')} />
  </AbsoluteFill>
);
