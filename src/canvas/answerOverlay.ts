/**
 * CalcInk – Answer Overlay Renderer
 * src/canvas/answerOverlay.ts
 *
 * Draws inline answers on the canvas next to the "=" sign.
 * Uses the locally-bundled Caveat font (handwriting style) in a
 * different colour from the user's ink so results are clearly distinct.
 *
 * The overlay is drawn on a separate canvas layered on top of the ink
 * canvas, so we never mutate the user's strokes.
 *
 * Multiple equations (one per line) are all tracked and redrawn together.
 */

import type { BBox } from '../recognition/grouper.js';

// ── Types ─────────────────────────────────────────────────────

export interface AnswerEntry {
  /** Canvas-pixel X position of the right edge of the "=" symbol */
  x: number;
  /** Canvas-pixel Y position (vertical centre of the "=" symbol) */
  y: number;
  /** The answer text to display */
  text: string;
  /** Symbol height in CSS pixels (for font sizing) */
  symbolHeight: number;
}

export type ConfidenceLevel = 'high' | 'mid' | 'low';

export interface ConfidenceMark {
  x: number;
  y: number;
  w: number;
  level: ConfidenceLevel;
}

// ── Constants ─────────────────────────────────────────────────

const ANSWER_COLOR = '#7c3aed';   // Indigo/purple — distinct from dark ink
const ERROR_COLOR  = '#dc2626';   // Red for errors
const FONT_FAMILY  = "'Caveat', cursive";
const GAP_PX       = 8;           // Gap between "=" right edge and answer text
const ANIM_MS      = 220;

export function confidenceLevel(c: number): ConfidenceLevel {
  if (c >= 0.85) return 'high';
  if (c >= 0.65) return 'mid';
  return 'low';
}

// ── Overlay ────────────────────────────────────────────────────

export class AnswerOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private entries: AnswerEntry[] = [];
  private marks: ConfidenceMark[] = [];
  private appearanceTimes = new Map<string, number>();
  private rafId: number | null = null;
  private dpr = 1;

  constructor(overlayCanvas: HTMLCanvasElement) {
    this.canvas = overlayCanvas;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Cannot get overlay canvas context');
    this.ctx = ctx;
  }

  /**
   * Update the physical size of the overlay canvas (called on resize).
   * Must match the ink canvas dimensions exactly.
   */
  setSize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width  = Math.round(cssWidth  * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.canvas.style.width  = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.redraw();
  }

  /** Replace all answer entries and redraw */
  setAnswers(entries: AnswerEntry[]): void {
    const now = performance.now();
    const nextKeys = new Set(entries.map(entry => this._entryKey(entry)));
    for (const key of Array.from(this.appearanceTimes.keys())) {
      if (!nextKeys.has(key)) this.appearanceTimes.delete(key);
    }
    for (const key of nextKeys) {
      if (!this.appearanceTimes.has(key)) this.appearanceTimes.set(key, now);
    }
    this.entries = entries;
    this.redraw();
    this._updateAnimationLoop();
  }

  setMarks(marks: ConfidenceMark[]): void {
    this.marks = marks;
    this.redraw();
  }

  /** Clear all answers */
  clear(): void {
    this.entries = [];
    this.marks = [];
    this.appearanceTimes.clear();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.redraw();
  }

  private redraw(): void {
    const { ctx, canvas, dpr } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    for (const entry of this.entries) {
      this._drawAnswer(entry);
    }

    for (const mark of this.marks) {
      this._drawMark(mark);
    }

    ctx.restore();
  }

  private _drawAnswer(entry: AnswerEntry): void {
    const { ctx } = this;
    const isError  = entry.text === 'Undefined' || entry.text.startsWith('?');
    const color    = isError ? ERROR_COLOR : ANSWER_COLOR;
    const fontSize = Math.max(entry.symbolHeight * 1.1, 18);
    const t0 = this.appearanceTimes.get(this._entryKey(entry));
    const elapsed = t0 === undefined ? ANIM_MS : performance.now() - t0;
    const progress = Math.max(0, Math.min(1, elapsed / ANIM_MS));
    const eased = 1 - (1 - progress) * (1 - progress);
    const alpha = eased;
    const offsetY = (1 - eased) * 8;

    ctx.font         = `600 ${fontSize}px ${FONT_FAMILY}`;
    ctx.fillStyle    = color;
    ctx.globalAlpha  = alpha;
    ctx.textBaseline = 'middle';
    ctx.textAlign    = 'left';

    // Drop shadow for legibility over the paper lines
    ctx.shadowColor   = 'rgba(255,255,255,0.8)';
    ctx.shadowBlur    = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    ctx.fillText(entry.text, entry.x + GAP_PX, entry.y + offsetY);

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  private _drawMark(mark: ConfidenceMark): void {
    const { ctx } = this;
    const color = mark.level === 'high' ? '#16a34a' : mark.level === 'mid' ? '#d97706' : '#dc2626';
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(mark.x - mark.w / 2, mark.y);
    ctx.lineTo(mark.x + mark.w / 2, mark.y);
    ctx.stroke();
    ctx.restore();
  }

  private _entryKey(entry: AnswerEntry): string {
    return `${entry.text}|${Math.round(entry.x / 10)}|${Math.round(entry.y / 10)}`;
  }

  private _updateAnimationLoop(): void {
    const now = performance.now();
    const animating = Array.from(this.appearanceTimes.values()).some(t => now - t < ANIM_MS);
    if (!animating || this.rafId !== null) return;
    this.rafId = requestAnimationFrame(this._animationTick);
  }

  private _animationTick = (): void => {
    this.rafId = null;
    this.redraw();
    const now = performance.now();
    const animating = Array.from(this.appearanceTimes.values()).some(t => now - t < ANIM_MS);
    if (animating) {
      this.rafId = requestAnimationFrame(this._animationTick);
    }
  }

  /**
   * Compute the x/y for an answer given the "=" group bounding box.
   */
  static answerPosition(equalsBBox: BBox, penWidth: number): { x: number; y: number } {
    return {
      x: equalsBBox.maxX + penWidth,
      y: (equalsBBox.minY + equalsBBox.maxY) / 2,
    };
  }
}
