# Wave 3 · Phase 13 — Barcode fit coherence

- Date: 2026-10-27
- Baseline: `main` @ `51495c2` (P12)
- Owner decision (2026-10-27): **stretch, no crop** — the raster is already
  generated at the node's box size, so the drawn rect must be the whole box.
- Reviewer: `review` (logic-heavy; `review-alt` if region-blocked)
- Commit: `fix(render): draw barcodes with the fit the verdict and mask assume`

## Failure mode (confirmed)

A 1D barcode raster is produced **at the box size** (`renderBarcode(…, w, h, …)`,
`prepareAssets.ts:246`), with the quiet zone composited into the canvas. Four
consumers then disagree about how that canvas reaches the box:

| Consumer | Current fit | Effect |
| --- | --- | --- |
| Raster (`konvaFactory.ts:355`) | `cover` | preserves aspect, **crops** the overflow — quiet zone / end bars shaved |
| Preview (`ResolvedShape.tsx:248`) | `cover` | same crop on screen (so preview ≡ raster, both wrong) |
| Verdict (`symbolEngine.drawnPitchBelowMinModule`, called from `barcodeImage.ts:81`) | `contain` (`min` scale) | scores a pitch the printer never draws; a height-constrained box "over-warns" |
| Policy mask (`renderLabelPage.ts:480`) | `contain` | stencils a letterboxed rect the raster does not occupy |
| Keep-out (`resolve.nodeDrawnLocalPoints:366`) | `contain` | reports non-printable overlap on empty letterbox |

`code` (2D) is internally consistent at `contain` — **do not touch it**.

## Design (fixed)

Barcode ⇒ `stretch` everywhere. The generated canvas already matches the box, so
stretch is ~identity, never crops, never letterboxes, and its X pitch is exactly
`modulePx × targetW / canvasW` — the number the verdict must use.

1. `src/editor/render/konvaFactory.ts:355` — barcode branch `'cover'` → `'stretch'`;
   update the `FitBox` comment at :116 and any nearby "barcodes cover" wording.
2. `src/components/editor/ResolvedShape.tsx:248` — same expression, same change
   (preview must stay byte-equivalent to the raster).
3. `src/editor/render/renderLabelPage.ts:480` — `leaf.type === 'barcode' ? 'stretch' : 'contain'`
   (was: everything non-image → `contain`).
4. `src/editor/render/resolve.ts:366` — a barcode now also draws its raw box:
   return `nodeLocalPoints(node)` for `node.type === 'barcode'` alongside the
   existing non-contain image escape. Update the doc block at :336-344.
5. `src/editor/render/symbolEngine.ts` — `drawnPitchBelowMinModule` gains
   `fit: 'contain' | 'stretch' = 'contain'`; `stretch` uses `targetW / canvasW`
   for the X scale (bar pitch is an X measurement; Y is irrelevant for 1D).
   `barcodeImage.ts` passes `'stretch'`; `codeImage.ts` keeps the default.
6. `src/editor/render/barcodeImage.ts` — update the header + inline comments
   (:17-19, :74-78) that assert a `contain` draw. Same for
   `symbolEngine.ts:101-104`.

Non-goals: no barcode node field (`fit` stays an image-only doc field — the
barcode's fit is a rendering invariant, not user data), no change to
`fitImageAttrs`, no change to the 2D `code`/`qr` path, no new quiet-zone maths.

## Files

| File | Change |
| --- | --- |
| `src/editor/render/konvaFactory.ts` | barcode → stretch |
| `src/components/editor/ResolvedShape.tsx` | barcode → stretch |
| `src/editor/render/renderLabelPage.ts` | barcode mask → stretch |
| `src/editor/render/resolve.ts` | barcode keep-out → raw box |
| `src/editor/render/symbolEngine.ts` | fit-aware verdict |
| `src/editor/render/barcodeImage.ts` | pass `'stretch'`, fix comments |
| tests (below) | verdict/mask/keep-out/fit assertions |

## Tests (must exist before done)

- `src/editor/render/assets.test.ts` — `drawnPitch` helper (:204-216) becomes the
  stretch X scale; re-base the four verdict tests (:507, :539, :576, :745) on it.
  The "height-constrained box shrinks the X pitch" case **inverts**: with stretch
  a short box no longer shrinks the bar pitch, so `belowMinModule` must be
  `false` there and `true` only when `targetW / totalModules < minModulePx`.
  Keep the real-bwip crispness assertions untouched.
- `src/editor/render/renderLabelPage.mask.test.ts` — new barcode case: the mask
  claims the **full box** (no crop, no letterbox) and matches the raster ink
  bounds; mirror the structure of the existing `cover`-image test (:400-429).
- `src/editor/render/konvaFactory.test.ts` — assert a barcode node's draw rect is
  the full box with no `crop` (today nothing pins the barcode fit mode).
- `src/editor/render/regionOverlay.test.ts:385-391` — the barcode raw-box
  expectation is now the general case; verify an overlapping region is reported
  (the old `[]` letterbox expectation was the contain assumption).
- Confirm the `code`/`qr` verdict tests stay green unchanged (`codeVerdict`,
  `symbolVerdict`) — that is the regression guard for scope creep.

Gate: full `bun run test` + `node node_modules/typescript/bin/tsc --noEmit`.

## Risks

| Risk | Mitigation |
| --- | --- |
| Stretch distorts the bar aspect | The canvas is generated at the box size; residual error is integer-rounding only (≤1 module) |
| Verdict becomes laxer (fewer "too small") | That is the point: the old warning scored a `contain` shrink that never happened. `targetW/totalModules` is the true printed pitch |
| Mask/raster diverge again | Mask derives from `fitImageAttrs` with the same fit; new mask test pins parity |
| Silent change for `code`/`qr` | 2D keeps `contain`; the existing verdict suites must stay untouched and green |
