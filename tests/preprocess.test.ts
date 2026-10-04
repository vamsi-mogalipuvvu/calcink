import { describe, it, expect } from 'vitest';
import { smooth, centerByMass } from '../src/recognition/preprocessor.js';
import type { Point } from '../src/canvas/stroke.js';

// ── smooth ────────────────────────────────────────────────────

function makePoints(coords: [number, number][]): Point[] {
  return coords.map(([x, y], i) => ({ x, y, t: i * 10, pressure: 0.5 }));
}

describe('smooth', () => {
  it('fewer than 5 points returns the same array (by reference)', () => {
    const pts = makePoints([[0,0],[10,10],[20,5],[30,15]]);
    expect(smooth(pts)).toBe(pts); // same reference
  });

  it('first and last points are unchanged after smoothing', () => {
    const pts = makePoints([[0,0],[10,100],[20,0],[30,100],[40,0],[50,100],[60,0]]);
    const out = smooth(pts);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it('y-variance is smaller after smoothing a zigzag', () => {
    // Alternating y=0 and y=100 — very high variance
    const pts = makePoints([[0,0],[10,100],[20,0],[30,100],[40,0],[50,100],[60,0]]);
    const before = pts.slice(1,-1).map(p => p.y);
    const out = smooth(pts);
    const after = out.slice(1,-1).map(p => p.y);
    const varOf = (arr: number[]) => {
      const m = arr.reduce((a,b) => a+b, 0) / arr.length;
      return arr.reduce((a,b) => a + (b-m)**2, 0) / arr.length;
    };
    expect(varOf(after)).toBeLessThan(varOf(before));
  });

  it('output length equals input length', () => {
    const pts = makePoints([[0,0],[5,10],[10,0],[15,10],[20,0]]);
    expect(smooth(pts).length).toBe(pts.length);
  });
});

// ── centerByMass ─────────────────────────────────────────────

describe('centerByMass', () => {
  it('all-zero tensor returned unchanged', () => {
    const t = new Float32Array(28 * 28);
    const out = centerByMass(t);
    expect(out).toBe(t); // same reference (sum < 1e-3 path)
  });

  it('blob near top-left corner is shifted to center of mass ≈ (13.5, 13.5)', () => {
    const N = 28;
    const t = new Float32Array(N * N);
    // 3×3 blob of 1s at top-left (rows 0-2, cols 0-2)
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++)
        t[y * N + x] = 1;

    const out = centerByMass(t);

    // Compute center of mass of the output
    let sum = 0, mx = 0, my = 0;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const v = out[y * N + x];
        sum += v; mx += v * x; my += v * y;
      }
    const comX = mx / sum;
    const comY = my / sum;

    expect(Math.abs(comX - 13.5)).toBeLessThan(1.5); // within 1 pixel
    expect(Math.abs(comY - 13.5)).toBeLessThan(1.5);
  });

  it('already-near-centre blob: center of mass within 1 px of 13.5 after shift', () => {
    const N = 28;
    const t = new Float32Array(N * N);
    // 3×3 blob centred at (13, 13)
    for (let y = 12; y <= 14; y++)
      for (let x = 12; x <= 14; x++)
        t[y * N + x] = 1;

    const out = centerByMass(t);

    let sum = 0, mx = 0, my = 0;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const v = out[y * N + x];
        sum += v; mx += v * x; my += v * y;
      }
    expect(Math.abs(mx / sum - 13.5)).toBeLessThan(1.5);
    expect(Math.abs(my / sum - 13.5)).toBeLessThan(1.5);
  });

  it('output has same total mass as input (no pixels lost in shift)', () => {
    const N = 28;
    const t = new Float32Array(N * N);
    // blob near bottom-right, small enough that shifted version stays in bounds
    for (let y = 18; y <= 20; y++)
      for (let x = 18; x <= 20; x++)
        t[y * N + x] = 1;

    const out = centerByMass(t);
    const sumIn  = t.reduce((a,b) => a+b, 0);
    const sumOut = out.reduce((a,b) => a+b, 0);
    // Shifted pixels should stay within 28×28, so mass is preserved
    expect(sumOut).toBeCloseTo(sumIn, 3);
  });
});
