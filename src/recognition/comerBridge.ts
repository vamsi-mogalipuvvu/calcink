import type { Stroke } from '../canvas/stroke';
import type { ComerRecognitionMode, ComerResult } from './comer/types';

export interface ComerBridgeOptions {
  onReady?: () => void;
  onError?: (err: Error) => void;
}

export class ComerBridge {
  private worker: Worker;
  private nextJobId = 1;
  private pendingJobs = new Map<
    number,
    { resolve: (r: ComerResult) => void; reject: (e: Error) => void }
  >();
  private ready = false;

  constructor(options?: ComerBridgeOptions) {
    this.worker = new Worker(new URL('./comer/worker.ts', import.meta.url), { type: 'module' });
    
    this.worker.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (data.type === 'READY') {
        this.ready = true;
        options?.onReady?.();
      } else if (data.type === 'RESULT') {
        const job = this.pendingJobs.get(data.id);
        if (job) {
          job.resolve({ latex: data.latex, expressionResult: data.expressionResult });
          this.pendingJobs.delete(data.id);
        }
      } else if (data.type === 'ERROR') {
        const job = this.pendingJobs.get(data.id);
        if (job) {
          job.reject(new Error(data.message));
          this.pendingJobs.delete(data.id);
        } else {
          options?.onError?.(new Error(data.message));
        }
      }
    };
    
    this.worker.postMessage({ type: 'INIT' });
  }

  public isReady() {
    return this.ready;
  }

  public recognize(strokes: Stroke[], penWidth: number, mode: ComerRecognitionMode = 'number'): Promise<ComerResult> {
    const id = this.nextJobId++;
    return new Promise((resolve, reject) => {
      this.pendingJobs.set(id, { resolve, reject });
      this.worker.postMessage({
        type: 'RECOGNIZE',
        id,
        strokes,
        penWidth,
        mode
      });
    });
  }

  public cancelPending() {
    for (const [id, job] of this.pendingJobs.entries()) {
      job.reject(new Error('Cancelled'));
      this.worker.postMessage({ type: 'CANCEL', id });
    }
    this.pendingJobs.clear();
  }
}

let bridgeInstance: ComerBridge | null = null;
export function getComerBridge(options?: ComerBridgeOptions): ComerBridge {
  if (!bridgeInstance) {
    bridgeInstance = new ComerBridge(options);
  }
  return bridgeInstance;
}
