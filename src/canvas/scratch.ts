import type { Point, Stroke } from './stroke.js';

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boundsOf(pts: Point[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function pathLength(pts: Point[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

function countReversals(values: number[], threshold: number): number {
  if (values.length < 2) return 0;
  let direction = 0;
  let extreme = values[0];
  let reversals = 0;

  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (direction === 0) {
      if (v - extreme >= threshold) {
        direction = 1;
        extreme = v;
      } else if (extreme - v >= threshold) {
        direction = -1;
        extreme = v;
      } else if (v > extreme) {
        extreme = v;
      } else if (v < extreme) {
        extreme = v;
      }
    } else if (direction > 0) {
      if (v > extreme) {
        extreme = v;
      } else if (extreme - v >= threshold) {
        reversals++;
        direction = -1;
        extreme = v;
      }
    } else {
      if (v < extreme) {
        extreme = v;
      } else if (v - extreme >= threshold) {
        reversals++;
        direction = 1;
        extreme = v;
      }
    }
  }

  return reversals;
}

/** Return true when a stroke looks like a deliberate back-and-forth scratch gesture. */
export function isScratchGesture(pts: Point[]): boolean {
  if (pts.length < 12) return false;

  const bbox = boundsOf(pts);
  const width = bbox.maxX - bbox.minX;
  const height = bbox.maxY - bbox.minY;
  const size = Math.max(width, height);
  if (size < 20) return false;
  if (pathLength(pts) < size * 3.5) return false;

  const dominantValues = width >= height ? pts.map(p => p.x) : pts.map(p => p.y);
  const threshold = Math.max(6, size * 0.12);
  return countReversals(dominantValues, threshold) >= 4;
}

/** Return ids of strokes whose points are mostly inside the expanded scratch bbox. */
export function strokesUnderScratch(scratch: Stroke, others: Stroke[]): string[] {
  if (scratch.points.length === 0) return [];
  const bbox = boundsOf(scratch.points);
  const minX = bbox.minX - 4;
  const minY = bbox.minY - 4;
  const maxX = bbox.maxX + 4;
  const maxY = bbox.maxY + 4;

  return others
    .filter(stroke => {
      if (stroke.points.length === 0) return false;
      const inside = stroke.points.filter(p =>
        p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY,
      ).length;
      return inside / stroke.points.length >= 0.5;
    })
    .map(stroke => stroke.id);
}
