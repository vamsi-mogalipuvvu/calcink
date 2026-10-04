// ── Locally-bundled fonts (replaces Google Fonts CDN) ────────
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/600.css';

/**
 * CalcInk – Application Entry Point
 * src/main.ts
 *
 * Wires together:
 *  - InkCanvas   (drawing, history, eraser)
 *  - Toolbar UI  (buttons, slider)
 *  - Recognition worker bridge (debounced, cancellable)
 *  - Live inline answers via AnswerOverlay
 *  - Math evaluator
 *
 * No framework – plain TypeScript DOM wiring.
 */

import './style.css';
import { InkCanvas } from './canvas/inkCanvas.js';
import type { ToolMode } from './canvas/inkCanvas.js';
import { AnswerOverlay } from './canvas/answerOverlay.js';
import { getRecognitionBridge } from './recognition/index.js';
import { groupStrokes, splitIntoLines, bboxHeight } from './recognition/grouper.js';
import { evaluate, formatResult } from './math/evaluator.js';
import type { Stroke } from './canvas/stroke.js';

// ── Grab DOM elements ─────────────────────────────────────────

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`Element #${id} not found`);
  return el;
}

const canvasEl          = getEl<HTMLCanvasElement>('main-canvas');
const answerCanvasEl    = getEl<HTMLCanvasElement>('answer-canvas');
const containerEl       = getEl<HTMLDivElement>('canvas-container');
const pixelEraserCursor = getEl<HTMLDivElement>('pixel-eraser-cursor');
const recognitionStatus = getEl<HTMLDivElement>('recognition-status');

const btnUndo           = getEl<HTMLButtonElement>('btn-undo');
const btnRedo           = getEl<HTMLButtonElement>('btn-redo');
const btnPen            = getEl<HTMLButtonElement>('btn-pen');
const btnStrokeEraser   = getEl<HTMLButtonElement>('btn-stroke-eraser');
const btnPixelEraser    = getEl<HTMLButtonElement>('btn-pixel-eraser');
const btnClear          = getEl<HTMLButtonElement>('btn-clear');
const strokeWidthInput  = getEl<HTMLInputElement>('stroke-width');
const strokeWidthVal    = getEl<HTMLSpanElement>('stroke-width-val');

const statusTool        = getEl<HTMLSpanElement>('status-tool');
const statusStrokes     = getEl<HTMLSpanElement>('status-strokes');
const statusHint        = getEl<HTMLSpanElement>('status-hint');

// ── Initialise subsystems ─────────────────────────────────────

const inkCanvas = new InkCanvas({
  canvas: canvasEl,
  container: containerEl,
  pixelEraserCursor,
  onStrokesChange: (strokes) => {
    updateUndoRedoState();
    statusStrokes.textContent = `Strokes: ${strokes.length}`;
    scheduleRecognition(strokes);
  },
  onToolChange: (tool) => {
    statusTool.textContent = `Tool: ${toolLabel(tool)}`;
  },
});

const answerOverlay = new AnswerOverlay(answerCanvasEl);

// Keep overlay sized to match the ink canvas
const resizeObserver = new ResizeObserver(() => {
  const rect = containerEl.getBoundingClientRect();
  answerOverlay.setSize(rect.width, rect.height, window.devicePixelRatio || 1);
});
resizeObserver.observe(containerEl);
// Initial size
{
  const rect = containerEl.getBoundingClientRect();
  answerOverlay.setSize(rect.width, rect.height, window.devicePixelRatio || 1);
}

// ── Recognition worker ────────────────────────────────────────

const bridge = getRecognitionBridge();

bridge.onReady = () => {
  statusHint.textContent = '✨ Write a math expression ending with = and CalcInk will answer!';
  setStatus('Model ready', false);
  setTimeout(() => setStatus('', false), 2000);
};

function setStatus(text: string, thinking: boolean): void {
  recognitionStatus.textContent = text;
  recognitionStatus.classList.toggle('visible', text.length > 0);
  recognitionStatus.classList.toggle('thinking', thinking);
}

// ── Debounced recognition ─────────────────────────────────────

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 350;

function scheduleRecognition(strokes: Stroke[]): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  if (strokes.length === 0) {
    answerOverlay.clear();
    setStatus('', false);
    return;
  }

  setStatus('Reading...', true);

  debounceTimer = setTimeout(async () => {
    debounceTimer = null;
    if (!bridge.isReady) {
      setStatus('Loading model…', true);
      return;
    }
    try {
      const penWidth = parseFloat(strokeWidthInput.value);
      const result   = await bridge.recognize(strokes, penWidth);
      processExpression(result.expression, strokes);
      setStatus('', false);
    } catch (err) {
      // Cancelled — a newer request is in flight; suppress
      if (!(err instanceof Error && err.message === 'Cancelled')) {
        console.warn('[CalcInk] Recognition error:', err);
        setStatus('', false);
      }
    }
  }, DEBOUNCE_MS);
}

// ── Expression → answer ───────────────────────────────────────

/**
 * Given a recognised expression string and the original strokes, compute
 * answers for each line that ends with "=" and draw them on the overlay.
 */
function processExpression(expression: string, strokes: Stroke[]): void {
  if (!expression) { answerOverlay.clear(); return; }

  // Re-group strokes for positional info (worker already did this but we need
  // bounding boxes in main-thread coordinate space)
  const allGroups = groupStrokes(strokes);
  const lines     = splitIntoLines(allGroups);

  const answers: import('./canvas/answerOverlay.js').AnswerEntry[] = [];

  for (const lineGroups of lines) {
    // Build expression string for this line by taking its symbols in order
    // We find which recognised symbols correspond to this line by matching cx
    const lineSymbols: string[] = [];
    const lineGroupsSorted = [...lineGroups].sort((a, b) => a.cx - b.cx);

    // Simple mapping: use the expression chars that correspond to this line's
    // group positions (approximated by grouping the global expression by lines)
    // For a robust impl we'd store per-group symbols from the worker; here we
    // re-derive from position:
    let equalsGroup: typeof lineGroups[0] | null = null;
    let equalsIdx   = -1;
    let exprForLine = '';

    // Map expression chars to groups by order
    const allGroupsSorted = [...allGroups].sort((a, b) => a.cx - b.cx);
    for (let i = 0; i < lineGroupsSorted.length; i++) {
      const globalIdx = allGroupsSorted.findIndex(g => g === lineGroupsSorted[i]);
      const sym = globalIdx < expression.length ? expression[globalIdx] : '?';
      lineSymbols.push(sym);
      if (sym === '=') {
        equalsGroup = lineGroupsSorted[i];
        equalsIdx   = lineSymbols.length - 1;
      }
    }

    if (!equalsGroup || equalsIdx <= 0) continue;

    exprForLine = lineSymbols.slice(0, equalsIdx).join('');
    const evalResult = evaluate(exprForLine);
    const answerText = evalResult.ok
      ? formatResult(evalResult.value)
      : (evalResult.error === 'Undefined' ? 'Undefined' : '?');

    const medianH = lineGroupsSorted
      .map(g => bboxHeight(g.bbox))
      .sort((a, b) => a - b)[Math.floor(lineGroupsSorted.length / 2)] ?? 30;

    const pos = AnswerOverlay.answerPosition(
      equalsGroup.bbox,
      parseFloat(strokeWidthInput.value),
    );

    answers.push({
      x:            pos.x,
      y:            pos.y,
      text:         answerText,
      symbolHeight: medianH,
    });
  }

  answerOverlay.setAnswers(answers);
}

// ── Toolbar: tool selection ───────────────────────────────────

function toolLabel(t: ToolMode): string {
  return { pen: 'Pen', 'stroke-eraser': 'Stroke Eraser', 'pixel-eraser': 'Pixel Eraser' }[t];
}

function setActiveTool(tool: ToolMode): void {
  inkCanvas.setTool(tool);
  const toolBtnMap: Record<ToolMode, HTMLButtonElement> = {
    pen:              btnPen,
    'stroke-eraser':  btnStrokeEraser,
    'pixel-eraser':   btnPixelEraser,
  };
  for (const [t, btn] of Object.entries(toolBtnMap) as [ToolMode, HTMLButtonElement][]) {
    const isActive = t === tool;
    btn.setAttribute('aria-pressed', String(isActive));
    btn.classList.toggle('active', isActive);
  }
}

btnPen.addEventListener('click',          () => setActiveTool('pen'));
btnStrokeEraser.addEventListener('click', () => setActiveTool('stroke-eraser'));
btnPixelEraser.addEventListener('click',  () => setActiveTool('pixel-eraser'));

// ── Toolbar: undo / redo / clear ──────────────────────────────

btnUndo.addEventListener('click', () => { inkCanvas.undo(); updateUndoRedoState(); });
btnRedo.addEventListener('click', () => { inkCanvas.redo(); updateUndoRedoState(); });

btnClear.addEventListener('click', () => {
  if (confirm('Clear the canvas? This can be undone.')) {
    inkCanvas.clear();
    answerOverlay.clear();
    setStatus('', false);
    updateUndoRedoState();
  }
});

function updateUndoRedoState(): void {
  btnUndo.disabled = !inkCanvas.canUndo;
  btnRedo.disabled = !inkCanvas.canRedo;
}

// ── Toolbar: stroke width ─────────────────────────────────────

strokeWidthInput.addEventListener('input', () => {
  const w = parseFloat(strokeWidthInput.value);
  strokeWidthVal.textContent = String(w);
  inkCanvas.setPenWidth(w);
});

// ── Initial state ─────────────────────────────────────────────

setActiveTool('pen');
updateUndoRedoState();
inkCanvas.setPenWidth(parseFloat(strokeWidthInput.value));
setStatus('Loading model…', true);

// Dev helpers
if (import.meta.env.DEV) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__calcink = { inkCanvas, answerOverlay, bridge, evaluate };
}
