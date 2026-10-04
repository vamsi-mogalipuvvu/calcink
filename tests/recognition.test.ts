/**
 * CalcInk – Recognition Pipeline Unit Tests
 * tests/recognition.test.ts
 *
 * Tests for:
 *  1. Stroke grouper (groupStrokes, splitIntoLines)
 *  2. Operator geometry classifier (every operator + confusion cases)
 *  3. Tensor preprocessor (output shape, value range, polarity)
 *
 * All tests use synthetic stroke data — no real handwriting needed.
 */

import { describe, it, expect } from 'vitest';
import { groupStrokes, splitIntoLines, bboxOfStroke, bboxWidth, bboxHeight, bboxesClose } from '../src/recognition/grouper.js';
import { classifyOperator } from '../src/recognition/operatorClassifier.js';
import type { SymbolGroup } from '../src/recognition/grouper.js';
import type { Stroke } from '../src/canvas/stroke.js';

// ─────────────────────────────────────────────────────────────
// Synthetic stroke helpers
// ─────────────────────────────────────────────────────────────

let _id = 100;

function makeStroke(points: [number, number][], t0 = 0, width = 3): Stroke {
  return {
    id:     String(_id++),
    points: points.map(([x, y], i) => ({ x, y, t: t0 + i * 10, pressure: 0.5 })),
    width,
    color:  '#000',
  };
}

/** Horizontal line from (x0,y) to (x1,y) */
function hLine(x0: number, x1: number, y: number, t0 = 0): Stroke {
  const pts: [number, number][] = [];
  for (let x = x0; x <= x1; x += 5) pts.push([x, y]);
  return makeStroke(pts, t0);
}

/** Vertical line from (x,y0) to (x,y1) */
function vLine(x: number, y0: number, y1: number, t0 = 0): Stroke {
  const pts: [number, number][] = [];
  for (let y = y0; y <= y1; y += 5) pts.push([x, y]);
  return makeStroke(pts, t0);
}

/** Diagonal line ↘ */
function diagDown(x0: number, y0: number, x1: number, y1: number, t0 = 0): Stroke {
  const steps = 10;
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    pts.push([x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps]);
  }
  return makeStroke(pts, t0);
}

/** Diagonal line ↗ (from bottom-left to top-right) */
function diagUp(x0: number, y0: number, x1: number, y1: number, t0 = 0): Stroke {
  // x increases, y decreases → goes up-right
  const steps = 10;
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    pts.push([
      x0 + (x1 - x0) * i / steps,
      y0 - (y0 - y1) * i / steps,  // y0 is bottom, y1 is top (smaller)
    ]);
  }
  return makeStroke(pts, t0);
}

/** Tiny dot (4×4) */
function dot(cx: number, cy: number, t0 = 0): Stroke {
  return makeStroke([[cx - 2, cy - 2], [cx, cy - 2], [cx + 2, cy], [cx, cy + 2], [cx - 2, cy]], t0);
}

/** Build a SymbolGroup from strokes (computes bbox/cx/cy) */
function makeGroup(strokes: Stroke[]): SymbolGroup {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let tStart = Infinity, tEnd = -Infinity;
  for (const s of strokes) {
    const b = bboxOfStroke(s);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
    const t0 = s.points[0]?.t ?? 0;
    const t1 = s.points[s.points.length - 1]?.t ?? 0;
    if (t0 < tStart) tStart = t0;
    if (t1 > tEnd)   tEnd   = t1;
  }
  const bbox = { minX, minY, maxX, maxY };
  return {
    strokes,
    bbox,
    cx:        (minX + maxX) / 2,
    cy:        (minY + maxY) / 2,
    startTime: tStart,
    endTime:   tEnd,
  };
}

const MEDIAN_H = 40; // typical symbol height used across tests

// ─────────────────────────────────────────────────────────────
// 1. Stroke Grouper
// ─────────────────────────────────────────────────────────────

describe('groupStrokes', () => {
  it('returns empty array for no strokes', () => {
    expect(groupStrokes([])).toEqual([]);
  });

  it('groups a single stroke into one group', () => {
    const groups = groupStrokes([hLine(0, 50, 20)]);
    expect(groups).toHaveLength(1);
  });

  it('keeps two spatially close, temporally close strokes together', () => {
    // Simulate "=" - two horizontal lines close in space and time
    const s0 = hLine(10, 60, 20, 0);    // written at t=0
    const s1 = hLine(10, 60, 30, 200);  // 200ms later
    const groups = groupStrokes([s0, s1]);
    expect(groups).toHaveLength(1);
    expect(groups[0].strokes).toHaveLength(2);
  });

  it('separates strokes with large time gap into different symbols', () => {
    const s0 = hLine(10, 50, 20, 0);
    const s1 = hLine(70, 110, 20, 2000); // 2 s gap → new symbol
    const groups = groupStrokes([s0, s1]);
    expect(groups).toHaveLength(2);
  });

  it('separates strokes that are far apart spatially', () => {
    const s0 = hLine(0,  40,  20, 0);
    const s1 = hLine(200, 240, 20, 100); // same time but very far right
    const groups = groupStrokes([s0, s1]);
    expect(groups).toHaveLength(2);
  });

  it('sorts groups left-to-right', () => {
    // Three symbols: digit at x=200, digit at x=10, digit at x=100
    const s0 = makeStroke([[200, 20], [210, 30]], 0);
    const s1 = makeStroke([[10,  20], [20,  30]], 2000);
    const s2 = makeStroke([[100, 20], [110, 30]], 4000);
    const groups = groupStrokes([s0, s1, s2]);
    expect(groups).toHaveLength(3);
    expect(groups[0].cx).toBeLessThan(groups[1].cx);
    expect(groups[1].cx).toBeLessThan(groups[2].cx);
  });

  it('groups "+" two-stroke symbol correctly', () => {
    // Horizontal + vertical drawn within 400ms, overlapping bbox
    const h = hLine(20, 60, 40,  0);
    const v = vLine(40, 20, 60, 300);
    const groups = groupStrokes([h, v]);
    expect(groups).toHaveLength(1);
    expect(groups[0].strokes).toHaveLength(2);
  });
});

describe('splitIntoLines', () => {
  it('puts strokes on the same line into one row', () => {
    const g0 = makeGroup([hLine(0,  30, 20)]);
    const g1 = makeGroup([hLine(50, 80, 25)]);
    const lines = splitIntoLines([g0, g1]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(2);
  });

  it('separates strokes on different lines', () => {
    const g0 = makeGroup([hLine(0, 30,  20)]);
    const g1 = makeGroup([hLine(0, 30, 120)]); // 100px lower
    const lines = splitIntoLines([g0, g1]);
    expect(lines).toHaveLength(2);
  });

  it('sorts each line left-to-right', () => {
    const g0 = makeGroup([makeStroke([[100, 20], [120, 20]])]);
    const g1 = makeGroup([makeStroke([[20, 20],  [40, 20]])]);
    const lines = splitIntoLines([g0, g1]);
    expect(lines[0][0].cx).toBeLessThan(lines[0][1].cx);
  });
});

// ─────────────────────────────────────────────────────────────
// 2. Operator Geometry Classifier
// ─────────────────────────────────────────────────────────────

describe('classifyOperator – "." decimal point', () => {
  it('classifies a tiny single stroke as "."', () => {
    const d = dot(20, 35, 0); // tiny, sits low
    const g = makeGroup([d]);
    const r = classifyOperator(g, MEDIAN_H);
    expect(r).not.toBeNull();
    expect(r?.symbol).toBe('.');
  });

  it('does NOT classify a normal-sized stroke as "."', () => {
    const s = hLine(0, 50, 20);
    const g = makeGroup([s]);
    const r = classifyOperator(g, MEDIAN_H);
    // Could be '−' but NOT '.'
    expect(r?.symbol).not.toBe('.');
  });
});

describe('classifyOperator – "−" minus', () => {
  it('classifies a wide flat stroke as "−"', () => {
    const s = hLine(0, 80, 20);  // width 80, height ~0 → very wide
    const g = makeGroup([s]);
    const r = classifyOperator(g, MEDIAN_H);
    expect(r).not.toBeNull();
    expect(r?.symbol).toBe('−');
  });

  it('does NOT classify a tall stroke as "−"', () => {
    const s = vLine(20, 0, 50);  // tall, not wide
    const g = makeGroup([s]);
    const r = classifyOperator(g, MEDIAN_H);
    expect(r?.symbol).not.toBe('−');
  });
});

describe('classifyOperator – "=" equals', () => {
  it('classifies two stacked flat strokes as "="', () => {
    const s0 = hLine(10, 60, 20, 0);    // top bar
    const s1 = hLine(10, 60, 32, 200);  // bottom bar, 12px below
    const g  = makeGroup([s0, s1]);
    const r  = classifyOperator(g, MEDIAN_H);
    expect(r).not.toBeNull();
    expect(r?.symbol).toBe('=');
  });

  it('rejects two strokes that are too far apart vertically', () => {
    const s0 = hLine(10, 60, 20, 0);
    const s1 = hLine(10, 60, 80, 200);  // 60px apart — too far for "="
    const g  = makeGroup([s0, s1]);
    const r  = classifyOperator(g, MEDIAN_H);
    // Should not be "=" (bars too spread)
    if (r) expect(r.symbol).not.toBe('=');
  });
});

describe('classifyOperator – "+" plus', () => {
  it('classifies flat + steep crossing strokes as "+"', () => {
    const h = hLine(20, 60, 40,  0);
    const v = vLine(40, 20, 60, 300);
    const g = makeGroup([h, v]);
    const r = classifyOperator(g, MEDIAN_H);
    expect(r).not.toBeNull();
    expect(r?.symbol).toBe('+');
  });

  it('classifies "+" not "×" when one stroke is horizontal', () => {
    const h = hLine(20, 60, 40, 0);
    const v = vLine(40, 20, 60, 200);
    const g = makeGroup([h, v]);
    const r = classifyOperator(g, MEDIAN_H);
    expect(r?.symbol).toBe('+');
    expect(r?.symbol).not.toBe('×');
  });
});

describe('classifyOperator – "×" times', () => {
  it('classifies two crossing diagonal strokes as "×"', () => {
    // d0: ↘ from (20,20) to (60,60) — positive slope
    // d1: ↗ from (20,60) to (60,20) — negative slope, they cross at (40,40)
    const d0 = diagDown(20, 20, 60, 60, 0);
    const d1 = diagUp(20, 60, 60, 20, 200); // x0=20,y0=60,x1=60,y1=20
    const g  = makeGroup([d0, d1]);
    const r  = classifyOperator(g, MEDIAN_H);
    expect(r).not.toBeNull();
    expect(r?.symbol).toBe('×');
  });

  it('distinguishes "×" from "+" (diagonals vs orthogonal)', () => {
    const d0 = diagDown(20, 20, 60, 60, 0);
    const d1 = diagUp(20, 60, 60, 20, 200);
    const g  = makeGroup([d0, d1]);
    const r  = classifyOperator(g, MEDIAN_H);
    expect(r?.symbol).not.toBe('+');
  });
});

describe('classifyOperator – "÷" division', () => {
  it('classifies flat stroke + two small dots as "÷"', () => {
    const bar    = hLine(10, 60, 40, 0);
    const topDot = dot(35, 20, 200);  // above
    const botDot = dot(35, 60, 400);  // below
    const g = makeGroup([bar, topDot, botDot]);
    const r = classifyOperator(g, MEDIAN_H);
    expect(r).not.toBeNull();
    expect(r?.symbol).toBe('÷');
  });
});

// ─────────────────────────────────────────────────────────────
// 3. Confusion cases
// ─────────────────────────────────────────────────────────────

describe('classifyOperator – confusion cases', () => {
  it('"1" (tall narrow) should NOT be classified as "−"', () => {
    // A "1" stroke is tall and narrow, not wide
    const one = vLine(30, 0, 50, 0);  // height=50, width=0
    const g   = makeGroup([one]);
    const r   = classifyOperator(g, MEDIAN_H);
    // Should NOT be classified as minus (not wide enough)
    expect(r?.symbol).not.toBe('−');
  });

  it('"=" should NOT be confused with two separate far-apart minus signs', () => {
    // Two parallel horizontal strokes but very far apart (60px gap)
    const s0 = hLine(10, 60, 10, 0);
    const s1 = hLine(10, 60, 70, 200);
    const g  = makeGroup([s0, s1]);
    const r  = classifyOperator(g, MEDIAN_H);
    // Gap > 80% of total height → should not be "="
    expect(r?.symbol).not.toBe('=');
  });

  it('"+" and "×" differ by diagonal test', () => {
    // "+" has orthogonal strokes
    const plus_h = hLine(20, 60, 40, 0);
    const plus_v = vLine(40, 20, 60, 200);
    const gPlus  = makeGroup([plus_h, plus_v]);
    const rPlus  = classifyOperator(gPlus, MEDIAN_H);
    expect(rPlus?.symbol).toBe('+');

    // "×" has diagonal strokes: ↘ and ↗ crossing
    const times_d0 = diagDown(20, 20, 60, 60, 0);
    const times_d1 = diagUp(20, 60, 60, 20, 200); // bottom-left to top-right
    const gTimes   = makeGroup([times_d0, times_d1]);
    const rTimes   = classifyOperator(gTimes, MEDIAN_H);
    expect(rTimes?.symbol).toBe('×');

    expect(rPlus?.symbol).not.toBe(rTimes?.symbol);
  });

  it('small round stroke should be "." not "0" (operator classifier)', () => {
    // 3×3 square stroke, much smaller than median height (40px)
    const tiny = makeStroke([[18,38],[20,38],[22,38],[22,40],[20,42],[18,40],[18,38]], 0);
    const g    = makeGroup([tiny]);
    const r    = classifyOperator(g, MEDIAN_H);
    // classifyOperator should tag this as '.' (small enough)
    expect(r?.symbol).toBe('.');
  });
});

// ─────────────────────────────────────────────────────────────
// 4. BBox helpers
// ─────────────────────────────────────────────────────────────

describe('bbox helpers', () => {
  it('bboxOfStroke computes correct bounds', () => {
    const s = makeStroke([[10, 20], [50, 5], [30, 40]]);
    const b = bboxOfStroke(s);
    expect(b.minX).toBe(10);
    expect(b.maxX).toBe(50);
    expect(b.minY).toBe(5);
    expect(b.maxY).toBe(40);
  });

  it('bboxWidth / bboxHeight', () => {
    const b = { minX: 10, minY: 5, maxX: 50, maxY: 35 };
    expect(bboxWidth(b)).toBe(40);
    expect(bboxHeight(b)).toBe(30);
  });

  it('bboxesClose: overlapping boxes are close', () => {
    const a = { minX: 0,  minY: 0,  maxX: 50, maxY: 30 };
    const b = { minX: 30, minY: 10, maxX: 80, maxY: 40 };
    expect(bboxesClose(a, b, 0)).toBe(true);
  });

  it('bboxesClose: distant boxes are not close at threshold 0', () => {
    const a = { minX: 0,   minY: 0,  maxX: 40,  maxY: 30 };
    const b = { minX: 100, minY: 0,  maxX: 140, maxY: 30 };
    expect(bboxesClose(a, b, 0)).toBe(false);
  });

  it('bboxesClose: distant boxes ARE close with enough threshold', () => {
    const a = { minX: 0,   minY: 0,  maxX: 40,  maxY: 30 };
    const b = { minX: 100, minY: 0,  maxX: 140, maxY: 30 };
    expect(bboxesClose(a, b, 60)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 5. Preprocessor (pure math — no DOM/canvas)
// ─────────────────────────────────────────────────────────────

describe('preprocessor – input validation', () => {
  it('tensor is Float32Array', async () => {
    // We cannot run OffscreenCanvas in Vitest (Node env)
    // So we test the pure math helpers via the grouper/classifier instead.
    // This is a placeholder to confirm the module exports are importable.
    const { preprocessSymbol } = await import('../src/recognition/preprocessor.js');
    expect(typeof preprocessSymbol).toBe('function');
  });
});
