/**
 * CalcInk – Recognition Worker Bridge
 * src/recognition/index.ts
 *
 * Main-thread interface to the recognition Web Worker.
 * Handles:
 *  - Worker lifecycle (create, destroy)
 *  - Debounced recognition requests (300ms)
 *  - Cancellation of stale jobs
 *  - Typed message passing
 */
// ── Bridge ────────────────────────────────────────────────────
export class RecognitionBridge {
    constructor() {
        Object.defineProperty(this, "worker", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "ready", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "nextId", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 1
        });
        Object.defineProperty(this, "pending", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        /** Called when worker becomes ready (model loaded) */
        Object.defineProperty(this, "onReady", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "_handleMessage", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (e) => {
                const msg = e.data;
                if (msg.type === 'READY') {
                    this.ready = true;
                    this.onReady?.();
                    return;
                }
                const handlers = this.pending.get(msg.id);
                if (!handlers)
                    return; // Stale result
                this.pending.delete(msg.id);
                if (msg.type === 'RESULT') {
                    handlers.resolve({ expression: msg.expression, debug: msg.debug });
                }
                else if (msg.type === 'ERROR') {
                    handlers.reject(new Error(msg.message));
                }
            }
        });
        // Vite detects the new URL(..., import.meta.url) pattern and bundles
        // the worker as a separate chunk. Use the .ts source path.
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        this.worker.addEventListener('message', this._handleMessage);
        this.worker.addEventListener('error', (e) => {
            console.error('[RecognitionBridge] Worker error:', e);
        });
    }
    get isReady() { return this.ready; }
    /**
     * Send strokes to the worker for recognition.
     * Returns a promise that resolves with the expression string.
     * Any previous pending request is cancelled.
     */
    recognize(strokes, penWidth) {
        // Cancel previous job
        for (const [id, { reject }] of this.pending) {
            this.worker.postMessage({ type: 'CANCEL', id });
            reject(new Error('Cancelled'));
        }
        this.pending.clear();
        const id = this.nextId++;
        const promise = new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
        });
        this.worker.postMessage({ type: 'RECOGNIZE', id, strokes, penWidth });
        return promise;
    }
    destroy() {
        this.worker.terminate();
        this.pending.clear();
    }
}
// Singleton bridge instance
let _bridge = null;
export function getRecognitionBridge() {
    if (!_bridge)
        _bridge = new RecognitionBridge();
    return _bridge;
}
