import React from 'react';
import { Composition } from 'remotion';
import { BigIdeas, FPS, TOTAL_FRAMES, W, H } from './BigIdeas';

export const Root: React.FC = () => (
  <Composition id="BigIdeas" component={BigIdeas} durationInFrames={TOTAL_FRAMES} fps={FPS} width={W} height={H} />
);
