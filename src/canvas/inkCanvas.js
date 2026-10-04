/**
 * CalcInk – Ink Canvas Controller
 * src/canvas/inkCanvas.ts
 *
 * Manages:
 *  - High-DPI canvas sizing & resize handling
 *  - Pointer Events (mouse / stylus / touch) → stroke capture
 *  - Smooth stroke rendering using quadratic Bézier midpoint smoothing
 *  - Stroke eraser (removes the whole stroke under the pointer)
 *  - Pixel eraser (composites with destination-out to erase pixels)
 *  - Full redraw from stroke data on every change
 *
 * Performance notes:
 *  - All drawing is done on the main canvas – no offscreen canvas for now
 *    (offscreen would complicate the stroke-eraser hit test).
 *  - Pointer events use { passive: false } only where we call preventDefault.
 *  - requestAnimationFrame is NOT used for live drawing (pointer events are
 *    already in sync with display refresh on modern browsers); rAF IS used
 *    for the full redraw after undo/redo/erase.
 */
import { createStroke } from './stroke.js';
import { DrawHistory } from './history.js';
export class InkCanvas {
    // ── Constructor ──────────────────────────────────────────────
    constructor(opts) {
        Object.defineProperty(this, "canvas", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "ctx", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "container", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "pixelEraserCursor", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        /** Logical (CSS-pixel) dimensions */
        Object.defineProperty(this, "cssWidth", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "cssHeight", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        /** Device pixel ratio */
        Object.defineProperty(this, "dpr", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 1
        });
        /** All committed strokes */
        Object.defineProperty(this, "strokes", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        /** The stroke currently being drawn (null when not drawing) */
        Object.defineProperty(this, "activeStroke", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        /**
         * Index of the last point that has already been painted incrementally.
         * Reset to 0 on pointerdown so the full stroke is always reachable.
         * Incremented in _drawActiveStrokeTail after each batch of new points.
         */
        Object.defineProperty(this, "lastDrawnIndex", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        /** Undo/redo history */
        Object.defineProperty(this, "history", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new DrawHistory()
        });
        /** Current tool */
        Object.defineProperty(this, "_tool", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 'pen'
        });
        /** Current pen settings */
        Object.defineProperty(this, "penWidth", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 3
        });
        Object.defineProperty(this, "penColor", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: '#1e1e2e'
        });
        /** Pixel eraser radius in CSS pixels */
        Object.defineProperty(this, "pixelEraserRadius", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 20
        });
        /** Callbacks */
        Object.defineProperty(this, "onStrokesChange", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "onToolChange", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        /** ResizeObserver to handle canvas container size changes */
        Object.defineProperty(this, "resizeObserver", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        // ── Pointer Event Handlers ────────────────────────────────────
        /** Bound methods stored as arrow functions so we can removeEventListener */
        Object.defineProperty(this, "_onPointerDown", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (e) => {
                // Only respond to primary button (left-click / primary touch / stylus tip)
                if (e.button !== 0 && e.pointerType === 'mouse')
                    return;
                e.preventDefault();
                this.canvas.setPointerCapture(e.pointerId);
                const pt = this._toCanvasPoint(e);
                if (this._tool === 'pen') {
                    // Save history snapshot before starting a new stroke
                    this.history.push(this.strokes);
                    this.activeStroke = createStroke(this.penWidth, this.penColor);
                    this.activeStroke.points.push(pt);
                    this.lastDrawnIndex = 0; // reset tail-draw cursor
                }
                else if (this._tool === 'stroke-eraser') {
                    this._eraseStrokeAt(pt);
                }
                else if (this._tool === 'pixel-eraser') {
                    this.history.push(this.strokes);
                    this._pixelEraseAt(pt);
                }
            }
        });
        Object.defineProperty(this, "_onPointerMove", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (e) => {
                const pt = this._toCanvasPoint(e);
                // Move pixel eraser cursor overlay
                if (this._tool === 'pixel-eraser') {
                    this.pixelEraserCursor.style.left = `${pt.x}px`;
                    this.pixelEraserCursor.style.top = `${pt.y}px`;
                }
                if (!e.buttons)
                    return; // no button held, nothing to draw
                e.preventDefault();
                if (this._tool === 'pen' && this.activeStroke) {
                    // For high-frequency stylus events, use getCoalescedEvents if available
                    const events = e.getCoalescedEvents?.() ?? [e];
                    for (const ce of events) {
                        this.activeStroke.points.push(this._toCanvasPoint(ce));
                    }
                    // Draw just the new segment incrementally (no full redraw needed)
                    this._drawActiveStrokeTail(this.activeStroke);
                }
                else if (this._tool === 'stroke-eraser') {
                    this._eraseStrokeAt(pt);
                }
                else if (this._tool === 'pixel-eraser') {
                    this._pixelEraseAt(pt);
                }
            }
        });
        Object.defineProperty(this, "_onPointerUp", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (e) => {
                if (this._tool === 'pen' && this.activeStroke) {
                    // Finalise the stroke
                    if (this.activeStroke.points.length >= 1) {
                        // Do a final full redraw so the committed stroke is pixel-perfect
                        // (incremental tail may have left hairline gaps at segment joins)
                        this.strokes.push(this.activeStroke);
                        this._redraw();
                        this.onStrokesChange?.(this.strokes);
                    }
                    else {
                        // Single-point: discard (history was pushed prematurely, pop it back)
                        this.history.undo(this.strokes);
                    }
                    this.activeStroke = null;
                    this.lastDrawnIndex = 0;
                }
                e.preventDefault();
            }
        });
        Object.defineProperty(this, "_onPointerLeave", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (_e) => {
                // Hide pixel eraser cursor when pointer leaves canvas
                if (this._tool === 'pixel-eraser') {
                    this.pixelEraserCursor.style.display = 'none';
                }
            }
        });
        // ── Drawing ───────────────────────────────────────────────────
        Object.defineProperty(this, "_rafId", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        this.canvas = opts.canvas;
        this.container = opts.container;
        this.pixelEraserCursor = opts.pixelEraserCursor;
        this.onStrokesChange = opts.onStrokesChange;
        this.onToolChange = opts.onToolChange;
        const ctx = this.canvas.getContext('2d');
        if (!ctx)
            throw new Error('Cannot get 2D context from canvas');
        this.ctx = ctx;
        // Size canvas to container immediately, then watch for changes
        this._updateSize();
        this.resizeObserver = new ResizeObserver(() => this._updateSize());
        this.resizeObserver.observe(this.container);
        this._attachPointerEvents();
        this._attachKeyboardShortcuts();
    }
    // ── Public API ────────────────────────────────────────────────
    get tool() { return this._tool; }
    setTool(tool) {
        this._tool = tool;
        // Update container class for CSS cursor changes
        this.container.classList.remove('tool-pen', 'tool-stroke-eraser', 'tool-pixel-eraser');
        this.container.classList.add(`tool-${tool}`);
        // Update canvas cursor
        if (tool === 'pen')
            this.canvas.style.cursor = 'crosshair';
        else if (tool === 'stroke-eraser')
            this.canvas.style.cursor = 'cell';
        // pixel-eraser uses the CSS circle overlay; cursor:none is set via CSS
        this.onToolChange?.(tool);
    }
    setPenWidth(width) {
        this.penWidth = Math.max(0.5, Math.min(40, width));
        // Update pixel eraser radius proportionally (5× pen width, capped)
        this.pixelEraserRadius = Math.min(Math.max(this.penWidth * 4, 12), 80);
        // Update the pixel eraser cursor circle size
        const d = this.pixelEraserRadius * 2;
        this.pixelEraserCursor.style.width = `${d}px`;
        this.pixelEraserCursor.style.height = `${d}px`;
    }
    setPenColor(color) { this.penColor = color; }
    undo() {
        const prev = this.history.undo(this.strokes);
        if (prev !== null) {
            this.strokes = prev;
            this._scheduleRedraw();
            this.onStrokesChange?.(this.strokes);
        }
    }
    redo() {
        const next = this.history.redo(this.strokes);
        if (next !== null) {
            this.strokes = next;
            this._scheduleRedraw();
            this.onStrokesChange?.(this.strokes);
        }
    }
    clear() {
        if (this.strokes.length === 0)
            return;
        this.history.push(this.strokes);
        this.strokes = [];
        this._scheduleRedraw();
        this.onStrokesChange?.(this.strokes);
    }
    get canUndo() { return this.history.canUndo; }
    get canRedo() { return this.history.canRedo; }
    get strokeCount() { return this.strokes.length; }
    /** Return a shallow copy of committed strokes for external consumers */
    getStrokes() { return [...this.strokes]; }
    destroy() {
        this.resizeObserver.disconnect();
        this.canvas.removeEventListener('pointerdown', this._onPointerDown);
        this.canvas.removeEventListener('pointermove', this._onPointerMove);
        this.canvas.removeEventListener('pointerup', this._onPointerUp);
        this.canvas.removeEventListener('pointercancel', this._onPointerUp);
        this.canvas.removeEventListener('pointerleave', this._onPointerLeave);
    }
    // ── Size / DPI ────────────────────────────────────────────────
    _updateSize() {
        const rect = this.container.getBoundingClientRect();
        this.cssWidth = rect.width;
        this.cssHeight = rect.height;
        this.dpr = window.devicePixelRatio || 1;
        // Set physical pixel size
        this.canvas.width = Math.round(this.cssWidth * this.dpr);
        this.canvas.height = Math.round(this.cssHeight * this.dpr);
        // CSS size stays at logical dimensions
        this.canvas.style.width = `${this.cssWidth}px`;
        this.canvas.style.height = `${this.cssHeight}px`;
        // Scale context so we always work in CSS pixels
        this.ctx.scale(this.dpr, this.dpr);
        // Redraw existing strokes after resize
        this._redraw();
    }
    // ── Coordinate helpers ────────────────────────────────────────
    /**
     * Convert a PointerEvent clientX/Y to CSS-pixel canvas coordinates.
     */
    _toCanvasPoint(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            t: e.timeStamp,
            pressure: e.pressure > 0 ? e.pressure : 0.5,
        };
    }
    // ── Stroke eraser ─────────────────────────────────────────────
    /**
     * Remove any stroke whose bounding-box + point-proximity test passes.
     * We use a simple segment-proximity check for accuracy.
     */
    _eraseStrokeAt(pt) {
        const HIT_RADIUS = 12; // CSS pixels
        const toRemove = new Set();
        for (const stroke of this.strokes) {
            if (this._strokeHitsPoint(stroke, pt, HIT_RADIUS + stroke.width / 2)) {
                toRemove.add(stroke.id);
            }
        }
        if (toRemove.size > 0) {
            // Save history before first erasure in this drag
            if (this.activeStroke === null) {
                this.history.push(this.strokes);
                // Use activeStroke as a sentinel to avoid double-pushing in the same drag
                this.activeStroke = { id: '__eraser__', points: [], width: 0, color: '' };
            }
            this.strokes = this.strokes.filter(s => !toRemove.has(s.id));
            this._scheduleRedraw();
            this.onStrokesChange?.(this.strokes);
        }
    }
    /**
     * Returns true if any segment of `stroke` passes within `radius` CSS px of `pt`.
     */
    _strokeHitsPoint(stroke, pt, radius) {
        const { points } = stroke;
        if (points.length === 0)
            return false;
        // Single point
        if (points.length === 1) {
            return this._dist2(points[0], pt) <= radius * radius;
        }
        for (let i = 0; i < points.length - 1; i++) {
            if (this._distToSegment2(pt, points[i], points[i + 1]) <= radius * radius) {
                return true;
            }
        }
        return false;
    }
    // ── Pixel eraser ──────────────────────────────────────────────
    /**
     * Erase a circular area by re-rendering strokes and cutting out the circle.
     * We use a temporary offscreen approach: erase within the live canvas context.
     */
    _pixelEraseAt(pt) {
        // We clip strokes to a circle via globalCompositeOperation = 'destination-out'
        // This is the most efficient approach without an offscreen canvas.
        const r = this.pixelEraserRadius;
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'destination-out';
        this.ctx.beginPath();
        this.ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        this.ctx.fillStyle = 'rgba(0,0,0,1)';
        this.ctx.fill();
        this.ctx.restore();
    }
    /** Schedule a full redraw at the next animation frame (debounced) */
    _scheduleRedraw() {
        if (this._rafId !== null)
            return;
        this._rafId = requestAnimationFrame(() => {
            this._rafId = null;
            this._redraw();
        });
    }
    /** Full redraw of all committed strokes */
    _redraw() {
        const { ctx, cssWidth, cssHeight } = this;
        ctx.clearRect(0, 0, cssWidth, cssHeight);
        for (const stroke of this.strokes) {
            this._drawStroke(stroke);
        }
        // Redraw active stroke on top (if any)
        if (this.activeStroke && this.activeStroke.id !== '__eraser__') {
            this._drawStroke(this.activeStroke);
        }
    }
    /**
     * Draw a complete stroke using quadratic Bézier midpoint smoothing.
     * Technique: draw through midpoints of consecutive control points so the
     * curve passes smoothly through every sampled point.
     */
    _drawStroke(stroke) {
        const { ctx } = this;
        const pts = stroke.points;
        if (pts.length === 0)
            return;
        ctx.save();
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        if (pts.length === 1) {
            // Single dot
            ctx.arc(pts[0].x, pts[0].y, stroke.width / 2, 0, Math.PI * 2);
            ctx.fillStyle = stroke.color;
            ctx.fill();
        }
        else {
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length - 1; i++) {
                // Midpoint between consecutive points → smooth curve
                const mx = (pts[i].x + pts[i + 1].x) / 2;
                const my = (pts[i].y + pts[i + 1].y) / 2;
                ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
            }
            // Draw to the last point
            const last = pts[pts.length - 1];
            ctx.lineTo(last.x, last.y);
            ctx.stroke();
        }
        ctx.restore();
    }
    /**
     * Incrementally draw ALL newly-added tail points of the active stroke.
     *
     * Key insight: coalesced pointer events can add N points per JS frame.
     * We must draw ALL segments from `lastDrawnIndex` to the current end,
     * not just the last one — otherwise fast strokes show gaps/dashes.
     *
     * We use midpoint Bézier smoothing, starting from the midpoint BEFORE
     * lastDrawnIndex so each call seamlessly continues the previous segment.
     */
    _drawActiveStrokeTail(stroke) {
        const pts = stroke.points;
        // Need at least 2 points to draw anything
        if (pts.length < 2)
            return;
        const { ctx } = this;
        ctx.save();
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // The segment we resume from.
        // If lastDrawnIndex >= 1 we start at the midpoint of [last-1, last],
        // which is where the previous call ended its quadraticCurveTo.
        // If this is the very first segment (lastDrawnIndex === 0) start at pts[0].
        const resumeFrom = Math.max(1, this.lastDrawnIndex);
        ctx.beginPath();
        if (resumeFrom === 1 && pts.length === 2) {
            // Only 2 points total — just a line from 0 to 1
            ctx.moveTo(pts[0].x, pts[0].y);
            ctx.lineTo(pts[1].x, pts[1].y);
            ctx.stroke();
            this.lastDrawnIndex = 1;
            ctx.restore();
            return;
        }
        // Start the path at the midpoint before resumeFrom so it joins smoothly
        if (resumeFrom >= 2) {
            const mx = (pts[resumeFrom - 2].x + pts[resumeFrom - 1].x) / 2;
            const my = (pts[resumeFrom - 2].y + pts[resumeFrom - 1].y) / 2;
            ctx.moveTo(mx, my);
        }
        else {
            ctx.moveTo(pts[0].x, pts[0].y);
        }
        // Draw ALL segments from resumeFrom up to (but not including) the last point
        // using quadratic midpoint smoothing
        for (let i = resumeFrom; i < pts.length - 1; i++) {
            const mx = (pts[i].x + pts[i + 1].x) / 2;
            const my = (pts[i].y + pts[i + 1].y) / 2;
            ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        // Draw to the actual last point
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
        // Advance the drawn cursor to second-to-last point
        // (last point will be the start of the NEXT call's path)
        this.lastDrawnIndex = pts.length - 1;
        ctx.restore();
    }
    // ── Geometry helpers ──────────────────────────────────────────
    _dist2(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return dx * dx + dy * dy;
    }
    /**
     * Squared distance from point `p` to segment [`a`, `b`].
     */
    _distToSegment2(p, a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0)
            return this._dist2(p, a);
        // Parametric projection onto segment
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
        const projX = a.x + t * dx;
        const projY = a.y + t * dy;
        const diffX = p.x - projX;
        const diffY = p.y - projY;
        return diffX * diffX + diffY * diffY;
    }
    // ── Keyboard shortcuts ────────────────────────────────────────
    _attachKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            const ctrl = e.ctrlKey || e.metaKey;
            if (ctrl && e.key === 'z') {
                e.preventDefault();
                this.undo();
            }
            if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
                e.preventDefault();
                this.redo();
            }
        });
    }
    // ── Event attachment ──────────────────────────────────────────
    _attachPointerEvents() {
        // Use { passive: false } on pointerdown/move where we call preventDefault
        this.canvas.addEventListener('pointerdown', this._onPointerDown, { passive: false });
        this.canvas.addEventListener('pointermove', this._onPointerMove, { passive: false });
        this.canvas.addEventListener('pointerup', this._onPointerUp, { passive: false });
        this.canvas.addEventListener('pointercancel', this._onPointerUp, { passive: false });
        this.canvas.addEventListener('pointerleave', this._onPointerLeave);
    }
}
