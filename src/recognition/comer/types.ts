import type { LatexNormalizeResult } from '../latexNormalize';

export type ComerRecognitionMode = 'number' | 'expression';

export interface ComerResult {
  latex: string;
  expressionResult: LatexNormalizeResult;
  confidence?: number;
}

export interface ComerConfig {
  encoderUrl: string;
  decoderUrl: string;
  vocabUrl: string;
  mode: ComerRecognitionMode;
  beamWidth: number;
  executionProvider: 'wasm' | 'webgpu';
}
