import React, { useEffect, useRef } from 'react';
import { drawStorybookCharacter } from '../lib/characterRenderer';
import type { Agent } from '../types/village';

interface CharacterSpriteBadgeProps {
  agent: Agent;
  size?: number;
  selected?: boolean;
}

export const CharacterSpriteBadge: React.FC<CharacterSpriteBadgeProps> = ({
  agent,
  size = 48,
  selected = false,
}) => {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    drawStorybookCharacter(
      ctx,
      {
        ...agent,
        direction: 'down',
        walkFrame: 0,
        isMoving: false,
        state: 'idle_yard',
        speechBubble: null,
      },
      size / 2,
      size * 0.68,
      0,
      {
        selected,
        scale: size / 50,
        hideLabel: true,
        hideSpeech: true,
      }
    );
  }, [agent, selected, size]);

  return (
    <canvas
      ref={ref}
      style={{ width: size, height: size }}
      className="shrink-0 pointer-events-none"
    />
  );
};
