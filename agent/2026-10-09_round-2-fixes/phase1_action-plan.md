# Phase 1 action plan — Symbol print pipeline (QR/barcode)

Plan ref: [`plan.md`](plan.md) §P1. Items: "QR too small warning mis-measures (2× unit error)";
"Triangle / non-square module artifact". Owner decision: option **D** (disable smoothing on the
symbol draw only).

## Deliverables
- **D1 — verdict fix** (`qrImage.ts`): `moduleCount = baseW / 2`; verdict on the *target* module.
- **D2 — option D** (nearest-neighbour symbol draw) in `konvaFactory.ts` + `ResolvedShape.tsx`.
- **D3 — regression tests** proving both, validated through `renderLabelPage` (not `PreviewStage`).

## Files
- `src/editor/render/qrImage.ts` — D1.
- `src/editor/render/konvaFactory.ts` — D2 (shared helper + symbol branch).
- `src/components/editor/ResolvedShape.tsx` — D2 (preview parity).
- `src/editor/render/barcodeImage.ts` — **parity-check only**: keep `scaleX < minModulePx` (scaleX is genuinely px/narrow-module). No verdict change.
- Tests: `src/editor/render/assets.test.ts`, `src/editor/render/konvaFactory.test.ts`, and a `renderLabelPage`-level test following the `renderLabelPage.assetDpi.test.ts` convention (happy-dom + `installCanvasShim()`).

## D1 — exact formula (apply verbatim)
In `renderQr`, after measuring the scale-1 canvas (`baseW = measure.width`):
```ts
const moduleCount = Math.max(1, baseW / 2);       // bwip qrcode = 2 device px / module at scale 1
const limitingPx = Math.min(targetW, targetH);    // symbol fills the authored box (D)
return { canvas, belowMinModule: limitingPx / moduleCount < minModulePx };
```
- Keep the existing integer-`scale` raster selection unchanged (the canvas is still the integer-scaled symbol).
- **Do NOT re-tune** `MIN_MODULE_MM = 0.25` (`prepareAssets.ts`). Owner data: 6 mm = 0.24 mm/module practical minimum.
- Barcodes: leave `barcodeImage.ts` verdict as-is; add a parity-check test only.
- P2 quiet zones will extend this budget later — expected, not rework now.

## D2 — disable smoothing on symbol draws only
Key fact (verified against Konva 9 in `node_modules`): a per-node `imageSmoothingEnabled` config is
**not** honoured on the normal scene draw. `Konva.Image._useBufferCanvas()` returns
`super._useBufferCanvas(true)` (`Shape.js:238`) which is `false` unless the node has fill **and**
stroke **and** non-1 opacity — so the buffer-canvas path (the only place `Node.js:1066` reads the
attr) never runs for our images. Smoothing is applied by the Layer/Context, not per node.

Therefore: a **custom `sceneFunc`** that toggles the raw canvas context around the draw.
1. Add ONE exported helper to `src/editor/render/konvaFactory.ts` (name e.g. `symbolSceneFunc`)
   that mirrors `Konva.Image._sceneFunc` (`node_modules/konva/lib/shapes/Image.js:48-88`):
   read `shape.attrs.image`; if absent return; save `raw.imageSmoothingEnabled`
   (`raw = context._context`), set it `false`, draw with crop-vs-plain `context.drawImage(...)`
   exactly as Konva does, and **restore in `finally`**.
2. `createFittedImage` gains a `symbol: boolean` param; when true set `sceneFunc: symbolSceneFunc`
   on the `Konva.Image` config. `createKonvaNode` passes `node.type !== 'image'`
   (i.e. qr/barcode → symbol; photos keep smoothing).
3. `ResolvedShape.tsx:226` (the single `KonvaImage` for image/qr/barcode): add the symbol
   `sceneFunc` only when `node.type !== 'image'`. Keep photo/image smoothing default.
4. `imageAssets.ts` keeps `imageSmoothingEnabled = true` for decoded photos.

No behaviour change for photos/images. The print/quantize path (`rasterizeResolved` →
`createKonvaNode`) is covered by step 2; the policy mask paints solid rects for symbols, so it is
unaffected this phase (P2 revisits it).

## D3 — tests
1. **Verdict (engine, `assets.test.ts`)**: pick a payload whose scale-1 `baseW/2 == 25` (measure it
   in-test via `baseSymbol`; `https://example.com` EC M is documented at 25 modules).
   - `renderQr(text, 'M', 100, 100, 3)` → `belowMinModule === false` (**was `true`** under the old `scale` unit error).
   - `renderQr(text, 'M', 74, 74, 3)` → `belowMinModule === true`.
   - Keep the returned canvas integer-scaled (existing assertions still hold).
2. **Pipeline verdict through `renderLabelPage`**: build a doc + `dpi` so `imageScale` gives
   `minModulePxFor(imageScale) === 3` (e.g. `imageScale = 0.1` → `dpi = 254`), a QR node whose box
   yields 100 px → no `too-small`; a 74 px box → `too-small`. Assert via `page.warnings`/asset map,
   not `PreviewStage`.
3. **Crisp edges (D2)**: assert the symbol `Konva.Image` is built with the symbol `sceneFunc`
   (konvaFactory test), and unit-test `symbolSceneFunc` directly with a fake context: it sets
   `imageSmoothingEnabled = false` during the draw and restores it after (deterministic, no
   dependency on the canvas shim's resampling). If the `@napi-rs/canvas` shim reproduces
   nearest-neighbour upscale reliably, add one pixel assertion (pre-quantize `rasterizeResolved`
   RGBA contains no partial-alpha / mid-grey pixels inside the symbol box); otherwise skip the
   pixel assertion and rely on the sceneFunc unit test.
4. Barcode parity test: unchanged verdict at a large and a tiny target.

## Review
`experimental-review` primary; `review-alt` fallback; `review-fast` only for a narrow fix re-review.
Max 2 fix rounds, then escalate to the owner.

## Commit
Semantic, per phase, after review: `fix(render): correct QR module verdict and disable symbol smoothing (#12/#13)`.
