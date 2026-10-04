import { describe, it, expect } from 'vitest';
import { densify } from '../src/canvas/stroke.js';
import type { Point } from '../src/canvas/stroke.js';

describe('densify', () => {
  it('returns the same array for fewer than 2 points', () => {
    const pts: Point[] = [{ x: 0, y: 0, t: 0, pressure: 0.5 }];
    expect(densify(pts, 3)).toBe(pts);
  });

  it('keeps endpoints, increases count, and caps gaps', () => {
    const pts: Point[] = [
      { x: 0, y: 0, t: 0, pressure: 0.5 },
      { x: 10, y: 0, t: 10, pressure: 0.5 },
    ];
    const dense = densify(pts, 3);

    expect(dense.length).toBeGreaterThan(pts.length);
    expect(dense[0]).toBe(pts[0]);
    expect(dense[dense.length - 1]).toBe(pts[1]);
    for (let i = 1; i < dense.length; i++) {
      expect(Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y)).toBeLessThanOrEqual(3);
    }
  });
});
