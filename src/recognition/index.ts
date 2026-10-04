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

import type { Stroke } from '../canvas/stroke.js';

// ── Types ─────────────────────────────────────────────────────

export interface RecognitionResult {
  expression: string;
}

type WorkerMessage =
  | { type: 'RESULT'; id: number; expression: string }
  | { type: 'ERROR';  id: number; message: string }
  | { type: 'READY' };

// ── Bridge ────────────────────────────────────────────────────

export class RecognitionBridge {
  private worker: Worker;
  private ready   = false;
  private nextId  = 1;
  private pending = new Map<number, {
    resolve: (r: RecognitionResult) => void;
    reject:  (e: Error) => void;
  }>();

  /** Called when worker becomes ready (model loaded) */
  onReady?: () => void;

  constructor() {
    // Vite detects the new URL(..., import.meta.url) pattern and bundles
    // the worker as a separate chunk. Use the .ts source path.
    this.worker = new Worker(
      new URL('./worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.worker.addEventListener('message', this._handleMessage);
    this.worker.addEventListener('error', (e) => {
      console.error('[RecognitionBridge] Worker error:', e);
    });
  }

  get isReady(): boolean { return this.ready; }

  /**
   * Send strokes to the worker for recognition.
   * Returns a promise that resolves with the expression string.
   * Any previous pending request is cancelled.
   */
  recognize(strokes: Stroke[], penWidth: number): Promise<RecognitionResult> {
    // Cancel previous job
    for (const [id, { reject }] of this.pending) {
      this.worker.postMessage({ type: 'CANCEL', id });
      reject(new Error('Cancelled'));
    }
    this.pending.clear();

    const id = this.nextId++;
    const promise = new Promise<RecognitionResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.worker.postMessage({ type: 'RECOGNIZE', id, strokes, penWidth });
    return promise;
  }

  destroy(): void {
    this.worker.terminate();
    this.pending.clear();
  }

  private _handleMessage = (e: MessageEvent<WorkerMessage>): void => {
    const msg = e.data;

    if (msg.type === 'READY') {
      this.ready = true;
      this.onReady?.();
      return;
    }

    const handlers = this.pending.get(msg.id);
    if (!handlers) return; // Stale result

    this.pending.delete(msg.id);

    if (msg.type === 'RESULT') {
      handlers.resolve({ expression: msg.expression });
    } else if (msg.type === 'ERROR') {
      handlers.reject(new Error(msg.message));
    }
  };
}

// Singleton bridge instance
let _bridge: RecognitionBridge | null = null;

export function getRecognitionBridge(): RecognitionBridge {
  if (!_bridge) _bridge = new RecognitionBridge();
  return _bridge;
}
