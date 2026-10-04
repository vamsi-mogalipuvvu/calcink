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
import type { DebugGroup } from './recognition/index.js';
import { getComerBridge } from './recognition/comerBridge.js';
import { findEqualAnchor } from './recognition/equalAnchor.js';
import { computeAnswers } from './recognition/answers.js';
import { groupStrokes } from './recognition/grouper.js';
import { evaluate, formatResult } from './math/evaluator.js';
import type { Stroke } from './canvas/stroke.js';
import { buzz, chime, haptic, isFeedbackEnabled, setFeedbackEnabled, swish } from './ui/feedback.js';

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
const debugExprEl  = getEl<HTMLSpanElement>('debug-expr');
const debugGroupsEl = getEl<HTMLSpanElement>('debug-groups');

const btnUndo           = getEl<HTMLButtonElement>('btn-undo');
const btnRedo           = getEl<HTMLButtonElement>('btn-redo');
const btnPen            = getEl<HTMLButtonElement>('btn-pen');
const btnStrokeEraser   = getEl<HTMLButtonElement>('btn-stroke-eraser');
const btnPixelEraser    = getEl<HTMLButtonElement>('btn-pixel-eraser');
const btnSound          = getEl<HTMLButtonElement>('btn-sound');
const btnConfidence     = getEl<HTMLButtonElement>('btn-confidence');
const btnComerToggle    = getEl<HTMLButtonElement>('btn-comer-toggle');
const btnClear          = getEl<HTMLButtonElement>('btn-clear');
const strokeWidthInput  = getEl<HTMLInputElement>('stroke-width');
const strokeWidthVal    = getEl<HTMLSpanElement>('stroke-width-val');

const statusTool        = getEl<HTMLSpanElement>('status-tool');
const statusStrokes     = getEl<HTMLSpanElement>('status-strokes');
const statusHint        = getEl<HTMLSpanElement>('status-hint');

let confidenceEnabled = true;
let comerEnabled = false;
let pointerActive = false;
let lastAnswerSignature = '';
let lastRecognition: { expression: string; debug: DebugGroup[]; strokes: Stroke[]; comer?: boolean } | null = null;

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
  onScratchErase: () => {
    swish();
    haptic(20);
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
const comerBridge = getComerBridge();

bridge.onReady = () => {
  statusHint.textContent = '✨ Write a math expression ending with = and CalcInk will answer! Tip: scribble over ink to erase it.';
  setStatus('Model ready', false);
  setTimeout(() => setStatus('', false), 2000);
  const strokes = inkCanvas.getStrokes();
  if (strokes.length > 0) scheduleRecognition(strokes);
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
    if (comerEnabled) {
      if (!comerBridge.isReady()) {
        setStatus('Loading CoMER model…', true);
        return;
      }
      try {
        const penWidth = parseFloat(strokeWidthInput.value);
        const result = await comerBridge.recognize(strokes, penWidth, 'number');
        
        lastRecognition = { expression: result.expressionResult.ok ? result.expressionResult.expression : '?', debug: [], strokes, comer: true };
        updateDebugPanelForComer(result.latex, result.expressionResult.ok ? result.expressionResult.expression : `Error: ${result.expressionResult.error}`);
        processComerExpression(result, strokes);
        setStatus('', false);
      } catch (err) {
        if (!(err instanceof Error && err.message === 'Cancelled')) {
          console.warn('[CalcInk] CoMER Recognition error:', err);
          setStatus('', false);
        }
      }
    } else {
      if (!bridge.isReady) {
        setStatus('Loading model…', true);
        return;
      }
      try {
        const penWidth = parseFloat(strokeWidthInput.value);
        const result   = await bridge.recognize(strokes, penWidth);
        lastRecognition = { expression: result.expression, debug: result.debug, strokes, comer: false };
        updateDebugPanel(result.expression, result.debug);
        processExpression(result.expression, result.debug, strokes);
        setStatus('', false);
      } catch (err) {
        if (!(err instanceof Error && err.message === 'Cancelled')) {
          console.warn('[CalcInk] Recognition error:', err);
          setStatus('', false);
        }
      }
    }
  }, DEBOUNCE_MS);
}

function updateDebugPanelForComer(latex: string, expr: string): void {
  debugExprEl.textContent = expr || '—';
  debugGroupsEl.textContent = `CoMER: ${latex}`;
}

// ── Debug panel ───────────────────────────────────────────────

function updateDebugPanel(expression: string, debug: DebugGroup[]): void {
  const shown = debug.filter(d => !d.dropped);
  debugExprEl.textContent = expression || '—';
  if (shown.length === 0) {
    debugGroupsEl.textContent = '—';
    return;
  }
  debugGroupsEl.textContent = shown
    .map(d => `${d.symbol}(${d.strokes}s@${d.cx})`)
    .join('  ');
}

// ── Expression → answer ───────────────────────────────────────

/**
 * Given a recognised expression string + per-group debug info from the worker,
 * compute answers for each line ending with "=" and draw them on the overlay.
 *
 * We re-group strokes on the main thread to get bounding boxes for positioning,
 * then align them with the worker's symbol array by index (both are sorted
 * left-to-right by cx, so index i in debug[] → index i in allGroups[]).
 */
function processExpression(
  expression: string,
  debug: DebugGroup[],
  strokes: Stroke[],
): void {
  if (!expression || debug.length === 0) {
    answerOverlay.clear();
    lastAnswerSignature = '';
    return;
  }

  // Re-group on the main thread to get bounding boxes for drawing positions.
  // groupStrokes is deterministic & sorts by cx, so groups[i] ↔ debug[i].
  const allGroups = groupStrokes(strokes);
  if (allGroups.length !== debug.length) {
    // Grouping mismatch (can happen mid-draw) – skip this frame.
    answerOverlay.clear();
    lastAnswerSignature = '';
    return;
  }

  const { answers, marks } = computeAnswers(allGroups, debug, parseFloat(strokeWidthInput.value));

  answerOverlay.setAnswers(answers);
  answerOverlay.setMarks(confidenceEnabled ? marks : []);
  maybePlayAnswerFeedback(answers);
}

function processComerExpression(result: import('./recognition/comer/types.js').ComerResult, strokes: Stroke[]): void {
  if (!result.expressionResult.ok) {
    answerOverlay.clear();
    lastAnswerSignature = '';
    return;
  }
  
  const anchor = findEqualAnchor(strokes);
  if (!anchor) {
    answerOverlay.clear();
    lastAnswerSignature = '';
    return;
  }

  const ans = evaluate(result.expressionResult.expression);
  const formattedAns = ans.ok ? formatResult(ans.value) : 'Undefined';
  
  const penWidth = parseFloat(strokeWidthInput.value);
  const padding = penWidth * 3;
  
  const answers = [{
    text: formattedAns,
    x: anchor.maxX + padding,
    y: anchor.minY,
    width: anchor.maxX - anchor.minX,
    symbolHeight: anchor.maxY - anchor.minY
  }];

  answerOverlay.setAnswers(answers);
  answerOverlay.setMarks([]); // CoMER mode does not currently have per-symbol confidence marks
  maybePlayAnswerFeedback(answers);
}

function answerSignature(answers: import('./canvas/answerOverlay.js').AnswerEntry[]): string {
  return answers
    .map(a => `${a.text}|${Math.round(a.x / 10)}|${Math.round(a.y / 10)}`)
    .join(';');
}

function maybePlayAnswerFeedback(answers: import('./canvas/answerOverlay.js').AnswerEntry[]): void {
  const sig = answerSignature(answers);
  if (sig === lastAnswerSignature) return;
  lastAnswerSignature = sig;
  if (answers.length === 0 || pointerActive) return;
  if (answers.some(a => a.text === 'Undefined')) {
    buzz();
    haptic(30);
  } else {
    chime();
    haptic(15);
  }
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

function setToggleState(btn: HTMLButtonElement, active: boolean): void {
  btn.setAttribute('aria-pressed', String(active));
  btn.classList.toggle('active', active);
  btn.classList.toggle('toggle-off', !active);
}

btnSound.classList.add('toggle');
btnConfidence.classList.add('toggle');
setToggleState(btnSound, isFeedbackEnabled());
setToggleState(btnConfidence, confidenceEnabled);

btnSound.addEventListener('click', () => {
  const next = !isFeedbackEnabled();
  setFeedbackEnabled(next);
  setToggleState(btnSound, next);
});

btnConfidence.addEventListener('click', () => {
  confidenceEnabled = !confidenceEnabled;
  setToggleState(btnConfidence, confidenceEnabled);
  if (!confidenceEnabled) answerOverlay.setMarks([]);
  else if (lastRecognition && !lastRecognition.comer) {
    processExpression(lastRecognition.expression, lastRecognition.debug, lastRecognition.strokes);
  }
});

btnComerToggle.addEventListener('click', () => {
  comerEnabled = !comerEnabled;
  setToggleState(btnComerToggle, comerEnabled);
  
  if (comerEnabled) {
    bridge.cancelPending();
  } else {
    comerBridge.cancelPending();
  }
  
  const strokes = inkCanvas.getStrokes();
  scheduleRecognition(strokes);
});

canvasEl.addEventListener('pointerdown', () => { pointerActive = true; });
canvasEl.addEventListener('pointerup', () => { pointerActive = false; });
canvasEl.addEventListener('pointercancel', () => { pointerActive = false; });
canvasEl.addEventListener('pointerleave', () => { pointerActive = false; });

// ── Toolbar: undo / redo / clear ──────────────────────────────

btnUndo.addEventListener('click', () => { inkCanvas.undo(); updateUndoRedoState(); });
btnRedo.addEventListener('click', () => { inkCanvas.redo(); updateUndoRedoState(); });

btnClear.addEventListener('click', () => {
  if (confirm('Clear the canvas? This can be undone.')) {
    inkCanvas.clear();
    answerOverlay.clear();
    setStatus('', false);
    lastRecognition = null;
    if (comerEnabled) updateDebugPanelForComer('', '');
    else updateDebugPanel('', []);
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
