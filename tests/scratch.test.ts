import { describe, it, expect } from 'vitest';
import { isScratchGesture, strokesUnderScratch } from '../src/canvas/scratch.js';
import type { Point, Stroke } from '../src/canvas/stroke.js';

function point(x: number, y: number, i: number): Point {
  return { x, y, t: i * 10, pressure: 0.5 };
}

function stroke(id: string, coords: [number, number][]): Stroke {
  return {
    id,
    width: 3,
    color: '#000',
    points: coords.map(([x, y], i) => point(x, y, i)),
  };
}

function zigzagScratch(): Point[] {
  const pts: Point[] = [];
  const xs = [0, 60, 0, 60, 0, 60, 0, 60, 0];
  for (let i = 0; i < xs.length; i++) {
    pts.push(point(xs[i], (i % 2) * 30, pts.length));
    if (i < xs.length - 1) {
      pts.push(point((xs[i] + xs[i + 1]) / 2, 15, pts.length));
    }
  }
  return pts;
}

describe('isScratchGesture', () => {
  it('detects a zigzag with 8 swings over a 60x30 px area', () => {
    expect(isScratchGesture(zigzagScratch())).toBe(true);
  });

  it('does not detect a smooth 8-like closed loop pair', () => {
    const pts: Point[] = [];
    for (let i = 0; i < 24; i++) {
      const t = (Math.PI * 2 * i) / 23;
      pts.push(point(30 + Math.sin(t) * 18, 20 + Math.sin(t * 2) * 12, i));
    }
    expect(isScratchGesture(pts)).toBe(false);
  });

  it('does not detect a straight line', () => {
    const pts = Array.from({ length: 16 }, (_, i) => point(i * 5, 0, i));
    expect(isScratchGesture(pts)).toBe(false);
  });

  it('does not detect a small S curve', () => {
    const pts: Point[] = [];
    for (let i = 0; i < 16; i++) {
      const t = i / 15;
      pts.push(point(10 + Math.sin(t * Math.PI * 2) * 8, 10 + t * 18, i));
    }
    expect(isScratchGesture(pts)).toBe(false);
  });

  it('does not detect a 2-point stroke', () => {
    expect(isScratchGesture([point(0, 0, 0), point(60, 0, 1)])).toBe(false);
  });
});

describe('strokesUnderScratch', () => {
  it('returns only strokes mostly inside the scribble bbox', () => {
    const scratch = stroke('scratch', [[0, 0], [60, 30]]);
    const mostlyInside = stroke('inside', [[5, 5], [20, 10], [30, 20], [80, 80]]);
    const mostlyOutside = stroke('edge', [[5, 5], [90, 90], [100, 90], [110, 90]]);
    const farAway = stroke('far', [[200, 200], [210, 210], [220, 220]]);

    expect(strokesUnderScratch(scratch, [mostlyInside, mostlyOutside, farAway])).toEqual(['inside']);
  });
});
