/**
 * CalcInk – Undo/Redo History
 * src/canvas/history.ts
 *
 * Lightweight command stack for undo/redo.  Each "command" is a snapshot
 * of the strokes array before the action – simple and correct for small
 * drawing sessions.  We cap history at MAX_HISTORY entries to bound memory.
 */
const MAX_HISTORY = 100;
export class DrawHistory {
    constructor() {
        /** Stack of past states (index 0 = oldest) */
        Object.defineProperty(this, "undoStack", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        /** Stack of future states after an undo */
        Object.defineProperty(this, "redoStack", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
    }
    /**
     * Call this BEFORE any mutation to record the current state.
     * @param current - The current strokes array (will be deep-cloned).
     */
    push(current) {
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
    undo(current) {
        if (this.undoStack.length === 0)
            return null;
        this.redoStack.push(this._clone(current));
        return this.undoStack.pop();
    }
    /**
     * Redo: re-apply the state undone.
     * @param current - The current strokes.
     * @returns The restored strokes array, or null if nothing to redo.
     */
    redo(current) {
        if (this.redoStack.length === 0)
            return null;
        this.undoStack.push(this._clone(current));
        return this.redoStack.pop();
    }
    /** Whether undo is possible */
    get canUndo() { return this.undoStack.length > 0; }
    /** Whether redo is possible */
    get canRedo() { return this.redoStack.length > 0; }
    /** Clear all history */
    clear() {
        this.undoStack = [];
        this.redoStack = [];
    }
    /** Deep-clone strokes array (points arrays are value types so one level deep is fine) */
    _clone(strokes) {
        return strokes.map(s => ({
            ...s,
            points: s.points.map(p => ({ ...p })),
        }));
    }
}
