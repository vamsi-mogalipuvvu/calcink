import * as ort from 'onnxruntime-web';
import type { ComerConfig } from './types';
import type { PreprocessResult } from './preprocess';
import type { Vocab } from './vocab';
import { decodeToTokenArray } from './vocab';

const DEFAULT_MAX_STEPS = 50;
const REPEAT_LIMIT = 3;

// Number mode: digits + basic operators + \frac + structural tokens
const NUMBER_MODE_ALLOWED: Set<number> = new Set([
  0, 1, 2, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 50, 53, 69, 78, 82, 83, 110, 112
]);

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export class ComerEngine {
  private encoderSession: ort.InferenceSession | null = null;
  private decoderSession: ort.InferenceSession | null = null;
  private loading: Promise<void> | null = null;

  constructor(private config: ComerConfig) {}

  async init(): Promise<void> {
    if (this.encoderSession && this.decoderSession) return;
    if (this.loading) return this.loading;
    this.loading = this._loadSessions();
    await this.loading;
  }

  private async _loadSessions(): Promise<void> {
    const ep = this.config.executionProvider;
    const opts: ort.InferenceSession.SessionOptions = { executionProviders: [ep] };
    try {
      this.encoderSession = await ort.InferenceSession.create(this.config.encoderUrl, opts);
      this.decoderSession = await ort.InferenceSession.create(this.config.decoderUrl, opts);
    } catch {
      if (ep !== "wasm") {
        const fallback: ort.InferenceSession.SessionOptions = { executionProviders: ["wasm"] };
        this.encoderSession = await ort.InferenceSession.create(this.config.encoderUrl, fallback);
        this.decoderSession = await ort.InferenceSession.create(this.config.decoderUrl, fallback);
      } else {
        throw new Error("Failed to create ONNX sessions for CoMER");
      }
    }
  }

  private async runDecoder(encoderFeatures: ort.Tensor, encoderMask: ort.Tensor, ids: number[]): Promise<Float32Array> {
    const inputIds = new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]);
    const res = await this.decoderSession!.run({
      encoder_features: encoderFeatures,
      encoder_mask: encoderMask,
      input_ids: inputIds,
    });
    inputIds.dispose();
    return res["logits"]!.data as Float32Array;
  }

  private logSoftmax(logits: Float32Array, offset: number, size: number): Float64Array {
    const result = new Float64Array(size);
    let max = -Infinity;
    for (let i = 0; i < size; i++) {
      const v = logits[offset + i];
      if (v > max) max = v;
    }
    let sumExp = 0;
    for (let i = 0; i < size; i++) {
      sumExp += Math.exp(logits[offset + i] - max);
    }
    const logSumExp = Math.log(sumExp);
    for (let i = 0; i < size; i++) {
      result[i] = logits[offset + i] - max - logSumExp;
    }
    return result;
  }

  async recognize(input: PreprocessResult, vocab: Vocab): Promise<string> {
    await this.init();
    const pixelValues = new ort.Tensor("float32", input.tensor, [1, 1, input.height, input.width]);
    const pixelMask = new ort.Tensor("bool", input.mask, [1, input.maskHeight, input.maskWidth]);
    const encResult = await this.encoderSession!.run({ pixel_values: pixelValues, pixel_mask: pixelMask });
    pixelValues.dispose();
    pixelMask.dispose();

    const encoderFeatures = encResult["encoder_features"]!;
    const encoderMask = encResult["encoder_mask"]!;

    const { sos, eos } = vocab.special_tokens;
    const vocabSize = vocab.vocab_size;
    const allowedTokens = this.config.mode === "number" ? NUMBER_MODE_ALLOWED : null;

    const tokenIds: number[] = [sos];
    let repeatCount = 0;
    let lastToken = -1;

    // Use greedy decoding logic based on reference, because it's fast enough for main usage
    // beamWidth \u003e 1 could be added later if needed.
    for (let step = 0; step < DEFAULT_MAX_STEPS; step++) {
      if (step > 0 && step % 5 === 0) await yieldToMain();

      const logits = await this.runDecoder(encoderFeatures, encoderMask, tokenIds);
      const offset = (tokenIds.length - 1) * vocabSize;
      const logProbs = this.logSoftmax(logits, offset, vocabSize);
      
      if (allowedTokens) {
        for (let i = 0; i < vocabSize; i++) {
          if (!allowedTokens.has(i)) {
            logProbs[i] = -Infinity;
          }
        }
      }

      let maxVal = -Infinity;
      let maxIdx = 0;
      for (let i = 0; i < vocabSize; i++) {
        if (logProbs[i] > maxVal) {
          maxVal = logProbs[i];
          maxIdx = i;
        }
      }

      if (maxIdx === eos) break;
      if (maxIdx === lastToken) {
        repeatCount++;
        if (repeatCount >= REPEAT_LIMIT) break;
      } else {
        repeatCount = 0;
      }
      lastToken = maxIdx;
      tokenIds.push(maxIdx);
    }
    
    encoderFeatures.dispose();
    encoderMask.dispose();

    const tokens = decodeToTokenArray(tokenIds.slice(1), vocab);
    return tokens.join(" ");
  }

  dispose(): void {
    this.encoderSession?.release();
    this.decoderSession?.release();
    this.encoderSession = null;
    this.decoderSession = null;
    this.loading = null;
  }
}
