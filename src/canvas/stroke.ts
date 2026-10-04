/**
 * CalcInk – Stroke Data Model
 * src/canvas/stroke.ts
 *
 * Defines the data structures that store every user stroke.
 * These objects are later consumed by the recognition module.
 */

/** A single captured pointer sample */
export interface Point {
  /** CSS-pixel X coordinate relative to the canvas */
  x: number;
  /** CSS-pixel Y coordinate relative to the canvas */
  y: number;
  /** Timestamp (ms, from PointerEvent.timeStamp) */
  t: number;
  /** Pointer pressure 0–1 (stylus) or 0.5 default (mouse/touch) */
  pressure: number;
}

/** One complete drawn stroke */
export interface Stroke {
  /** Unique stroke id (monotonically increasing integer as string) */
  id: string;
  /** Ordered sequence of captured points */
  points: Point[];
  /** Base stroke width from the width slider */
  width: number;
  /** Ink colour (CSS colour string, e.g. "#1e1e2e") */
  color: string;
}

/** Create a fresh empty stroke with a new id */
let _nextId = 1;
export function createStroke(width: number, color: string): Stroke {
  return {
    id: String(_nextId++),
    points: [],
    width,
    color,
  };
}

/** Reset the id counter (used in tests only) */
export function _resetIdCounter(): void {
  _nextId = 1;
}
