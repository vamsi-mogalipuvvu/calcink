/**
 * CalcInk – Stroke Grouper (v2 – spatial-primary)
 * src/recognition/grouper.ts
 *
 * Groups raw strokes into logical symbols.
 *
 * ALGORITHM (spatial-primary, time-secondary)
 * ───────────────────────────────────────────
 * When a new stroke arrives, check the last LOOKBACK groups for a merge
 * candidate using TWO independent gates:
 *
 * Gate A – SPATIAL (primary, geometry-driven):
 *   1. Horizontal overlap ≥ MIN_HORIZ_OVERLAP_RATIO of the NARROWER bbox width.
 *      This is the critical gate that keeps adjacent digits separate.
 *      "1" (x=[30,38]) and "8" (x=[50,80]) have zero horizontal overlap → never merge.
 *      "=" bar 2 (x=[10,70]) vs bar 1 group (x=[10,70]) → 100% overlap → merge.
 *   2. Vertical gap ≤ MAX_VERT_GAP_RATIO × max(groupWidth, strokeWidth).
 *      Using WIDTH (not height) as reference because horizontal strokes (−, =)
 *      have nearly zero height but ample width as a size reference.
 *   3. Time gap ≤ MAX_TIME_SPATIAL_MS (4 s). Long pauses prevent accidental merges
 *      when the user starts a new expression in the same horizontal region.
 *
 * Gate B – TEMPORAL only (fast adjacent strokes, NO spatial overlap):
 *   Disabled. We only merge spatially overlapping strokes.
 *   This guarantees adjacent digits (even written fast) stay separate.
 *
 * Merge target: the group among the last LOOKBACK groups with the highest
 * horizontal overlap ratio (greedy best-fit, not just last-group).
 * This handles: bar₁ of `÷`, then the dot (merges with bar₁'s group even
 * if other strokes were started in between).
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

// ── Tuning constants ───────────────────────────────────────────

/**
 * A new stroke must share at least this fraction of the NARROWER bbox's
 * width as horizontal overlap to be considered for merging.
 * 0.30 = 30% — wide enough to catch thin strokes (÷ dots, + vertical arm)
 * yet strict enough to reject adjacent symbols with no x-range overlap.
 */
const MIN_HORIZ_OVERLAP_RATIO = 0.30;

/**
 * Max vertical gap between the existing group and the incoming stroke,
 * expressed as a fraction of max(groupWidth, strokeWidth).
 * Using width (not height) avoids the degenerate case where a flat
 * stroke like "−" has near-zero height.
 *
 * For "=" bars 10 px apart, bar width = 60 px → threshold = 60 × 0.55 = 33 px → OK.
 * For "÷" dot 20 px above bar, bar width = 60 → 20 < 33 → OK.
 * For "1" (height 50 px) and "−" 80 px away vertically → 80 > 33 → REJECT.
 */
const MAX_VERT_GAP_RATIO = 0.55;

/**
 * Max time (ms) allowed between spatially-overlapping strokes of the same
 * symbol. 4 s accommodates slow/deliberate stylus writers.
 */
const MAX_TIME_SPATIAL_MS = 4000;

/**
 * How many recently-closed groups to scan for a merge candidate.
 * 3 covers "bar → stray point → second bar" edge-cases.
 */
const LOOKBACK = 3;

// ── BBox helpers ───────────────────────────────────────────────

export function bboxOfStroke(s: Stroke): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of s.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  // Single-point stroke: give it a minimal size so overlap math works
  if (minX === maxX) { minX -= 3; maxX += 3; }
  if (minY === maxY) { minY -= 3; maxY += 3; }
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
export function bboxWidth(b: BBox): number  { return b.maxX - b.minX; }
/** Height of a bounding box */
export function bboxHeight(b: BBox): number { return b.maxY - b.minY; }

/**
 * Returns true if the two boxes overlap OR are within `threshold` pixels
 * of each other horizontally and vertically.
 * Kept for backward-compat with operatorClassifier & tests.
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

// ── Merge-eligibility logic ────────────────────────────────────

/**
 * Horizontal overlap of bbox b into group g, as a fraction of the narrower
 * width. Returns 0 if there is no overlap at all.
 */
export function horizOverlapRatio(gBbox: BBox, sBbox: BBox): number {
  const overlapStart = Math.max(gBbox.minX, sBbox.minX);
  const overlapEnd   = Math.min(gBbox.maxX, sBbox.maxX);
  const overlap      = Math.max(0, overlapEnd - overlapStart);
  if (overlap === 0) return 0;
  const narrower = Math.min(bboxWidth(gBbox), bboxWidth(sBbox));
  return narrower > 0 ? overlap / narrower : 0;
}

/**
 * Vertical gap between group bbox and stroke bbox (0 if they overlap).
 */
function verticalGap(gBbox: BBox, sBbox: BBox): number {
  return Math.max(0,
    Math.max(gBbox.minY, sBbox.minY) - Math.min(gBbox.maxY, sBbox.maxY),
  );
}

/**
 * Returns true if the stroke's bbox is "flat" (height < 25% of width).
 * Used to identify horizontal bars like the arms of "−" and "=".
 */
export function isFlat(bbox: BBox): boolean {
  const w = bboxWidth(bbox);
  const h = bboxHeight(bbox);
  return w > 4 && h < w * 0.25;
}

/**
 * Decide whether an incoming stroke should merge into an existing group.
 *
 * Two gates are checked in order; the first one that PASSES wins:
 *
 * Gate S (stacked flat strokes — for "="):
 *   Both the group AND the new stroke are flat (height < 25% of width),
 *   widths are similar (narrower / wider > 0.5), horizontal overlap ≥ 60%
 *   of the narrower width, and the vertical gap is ≤ 1.5× the wider width.
 *   This handles real-world "=" where bars can be 100+ px apart vertically
 *   while the default Gate G would reject them (55% of 155px = 85px < 100px).
 *
 * Gate G (general spatial gate — for +, ×, ÷, etc.):
 *   Horizontal overlap ≥ MIN_HORIZ_OVERLAP_RATIO of narrower width,
 *   vertical gap ≤ MAX_VERT_GAP_RATIO × max(groupW, strokeW).
 */
function canMerge(group: SymbolGroup, sBbox: BBox, sStart: number): boolean {
  // Guard: too old
  if (sStart - group.endTime > MAX_TIME_SPATIAL_MS) return false;

  const gBbox  = group.bbox;
  const hRatio = horizOverlapRatio(gBbox, sBbox);
  const vGap   = verticalGap(gBbox, sBbox);

  // Gate S: stacked flat strokes (the "=" case)
  if (isFlat(gBbox) && isFlat(sBbox)) {
    const gW     = bboxWidth(gBbox);
    const sW     = bboxWidth(sBbox);
    const wider  = Math.max(gW, sW);
    const narrower = Math.min(gW, sW);
    const widthSimilar  = narrower / wider > 0.5;         // widths are comparable
    const overlapOk     = hRatio >= 0.60;                 // strong horizontal overlap
    const vertGapOk     = vGap <= wider * 1.5;            // up to 1.5× wider stroke's width
    if (widthSimilar && overlapOk && vertGapOk) return true;
  }

  // Gate G: general spatial gate (for +, ×, ÷, and also catches close-together "=")
  if (hRatio < MIN_HORIZ_OVERLAP_RATIO) return false;
  const refWidth = Math.max(bboxWidth(gBbox), bboxWidth(sBbox), 10);
  return vGap <= refWidth * MAX_VERT_GAP_RATIO;
}

// ── Main grouper ───────────────────────────────────────────────

/**
 * Given all committed strokes (in any order), return an ordered list of
 * SymbolGroups sorted left-to-right by horizontal centre.
 *
 * Each call fully recomputes grouping from scratch, so it is safe to call
 * after every new stroke (debounced by the caller).
 */
export function groupStrokes(strokes: Stroke[]): SymbolGroup[] {
  if (strokes.length === 0) return [];

  // Sort by stroke start time
  const sorted = [...strokes].sort((a, b) => {
    return (a.points[0]?.t ?? 0) - (b.points[0]?.t ?? 0);
  });

  const groups: SymbolGroup[] = [];

  for (const stroke of sorted) {
    if (stroke.points.length === 0) continue;

    const sBbox  = bboxOfStroke(stroke);
    const sStart = stroke.points[0].t;
    const sEnd   = stroke.points[stroke.points.length - 1].t;

    // Scan the last LOOKBACK groups for the best merge candidate
    // (highest horizontal overlap ratio that meets all gates).
    let bestIdx    = -1;
    let bestRatio  = MIN_HORIZ_OVERLAP_RATIO - 0.0001; // must exceed threshold

    const start = Math.max(0, groups.length - LOOKBACK);
    for (let gi = groups.length - 1; gi >= start; gi--) {
      if (!canMerge(groups[gi], sBbox, sStart)) continue;
      const ratio = horizOverlapRatio(groups[gi].bbox, sBbox);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestIdx   = gi;
      }
    }

    if (bestIdx >= 0) {
      const g      = groups[bestIdx];
      g.strokes.push(stroke);
      g.bbox    = mergeBBox(g.bbox, sBbox);
      g.cx      = (g.bbox.minX + g.bbox.maxX) / 2;
      g.cy      = (g.bbox.minY + g.bbox.maxY) / 2;
      g.endTime = Math.max(g.endTime, sEnd);
    } else {
      groups.push({
        strokes:   [stroke],
        bbox:      sBbox,
        cx:        (sBbox.minX + sBbox.maxX) / 2,
        cy:        (sBbox.minY + sBbox.maxY) / 2,
        startTime: sStart,
        endTime:   sEnd,
      });
    }
  }

  // Sort left-to-right by horizontal centre
  groups.sort((a, b) => a.cx - b.cx);

  // Post-pass: merge consecutive groups that are both single flat strokes
  // with strong horizontal overlap. This catches "=" bars that were written
  // with a pause long enough to start a new group, or that the vertical gap
  // slightly exceeded the general gate but are clearly the same symbol.
  mergeConsecutiveFlatGroups(groups);

  return groups;
}

/**
 * Post-pass: scan left-to-right and merge adjacent groups when:
 *  - Each group contains exactly ONE stroke
 *  - Both strokes are flat (height < 25% of their own width)
 *  - Horizontal overlap ≥ 60% of the narrower bbox
 *  - Vertical gap ≤ 1.5× the wider bbox width
 *
 * This is the safety-net for "=" bars that escaped canMerge due to
 * timing or grouper ordering.
 *
 * Side-by-side "−" signs (no horizontal overlap) are NOT affected because
 * the overlap gate (60%) rejects them.
 */
function mergeConsecutiveFlatGroups(groups: SymbolGroup[]): void {
  let i = 0;
  while (i < groups.length - 1) {
    const a = groups[i];
    const b = groups[i + 1];

    // Both must be single-stroke flat groups
    if (a.strokes.length !== 1 || b.strokes.length !== 1) { i++; continue; }
    if (!isFlat(a.bbox) || !isFlat(b.bbox)) { i++; continue; }

    // Time guard: respect the same 4 s limit as canMerge
    const timeDiff = Math.abs(b.startTime - a.endTime);
    if (timeDiff > MAX_TIME_SPATIAL_MS) { i++; continue; }

    // Horizontal overlap
    const overlap = horizOverlapRatio(a.bbox, b.bbox);
    if (overlap < 0.60) { i++; continue; }

    // Vertical gap
    const vGap  = verticalGap(a.bbox, b.bbox);
    const wider = Math.max(bboxWidth(a.bbox), bboxWidth(b.bbox));
    if (vGap > wider * 1.5) { i++; continue; }

    // Merge b into a
    a.strokes.push(...b.strokes);
    a.bbox    = mergeBBox(a.bbox, b.bbox);
    a.cx      = (a.bbox.minX + a.bbox.maxX) / 2;
    a.cy      = (a.bbox.minY + a.bbox.maxY) / 2;
    a.endTime = Math.max(a.endTime, b.endTime);

    // Remove b
    groups.splice(i + 1, 1);
    // Don't advance i — allow chaining (three or more stacked bars)
  }
}

// ── Line splitter ──────────────────────────────────────────────

/**
 * Split groups into rows (lines) based on vertical centre distance.
 * Returns an array of rows, each sorted left-to-right.
 */
export function splitIntoLines(groups: SymbolGroup[]): SymbolGroup[][] {
  if (groups.length === 0) return [];

  const sorted = [...groups].sort((a, b) => a.cy - b.cy);
  const lines: SymbolGroup[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const g   = sorted[i];
    const cur = lines[lines.length - 1];
    const avgH = cur.reduce((s, x) => s + bboxHeight(x.bbox), 0) / cur.length;
    // Use 1.8× avg height as line-break threshold so tall symbols don't
    // accidentally break into a new line.
    const lastCy = cur.reduce((s, x) => s + x.cy, 0) / cur.length;
    if (Math.abs(g.cy - lastCy) > Math.max(avgH * 1.8, 30)) {
      lines.push([g]);
    } else {
      cur.push(g);
    }
  }

  for (const line of lines) line.sort((a, b) => a.cx - b.cx);
  return lines;
}
