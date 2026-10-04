import { describe, expect, it } from 'vitest';
import {
  buzz,
  chime,
  haptic,
  isFeedbackEnabled,
  setFeedbackEnabled,
  swish,
} from '../src/ui/feedback.js';

describe('feedback', () => {
  it('setFeedbackEnabled/isFeedbackEnabled round-trip', () => {
    const initial = isFeedbackEnabled();
    setFeedbackEnabled(false);
    expect(isFeedbackEnabled()).toBe(false);
    setFeedbackEnabled(true);
    expect(isFeedbackEnabled()).toBe(true);
    setFeedbackEnabled(initial);
  });

  it('feedback functions do not throw without browser audio/haptics', () => {
    expect(() => chime()).not.toThrow();
    expect(() => buzz()).not.toThrow();
    expect(() => swish()).not.toThrow();
    expect(() => haptic(10)).not.toThrow();
  });
});
