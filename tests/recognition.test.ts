/**
 * CalcInk – Recognition Pipeline Unit Tests (v2)
 * tests/recognition.test.ts
 *
 * Tests for:
 *  1. Stroke grouper – spatial-primary algorithm (new)
 *  2. Operator geometry classifier – all 6 operators + confusion cases
 *  3. Full pipeline stubs
 *
 * KEY NEW TESTS (spatial-primary requirements):
 *  - "=" drawn with a 2-second pause → still 1 group
 *  - "÷" drawn as bar→dot→dot with 1.5s pauses → still 1 group
 *  - "+" and "×" with 1s pause between strokes → 1 group
 *  - "18" (adjacent digits) → 2 separate groups (never merge)
 *  - "18+4×2÷8=" → 9 groups (full expression)
 */

import { describe, it, expect } from 'vitest';
import {
  groupStrokes,
  splitIntoLines,
  bboxOfStroke,
  bboxWidth,
  bboxHeight,
  bboxesClose,
  horizOverlapRatio,
  isFlat,
} from '../src/recognition/grouper.js';
import { classifyOperator } from '../src/recognition/operatorClassifier.js';
import type { SymbolGroup, BBox } from '../src/recognition/grouper.js';
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

function hLine(x0: number, x1: number, y: number, t0 = 0): Stroke {
  const pts: [number, number][] = [];
  for (let x = x0; x <= x1; x += 5) pts.push([x, y]);
  return makeStroke(pts, t0);
}

function vLine(x: number, y0: number, y1: number, t0 = 0): Stroke {
  const pts: [number, number][] = [];
  for (let y = y0; y <= y1; y += 5) pts.push([x, y]);
  return makeStroke(pts, t0);
}

function diagDown(x0: number, y0: number, x1: number, y1: number, t0 = 0): Stroke {
  const steps = 10;
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++)
    pts.push([x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps]);
  return makeStroke(pts, t0);
}

function diagUp(x0: number, y0: number, x1: number, y1: number, t0 = 0): Stroke {
  // x increases, y decreases (bottom-left → top-right)
  const steps = 10;
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++)
    pts.push([
      x0 + (x1 - x0) * i / steps,
      y0 - (y0 - y1) * i / steps,
    ]);
  return makeStroke(pts, t0);
}

function dot(cx: number, cy: number, t0 = 0): Stroke {
  return makeStroke([[cx-2,cy-2],[cx,cy-2],[cx+2,cy],[cx,cy+2],[cx-2,cy]], t0);
}

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
  return { strokes, bbox, cx: (minX+maxX)/2, cy: (minY+maxY)/2, startTime: tStart, endTime: tEnd };
}

const MEDIAN_H = 40;

// ─────────────────────────────────────────────────────────────
// 1.  SPATIAL-PRIMARY GROUPER
// ─────────────────────────────────────────────────────────────

describe('groupStrokes – spatial-primary (new algorithm)', () => {

  // ── "=" with a 2-second pause ──────────────────────────────
  it('"=" drawn with 2 s pause between bars → 1 group', () => {
    //   bar1: x=[10,70], y=20, t=0
    //   bar2: x=[10,70], y=32, t=2000  (2 second pause)
    const bar1 = hLine(10, 70, 20, 0);
    const bar2 = hLine(10, 70, 32, 2000);  // 2 s later
    const groups = groupStrokes([bar1, bar2]);
    expect(groups).toHaveLength(1);
    expect(groups[0].strokes).toHaveLength(2);
  });

  it('"=" drawn with 3.5 s pause → still 1 group (within 4 s limit)', () => {
    const bar1 = hLine(10, 70, 20, 0);
    const bar2 = hLine(10, 70, 32, 3500);
    const groups = groupStrokes([bar1, bar2]);
    expect(groups).toHaveLength(1);
  });

  it('"=" bars more than 4 s apart → 2 groups (time limit exceeded)', () => {
    const bar1 = hLine(10, 70, 20, 0);
    const bar2 = hLine(10, 70, 32, 4500);
    const groups = groupStrokes([bar1, bar2]);
    expect(groups).toHaveLength(2);
  });

  // ── Real-world reproduction: 155 px bars, 100 px gap (BUG #1 numbers) ──
  it('REAL-WORLD: "=" bars 155 px wide, 100 px apart, 2 s pause → 1 group', () => {
    // Exactly what the user saw: debug showed −(1s@762) −(1s@765)
    // bars ≈155 px wide, vertical gap ≈100 px.
    // Old 55%-of-width rule: 0.55 × 155 = 85 < 100 → FAIL (bug).
    // New Gate S: 1.5 × 155 = 232 ≥ 100 → PASS (fixed).
    const bar1 = hLine(680, 835, 120, 0);      // ~155 px wide
    const bar2 = hLine(680, 835, 220, 2000);   // 100 px lower, 2 s later
    const groups = groupStrokes([bar1, bar2]);
    expect(groups).toHaveLength(1);
    expect(groups[0].strokes).toHaveLength(2);
  });

  it('REAL-WORLD: "=" bars 155 px wide, 300 px apart → 2 groups (too far)', () => {
    // Vertical gap 300 px >> 1.5 × 155 = 232 px → must NOT merge
    const bar1 = hLine(680, 835, 100, 0);
    const bar2 = hLine(680, 835, 400, 1000);   // 300 px lower
    const groups = groupStrokes([bar1, bar2]);
    expect(groups).toHaveLength(2);
  });

  it('post-pass: "=" bars escaped canMerge (sorted after grouping) → post-pass merges them', () => {
    // Simulate the case where bars were written right-to-left so they
    // ended up in different groups before the sort, then the post-pass
    // should still merge them.
    const bar1 = hLine(100, 255, 50, 500);   // written second (higher t)
    const bar2 = hLine(100, 255, 65, 0);     // written first (lower t) — out of order
    const groups = groupStrokes([bar1, bar2]);
    // After time-sort, bar2 comes first, bar1 second.
    // They overlap 100% horizontally, gap = 15px < 1.5 × 155 = 232 px → merge.
    expect(groups).toHaveLength(1);
  });

  it('side-by-side "−" signs (no overlap) do NOT merge via post-pass', () => {
    // e.g. "5−−3": two minus signs at different x positions, no horizontal overlap
    const minus1 = hLine(10, 50, 30,    0);    // x=[10,50]
    const minus2 = hLine(70, 110, 30, 300);    // x=[70,110] — no overlap with minus1
    const groups = groupStrokes([minus1, minus2]);
    expect(groups).toHaveLength(2);
  });

  it('isFlat: flat bar returns true, tall stroke returns false', () => {
    // flat: width=150, height=4
    expect(isFlat({ minX: 0, maxX: 150, minY: 0, maxY: 4 })).toBe(true);
    // tall: width=20, height=60
    expect(isFlat({ minX: 0, maxX: 20, minY: 0, maxY: 60 })).toBe(false);
    // square-ish: width=40, height=30 (h/w = 75%, not flat)
    expect(isFlat({ minX: 0, maxX: 40, minY: 0, maxY: 30 })).toBe(false);
  });

  // ── "÷" with 1.5-second pauses ────────────────────────────
  it('"÷" bar → top dot → bottom dot (1.5 s pauses) → 1 group', () => {
    const bar    = hLine(10, 70, 40,   0);    // horizontal bar
    const topDot = dot(40, 18,        1500);  // 1.5 s later
    const botDot = dot(40, 62,        3000);  // another 1.5 s later
    const groups = groupStrokes([bar, topDot, botDot]);
    expect(groups).toHaveLength(1);
    expect(groups[0].strokes).toHaveLength(3);
  });

  it('"÷" top dot merges with bar because it is inside bar x-range', () => {
    // The dot (x=[38,42]) is entirely within bar x=[10,70]
    const bar    = hLine(10, 70, 40, 0);
    const topDot = dot(40, 18, 500);
    const groups = groupStrokes([bar, topDot]);
    expect(groups).toHaveLength(1);
  });

  // ── "+" with 1-second pause ────────────────────────────────
  it('"+" horizontal then vertical (1 s pause) → 1 group', () => {
    const h = hLine(20, 60, 40,    0);
    const v = vLine(40, 20, 60, 1000);
    const groups = groupStrokes([h, v]);
    expect(groups).toHaveLength(1);
    expect(groups[0].strokes).toHaveLength(2);
  });

  // ── "×" with 1-second pause ────────────────────────────────
  it('"×" two crossing diagonals (1 s pause) → 1 group', () => {
    const d0 = diagDown(20, 20, 60, 60, 0);
    const d1 = diagUp(20, 60, 60, 20, 1000);
    const groups = groupStrokes([d0, d1]);
    expect(groups).toHaveLength(1);
    expect(groups[0].strokes).toHaveLength(2);
  });

  // ── Adjacent digits must NOT merge ────────────────────────
  it('"1" and "8" side by side → 2 separate groups (no horizontal overlap)', () => {
    // "1": narrow, x=[30,38]   "8": wider, x=[50,80]  — no overlap
    const one = vLine(34, 0, 50,   0);   // x=34, width≈0 → padded to [31,37]
    const eight = makeStroke([[50,5],[80,5],[80,25],[50,25],[50,45],[80,45],[80,55],[50,55]], 200);
    const groups = groupStrokes([one, eight]);
    expect(groups).toHaveLength(2);
  });

  it('"1" and "8" even written fast (200 ms apart) → still 2 groups', () => {
    const one   = makeStroke([[30,5],[32,50]], 0);    // x=[30,32]
    const eight = makeStroke([[55,5],[85,55]], 200);  // x=[55,85], no overlap with [27,35]
    const groups = groupStrokes([one, eight]);
    expect(groups).toHaveLength(2);
  });

  // ── Full expression "18+4×2÷8=" → 9 groups ────────────────
  it('"18+4×2÷8=" → 9 symbol groups ordered left-to-right', () => {
    let t = 0;
    const dt = () => (t += 300);

    // "1": x=[10,16]
    const s1 = vLine(13, 5, 55, dt());
    // "8": x=[30,55]
    const s8a = makeStroke([[30,5],[55,5],[55,30],[30,30],[30,55],[55,55]], dt());
    // "+": h=[70,110,y=30] + v=[90,y=10..50]
    const plusH = hLine(70, 110, 30, dt());
    const plusV = vLine(90, 10, 50, dt());
    // "4": x=[130,165]
    const s4 = makeStroke([[130,5],[130,40],[165,40],[150,5],[150,60]], dt());
    // "×": two diagonals x=[180,220]
    const timesD0 = diagDown(180, 10, 220, 50, dt());
    const timesD1 = diagUp(180, 50, 220, 10, dt());
    // "2": x=[235,270]
    const s2 = makeStroke([[235,5],[270,5],[270,30],[235,30],[235,55],[270,55]], dt());
    // "÷": bar=[285..325,y=30] + top dot + bottom dot
    const divBar = hLine(285, 325, 30, dt());
    const divTop = dot(305, 10, dt());
    const divBot = dot(305, 50, dt());
    // "8" again: x=[340,375]
    const s8b = makeStroke([[340,5],[375,5],[375,30],[340,30],[340,55],[375,55]], dt());
    // "=": two bars x=[390,430]
    const eqBar1 = hLine(390, 430, 25, dt());
    const eqBar2 = hLine(390, 430, 37, dt());

    const allStrokes = [s1, s8a, plusH, plusV, s4, timesD0, timesD1, s2,
                        divBar, divTop, divBot, s8b, eqBar1, eqBar2];
    const groups = groupStrokes(allStrokes);

    expect(groups).toHaveLength(9);
    // Left-to-right ordering
    for (let i = 1; i < groups.length; i++) {
      expect(groups[i].cx).toBeGreaterThan(groups[i-1].cx);
    }
    // Multi-stroke groups
    const multiStroke = groups.filter(g => g.strokes.length > 1);
    expect(multiStroke.length).toBeGreaterThanOrEqual(4); // +, ×, ÷, =
  });

  // ── Edge: single stroke → 1 group ─────────────────────────
  it('single stroke → 1 group', () => {
    expect(groupStrokes([hLine(0, 50, 20)])).toHaveLength(1);
  });

  it('empty input → 0 groups', () => {
    expect(groupStrokes([])).toHaveLength(0);
  });

  // ── Sorting ────────────────────────────────────────────────
  it('groups sorted left-to-right', () => {
    const s0 = makeStroke([[200,20],[210,30]], 0);
    const s1 = makeStroke([[10,20],[20,30]],  2000);
    const s2 = makeStroke([[100,20],[110,30]], 4000);
    const groups = groupStrokes([s0, s1, s2]);
    expect(groups[0].cx).toBeLessThan(groups[1].cx);
    expect(groups[1].cx).toBeLessThan(groups[2].cx);
  });
});

// ─────────────────────────────────────────────────────────────
// 2.  horizOverlapRatio helper
// ─────────────────────────────────────────────────────────────

describe('horizOverlapRatio', () => {
  const bb = (minX: number, maxX: number): BBox => ({ minX, maxX, minY: 0, maxY: 10 });

  it('identical boxes → 1.0', () => {
    expect(horizOverlapRatio(bb(0, 60), bb(0, 60))).toBeCloseTo(1.0);
  });

  it('no overlap → 0', () => {
    expect(horizOverlapRatio(bb(0, 40), bb(60, 100))).toBe(0);
  });

  it('narrow entirely inside wide → 1.0 (of narrower)', () => {
    // narrow=[35,45] inside wide=[10,70]: overlap=10, narrower=10 → 1.0
    expect(horizOverlapRatio(bb(10, 70), bb(35, 45))).toBeCloseTo(1.0);
  });

  it('partial overlap → correct ratio', () => {
    // [0,60] ∩ [40,80] = 20, narrower = min(60,40) = 40 → 0.5
    expect(horizOverlapRatio(bb(0, 60), bb(40, 80))).toBeCloseTo(0.5);
  });
});

// ─────────────────────────────────────────────────────────────
// 3.  splitIntoLines
// ─────────────────────────────────────────────────────────────

describe('splitIntoLines', () => {
  it('same-row groups → 1 line', () => {
    const g0 = makeGroup([hLine(0, 30, 20)]);
    const g1 = makeGroup([hLine(50, 80, 25)]);
    expect(splitIntoLines([g0, g1])).toHaveLength(1);
  });

  it('well-separated rows → 2 lines', () => {
    const g0 = makeGroup([hLine(0, 30, 20)]);
    const g1 = makeGroup([hLine(0, 30, 120)]);
    expect(splitIntoLines([g0, g1])).toHaveLength(2);
  });

  it('each line sorted left-to-right', () => {
    const g0 = makeGroup([makeStroke([[100,20],[120,20]])]);
    const g1 = makeGroup([makeStroke([[20,20],[40,20]])]);
    const lines = splitIntoLines([g0, g1]);
    expect(lines[0][0].cx).toBeLessThan(lines[0][1].cx);
  });
});

// ─────────────────────────────────────────────────────────────
// 4.  BBox helpers
// ─────────────────────────────────────────────────────────────

describe('bbox helpers', () => {
  it('bboxOfStroke computes correct bounds', () => {
    const s = makeStroke([[10,20],[50,5],[30,40]]);
    const b = bboxOfStroke(s);
    expect(b.minX).toBe(10); expect(b.maxX).toBe(50);
    expect(b.minY).toBe(5);  expect(b.maxY).toBe(40);
  });

  it('bboxWidth / bboxHeight', () => {
    const b = { minX: 10, minY: 5, maxX: 50, maxY: 35 };
    expect(bboxWidth(b)).toBe(40);
    expect(bboxHeight(b)).toBe(30);
  });

  it('bboxesClose: overlapping → true at threshold 0', () => {
    expect(bboxesClose({minX:0,minY:0,maxX:50,maxY:30},{minX:30,minY:10,maxX:80,maxY:40},0)).toBe(true);
  });

  it('bboxesClose: far apart → false at threshold 0', () => {
    expect(bboxesClose({minX:0,minY:0,maxX:40,maxY:30},{minX:100,minY:0,maxX:140,maxY:30},0)).toBe(false);
  });

  it('bboxesClose: far apart → true with large threshold', () => {
    expect(bboxesClose({minX:0,minY:0,maxX:40,maxY:30},{minX:100,minY:0,maxX:140,maxY:30},60)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 5.  Operator classifier – all 6 operators
// ─────────────────────────────────────────────────────────────

describe('classifyOperator – "." decimal point', () => {
  it('tiny single stroke → "."', () => {
    expect(classifyOperator(makeGroup([dot(20, 35)]), MEDIAN_H)?.symbol).toBe('.');
  });
  it('normal-sized stroke → NOT "."', () => {
    expect(classifyOperator(makeGroup([hLine(0, 50, 20)]), MEDIAN_H)?.symbol).not.toBe('.');
  });
});

describe('classifyOperator – "−" minus', () => {
  it('wide flat stroke → "−"', () => {
    expect(classifyOperator(makeGroup([hLine(0, 80, 20)]), MEDIAN_H)?.symbol).toBe('−');
  });
  it('tall stroke → NOT "−"', () => {
    expect(classifyOperator(makeGroup([vLine(20, 0, 50)]), MEDIAN_H)?.symbol).not.toBe('−');
  });
});

describe('classifyOperator – "=" equals', () => {
  it('two stacked flat strokes → "="', () => {
    const g = makeGroup([hLine(10,60,20,0), hLine(10,60,32,200)]);
    expect(classifyOperator(g, MEDIAN_H)?.symbol).toBe('=');
  });
  it('two bars too far apart vertically → NOT "="', () => {
    const g = makeGroup([hLine(10,60,20,0), hLine(10,60,80,200)]);
    const r = classifyOperator(g, MEDIAN_H);
    if (r) expect(r.symbol).not.toBe('=');
  });
});

describe('classifyOperator – "+" plus', () => {
  it('horizontal + vertical crossing → "+"', () => {
    expect(classifyOperator(makeGroup([hLine(20,60,40,0), vLine(40,20,60,300)]), MEDIAN_H)?.symbol).toBe('+');
  });
  it('"+" is not "×"', () => {
    expect(classifyOperator(makeGroup([hLine(20,60,40,0), vLine(40,20,60,300)]), MEDIAN_H)?.symbol).not.toBe('×');
  });
});

describe('classifyOperator – "×" times', () => {
  it('two crossing diagonals → "×"', () => {
    const g = makeGroup([diagDown(20,20,60,60,0), diagUp(20,60,60,20,200)]);
    expect(classifyOperator(g, MEDIAN_H)?.symbol).toBe('×');
  });
  it('"×" is not "+"', () => {
    const g = makeGroup([diagDown(20,20,60,60,0), diagUp(20,60,60,20,200)]);
    expect(classifyOperator(g, MEDIAN_H)?.symbol).not.toBe('+');
  });
});

describe('classifyOperator – "÷" division', () => {
  it('flat bar + two small dots → "÷"', () => {
    const g = makeGroup([hLine(10,60,40,0), dot(35,20,200), dot(35,60,400)]);
    expect(classifyOperator(g, MEDIAN_H)?.symbol).toBe('÷');
  });
});

// ─────────────────────────────────────────────────────────────
// 6.  Confusion cases
// ─────────────────────────────────────────────────────────────

describe('classifyOperator – confusion cases', () => {
  it('"1" (tall narrow) is NOT "−"', () => {
    expect(classifyOperator(makeGroup([vLine(30,0,50)]), MEDIAN_H)?.symbol).not.toBe('−');
  });

  it('"=" vs two far-apart minus signs: wide vert gap → NOT "="', () => {
    const g = makeGroup([hLine(10,60,10,0), hLine(10,60,70,200)]);
    const r = classifyOperator(g, MEDIAN_H);
    if (r) expect(r.symbol).not.toBe('=');
  });

  it('"+" (orthogonal) vs "×" (diagonal) are different', () => {
    const rPlus  = classifyOperator(makeGroup([hLine(20,60,40,0), vLine(40,20,60,200)]), MEDIAN_H);
    const rTimes = classifyOperator(makeGroup([diagDown(20,20,60,60,0), diagUp(20,60,60,20,200)]), MEDIAN_H);
    expect(rPlus?.symbol).toBe('+');
    expect(rTimes?.symbol).toBe('×');
    expect(rPlus?.symbol).not.toBe(rTimes?.symbol);
  });

  it('small round stroke → "." (not "0") in operator classifier', () => {
    const tiny = makeStroke([[18,38],[20,38],[22,38],[22,40],[20,42],[18,40],[18,38]]);
    expect(classifyOperator(makeGroup([tiny]), MEDIAN_H)?.symbol).toBe('.');
  });
});

// ─────────────────────────────────────────────────────────────
// 7.  Module import smoke test
// ─────────────────────────────────────────────────────────────

describe('preprocessor module import', () => {
  it('preprocessSymbol is a function', async () => {
    const { preprocessSymbol } = await import('../src/recognition/preprocessor.js');
    expect(typeof preprocessSymbol).toBe('function');
  });
});
