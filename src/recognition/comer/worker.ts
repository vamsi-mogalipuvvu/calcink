import * as ort from 'onnxruntime-web';
import { ComerEngine } from './engine';
import { loadVocab, Vocab } from './vocab';
import { preprocessStrokesForComer } from './preprocess';
import { normalizeLatexExpression } from '../latexNormalize';
import type { ComerConfig, ComerRecognitionMode } from './types';
import type { Stroke } from '../../canvas/stroke';

ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;
// No proxy for WASM workers
ort.env.wasm.proxy = false;

let engine: ComerEngine | null = null;
let vocab: Vocab | null = null;
let initPromise: Promise<void> | null = null;
let currentJobId: number | null = null;

async function doInit() {
  const config: ComerConfig = {
    encoderUrl: '/models/comer/encoder_int8.onnx',
    decoderUrl: '/models/comer/decoder_int8.onnx',
    vocabUrl: '/models/comer/vocab.json',
    mode: 'number',
    beamWidth: 1,
    executionProvider: 'wasm'
  };
  
  engine = new ComerEngine(config);
  vocab = await loadVocab(config.vocabUrl);
  await engine.init();
  
  self.postMessage({ type: 'READY' });
}

self.onmessage = async (e: MessageEvent) => {
  const { type, id, strokes, penWidth } = e.data as {
    type: string;
    id: number;
    strokes: Stroke[];
    penWidth: number;
    mode: ComerRecognitionMode;
  };
  
  if (type === 'INIT') {
    if (!initPromise) initPromise = doInit();
    await initPromise;
    return;
  }
  
  if (type === 'CANCEL') {
    if (currentJobId === id) {
      currentJobId = null; // Basic cancellation marker
    }
    return;
  }
  
  if (type === 'RECOGNIZE') {
    currentJobId = id;
    try {
      if (!initPromise) initPromise = doInit();
      await initPromise;
      
      if (currentJobId !== id) return; // cancelled while initializing
      
      const input = preprocessStrokesForComer(strokes, penWidth);
      if (currentJobId !== id) return;
      
      const latex = await engine!.recognize(input, vocab!);
      if (currentJobId !== id) return;
      
      const expressionResult = normalizeLatexExpression(latex);
      
      self.postMessage({
        type: 'RESULT',
        id,
        latex,
        expressionResult
      });
    } catch (err: any) {
      self.postMessage({
        type: 'ERROR',
        id,
        message: err.message || 'Unknown error'
      });
    }
  }
};
