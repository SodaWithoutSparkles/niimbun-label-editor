# Handoff — Phase 4 (Render pipeline + color, M4 vertical slice)

**Run:** `agent/2026-09-29_label-editor-v1` · **Written:** 2026-10-04 · **Owner:** Coordinator
**Plan:** `plan.md` (P4 row) · **Action plan:** `phase4_action-plan.md`

## Outcome

P4 delivers the **vertical slice**: a `LabelDoc` renders WYSIWYG and prints one label
end-to-end. The preview and print rasters are **bit-identical by construction** — one
shared `renderLabelPage` path, no second renderer.

**Exit criteria:**
- WYSIWYG preview ≡ print raster — met by construction (single `renderLabelPage`;
  `printLabel.test.ts` asserts job-encode ≡ independent render+encode).
- **One weird label prints on hardware — PASSED** (owner's B1_PRO, 50×30 mm roll,
  2026-10-04). See the narrow-roll finding below.

## Commits (P4)

| Commit | Content |
| --- | --- |
| `d1653b5` | `test(render)`: headless real-canvas harness (`@napi-rs/canvas`) for golden pixel tests |
| `93e81c7` | `feat(render)`: Mono color pipeline — colorspace seam, 4 quantizers, policy masks |
| `d409349` | `feat(render)`: shared `rasterize → clip → quantize` path, preview≡print |
| `b7375ae` | `feat(doc)`: per-object `quantizerHint` field + inspector wiring |
| `01fad9f` | `feat(print)`: single-label print end-to-end + `?print=1` dev harness |
| `01438af` | `docs(plan)`: correct F-tag preset geometry, add P4 action plan |

## Gate record

Two full gate rounds (`review` + `experimental-review`), then narrow re-reviews.

- **Round 1** — both CHANGES-REQUESTED. Must-fixes: policy mask skipped unhinted
  leaves; clip ran *before* diffusion (ink could diffuse outside the union); the
  returned encoder canvas was **0×0** because Konva `stage.destroy()` frees canvases;
  negative region `w/h/r` flipped winding / threw in `ctx.arc`; polygon winding
  unenforced. All fixed.
- **Round 2** — all 7 prior must-fixes verified resolved; 2 new must-fix: Konva
  `devicePixelRatio` overscale/truncation on HiDPI; a lone zero-area region contour
  blanked the entire label. Fixed.
- **Final re-review** — APPROVE (0 findings); bow-tie polygon + keep-out consistency
  refined.

## Architecture installed (P5+ builds on this)

- `src/core/render/` — `dimensions` (`hmToPx`, `rasterDimensions`), `colorspace`
  (`MonoColorSpace`, extensible `ColorSpace`), `quantize` (`createDiffuser` +
  threshold/Floyd–Steinberg/Stucki/Atkinson; serpentine default, atkinson discards
  2/8), `policy` (`resolveQuantizer`, `PolicyMask`, `applyPolicy`), `pipeline`
  (`quantizeRgba`). Pure — no React/Konva/DOM.
- `src/editor/render/` — `unionPath` (`traceUnion`), `clip` (`applyRegionClip`,
  nonzero), `rasterize` (`rasterizeResolved`, DPR-safe), `renderLabelPage`
  (`buildPolicyMask` + the shared path). Editor overlay shares `traceUnion`.
- `src/print/printLabel.ts` — `buildLabelPrintJob` / `printLabel`,
  `ImageEncoder.encodeCanvas`, lazy `pages` (invariant 9).
- `src/components/dev/PrintSmoke.tsx` — `?print=1` harness (Mock / NIIMBOT).
- `src/test/canvasHarness.ts` — real canvas in Vitest; guard forbids product imports.
- `BaseNode.quantizerHint?: QuantizerId` (optional, validated); inspector select.

## Carry into P5+ (non-blocking)

- `printDirection` `right|bottom` encode unrotated like `top` (niimbluelib encoder is
  2-valued). Pre-rotate 180° or reject at validate before P8 import. P7 owns the UI.
- **Narrow-roll placement (P7):** a 25 mm label on the 567-dot head left-aligns content,
  so it prints ~15.5 mm from the left of a 50 mm roll; the printer trims at the tag
  boundary. Fix with feed/label-offset knobs + printhead-overflow warning (P7 list).
- `applyPolicy` does one full-frame pass per distinct policy (bounded 4) — fine at v1
  sizes; revisit before P7 batches.
- `regionUnionBounds` still has no production consumer (clip uses `regionUnionPath`).
- `ResolvedShape` still renders image/qr/barcode blank — P5 engines.
- `rasterizeResolved` applies black ink defaults (fills/strokes) because v1 nodes
  carry no style; revisit when the inspector wires fill/stroke.
