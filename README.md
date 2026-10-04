# CalcInk

CalcInk is an on-device handwritten arithmetic notebook: users draw an expression with mouse, touch, or stylus, end it with `=`, and the app recognizes the strokes, evaluates the expression, and renders the answer inline on the canvas. It is built for the Inter IIT Tech Meet Bootcamp Phase 1 Software PS and runs fully client-side/offline after the app assets are loaded.

- Repository: https://github.com/vamsi-mogalipuvvu/calcink
- Live demo: `https://calcink-three.vercel.app`
- License: MIT

## Quick Start

Requires Node 18+.

```bash
npm install
npm run dev
```

Development server: http://localhost:5173

```bash
npm test
npm run build
npm run preview
```

Preview server: http://localhost:4173

## Verify Offline Mode

```bash
npm run build
npm run preview
```

Open the preview once and wait about 10 seconds for the service worker to precache the build. The latest checked build precached 65 entries (29823.64 KiB). Then stop the server or enable DevTools offline mode, reload the page, write `4×3=` with a crossed-diagonal multiply sign, and CalcInk should display `12` next to the equals sign.

There is one ONNX Runtime WASM request in the production build; it is served from the ServiceWorker cache after precaching, not from the network.

## Features

| Area | Current implementation |
|---|---|
| Canvas | Pointer Events for mouse, touch, and stylus; smooth quadratic stroke rendering; undo/redo; stroke eraser; pixel eraser; clear canvas; stroke-width slider; HiDPI scaling with `window.devicePixelRatio`. |
| Recognition | Web Worker pipeline that groups strokes, classifies operators by geometry, and classifies digits with bundled MNIST-12 ONNX. |
| Evaluation | Deterministic tokenizer, shunting-yard parser, and RPN evaluator; no `eval()`; supports precedence, decimals, unary minus, and division-by-zero handling. |
| Reactive projection | Recognition is debounced and rerun after stroke edits; answers are positioned next to the detected `=` group on a separate overlay canvas. |
| Fault tolerance | Malformed expressions show `?`; division by zero shows `Undefined`; stale recognition jobs are cancelled. |
| Offline PWA | Vite PWA precaches HTML, JS, CSS, fonts, model, and WASM assets for offline reloads. |

## Creative Extensions

- Scratch-to-erase detects back-and-forth scribbles in `src/canvas/scratch.ts` and removes ink under the scratch without keeping the scribble stroke.
- Confidence indicators underline recognized symbols with high/mid/low confidence marks on the answer overlay.
- Audio and haptic feedback live in `src/ui/feedback.ts`, use generated WebAudio tones, and can be muted from the toolbar.
- Answers fade in on the overlay canvas when a new result appears.
- The pixel eraser edits stroke data directly, so erased ink stays erased through redraws, recognition, undo, and export-like stroke reads.

## Architecture

```text
PointerEvent samples
  -> InkCanvas stroke store
  -> 350 ms debounced RecognitionBridge
  -> recognition Web Worker
  -> groupStrokes()
  -> operator geometry rules OR MNIST-12 ONNX inference
  -> stray-dot filtering
  -> main-thread line split and "=" placement
  -> shunting-yard evaluator
  -> AnswerOverlay canvas
```

Recognition runs in a Web Worker. The main thread uses a 350 ms debounce before sending strokes to the worker, and `RecognitionBridge` cancels stale pending jobs when a newer request starts. ONNX Runtime Web is imported through `onnxruntime-web/all`; the worker config uses single-threaded WASM (`numThreads = 1`) with no proxy. The MNIST model is loaded once from `/models/mnist-12.onnx`. Answers are drawn on a separate overlay canvas so the user's ink strokes remain unchanged.

| File | Responsibility |
|---|---|
| `src/main.ts` | Wires DOM controls, canvas, recognition bridge, debug panel, evaluation, and answer overlay. |
| `src/style.css` | Notebook-paper UI, toolbar, status/debug panels, canvas layout, and responsive styles. |
| `src/canvas/answerOverlay.ts` | Draws inline answer text on a separate overlay canvas next to `=`. |
| `src/canvas/history.ts` | Bounded snapshot-based undo/redo stack for stroke arrays. |
| `src/canvas/inkCanvas.ts` | Pointer capture, HiDPI canvas sizing, drawing, stroke/pixel erasers, clear, undo/redo, and keyboard shortcuts. |
| `src/canvas/stroke.ts` | Stroke and point data types, stroke factory, id reset helper, and point densification for erasing. |
| `src/math/evaluator.ts` | Tokenizer, shunting-yard parser, RPN evaluator, and result formatter. |
| `src/recognition/grouper.ts` | Spatial-first stroke grouping, line splitting, bounding boxes, and overlap helpers. |
| `src/recognition/index.ts` | Main-thread worker bridge, cancellation, message handling, and typed recognition results. |
| `src/recognition/operatorClassifier.ts` | Rule-based classifier for `.`, `-`, `+`, `x`, division, and `=` geometry. |
| `src/recognition/postprocess.ts` | Stray decimal-dot mask; a `.` is kept only between two digits. |
| `src/recognition/preprocessor.ts` | Renders vector strokes into MNIST-compatible `[1,1,28,28]` tensors. |
| `src/recognition/worker.ts` | Loads ONNX model, groups strokes, classifies symbols, applies postprocessing, and returns expression/debug data. |

## Recognition Pipeline

Stroke capture stores points as `{ x, y, t, pressure }` in CSS pixels. The canvas is physically scaled by `devicePixelRatio`, but stroke data stays in CSS-pixel coordinates.

`groupStrokes()` sorts strokes by start time and merges them into symbol groups using spatial gates. General merges require at least 30% horizontal overlap of the narrower bounding box and a vertical gap no larger than 55% of the larger relevant width. Stacked flat strokes, mainly `=`, have a special gate: both boxes must be flat, widths must be comparable, horizontal overlap must be at least 60%, and vertical gap can be up to 1.5x the wider stroke width. The grouping time limit is 4 seconds, the lookback window is 3 groups, and a post-pass can merge consecutive flat groups that clearly form `=`.

The worker classifies multi-stroke groups with the operator classifier first and accepts operator results at confidence `>= 0.80`. It also tries single-stroke operator rules, accepting them at `>= 0.88`. If no operator rule is accepted, the group is rendered for MNIST digit inference. MNIST results are accepted at confidence `>= 0.65`; below that, any available operator result is used as a fallback.

The preprocessor renders vector strokes to a 112x112 `OffscreenCanvas`, white ink on black background. It applies two-pass moving-average smoothing, uses 15% padding, and uses a fixed stroke width equal to 10% of the render size, independent of the user's pen width. The image is downscaled with smoothing to 28x28, converted from the red channel `/ 255` into a `Float32Array`, center-of-mass shifted toward `(13.5, 13.5)`, and passed to ONNX Runtime as shape `[1,1,28,28]`.

The worker applies softmax to the MNIST logits, keeps every debug group, and marks symbols dropped by the stray-dot filter. The filter keeps `.` only when both neighboring symbols are digits, so accidental taps outside decimals do not break answer placement. On the main thread, lines are split by vertical centers, the last `=` on each line is used as the answer anchor, and the expression before `=` is evaluated by the shunting-yard parser.

## Model Attribution

| Field | Value |
|---|---|
| Model | MNIST-12 |
| Source | ONNX Model Zoo MNIST: https://github.com/onnx/models/tree/main/validated/vision/classification/mnist |
| License | MIT |
| Architecture | Small CNN with alternating convolution/max-pool blocks, trained in CNTK per the CNTK 103D tutorial. |
| Input | Grayscale tensor `[1,1,28,28]`, white ink on black background, values `0.0` to `1.0`. |
| Output | 10 digit logits for `0` through `9`; CalcInk applies softmax. |
| Bundled file | `public/models/mnist-12.onnx` |
| Size | 26 KB |
| Reported error | 1.1% top-1 error on MNIST |
| Runtime | `onnxruntime-web` WASM backend inside `src/recognition/worker.ts`. |

## Why A Hybrid Model

A single small, license-clear, browser-ready model covering digits plus `+ - x / . =` was not found. CalcInk therefore uses MNIST-12 where it is strongest, for digits, and uses geometry for operators whose stroke count, aspect ratio, crossing pattern, and relative dot/bar placement are distinctive. This keeps the runtime small, offline, and fast enough to run off the main thread.

| Alternative | License | Why not used |
|---|---|---|
| `nikkii03/Handwritten_Maths_Evaluator` | None stated | Has weights for digits and `+ - x /`, but no license means it cannot be redistributed safely. |
| `TGrote11/Handwriting_Math_Classification` | None stated | 87.5M-parameter ViT, too large for this browser/offline target. |
| `Yoshibansal/handwritten-mathematical-symbols` | MIT | HASYv2 training work, but no published weights to bundle directly. |
| `whywhs/Pytorch-HMER` | MIT | Whole-expression to LaTeX system; hard to port to this browser pipeline and reported accuracy is low for exact expressions. |
| `kimseungdae/ink-on` | Apache-2.0 | CoMER INT8 ONNX, about 7.2 MB, whole-expression recognizer; promising future experiment, but it does not directly provide symbol positions needed to place the answer next to `=`. |
| PosFormer / HMER GGUF variants | CC BY-NC-SA | Restrictive non-commercial license and wrong runtime format for this Vite/ONNX Runtime Web app. |
| TrOCR math variants | Varies | Around 2.4 GB for some variants, far too large for this client-side/offline scope. |
| Plain MNIST/EMNIST models | Varies | Digits or letters only; MNIST-12 is the smallest and best documented digit-only option already available in ONNX format. |

## Experimental CoMER Mode (Blocked)

An experimental recognition mode based on the [ink-on](https://github.com/kimseungdae/ink-on) project (CoMER INT8 ONNX, ECCV 2022) was investigated to provide a unified end-to-end recognition pipeline. 

The implementation requires the following local assets to be present in `public/models/comer/`:
- `encoder_int8.onnx` (~3.4 MB)
- `decoder_int8.onnx` (~4.0 MB)
- `vocab.json`

Because the project mandates 100% offline operation and zero network runtime dependency, these assets cannot be downloaded on the fly from Hugging Face or GitHub at runtime. As the assets are currently missing from the repository, the integration is halted. Safe, non-ML supporting logic (such as LaTeX to arithmetic normalization) has been added and tested, but the CoMER ONNX execution path will not be built until the physical model weights are provided locally.

## Testing

Latest required verification: 143 tests passed.

| Test file | Coverage |
|---|---|
| `tests/answers.test.ts` | Pure answer computation, dropped-symbol handling, multi-line answers, edit recomputation, error display, and answer placement. |
| `tests/coords.test.ts` | Client-to-canvas conversion, CSS/physical pixel conversion, backing-store rounding, DPR variants, and round trips. |
| `tests/feedback.test.ts` | Feedback enable state and no-throw behavior when audio or vibration APIs are unavailable. |
| `tests/math.test.ts` | Tokenization, Unicode and ASCII operators, precedence, decimals, unary minus, parentheses, division by zero, malformed input, and formatting. |
| `tests/overlay.test.ts` | Confidence-level thresholds for overlay marks. |
| `tests/preprocess.test.ts` | Smoothing behavior and center-of-mass recentering. |
| `tests/postprocess.test.ts` | Stray-dot filtering and dropped-debug alignment. |
| `tests/recognition.test.ts` | Stroke grouping, line splitting, bbox helpers, operator classifier rules, confusion cases, and module import smoke test. |
| `tests/scratch.test.ts` | Scratch gesture detection and stroke selection under scratch bounding boxes. |
| `tests/stroke.test.ts` | Point densification used by the pixel eraser. |
| `tests/setup.ts` | Node test polyfill for `OffscreenCanvas`. |

## Recognition accuracy

To be filled with measured results.

## Performance measurements

To be filled with measured results.

## Known Limitations

- Neat, separated handwriting works best.
- Digits that touch or overlap may merge into one symbol group.
- MNIST-style digits work best; a crossed `7` or unusual digit shape may be misread.
- A leading `.5` is dropped by the stray-dot filter, so write `0.5`.
- Rule-based operators can misfire on sloppy `x` or division symbols.
- The UI supports one evaluated equation per line. Multiple lines can be shown, but each line is handled independently.
- The parser supports parentheses, but the recognizer does not output parentheses.
- Deploy at the site root because the model path is absolute: `/models/mnist-12.onnx`.

## Tech Stack And License

- Vite 6
- TypeScript
- Vitest
- ONNX Runtime Web
- Vite PWA / Workbox
- Locally bundled Inter and Caveat fonts via `@fontsource`

CalcInk is released under the MIT License.
