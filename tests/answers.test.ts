import { describe, expect, it } from 'vitest';
import { computeAnswers } from '../src/recognition/answers.js';
import type { DebugGroup } from '../src/recognition/index.js';
import type { SymbolGroup } from '../src/recognition/grouper.js';
import type { Stroke } from '../src/canvas/stroke.js';

let nextId = 1;

function strokeForBox(minX: number, minY: number, maxX: number, maxY: number, t: number): Stroke {
  return {
    id: String(nextId++),
    points: [
      { x: minX, y: minY, t, pressure: 0.5 },
      { x: maxX, y: maxY, t: t + 10, pressure: 0.5 },
    ],
    width: 3,
    color: '#000',
  };
}

function groupAt(x: number, y: number, t: number): SymbolGroup {
  const bbox = { minX: x, minY: y, maxX: x + 20, maxY: y + 30 };
  const stroke = strokeForBox(bbox.minX, bbox.minY, bbox.maxX, bbox.maxY, t);
  return {
    strokes: [stroke],
    bbox,
    cx: (bbox.minX + bbox.maxX) / 2,
    cy: (bbox.minY + bbox.maxY) / 2,
    startTime: t,
    endTime: t + 10,
  };
}

function expression(symbols: string[], y = 10, startX = 10): { groups: SymbolGroup[]; debug: DebugGroup[] } {
  const groups = symbols.map((_, i) => groupAt(startX + i * 34, y, i * 100));
  const debug = symbols.map((symbol, i) => ({
    symbol,
    cx: Math.round(groups[i].cx),
    strokes: 1,
    confidence: 0.9,
  }));
  return { groups, debug };
}

describe('computeAnswers', () => {
  it('computes 4 times 3', () => {
    const { groups, debug } = expression(['4', '\u00d7', '3', '=']);
    expect(computeAnswers(groups, debug, 3).answers[0].text).toBe('12');
  });

  it('computes mixed-precedence arithmetic', () => {
    const { groups, debug } = expression(['1', '8', '+', '4', '\u00d7', '2', '\u00f7', '8', '=']);
    expect(computeAnswers(groups, debug, 3).answers[0].text).toBe('19');
  });

  it('formats division by zero as Undefined', () => {
    const { groups, debug } = expression(['6', '\u00f7', '0', '=']);
    expect(computeAnswers(groups, debug, 3).answers[0].text).toBe('Undefined');
  });

  it('formats malformed expressions as question mark', () => {
    const { groups, debug } = expression(['3', '+', '+', '=']);
    expect(computeAnswers(groups, debug, 3).answers[0].text).toBe('?');
  });

  it('recomputes when a symbol changes but layout stays the same', () => {
    const { groups, debug } = expression(['4', '\u00d7', '3', '=']);
    const edited = debug.map((d, i) => i === 0 ? { ...d, symbol: '5' } : d);
    expect(computeAnswers(groups, debug, 3).answers[0].text).toBe('12');
    expect(computeAnswers(groups, edited, 3).answers[0].text).toBe('15');
  });

  it('computes separate answers for separate lines', () => {
    const top = expression(['4', '\u00d7', '3', '='], 10, 10);
    const bottom = expression(['6', '+', '2', '='], 100, 210);
    const result = computeAnswers([...top.groups, ...bottom.groups], [...top.debug, ...bottom.debug], 3);
    expect(result.answers.map(a => a.text)).toEqual(['12', '8']);
  });

  it('ignores a dropped stray decimal point', () => {
    const { groups, debug } = expression(['.', '4', '+', '3', '=']);
    const withDroppedDot = debug.map((d, i) => i === 0 ? { ...d, dropped: true } : d);
    const result = computeAnswers(groups, withDroppedDot, 3);
    expect(result.answers[0].text).toBe('7');
    expect(result.marks).toHaveLength(4);
  });

  it('positions the answer just right of the equals group', () => {
    const penWidth = 5;
    const { groups, debug } = expression(['4', '\u00d7', '3', '=']);
    const result = computeAnswers(groups, debug, penWidth);
    const equalsGroup = groups[3];
    expect(result.answers[0].x).toBe(equalsGroup.bbox.maxX + penWidth);
    expect(result.answers[0].y).toBe((equalsGroup.bbox.minY + equalsGroup.bbox.maxY) / 2);
  });
});
