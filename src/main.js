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
import { AnswerOverlay } from './canvas/answerOverlay.js';
import { getRecognitionBridge } from './recognition/index.js';
import { groupStrokes, splitIntoLines, bboxHeight } from './recognition/grouper.js';
import { evaluate, formatResult } from './math/evaluator.js';
// ── Grab DOM elements ─────────────────────────────────────────
function getEl(id) {
    const el = document.getElementById(id);
    if (!el)
        throw new Error(`Element #${id} not found`);
    return el;
}
const canvasEl = getEl('main-canvas');
const answerCanvasEl = getEl('answer-canvas');
const containerEl = getEl('canvas-container');
const pixelEraserCursor = getEl('pixel-eraser-cursor');
const recognitionStatus = getEl('recognition-status');
const debugExprEl = getEl('debug-expr');
const debugGroupsEl = getEl('debug-groups');
const btnUndo = getEl('btn-undo');
const btnRedo = getEl('btn-redo');
const btnPen = getEl('btn-pen');
const btnStrokeEraser = getEl('btn-stroke-eraser');
const btnPixelEraser = getEl('btn-pixel-eraser');
const btnClear = getEl('btn-clear');
const strokeWidthInput = getEl('stroke-width');
const strokeWidthVal = getEl('stroke-width-val');
const statusTool = getEl('status-tool');
const statusStrokes = getEl('status-strokes');
const statusHint = getEl('status-hint');
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
function setStatus(text, thinking) {
    recognitionStatus.textContent = text;
    recognitionStatus.classList.toggle('visible', text.length > 0);
    recognitionStatus.classList.toggle('thinking', thinking);
}
// ── Debounced recognition ─────────────────────────────────────
let debounceTimer = null;
const DEBOUNCE_MS = 350;
function scheduleRecognition(strokes) {
    if (debounceTimer !== null)
        clearTimeout(debounceTimer);
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
            const result = await bridge.recognize(strokes, penWidth);
            updateDebugPanel(result.expression, result.debug);
            processExpression(result.expression, result.debug, strokes);
            setStatus('', false);
        }
        catch (err) {
            // Cancelled — a newer request is in flight; suppress
            if (!(err instanceof Error && err.message === 'Cancelled')) {
                console.warn('[CalcInk] Recognition error:', err);
                setStatus('', false);
            }
        }
    }, DEBOUNCE_MS);
}
// ── Debug panel ───────────────────────────────────────────────
function updateDebugPanel(expression, debug) {
    debugExprEl.textContent = expression || '—';
    if (debug.length === 0) {
        debugGroupsEl.textContent = '—';
        return;
    }
    debugGroupsEl.textContent = debug
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
function processExpression(expression, debug, strokes) {
    if (!expression || debug.length === 0) {
        answerOverlay.clear();
        return;
    }
    // Re-group on the main thread to get bounding boxes for drawing positions.
    // groupStrokes is deterministic & sorts by cx, so groups[i] ↔ debug[i].
    const allGroups = groupStrokes(strokes);
    if (allGroups.length !== debug.length) {
        // Grouping mismatch (can happen mid-draw) – skip this frame.
        answerOverlay.clear();
        return;
    }
    const lines = splitIntoLines(allGroups);
    const answers = [];
    for (const lineGroups of lines) {
        // Build this line's symbol sequence using debug[] for symbols,
        // allGroups[] for bounding boxes.
        const lineGroupsSorted = [...lineGroups].sort((a, b) => a.cx - b.cx);
        const allGroupsSorted = [...allGroups].sort((a, b) => a.cx - b.cx);
        let equalsGroup = null;
        const lineSymbols = [];
        for (const lineGroup of lineGroupsSorted) {
            // Find this group's global index (= debug array index)
            const gIdx = allGroupsSorted.indexOf(lineGroup);
            const sym = gIdx >= 0 && gIdx < debug.length ? debug[gIdx].symbol : '?';
            lineSymbols.push(sym);
            if (sym === '=')
                equalsGroup = lineGroup;
        }
        const equalsIdx = lineSymbols.lastIndexOf('=');
        if (!equalsGroup || equalsIdx <= 0)
            continue;
        const exprForLine = lineSymbols.slice(0, equalsIdx).join('');
        const evalResult = evaluate(exprForLine);
        const answerText = evalResult.ok
            ? formatResult(evalResult.value)
            : (evalResult.error === 'Undefined' ? 'Undefined' : '?');
        const heights = lineGroupsSorted.map(g => bboxHeight(g.bbox)).sort((a, b) => a - b);
        const medianH = heights[Math.floor(heights.length / 2)] ?? 30;
        const pos = AnswerOverlay.answerPosition(equalsGroup.bbox, parseFloat(strokeWidthInput.value));
        answers.push({ x: pos.x, y: pos.y, text: answerText, symbolHeight: medianH });
    }
    answerOverlay.setAnswers(answers);
}
// ── Toolbar: tool selection ───────────────────────────────────
function toolLabel(t) {
    return { pen: 'Pen', 'stroke-eraser': 'Stroke Eraser', 'pixel-eraser': 'Pixel Eraser' }[t];
}
function setActiveTool(tool) {
    inkCanvas.setTool(tool);
    const toolBtnMap = {
        pen: btnPen,
        'stroke-eraser': btnStrokeEraser,
        'pixel-eraser': btnPixelEraser,
    };
    for (const [t, btn] of Object.entries(toolBtnMap)) {
        const isActive = t === tool;
        btn.setAttribute('aria-pressed', String(isActive));
        btn.classList.toggle('active', isActive);
    }
}
btnPen.addEventListener('click', () => setActiveTool('pen'));
btnStrokeEraser.addEventListener('click', () => setActiveTool('stroke-eraser'));
btnPixelEraser.addEventListener('click', () => setActiveTool('pixel-eraser'));
// ── Toolbar: undo / redo / clear ──────────────────────────────
btnUndo.addEventListener('click', () => { inkCanvas.undo(); updateUndoRedoState(); });
btnRedo.addEventListener('click', () => { inkCanvas.redo(); updateUndoRedoState(); });
btnClear.addEventListener('click', () => {
    if (confirm('Clear the canvas? This can be undone.')) {
        inkCanvas.clear();
        answerOverlay.clear();
        setStatus('', false);
        updateDebugPanel('', []);
        updateUndoRedoState();
    }
});
function updateUndoRedoState() {
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
    window.__calcink = { inkCanvas, answerOverlay, bridge, evaluate };
}
