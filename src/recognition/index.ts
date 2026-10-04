/**
 * CalcInk – Recognition Module (stub)
 * src/recognition/index.ts
 *
 * This module will contain the offline handwriting recognition engine
 * (e.g. a TensorFlow.js model, CNN, or classical feature extraction).
 *
 * For now it exports the interface contract so the rest of the codebase
 * can depend on the types without waiting for the recognition impl.
 *
 * ── FUTURE STEP ──────────────────────────────────────────────
 * Implement recognizeStrokes() to convert Stroke[] → math expression string.
 * The function MUST:
 *   - Run entirely client-side (no network requests)
 *   - Not block the main thread for > 16 ms (use a Web Worker if needed)
 *   - Return null when confidence is too low (let the user re-draw)
 */

import type { Stroke } from '../canvas/stroke.js';

/** Result of recognition */
export interface RecognitionResult {
  /** The recognised expression, e.g. "18+4×3=" */
  expression: string;
  /** Confidence score 0–1 (1 = certain) */
  confidence: number;
}

/**
 * Attempt to recognise a math expression from the given strokes.
 *
 * @param strokes - All strokes on the canvas
 * @returns Recognised expression + confidence, or null if recognition fails.
 *
 * @stub This is a placeholder – recognition is not yet implemented.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function recognizeStrokes(_strokes: Stroke[]): Promise<RecognitionResult | null> {
  // TODO: implement in Step 2
  return null;
}

/** Whether the recognition module is ready (model loaded, etc.) */
export function isRecognitionReady(): boolean {
  return false; // Not yet implemented
}
