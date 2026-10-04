import { describe, expect, it } from 'vitest';
import {
  canvasBackingSize,
  clientToCanvasPoint,
  cssToPhysical,
  physicalToCss,
} from '../src/canvas/coords.js';

describe('coordinate helpers', () => {
  it.each([1, 1.25, 1.5, 2, 3])('converts CSS pixels to physical pixels at DPR %s', (dpr) => {
    expect(cssToPhysical(80, dpr)).toBe(80 * dpr);
  });

  it('converts client coordinates to canvas-local CSS coordinates with rect offsets', () => {
    expect(clientToCanvasPoint(145, 90, { left: 25, top: 10 })).toEqual({ x: 120, y: 80 });
  });

  it('rounds backing-store size after DPR scaling', () => {
    expect(canvasBackingSize(101, 50, 1.25)).toEqual({ width: 126, height: 63 });
    expect(canvasBackingSize(101, 50, 1.5)).toEqual({ width: 152, height: 75 });
  });

  it('keeps DPR 1 as identity', () => {
    expect(cssToPhysical(123, 1)).toBe(123);
    expect(physicalToCss(456, 1)).toBe(456);
    expect(canvasBackingSize(123, 456, 1)).toEqual({ width: 123, height: 456 });
  });

  it.each([1, 1.25, 1.5, 2, 3])('round-trips CSS to physical to CSS at DPR %s', (dpr) => {
    const css = 37.5;
    const physical = cssToPhysical(css, dpr);
    expect(physicalToCss(physical, dpr)).toBeCloseTo(css, 10);
  });
});
