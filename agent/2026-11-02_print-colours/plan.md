# Print-time colours: grayscale (16 levels) + red/black (dithered) — run plan

Date: 2026-11-02 · Owner calls recorded in §0 · Research: [`agent/memory/grayscale.md`](../../agent/memory/grayscale.md) (written today, library 0.49.0), [`agent/memory/dual-color.md`](../../agent/memory/dual-color.md).

## ENV BRIEF (inherited by coordinator)

- Package manager: `bun`. Build: `bun run build` (= `tsc && vite build`). Typecheck-only: `tsc`.
- Tests: `bun run test` (Vitest in-process). NEVER `bun test`.
- Repo may sit on drvfs — prefer bare `tsc` over full rebuilds during the phase loop.
- tsconfig `noUnusedLocals/Parameters`, `verbatimModuleSyntax`, no path aliases. Product strings via typed `t()`; agents edit `en.json` directly in-phase (one writer per wave).
- Reviewer routing: `review` primary, `review-alt` fallback, `review-fast` for mechanical. Subagents must not use `git stash`. No grandchild delegation (depth-1).

## 0. Owner decisions (2026-11-02)

1. **Grayscale ships FULL 16-level diffusion in this run** — not pass-through. The diffuser is shared with red/black (single-ink subset of the same palette problem, grayscale.md §3); one engine, two runs of it.
2. **UI follows existing patterns** — no owner sketch; print-dialog `SettingRow`/`Select` and object-inspector controls. No `ui-designer` dispatch needed; `small-coder`/`general` with pattern receipts suffice.
3. **Latent red bugs fold in** (`countInkPx` red-channel-only read, `invertRgb` flips red to cyan, `SingleColorAlt` unguarded).
4. Semantic commits per phase.

## 1. Goal and shape

One print-time **page-colour** selection (Mono / Grayscale / Red-black) gated by printer capability. Doc stays colour-agnostic; selection lives in the print dialog and drives preview, print raster, thumbnails-in-dialog.

Single generalized **palette error-diffusion engine**: input = tone-mapped RGBA; palette = per-mode targets:

- mono: existing 1-bit strategies unchanged (untouched).
- grayscale: 16 ink levels (0=white…15=black), matching the library's `colorToGrayLevel` quantization exactly (BT.601 luminance, bands read off `ImageEncoder.colorToGrayLevel`).
- red/black: {white, black, red} palette, **vector error diffusion** (Floyd–Steinberg generalized, RGB error vector) — chosen over two-scalar decomposition as CTO call: one error channel, correct black+red mixes for dark regions, generalizes to "any palette".

Per-object quantizer policies (`memory/dithering.md` §7) reused: per-node strategy/params key colours-synthetically; per-type defaults route flat authored colour to threshold (crisp), images to diffusion. Page colour interacts as the mode the *final* dispatch maps into.

## 2. Phases

**P1 — palette diffusion engine (core).** New module alongside `core/render/quantize.ts` (e.g. `core/render/palette.ts`): serpentine vector error diffusion over an N-entry palette; palette entries carry RGB + a calibration-distance function (thermal red is heat-selected — distances are calibration, not linear RGB distance; naive `distanceTo` constants documented, test pattern verifies). Grayscale ramp palette derived from the encoder's level bands (`colorToGrayLevel` inverse); write R=G=B ramp greys at **band midpoints** so the encoder's rounding is unambiguous. Existing 1-bit strategies untouched and goldens must stay green (regression proof).

**P2 — latent red bugs + pigment-safe helpers.** Fix `countInkPx` (`renderLabelPage.ts:663` counts red as ink), `invertRgb` (mirror reflected on red = cyan bug), explicit guard on `SingleColorAlt` ("not implemented" throw instead of silent mono-encode). Goldens for each. Cheap, prerequisites for any colour body text/images.

**P3 — grayscale wiring (render + print + dialog).** Page-colour override through the existing seam: dialog holds the selection (doc untouched); pipeline receives it; `Grayscale` mode skips 1-bit quantize step, runs palette diffuser into `renderLabelPage.ts` encoder canvas (opaque white fill already at `:879` — transparent→black trap test). Remove the `DoubleColor`/grayscale restrictions in the `printLabel.ts:184` guard deliberately: allow `Grayscale`, keep `DoubleColor` for P4. `capabilitiesOf` gains `grayscale` from `PrintTaskCapability.SupportGrayscale`; `PrintOverrides`/`PrintJob`/adapter (`niimbotAdapter.ts:275`) already thread `pageColor` — add Grayscale to allowed values + `PrintOptions.pageColor === image.pageColor` invariant. Preview + ` QuantizedPreviewLayer` draws 16-level raster as-is (no new renderer); dialog thumbnails follow mode. Goldens: encode nibble order/void/repeat/RLE rows for known greys (0, 7, 15, gradient); preview ≡ print raster; capability gating (unsupported task offers option disabled).

**P4 — red/black: authoring.** Colour as truth, no ink enum. Text gains `fill` (remove hardcoded black at `rasterize.ts:108-110`); images gain tint option; shapes/QR/barcode/code already carry `fill`/`stroke`. Inspector UI in existing patterns. `validate.ts` copy sites for the new fields (`:442`, `:1021`, `:1088`); factory defaults; i18n.

**P5 — red/black: colourspace + converter.** Pipeline multi-channel: per-object dispatch — flat authored red (text/symbols) thresholds straight to red plane by per-type default; image objects diffuse through the {white, black, red} palette. Per-object policies extend with red/black-type defaults; `policyKeyOf` unaffected (colour already keyed via masks). Pair with dialog selector offering `DoubleColor` (task must advertise `SupportDoubleColor`), plus one-off `thresholdRedBlack`-style flat path for the calibration strip. Encoder: exact `#ff0000` pixels, library planes split (0x8a path; verify the 133 sub-command byte on 0.49 source before shipping — dual-color.md parked check).

**P6 — shared dialog selector + doc/preview parity.** One page-colour `Select` (Mono / Grayscale / Red-black), unsupported options shown disabled + explained, `SettingRow` replaces the dead no-op control at `PrintDialog.tsx:475,930-939`; preview raster inside dialog uses the selected mode; warnings centre: red ink counted correctly in `countInkPx` notice; batch/CSV: mode is per-job, multi-page grayscale job constant on every page (test).

**P7 — verification print + docs/memory.** Owner hardware: one grayscale test label (gradient/photo — 16-level diffusion vs banding, physical level count, long-label buffer test since `sixteenGrayMaxBuffer` is parsed-not-enforced) and one red/black test pattern (black bars, red bars, mixed rows, threshold sweep, dithered red gradient, one photo). Update memory: promote run findings to `agent/memory/` area files (dithering.md, print-transport.md, or new `print-colours.md`), retire debt lines, scrub task folder.

## 3. Files / modules

Core: `core/render/quantize.ts` (touch lightly — dispatch seam only), new `core/render/palette.ts`. Render: `src/editor/render/renderLabelPage.ts` (`:788-796`, `:879`, `:663`, `:628-635`), `src/editor/render/rasterize.ts` (`:108-110`), `pipeline.ts` doc update. Print: `src/print/printLabel.ts` (`:184`, `:238`), `src/print/niimbotAdapter.ts` (`:275`, `:564-592`). UI: `src/components/print/PrintDialog.tsx` (`:475`, `:930-939`), object inspector tab. Doc/validate: `core/doc/types.ts` (text `fill`, image tint; check `:57-98` `BaseNode` slots, `:155-195` shape fields), `core/doc/validate.ts` (`:401`, `:442`, `:1021`, `:1088`), `factory.ts` (`:235-245`). i18n: `en.json`.

## 4. Risks / open items (for the run, not redone here)

- **Verifier first**: upstream 0.49 source — `printBitmapRowDoubleColor` 133 sub-command byte; also whether `writeImageData` Grayscale handles the red/black rows interface cleanly. Read, don't guess (nodes: `dist/cjs/utils/image_encoder.js`, `packets/packet_generator.js`).
- **Banding vs physical levels**: diffusion lands in P1; physical level count + banding judged on the P7 print, no earlier hardware loops.
- **Buffer**: grayscale long labels — library ignores `sixteenGrayMaxBuffer`; test a long label early (P7 harness built before the print).
- **Paper**: grayscale photo stock reports `consumablesType=2` over RFID; selection stays manual. Seeded paper type optional — needs owner geometry/name if wanted (ask at P6/P7).
- **D-05 (cross-policy seam drift)** now targets colour palettes too — note in diffuser doc comment; do not fix here.
- **Tape expensive**: red/black gets ONE print. All pixel-path questions settled by preview ≡ print invariants + goldens first.

## 5. Ambiguities resolved

None open. All four owner calls in §0. Re-verify memory line numbers (written 2026-10-29 / 2026-11-02 — fresh today) during phase action plans, not now.
