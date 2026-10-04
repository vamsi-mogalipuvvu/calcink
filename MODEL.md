See README.md for the full architecture.

# CalcInk Model Report

## Recognition Architecture

CalcInk uses a two-stage hybrid recognizer for the project vocabulary:

`0-9`, `+`, `-`, `x`, division, `.`, and `=`.

All recognition runs client-side in `src/recognition/worker.ts`. The worker loads the bundled MNIST-12 ONNX model once from `/models/mnist-12.onnx`, groups incoming strokes, classifies each group, applies stray-dot postprocessing, and returns both the expression string and per-group debug data.

## Stage 1: MNIST Digit Model

| Field | Value |
|---|---|
| Model name | MNIST-12 |
| Source | ONNX Model Zoo MNIST: https://github.com/onnx/models/tree/main/validated/vision/classification/mnist |
| License | MIT |
| Architecture | Small CNN with alternating convolution/max-pool blocks, trained in CNTK per the CNTK 103D tutorial. |
| Input shape | `[1, 1, 28, 28]`, grayscale white-on-black, values `0.0` to `1.0` |
| Output | 10 logits, converted by CalcInk to softmax probabilities for digits `0`-`9` |
| File | `public/models/mnist-12.onnx` |
| Size | 26 KB |
| Reported error | 1.1% top-1 error on MNIST |
| Runtime | `onnxruntime-web` WASM backend inside a Web Worker |

### Preprocessing Pipeline

1. The worker receives vector strokes as CSS-pixel `{ x, y, t, pressure }` points.
2. `preprocessSymbol()` renders each symbol group to a 112x112 `OffscreenCanvas`.
3. Strokes are drawn as white ink on a black background.
4. Input points are smoothed with two moving-average passes when there are at least five points.
5. The renderer uses 15% padding and a fixed stroke width equal to 10% of the 112px render size; it does not scale the model ink width from the user's pen width.
6. The 112x112 image is downscaled to 28x28 with canvas image smoothing.
7. The red channel is divided by 255 into a `Float32Array`.
8. `centerByMass()` shifts the 28x28 tensor toward the MNIST center of mass at `(13.5, 13.5)`.
9. ONNX Runtime receives the tensor with shape `[1, 1, 28, 28]`.

## Stage 2: Geometry Operator Classifier

Operators are recognized with relative geometry in `src/recognition/operatorClassifier.ts`.

| Symbol | Current rule summary |
|---|---|
| `.` | Single tiny stroke with relative height `< 0.25` and aspect ratio between `0.4` and `2.5`, or a very small bbox. |
| `-` | Single wide flat stroke: aspect ratio `> 1.6`, angle near horizontal, and height `< 0.4 * medianLineHeight`. |
| `=` | Two strokes, both flat, vertical separation `> 5%` and `< 200%` of group width, each spanning `> 40%` of group width. |
| `+` | Two crossing strokes where one is flat and one is steep; a weaker single-stroke plus rule also exists. |
| `x` | Two crossing diagonal strokes with diagonal angles and sufficient angle difference/opposite sign. |
| Division | Three strokes: one flat bar spanning `> 35%` of group width plus one small dot above and one below. |

The worker accepts multi-stroke operator results at confidence `>= 0.80` and single-stroke quick operator results at confidence `>= 0.88`. MNIST digit results are accepted at confidence `>= 0.65`; low-confidence digit results can fall back to an operator result.

## Stroke Grouping

Grouping is spatial-first and time-secondary in `src/recognition/grouper.ts`.

- Strokes are sorted by start time.
- Each new stroke scans the last 3 groups for the best merge candidate.
- The general spatial gate requires horizontal overlap of at least 30% of the narrower bbox width and a vertical gap no larger than 55% of the reference width.
- The grouping time limit is 4 seconds.
- A special stacked-flat-stroke gate handles `=`: both boxes must be flat, widths comparable, horizontal overlap at least 60%, and vertical gap no larger than `1.5x` the wider stroke width.
- A post-pass also merges consecutive single-stroke flat groups that satisfy the same strong-overlap and `1.5x` width gap rule.
- Side-by-side minus signs do not merge because they fail the horizontal-overlap gate.

## Postprocessing

`strayDotMask()` removes stray decimal dots before forming the final expression. A `.` is kept only when both neighboring symbols are digits. The worker keeps all debug groups and marks filtered groups with `dropped: true` so answer placement remains aligned with the original stroke groups.

## Why The Hybrid Approach

| Reason | Details |
|---|---|
| Browser/offline fit | MNIST-12 is small, bundled, and runs through ONNX Runtime Web in a worker. |
| Operator geometry is strong | Operators in this vocabulary are largely separable by stroke count, aspect ratio, crossing structure, and relative dot/bar placement. |
| No training required | The digit model is pre-trained; operator rules are deterministic and local to the app. |
| Position preservation | Symbol grouping keeps bounding boxes, allowing answers to be placed next to the terminal `=` on the canvas. |

## Alternatives Rejected

| Model/resource | Reason |
|---|---|
| `nikkii03/Handwritten_Maths_Evaluator` | Has useful weights, but no stated license for redistribution. |
| `TGrote11/Handwriting_Math_Classification` | Large 87.5M-parameter ViT and not suitable for this browser-sized target. |
| `Yoshibansal/handwritten-mathematical-symbols` | MIT code/dataset work, but no published weights to bundle directly. |
| `whywhs/Pytorch-HMER` | Whole-expression LaTeX recognizer, hard to port to this browser pipeline, and not designed to return symbol positions. |
| `kimseungdae/ink-on` | Promising Apache-2.0 browser ONNX expression recognizer, but whole-expression output does not directly provide the `=` symbol position needed for inline answer placement. |
| PosFormer / HMER GGUF variants | Wrong runtime format for this app and restrictive non-commercial licensing in some variants. |
| TrOCR math variants | Too large for the offline browser budget. |
| Plain MNIST/EMNIST models | Digits only; MNIST-12 is the smallest and best documented model already in ONNX form. |
