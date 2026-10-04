/**
 * CalcInk – Stroke Grouper
 * src/recognition/grouper.ts
 *
 * Groups raw strokes into logical symbols using:
 *  1. Temporal gap: strokes written close together in time belong together
 *  2. Spatial overlap: bounding boxes that overlap or are very close
 *  3. Relative size: a tiny stroke near a larger one may be a diacritic (e.g. ÷ dots)
 *
 * Returns groups ordered left-to-right by their horizontal centre.
 */

import type { Stroke, Point } from '../canvas/stroke.js';

// ── Types ─────────────────────────────────────────────────────

export interface BBox {
  minX: number; minY: number;
  maxX: number; maxY: number;
}

/** A group of strokes that form one symbol */
export interface SymbolGroup {
  strokes: Stroke[];
  bbox: BBox;
  /** Horizontal centre (used for left-to-right ordering) */
  cx: number;
  /** Vertical centre */
  cy: number;
  /** Timestamp of the first point of the first stroke */
  startTime: number;
  /** Timestamp of the last point of the last stroke */
  endTime: number;
}

// ── Constants ─────────────────────────────────────────────────

/**
 * Maximum time gap (ms) between consecutive strokes to still consider them
 * part of the same symbol. Multi-stroke symbols (=, ÷, +) are written within
 * this window.  Increase if users write slowly.
 */
const MAX_TIME_GAP_MS = 800;

/**
 * Maximum spatial gap (as a fraction of the symbol's own height/width) before
 * we consider a stroke a new separate symbol.  0.5 = 50% of bbox height.
 */
const MAX_SPATIAL_GAP_FRACTION = 0.8;

// ── BBox helpers ──────────────────────────────────────────────

export function bboxOfStroke(s: Stroke): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of s.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  // Single-point stroke: give it a minimal size
  if (minX === maxX) { minX -= 2; maxX += 2; }
  if (minY === maxY) { minY -= 2; maxY += 2; }
  return { minX, minY, maxX, maxY };
}

export function mergeBBox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Width of a bounding box */
export function bboxWidth(b: BBox): number { return b.maxX - b.minX; }
/** Height of a bounding box */
export function bboxHeight(b: BBox): number { return b.maxY - b.minY; }

/**
 * Returns true if the two boxes overlap OR are within `threshold` pixels
 * of each other horizontally and vertically.
 */
export function bboxesClose(a: BBox, b: BBox, threshold: number): boolean {
  const hOverlap = a.minX <= b.maxX + threshold && b.minX <= a.maxX + threshold;
  const vOverlap = a.minY <= b.maxY + threshold && b.minY <= a.maxY + threshold;
  return hOverlap && vOverlap;
}

/** Centroid of a stroke's points */
export function centroid(pts: Point[]): { x: number; y: number } {
  if (pts.length === 0) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  return { x: sx / pts.length, y: sy / pts.length };
}

// ── Grouper ───────────────────────────────────────────────────

/**
 * Given all committed strokes, return an ordered list of SymbolGroups.
 *
 * Algorithm:
 *  - Process strokes in order of start time.
 *  - For each stroke, try to merge it into the most recent open group if:
 *      (a) time gap < MAX_TIME_GAP_MS, AND
 *      (b) spatial proximity < MAX_SPATIAL_GAP_FRACTION * group height
 *  - Otherwise start a new group.
 *  - After all strokes are processed, sort groups left-to-right.
 */
export function groupStrokes(strokes: Stroke[]): SymbolGroup[] {
  if (strokes.length === 0) return [];

  // Sort strokes by start time (they should already be ordered, but guard)
  const sorted = [...strokes].sort((a, b) => {
    const ta = a.points[0]?.t ?? 0;
    const tb = b.points[0]?.t ?? 0;
    return ta - tb;
  });

  const groups: SymbolGroup[] = [];

  for (const stroke of sorted) {
    if (stroke.points.length === 0) continue;

    const sBbox = bboxOfStroke(stroke);
    const sStart = stroke.points[0].t;
    const sEnd   = stroke.points[stroke.points.length - 1].t;

    // Try merging with the last group
    const last = groups[groups.length - 1];
    if (last) {
      const timeGap  = sStart - last.endTime;
      const groupH   = Math.max(bboxHeight(last.bbox), 10);
      const groupW   = Math.max(bboxWidth(last.bbox), 10);
      const spatialThreshold = Math.max(groupH, groupW) * MAX_SPATIAL_GAP_FRACTION;

      const canMerge =
        timeGap < MAX_TIME_GAP_MS &&
        bboxesClose(last.bbox, sBbox, spatialThreshold);

      if (canMerge) {
        last.strokes.push(stroke);
        last.bbox    = mergeBBox(last.bbox, sBbox);
        last.cx      = (last.bbox.minX + last.bbox.maxX) / 2;
        last.cy      = (last.bbox.minY + last.bbox.maxY) / 2;
        last.endTime = sEnd;
        continue;
      }
    }

    // New group
    groups.push({
      strokes:   [stroke],
      bbox:      sBbox,
      cx:        (sBbox.minX + sBbox.maxX) / 2,
      cy:        (sBbox.minY + sBbox.maxY) / 2,
      startTime: sStart,
      endTime:   sEnd,
    });
  }

  // Sort groups left-to-right by horizontal centre
  groups.sort((a, b) => a.cx - b.cx);

  return groups;
}

/**
 * Detect line breaks: groups with a large vertical gap relative to their
 * height are considered to be on a new "line".
 *
 * Returns groups split into rows, each row sorted left-to-right.
 */
export function splitIntoLines(groups: SymbolGroup[]): SymbolGroup[][] {
  if (groups.length === 0) return [];

  // Sort by vertical centre first for line detection
  const sorted = [...groups].sort((a, b) => a.cy - b.cy);

  const lines: SymbolGroup[][] = [[sorted[0]]];
  const LINE_GAP_THRESHOLD = 0.8; // fraction of avg symbol height

  for (let i = 1; i < sorted.length; i++) {
    const g   = sorted[i];
    const cur = lines[lines.length - 1];
    const avgH = cur.reduce((s, x) => s + bboxHeight(x.bbox), 0) / cur.length;
    const lastCy = cur[cur.length - 1].cy;

    if (Math.abs(g.cy - lastCy) > avgH * (1 + LINE_GAP_THRESHOLD)) {
      lines.push([g]);
    } else {
      cur.push(g);
    }
  }

  // Sort each line left-to-right
  for (const line of lines) {
    line.sort((a, b) => a.cx - b.cx);
  }

  return lines;
}
