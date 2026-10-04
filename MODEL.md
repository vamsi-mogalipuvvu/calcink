# CalcInk – Model Report

## Recognition Architecture

CalcInk uses a **two-stage hybrid classifier** to recognise all 16 symbols
(`0–9 + − × ÷ . =`) entirely client-side with no network requests.

---

## Stage 1 – MNIST Digit Model (0–9)

| Field | Value |
|---|---|
| **Model name** | MNIST-12 |
| **Source** | [ONNX Model Zoo – MNIST](https://github.com/onnx/models/tree/main/validated/vision/classification/mnist) |
| **License** | MIT |
| **Architecture** | 2-layer CNN (Conv → ReLU → MaxPool × 2 → FC → Softmax) |
| **Input shape** | `[1, 1, 28, 28]` — grayscale, white-on-black, values 0.0–1.0 |
| **Output** | 10 logits → softmax → digit `0`–`9` |
| **File** | `public/models/mnist-12.onnx` (26 KB) |
| **Inference runtime** | `onnxruntime-web` 1.x, WASM backend |
| **Where it runs** | Web Worker (`src/recognition/worker.ts`) — never on the main thread |

### Preprocessing pipeline

1. Render strokes to `OffscreenCanvas` (112×112) — white ink, black background  
2. Downscale to 28×28 with bilinear interpolation (`drawImage`)  
3. Extract red channel, normalise to `[0.0, 1.0]`  
4. Wrap in `Float32Array` shape `[1, 1, 28, 28]`

Stroke width is scaled proportionally to the symbol bounding box size so thin
and thick handwriting produce comparably thick rendered glyphs.

---

## Stage 2 – Geometry Operator Classifier (+  −  ×  ÷  .  =)

A hand-written rule classifier that uses **relative geometry only** (no absolute
pixel values, fully resolution-independent):

| Symbol | Rules |
|---|---|
| `.` | Single stroke, height < 25% of median line height |
| `−` | Single stroke, aspect ratio > 1.6, angle < 30° (flat) |
| `=` | Two strokes, both flat, vertically separated 15%–85% of group height, each spanning ≥ 40% of group width |
| `+` | Two strokes: one flat + one steep, crossing bboxes; OR single stroke with ≥1 direction reversal in each axis |
| `×` | Two strokes, both diagonal (25°–65°), crossing bboxes, angles opposite sign |
| `÷` | Three strokes: one flat bar spanning ≥ 35% of width, two small dots above and below the bar |

### Known confusion handling

| Confusion | Resolution |
|---|---|
| `1` vs `−` | MNIST handles `1` (tall/narrow); `−` requires aspect ratio > 1.6 AND short height |
| `.` vs small `0` | Operator classifier fires first for very small strokes; MNIST takes over if relSize ≥ 0.25 |
| `+` vs `×` | `+` has one horizontal + one vertical stroke; `×` requires both strokes to be diagonal |
| `=` vs two separate `−` | Grouped only if written within 800ms and bboxes close; two far-apart minus signs form separate groups |

---

## Why the Hybrid Approach?

| Reason | Details |
|---|---|
| **No ONNX model covers all 16 symbols** | After exhaustive search of Hugging Face, ONNX Model Zoo, and GitHub, no single pre-trained, downloadable ONNX/TF.js model exists that covers `0–9 + − × ÷ . =` in a browser-deployable size. |
| **Operators have strong geometric signatures** | `+`, `×`, `=`, `÷`, `−`, `.` are structurally distinct from digits — stroke count, aspect ratio, and crossing topology reliably distinguish them without ML. This is the same approach used in MyScript and similar commercial solutions. |
| **MNIST is the best available pre-trained model** | MIT-licensed, 26 KB, well-tested on 70,000 digit images, available as ready-to-download ONNX from the ONNX Model Zoo. Digit recognition accuracy on standard MNIST test set: **~99.3%**. |
| **Size budget** | MNIST: 26 KB. ORT WASM: ~14 MB (bundled). Total addition: ~14 MB — acceptable for a hackathon PWA. |

---

## Alternatives Rejected

| Model | Reason for rejection |
|---|---|
| `fhswf/TrOCR_Math_handwritten` (HF) | 400MB+, designed for full-expression LaTeX generation, not isolated symbol classification |
| HASYv2 CNNs (GitHub) | Training code exists, but no hosted pre-trained ONNX weights |
| EMNIST | Digits + letters only; no math operators |
| `TGrote11/Handwriting_Math_Classification` (HF) | Model page exists but weights are inaccessible / not downloadable |
