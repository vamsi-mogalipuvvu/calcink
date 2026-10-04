/**
 * CalcInk – Recognition Web Worker
 * src/recognition/worker.ts
 *
 * Runs entirely off the main thread. Receives stroke data from the main
 * thread, performs symbol grouping, classification (MNIST + geometry rules),
 * and returns the recognised expression string.
 *
 * MESSAGE PROTOCOL
 * ─────────────────
 * Main → Worker:
 *   { type: 'RECOGNIZE', id: number, strokes: Stroke[], penWidth: number }
 *   { type: 'CANCEL',    id: number }
 *
 * Worker → Main:
 *   { type: 'RESULT', id: number, expression: string, groups: GroupDebug[] }
 *   { type: 'ERROR',  id: number, message: string }
 *   { type: 'READY' }
 */

import * as ort from 'onnxruntime-web/all';
import type { Stroke } from '../canvas/stroke.js';
import { groupStrokes, bboxHeight } from './grouper.js';
import { classifyOperator } from './operatorClassifier.js';
import { preprocessSymbol } from './preprocessor.js';

// ── ORT WASM path config ─────────────────────────────────────────────────────
// We use the /ort-wasm/ path in public/ (bundled locally, no network needed).
// Setting wasmPaths as an absolute URL makes it worker-context-safe.
ort.env.wasm.numThreads = 1;   // single-thread: no SharedArrayBuffer/COEP needed
ort.env.wasm.proxy     = false; // already in a worker, no proxy needed


// ── State ─────────────────────────────────────────────────────

let session: ort.InferenceSession | null = null;
let currentJobId: number | null = null;

// ── MNIST digit label map ─────────────────────────────────────
const DIGIT_LABELS = ['0','1','2','3','4','5','6','7','8','9'];

// ── Confidence thresholds ─────────────────────────────────────
const DIGIT_CONFIDENCE_THRESHOLD = 0.65; // below this → try operator classifier

// ── Model loading ─────────────────────────────────────────────

async function loadModel(): Promise<void> {
  if (session) return;
  try {
    // Model is bundled in /public/models/ — always served locally
    session = await ort.InferenceSession.create('/models/mnist-12.onnx', {
      executionProviders: ['wasm'],
    });
    self.postMessage({ type: 'READY' });
  } catch (err) {
    self.postMessage({ type: 'ERROR', id: -1, message: `Model load failed: ${String(err)}` });
  }
}

// ── MNIST inference for a single symbol group ─────────────────

/**
 * Run MNIST on a symbol group.  Returns { label, confidence }.
 * label is a string digit '0'–'9'.
 */
async function runMNIST(
  strokes: Stroke[],
  bbox: import('./grouper.js').BBox,
  penWidth: number,
): Promise<{ label: string; confidence: number } | null> {
  if (!session) return null;

  try {
    const { tensor } = preprocessSymbol(strokes, bbox, penWidth);
    // MNIST-12 input: name='Input3', shape [1,1,28,28]
    const inputTensor = new ort.Tensor('float32', tensor, [1, 1, 28, 28]);
    const feeds: Record<string, ort.Tensor> = {};
    feeds[session.inputNames[0]] = inputTensor;

    const results = await session.run(feeds);
    const output  = results[session.outputNames[0]];
    const logits  = output.data as Float32Array;

    // Softmax
    const maxLogit = Math.max(...Array.from(logits));
    const exps     = Array.from(logits).map(x => Math.exp(x - maxLogit));
    const sumExps  = exps.reduce((a, b) => a + b, 0);
    const probs    = exps.map(x => x / sumExps);

    let bestIdx = 0;
    let bestProb = probs[0];
    for (let i = 1; i < probs.length; i++) {
      if (probs[i] > bestProb) { bestProb = probs[i]; bestIdx = i; }
    }

    return {
      label:      DIGIT_LABELS[bestIdx] ?? String(bestIdx),
      confidence: bestProb,
    };
  } catch (_err) {
    return null;
  }
}

// ── Main recognition pipeline ─────────────────────────────────

/**
 * Classify one symbol group → returns the symbol character string.
 * Hybrid: try geometry (operator) first for multi-stroke groups or
 * groups with low MNIST confidence; fall back to MNIST for digits.
 */
async function classifyGroup(
  group: import('./grouper.js').SymbolGroup,
  medianHeight: number,
  penWidth: number,
): Promise<string> {

  // 1. Always try operator classifier for multi-stroke groups
  if (group.strokes.length > 1) {
    const opResult = classifyOperator(group, medianHeight);
    if (opResult && opResult.confidence >= 0.80) {
      return opResult.symbol;
    }
  }

  // 2. Try operator classifier for single-stroke operators (., −)
  const quickOp = classifyOperator(group, medianHeight);
  if (quickOp && quickOp.confidence >= 0.88) {
    return quickOp.symbol;
  }

  // 3. Run MNIST digit model
  const digitResult = await runMNIST(group.strokes, group.bbox, penWidth);

  if (digitResult && digitResult.confidence >= DIGIT_CONFIDENCE_THRESHOLD) {
    return digitResult.label;
  }

  // 4. Low MNIST confidence → fall back to operator with any result
  if (quickOp) return quickOp.symbol;
  if (digitResult) return digitResult.label;

  return '?';
}

async function recognizeStrokes(
  id: number,
  strokes: Stroke[],
  penWidth: number,
): Promise<void> {
  if (!session) {
    self.postMessage({ type: 'ERROR', id, message: 'Model not loaded yet' });
    return;
  }

  currentJobId = id;

  try {
    const groups = groupStrokes(strokes);
    if (groups.length === 0) {
      self.postMessage({ type: 'RESULT', id, expression: '', debug: [] });
      return;
    }

    const heights = groups.map(g => bboxHeight(g.bbox)).sort((a, b) => a - b);
    const medianH = heights[Math.floor(heights.length / 2)] ?? 20;

    const symbols: string[] = [];
    const debug: Array<{ symbol: string; cx: number; strokes: number }> = [];

    for (const group of groups) {
      if (currentJobId !== id) return;
      const sym = await classifyGroup(group, medianH, penWidth);
      symbols.push(sym);
      debug.push({ symbol: sym, cx: Math.round(group.cx), strokes: group.strokes.length });
    }

    if (currentJobId !== id) return;

    self.postMessage({ type: 'RESULT', id, expression: symbols.join(''), debug });
  } catch (err) {
    if (currentJobId === id) {
      self.postMessage({ type: 'ERROR', id, message: String(err) });
    }
  }
}

// ── Message handler ───────────────────────────────────────────

self.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as
    | { type: 'RECOGNIZE'; id: number; strokes: Stroke[]; penWidth: number }
    | { type: 'CANCEL'; id: number };

  if (msg.type === 'RECOGNIZE') {
    recognizeStrokes(msg.id, msg.strokes, msg.penWidth).catch(() => {
      self.postMessage({ type: 'ERROR', id: msg.id, message: 'Unhandled recognition error' });
    });
  } else if (msg.type === 'CANCEL') {
    if (currentJobId === msg.id) currentJobId = null;
  }
});

// Load model immediately on worker start
loadModel().catch(() => {
  self.postMessage({ type: 'ERROR', id: -1, message: 'Failed to start model loading' });
});
