/**
 * CalcInk – Stroke Data Model
 * src/canvas/stroke.ts
 *
 * Defines the data structures that store every user stroke.
 * These objects are later consumed by the recognition module.
 */
/** Create a fresh empty stroke with a new id */
let _nextId = 1;
export function createStroke(width, color) {
    return {
        id: String(_nextId++),
        points: [],
        width,
        color,
    };
}
/** Reset the id counter (used in tests only) */
export function _resetIdCounter() {
    _nextId = 1;
}
