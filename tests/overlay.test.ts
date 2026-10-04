import { describe, expect, it } from 'vitest';
import { confidenceLevel } from '../src/canvas/answerOverlay.js';

describe('confidenceLevel', () => {
  it('maps confidence boundaries', () => {
    expect(confidenceLevel(0.85)).toBe('high');
    expect(confidenceLevel(0.84)).toBe('mid');
    expect(confidenceLevel(0.65)).toBe('mid');
    expect(confidenceLevel(0.64)).toBe('low');
  });
});
