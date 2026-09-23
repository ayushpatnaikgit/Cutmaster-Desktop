import React from 'react';
import { Composition } from 'remotion';
import { BigIdeas, FPS, TOTAL_FRAMES } from './BigIdeas';

export const Root: React.FC = () => (
  <Composition id="BigIdeas" component={BigIdeas} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
);
