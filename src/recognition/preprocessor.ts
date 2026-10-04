/**
 * CalcInk – Symbol Preprocessor
 * src/recognition/preprocessor.ts
 *
 * Renders a SymbolGroup's strokes to a Float32 tensor in the exact format
 * expected by the ONNX MNIST model:
 *   - Shape: [1, 1, 28, 28]  (batch=1, channels=1, H=28, W=28)
 *   - Polarity: WHITE ink on BLACK background (MNIST convention)
 *   - Normalisation: 0.0 = background, 1.0 = ink
 *
 * The preprocessing pipeline:
 *  1. Find stroke bounding box
 *  2. Render strokes onto an offscreen OffscreenCanvas (or regular canvas)
 *     with white ink on black background
 *  3. Add padding so the digit occupies ~70% of the cell (MNIST standard)
 *  4. Resize to 28×28 using bilinear interpolation (via canvas drawImage)
 *  5. Extract grayscale pixel values and normalise to [0, 1]
 *
 * This module is used inside the Web Worker (no DOM access needed for
 * OffscreenCanvas, which is available in workers).
 */

import type { Stroke, Point } from '../canvas/stroke.js';
import type { BBox } from './grouper.js';

// ── Constants ─────────────────────────────────────────────────

const MODEL_SIZE = 28;     // MNIST input: 28×28
const RENDER_SIZE = 112;   // Render at 4× then downscale for better quality
const PADDING_FRACTION = 0.15; // 15% padding around the digit

/** Light moving-average smoothing to remove mouse jitter (2 passes). */
export function smooth(pts: Point[]): Point[] {
  if (pts.length < 5) return pts;
  let cur = pts;
  for (let pass = 0; pass < 2; pass++) {
    const prev = cur;
    cur = prev.map((p, i) =>
      i === 0 || i === prev.length - 1
        ? p
        : { ...p, x: (prev[i - 1].x + p.x + prev[i + 1].x) / 3,
                  y: (prev[i - 1].y + p.y + prev[i + 1].y) / 3 });
  }
  return cur;
}

/** Shift the 28x28 image so its center of mass sits at the middle (MNIST convention). */
export function centerByMass(t: Float32Array): Float32Array {
  const N = 28;
  let sum = 0, mx = 0, my = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v = t[y * N + x];
      sum += v; mx += v * x; my += v * y;
    }
  }
  if (sum < 1e-3) return t;
  const dx = Math.round(13.5 - mx / sum);
  const dy = Math.round(13.5 - my / sum);
  if (dx === 0 && dy === 0) return t;
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < N && ny >= 0 && ny < N) out[ny * N + nx] = t[y * N + x];
    }
  }
  return out;
}

// ── Render helpers ────────────────────────────────────────────

/**
 * Draw strokes onto a canvas context with white ink on black background.
 * `scale` maps from CSS pixel space to the render canvas coordinate space.
 * `offsetX`/`offsetY` shift the strokes so the bbox starts at (padding, padding).
 */
function renderStrokesToCtx(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  strokes: Stroke[],
  bbox: BBox,
  canvasSize: number,
  strokeWidth: number,
): void {
  const bw = Math.max(bbox.maxX - bbox.minX, 1);
  const bh = Math.max(bbox.maxY - bbox.minY, 1);

  // Scale so the content fills (1 - 2*PADDING_FRACTION) of the canvas
  const contentSize = canvasSize * (1 - 2 * PADDING_FRACTION);
  const scale = Math.min(contentSize / bw, contentSize / bh);
  const padPx = canvasSize * PADDING_FRACTION;

  // Centre the content within padding
  const offX = padPx + (contentSize - bw * scale) / 2 - bbox.minX * scale;
  const offY = padPx + (contentSize - bh * scale) / 2 - bbox.minY * scale;

  // Black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  // White ink
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle   = '#ffffff';
  ctx.lineWidth   = strokeWidth;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';

  for (const stroke of strokes) {
    const pts = smooth(stroke.points);
    if (pts.length === 0) continue;

    ctx.beginPath();
    if (pts.length === 1) {
      // Single dot
      ctx.arc(
        pts[0].x * scale + offX,
        pts[0].y * scale + offY,
        strokeWidth / 2, 0, Math.PI * 2,
      );
      ctx.fill();
    } else {
      ctx.moveTo(pts[0].x * scale + offX, pts[0].y * scale + offY);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(
          pts[i].x * scale + offX,
          pts[i].y * scale + offY,
          mx * scale + offX,
          my * scale + offY,
        );
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last.x * scale + offX, last.y * scale + offY);
      ctx.stroke();
    }
  }
}

// ── Public API ────────────────────────────────────────────────

/**
 * Preprocessing result: the Float32 tensor data and the canvas size.
 */
export interface PreprocessResult {
  /** Float32Array of shape [1, 1, 28, 28] — ready for ONNX input */
  tensor: Float32Array;
  /** The intermediate render canvas (for debugging) */
  debugDataUrl?: string;
}

/**
 * Preprocess a symbol group for MNIST inference.
 *
 * Works in both the main thread (returns a data URL for debugging) and in
 * a Web Worker (OffscreenCanvas, no DOM).
 */
export function preprocessSymbol(
  strokes: Stroke[],
  bbox: BBox,
  penWidth: number,
  debug = false,
): PreprocessResult {
  void debug;
  // Step 1: Render at RENDER_SIZE (4× model size) for quality
  const renderCanvas = new OffscreenCanvas(RENDER_SIZE, RENDER_SIZE);
  const renderCtx    = renderCanvas.getContext('2d');
  if (!renderCtx) throw new Error('Could not get OffscreenCanvas 2D context');

  // MNIST strokes are ~2.5px thick on a 28px image, i.e. ~10% of the cell.
  // Fixed fraction of the render size, independent of pen width and digit size.
  void penWidth;
  const scaledPenWidth = RENDER_SIZE * 0.10;

  renderStrokesToCtx(renderCtx, strokes, bbox, RENDER_SIZE, scaledPenWidth);

  // Step 2: Downscale to 28×28
  const modelCanvas = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE);
  const modelCtx    = modelCanvas.getContext('2d');
  if (!modelCtx) throw new Error('Could not get model canvas context');
  modelCtx.imageSmoothingEnabled = true;
  modelCtx.imageSmoothingQuality = 'high';
  modelCtx.drawImage(renderCanvas, 0, 0, MODEL_SIZE, MODEL_SIZE);

  // Step 3: Extract pixel data and build Float32 tensor
  const imageData = modelCtx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE);
  const tensor    = new Float32Array(MODEL_SIZE * MODEL_SIZE);

  for (let i = 0; i < MODEL_SIZE * MODEL_SIZE; i++) {
    // RGBA: use red channel (all same for greyscale), normalise 0→0.0, 255→1.0
    tensor[i] = imageData.data[i * 4] / 255.0;
  }

  return {
    tensor: centerByMass(tensor),
    // debugDataUrl omitted — OffscreenCanvas.toDataURL not supported in workers
  };
}

/**
 * Wrap the flat [28*28] tensor in the [1, 1, 28, 28] shape expected by MNIST.
 * Returns a new Float32Array (same data, same buffer — just conceptually shaped).
 */
export function wrapTensor(flat28: Float32Array): Float32Array {
  // ONNX Runtime Web reads the flat array and uses the shape separately
  return flat28;
}
