/**
 * CalcInk – Operator Geometry Classifier
 * src/recognition/operatorClassifier.ts
 *
 * Rule-based classifier for the 6 math operator symbols:
 *   +  −  ×  ÷  .  =
 *
 * All rules use RELATIVE geometry (ratios, angles, stroke counts) — never
 * absolute pixel values.  This makes the classifier resolution-independent
 * and robust to different writing sizes.
 *
 * Classification is tried ONLY for groups that the MNIST digit model cannot
 * confidently classify (confidence < DIGIT_CONFIDENCE_THRESHOLD), OR that
 * have geometry inconsistent with a single digit.
 *
 * Returns the symbol string ('+', '−', '×', '÷', '.', '=') or null if the
 * geometry does not match any operator pattern.
 */
import { bboxHeight, bboxWidth } from './grouper.js';
// ── Stroke geometry helpers ───────────────────────────────────
/** Bounding box aspect ratio: width/height.  >1 = landscape, <1 = portrait */
function aspectRatio(g) {
    const h = bboxHeight(g.bbox);
    if (h === 0)
        return 1;
    return bboxWidth(g.bbox) / h;
}
/**
 * Compute the principal angle of a stroke (−90° to +90°).
 * Uses linear regression on the points.
 * Returns angle in degrees; 0° = horizontal, 90° = vertical.
 */
function strokeAngleDeg(pts) {
    if (pts.length < 2)
        return 0;
    const n = pts.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of pts) {
        sx += p.x;
        sy += p.y;
        sxx += p.x * p.x;
        sxy += p.x * p.y;
    }
    const mx = sx / n, my = sy / n;
    const cov = sxy / n - mx * my;
    const varX = sxx / n - mx * mx;
    if (varX === 0)
        return 90;
    return Math.atan(cov / varX) * (180 / Math.PI);
}
/**
 * Returns true if the stroke is predominantly "flat" (horizontal).
 * Threshold: |angle| < 30°.
 */
function isFlat(pts) {
    return Math.abs(strokeAngleDeg(pts)) < 30;
}
/**
 * Returns true if the stroke is predominantly "steep" (vertical).
 * Threshold: |angle| > 60°.
 */
function isSteep(pts) {
    return Math.abs(strokeAngleDeg(pts)) > 60;
}
/**
 * Returns true if the stroke is diagonal (neither flat nor steep).
 * Threshold: 30° < |angle| < 60°.
 */
function isDiagonal(pts) {
    const a = Math.abs(strokeAngleDeg(pts));
    return a >= 25 && a <= 65;
}
/**
 * Detect if two strokes cross each other by checking if their bounding boxes
 * overlap AND if segment intersection exists (simplified: bbox overlap test).
 */
function strokesCross(a, b) {
    const ax1 = Math.min(...a.points.map(p => p.x));
    const ax2 = Math.max(...a.points.map(p => p.x));
    const ay1 = Math.min(...a.points.map(p => p.y));
    const ay2 = Math.max(...a.points.map(p => p.y));
    const bx1 = Math.min(...b.points.map(p => p.x));
    const bx2 = Math.max(...b.points.map(p => p.x));
    const by1 = Math.min(...b.points.map(p => p.y));
    const by2 = Math.max(...b.points.map(p => p.y));
    return ax1 <= bx2 && bx1 <= ax2 && ay1 <= by2 && by1 <= ay2;
}
/**
 * Compute normalised centroid Y of a stroke, relative to the group bbox.
 * 0 = top of group, 1 = bottom.
 */
function relCentroidY(stroke, g) {
    const h = bboxHeight(g.bbox);
    if (h === 0)
        return 0.5;
    const cy = stroke.points.reduce((s, p) => s + p.y, 0) / stroke.points.length;
    return (cy - g.bbox.minY) / h;
}
/**
 * Width of a stroke relative to the group width.
 */
function relWidth(stroke, g) {
    const gw = bboxWidth(g.bbox);
    if (gw === 0)
        return 0;
    const sw = Math.max(...stroke.points.map(p => p.x)) - Math.min(...stroke.points.map(p => p.x));
    return sw / gw;
}
/**
 * Height of a stroke relative to the group height.
 */
function relHeight(stroke, g) {
    const gh = bboxHeight(g.bbox);
    if (gh === 0)
        return 0;
    const sh = Math.max(...stroke.points.map(p => p.y)) - Math.min(...stroke.points.map(p => p.y));
    return sh / gh;
}
/**
 * True if a stroke is flat: wide and short, or close to horizontal.
 * Tolerant of wavy or slightly slanted handwriting.
 */
function looksFlat(s) {
    const xs = s.points.map(p => p.x);
    const ys = s.points.map(p => p.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    return (w > 8 && h < w * 0.35) || isFlat(s.points);
}
// ── Main classifier ───────────────────────────────────────────
/**
 * Try to classify a symbol group as a math operator.
 *
 * Returns null if the group doesn't match any operator pattern well enough,
 * which means the MNIST digit model should handle it.
 */
export function classifyOperator(g, 
/** Median symbol height across all groups on this line (for relative-size tests) */
medianLineHeight) {
    const n = g.strokes.length;
    const ar = aspectRatio(g);
    const gh = bboxHeight(g.bbox);
    const gw = bboxWidth(g.bbox);
    const relSize = medianLineHeight > 0 ? gh / medianLineHeight : 1;
    // ── "." — decimal point ───────────────────────────────────
    // Very small, roughly square, sits near the baseline.
    // Must be much smaller than neighbours (< 25% of median height).
    if (n === 1 && relSize < 0.25 && ar > 0.4 && ar < 2.5) {
        return { symbol: '.', confidence: 0.90, reason: 'dot: tiny single stroke' };
    }
    // Also catch a round closed dot stroke
    if (n === 1 && gw < medianLineHeight * 0.3 && gh < medianLineHeight * 0.3) {
        return { symbol: '.', confidence: 0.80, reason: 'dot: small bbox' };
    }
    // ── "−" — minus / horizontal line ─────────────────────────
    // Wide (ar > 1.6), flat single stroke.
    // Disambiguate from "1" which is narrow (ar < 0.6).
    if (n === 1 && ar > 1.6 && isFlat(g.strokes[0].points)) {
        // Extra guard: not too tall (1 can look wide if tilted)
        if (gh < medianLineHeight * 0.4) {
            return { symbol: '−', confidence: 0.92, reason: 'minus: wide flat stroke' };
        }
    }
    // ── "=" — equals: two stacked flat strokes ─────────────────
    if (n === 2) {
        const [s0, s1] = g.strokes;
        if (looksFlat(s0) && looksFlat(s1)) {
            const cy0 = s0.points.reduce((s, p) => s + p.y, 0) / s0.points.length;
            const cy1 = s1.points.reduce((s, p) => s + p.y, 0) / s1.points.length;
            const vertSep = Math.abs(cy0 - cy1);
            const w0 = relWidth(s0, g);
            const w1 = relWidth(s1, g);
            // Bars must be separated (not the same line), not absurdly far apart,
            // and both must span most of the group's width.
            if (vertSep > gw * 0.05 && vertSep < gw * 2.0 && w0 > 0.4 && w1 > 0.4) {
                return { symbol: '=', confidence: 0.93, reason: 'equals: two flat strokes stacked' };
            }
        }
    }
    // ── "+" — plus: one flat + one steep, crossing ─────────────
    if (n === 2) {
        const [s0, s1] = g.strokes;
        const oneFlat = (isFlat(s0.points) && isSteep(s1.points));
        const otherFlat = (isSteep(s0.points) && isFlat(s1.points));
        if ((oneFlat || otherFlat) && strokesCross(s0, s1)) {
            return { symbol: '+', confidence: 0.90, reason: 'plus: flat+steep crossing' };
        }
    }
    // Single-stroke plus (drawn in one motion)
    if (n === 1 && ar > 0.7 && ar < 1.4) {
        // Detect crossing: count direction changes
        const pts = g.strokes[0].points;
        if (pts.length > 8) {
            let dxChanges = 0, dyChanges = 0;
            for (let i = 2; i < pts.length; i++) {
                const dx1 = pts[i - 1].x - pts[i - 2].x;
                const dx2 = pts[i].x - pts[i - 1].x;
                if (dx1 * dx2 < 0)
                    dxChanges++;
                const dy1 = pts[i - 1].y - pts[i - 2].y;
                const dy2 = pts[i].y - pts[i - 1].y;
                if (dy1 * dy2 < 0)
                    dyChanges++;
            }
            if (dxChanges >= 1 && dyChanges >= 1) {
                return { symbol: '+', confidence: 0.75, reason: 'plus: single-stroke with direction changes' };
            }
        }
    }
    // ── "×" — multiply: two diagonal strokes crossing ──────────
    if (n === 2) {
        const [s0, s1] = g.strokes;
        if (isDiagonal(s0.points) && isDiagonal(s1.points) && strokesCross(s0, s1)) {
            // The two diagonals must have meaningfully different angles
            // (one goes ↘, the other ↗ — their angles differ by ≥ 60°)
            const a0 = strokeAngleDeg(s0.points);
            const a1 = strokeAngleDeg(s1.points);
            const angleDiff = Math.abs(a0 - a1);
            if (angleDiff >= 50 || (angleDiff < 50 && Math.sign(a0) !== Math.sign(a1))) {
                return { symbol: '×', confidence: 0.88, reason: 'times: two crossing diagonals' };
            }
        }
    }
    // ── "÷" — division: flat stroke with dot above and below ───
    // Three strokes: one flat (middle) + two small (top dot, bottom dot)
    if (n === 3) {
        let flatIdx = -1;
        for (let i = 0; i < 3; i++) {
            if (isFlat(g.strokes[i].points) && relWidth(g.strokes[i], g) > 0.35) {
                flatIdx = i;
                break;
            }
        }
        if (flatIdx !== -1) {
            const others = g.strokes.filter((_, i) => i !== flatIdx);
            const dot0 = relHeight(others[0], g) < 0.3;
            const dot1 = relHeight(others[1], g) < 0.3;
            if (dot0 && dot1) {
                const cy0 = relCentroidY(others[0], g);
                const cy1 = relCentroidY(others[1], g);
                const cyF = relCentroidY(g.strokes[flatIdx], g);
                // One dot above the line, one below
                const oneAbove = (cy0 < cyF && cy1 > cyF) || (cy1 < cyF && cy0 > cyF);
                if (oneAbove) {
                    return { symbol: '÷', confidence: 0.87, reason: 'div: flat stroke with dots above+below' };
                }
            }
        }
    }
    // ── "+" single wide stroke variant ────────────────────────
    // catch + drawn as single stroke with very square bbox
    if (n === 1 && ar > 0.8 && ar < 1.25 && relSize > 0.4) {
        return { symbol: '+', confidence: 0.60, reason: 'plus: square single stroke (weak)' };
    }
    return null; // Not an operator — let MNIST handle it
}
