/**
 * CalcInk – Undo/Redo History
 * src/canvas/history.ts
 *
 * Lightweight command stack for undo/redo.  Each "command" is a snapshot
 * of the strokes array before the action – simple and correct for small
 * drawing sessions.  We cap history at MAX_HISTORY entries to bound memory.
 */

import type { Stroke } from './stroke.js';

const MAX_HISTORY = 100;

export class DrawHistory {
  /** Stack of past states (index 0 = oldest) */
  private undoStack: Stroke[][] = [];
  /** Stack of future states after an undo */
  private redoStack: Stroke[][] = [];

  /**
   * Call this BEFORE any mutation to record the current state.
   * @param current - The current strokes array (will be deep-cloned).
   */
  push(current: Stroke[]): void {
    this.undoStack.push(this._clone(current));
    // Trim oldest entries if over limit
    if (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift();
    }
    // Any new action clears the redo future
    this.redoStack = [];
  }

  /**
   * Undo: restore the previous state.
   * @param current - The current strokes (so we can redo back to it).
   * @returns The restored strokes array, or null if nothing to undo.
   */
  undo(current: Stroke[]): Stroke[] | null {
    if (this.undoStack.length === 0) return null;
    this.redoStack.push(this._clone(current));
    return this.undoStack.pop()!;
  }

  /**
   * Redo: re-apply the state undone.
   * @param current - The current strokes.
   * @returns The restored strokes array, or null if nothing to redo.
   */
  redo(current: Stroke[]): Stroke[] | null {
    if (this.redoStack.length === 0) return null;
    this.undoStack.push(this._clone(current));
    return this.redoStack.pop()!;
  }

  /** Whether undo is possible */
  get canUndo(): boolean { return this.undoStack.length > 0; }

  /** Whether redo is possible */
  get canRedo(): boolean { return this.redoStack.length > 0; }

  /** Clear all history */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Deep-clone strokes array (points arrays are value types so one level deep is fine) */
  private _clone(strokes: Stroke[]): Stroke[] {
    return strokes.map(s => ({
      ...s,
      points: s.points.map(p => ({ ...p })),
    }));
  }
}
