import { describe, it, expect } from 'vitest';
import { strayDotMask } from '../src/recognition/postprocess.js';

describe('strayDotMask', () => {
  it('dot at position 0 (no left digit) → removed', () => {
    const mask = strayDotMask(['.', '1', '8', '+', '4']);
    expect(mask).toEqual([false, true, true, true, true]);
  });

  it('dot between two digits → kept', () => {
    const mask = strayDotMask(['7', '.', '5']);
    expect(mask).toEqual([true, true, true]);
  });

  it('dot after operator, before digit → removed', () => {
    const mask = strayDotMask(['5', '+', '.', '3']);
    expect(mask).toEqual([true, true, false, true]);
  });

  it('dot before equals sign → removed', () => {
    const mask = strayDotMask(['3', '.', '=']);
    expect(mask).toEqual([true, false, true]);
  });

  it('no dots → all true', () => {
    const mask = strayDotMask(['1', '8', '+', '4', '=']);
    expect(mask).toEqual([true, true, true, true, true]);
  });

  it('empty input → empty mask', () => {
    expect(strayDotMask([])).toEqual([]);
  });

  it('multiple valid decimal points → all kept', () => {
    // "3.14+2.5"
    const mask = strayDotMask(['3', '.', '1', '4', '+', '2', '.', '5']);
    expect(mask).toEqual([true, true, true, true, true, true, true, true]);
  });

  it('dot at end → removed', () => {
    const mask = strayDotMask(['5', '+', '3', '.']);
    expect(mask).toEqual([true, true, true, false]);
  });
});
