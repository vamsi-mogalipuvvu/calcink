/**
 * CalcInk – Application Entry Point
 * src/main.ts
 *
 * Wires together:
 *  - InkCanvas (drawing, history, eraser)
 *  - Toolbar UI (buttons, slider)
 *  - Status bar updates
 *  - Math engine (placeholder until recognition is ready)
 *
 * No framework – plain TypeScript DOM wiring.
 */

import './style.css';
import { InkCanvas } from './canvas/inkCanvas.js';
import type { ToolMode } from './canvas/inkCanvas.js';

// ── Grab DOM elements ─────────────────────────────────────────

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`Element #${id} not found`);
  return el;
}

const canvasEl         = getEl<HTMLCanvasElement>('main-canvas');
const containerEl      = getEl<HTMLDivElement>('canvas-container');
const pixelEraserCursor= getEl<HTMLDivElement>('pixel-eraser-cursor');

const btnUndo          = getEl<HTMLButtonElement>('btn-undo');
const btnRedo          = getEl<HTMLButtonElement>('btn-redo');
const btnPen           = getEl<HTMLButtonElement>('btn-pen');
const btnStrokeEraser  = getEl<HTMLButtonElement>('btn-stroke-eraser');
const btnPixelEraser   = getEl<HTMLButtonElement>('btn-pixel-eraser');
const btnClear         = getEl<HTMLButtonElement>('btn-clear');
const strokeWidthInput = getEl<HTMLInputElement>('stroke-width');
const strokeWidthVal   = getEl<HTMLSpanElement>('stroke-width-val');

const statusTool       = getEl<HTMLSpanElement>('status-tool');
const statusStrokes    = getEl<HTMLSpanElement>('status-strokes');

// ── Initialise InkCanvas ──────────────────────────────────────

const inkCanvas = new InkCanvas({
  canvas: canvasEl,
  container: containerEl,
  pixelEraserCursor,
  onStrokesChange: (strokes) => {
    updateUndoRedoState();
    statusStrokes.textContent = `Strokes: ${strokes.length}`;
  },
  onToolChange: (tool) => {
    statusTool.textContent = `Tool: ${toolLabel(tool)}`;
  },
});

// ── Toolbar: tool selection ───────────────────────────────────

function toolLabel(t: ToolMode): string {
  return { pen: 'Pen', 'stroke-eraser': 'Stroke Eraser', 'pixel-eraser': 'Pixel Eraser' }[t];
}

function setActiveTool(tool: ToolMode): void {
  inkCanvas.setTool(tool);

  // Update aria-pressed and visual active class
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

btnPen.addEventListener('click', () => setActiveTool('pen'));
btnStrokeEraser.addEventListener('click', () => setActiveTool('stroke-eraser'));
btnPixelEraser.addEventListener('click', () => setActiveTool('pixel-eraser'));

// ── Toolbar: undo / redo / clear ──────────────────────────────

btnUndo.addEventListener('click', () => {
  inkCanvas.undo();
  updateUndoRedoState();
});

btnRedo.addEventListener('click', () => {
  inkCanvas.redo();
  updateUndoRedoState();
});

btnClear.addEventListener('click', () => {
  if (confirm('Clear the canvas? This can be undone.')) {
    inkCanvas.clear();
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

// Set pen as the default tool
setActiveTool('pen');
updateUndoRedoState();
inkCanvas.setPenWidth(parseFloat(strokeWidthInput.value));

// Expose inkCanvas on window for debugging in dev
if (import.meta.env.DEV) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__calcink = { inkCanvas };
}
