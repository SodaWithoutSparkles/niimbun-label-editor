# Dual-color (red/black) printing — parked-feature research

> **Shipped 2026-11-02 — see [`print-colours.md`](print-colours.md).** Red/black
> printing is implemented as the `redBlack` page colour; the research below
> (including the 133-byte check and the parked notes) is kept as written.

Phase 0 investigation for the deferred **RedBlack color space** (v1 plan
decision 2, 2026-09-29; owner reconfirmed as next feature run after label
presets, 2026-10-29). This file holds the findings so the eventual run's
Phase 0 does not redo them. Not a spec — the run writes its own plan.

## Owner constraints + vision (2026-10-29)

- **Owner vision: dithered red and black.** The conversion is RGB → a
  **red-black-white colourspace with dithering** — a photo prints as a
  red/black/white dot mix, not "red objects threshold + greys dithered".
  Printer is capable; the software must convert. This goes **beyond
  niim.blue's threshold classifier** — a differentiator in the same family
  as per-object dither policies (owner's "be better than niim.blue"
  directive, `memory/niimblue-reference.md` §Differentiation).
- Printer is **2-color capable** and red/black tape is on hand, but the tape
  is **expensive — no trial-and-error hardware loops** like the mono bring-up.
  Verification strategy must be: mock/golden first, copy the hardware-proven
  upstream *mechanics*, then **one** planned test-pattern print. Dither
  quality itself is software-verifiable — preview ≡ print raster
  (invariant 7) — so the tape only settles physical behaviour (red dot
  density vs black, heat interaction on mixed rows).
- Presets run comes first; do not start this feature before that lands.

## Design direction (owner-confirmed 2026-10-30)

- **Colour as truth — no ink enum.** Authored colour is the ONLY ink
  selector (owner confirmed; a separate per-object `ink` field was
  considered and rejected — contradiction matrix, e.g. blue fill + red
  ink). A greyscale image dithered in red only = a red-tinted image; flat
  red text = red plane; an untinted colour photo = palette mix. Only
  authoring additions: text gains a fill picker (ink is hardcoded black
  today, `rasterize.ts:108-110` — a mono-world artifact) and images gain a
  tint option; shapes/QR/barcode/code already carry `fill`/`stroke`.
  Accepted edge: under MONO paper a red tint prints at red's luminance
  (~30% grey) — predictable, previewable.
- **Per-object threshold-vs-dither: reused unchanged.** The existing
  per-object quantizer policy + per-type default mechanism
  (`memory/dithering.md` §7) IS this control. Policy masks are ink-agnostic
  (key colours are synthetic, thrown-away canvas).
- **Colorspace is print-time, not doc data.** Print-dialog selector,
  capability-gated (`SupportDoubleColor`) — same pattern as the label-type
  seeding (P19). The doc stays colour-agnostic; the editor dithered-preview
  overlay follows the same selection.
- **Paper types carry a colorspace.** Catalogue field (default `mono`);
  vendor dual-colour SKUs seeded `redBlack` (50×30, 50×80, 51×51 round).
  Hint chain (order settled in the run's plan): dialog selection >
  session override > doc `meta.paperTypeId` > mono. **RFID cannot hint
  the colorspace** (owner + Multimote independently confirmed 2026-10-30):
  official red/black stock reports `type = 1` (gap labels),
  indistinguishable from ordinary gap stock, and no dual-color label type
  is registered in the niimblue wiki. Red/black selection is therefore
  always manual (paper-type pick or print-dialog selector); the reported
  roll type only validates geometry/label-type as today (P19).
- **Screentone deferred (owner 2026-10-30).** First cut: threshold + error
  diffusion in red-black; screentone stays black-ink-only, red objects go
  flat red. Per-ink screentone (mixed red-black clustered dots, offset
  screen angles) — exact mechanics uninvestigated; decide in a later phase
  after seeing diffusion output on hardware.

## Library state — DoubleColor is already implemented (do not rebuild it)

Verified against installed `@mmote/niimbluelib` **0.47.1** (explore receipts,
2026-10-29):

- `ImageEncoder.encode(source, pageColor, printDirection)` splits **exact**
  pixels into two 1-bit planes: `0xffffff` paper, `0x000000` black,
  `0xff0000` red. Red is only separated when `pageColor === DoubleColor`;
  otherwise red pixels fall into the **black** plane.
- Packet generator `writeImageData` accepts only `SingleColor`/`DoubleColor`
  (others throw `"Page color ${n} not implemented"`). Double-color rows:
  both inks → `printBitmapRowDoubleColor` (command 138, `BitmapColorMode.Mixed`:
  presence mask + 1=red/0=black colour mask); one ink →
  `printBitmapRowWithColor` with `Black`/`Red`; void rows → empty mode.
- `PageColorType { SingleColor=0, DoubleColor=1, SingleColorAlt=2,
  MultiorderColor=3 }`. The color mode is a byte inside `PrintStart` — there
  is **no** `SetPrintMode` command.
- Print-task capability: `PrintTaskCapability.SupportDoubleColor` — only
  `B1PrintTask` and `D110MV4PrintTask` accept it; `validatePage` rejects
  DoubleColor pages on every other task. Our adapter already surfaces this:
  `PrinterCapabilities.doubleColor` (`src/print/niimbotAdapter.ts`).
- Upstream protocol wiki: one pass, two channels per row (not two passes).
  Community btsnoop (niimbluelib issue #22) also shows a B2 Pro `0xA7`
  LZO-compressed variant — **not implemented in any library**; we do not need
  it unless a B2 Pro fails on the `0x8a` path.
- ⚠️ Flagged upstream inconsistency to re-check before the run:
  `printBitmapRowDoubleColor` does not emit the `PrintBitmapRow` (133)
  sub-command byte that `printBitmapRowWithColor` does. niim.blue 2026.9.0
  shipped dual-color on this library, so the path presumably works on real
  printers — still, check upstream > 0.47.1 for post-release fixes and bump
  if any exist.
- Hardware truth at runtime = task capability + RFID paper info, **not** the
  model table (vendor-documented 2-color models: B21 Pro, B1 Pro, B2 Pro;
  model table over-approximates).

## niim.blue shipped model (2026.9.0) — copy the mechanics, not the quantizer

- Gate: task has `SupportDoubleColor` **and** post-process mode is
  `threshold_rb` → `pageColor = DoubleColor`; falling back to a mono task
  force-resets the post-process mode.
- **Red is a plain CSS colour in the designer** (text fill option,
  rect/circle fill+stroke options) — no per-object model field, no ink enum.
- `thresholdRedBlack(image, darkThreshold, redThreshold=100)` classifies
  `r-g > t && r-b > t` as pure `#ff0000`; dark grey → black; else paper.
  A `thresholdRed` slider (1–255) lives in the print dialog.

**Ours goes further (owner vision above): niim.blue's threshold is the flat
red path, not the target.** Copy: capability gating, red-as-CSS-colour
authoring, exact `#ff0000` pixel contract into the encoder. Build new: the
dithered RGB → {paper, black, red} converter. The ink model is settled
(colour as truth, no ink enum — see "Design direction"); flat-colour
routing goes through per-type defaults (flat red text thresholds, images
diffuse). Still open for that run's plan: the converter architecture
(see "Dither interaction" below).

## Our pipeline — seam map (verified 2026-10-29)

Order today: `resolve` → dims → asset prep → Konva raster (white bg) →
policy mask build → region clip → global options → quantize dispatch
(`applyPolicy` per policy slot) → project+tone → invert/mirror/post-clip →
encoder canvas → offset → orient+encode.

- **The v1 "typed seam" claim is wrong.** `ColorSpace` is
  `toGray(r,g,b): number` — a single scalar projection
  (`src/core/render/colorspace.ts:39-45`), not the multi-channel
  `toChannel` the v1 phase-4 plan described. `COLOR_SPACES` registry
  (`:64`) has no production consumer. 1-bit thresholding happens inside
  each quantizer (`quantize.ts:348,192`, `screentone.ts:292`), all writing
  R=G=B (`quantize.ts:123`, `screentone.ts:294`).
- **Encoder side is done**: remove the guard at
  `src/print/printLabel.ts:184-188` (throws on `DoubleColor`,
  "single-plane v1 render path") and produce exact `255,0,0` red pixels;
  the library handles the rest. `PrintJob.pageColor` /
  `PrintOverrides.pageColor` / adapter forwarding already exist.
  `PrintDialog.tsx:475` hardcodes `SingleColor` with a no-op one-option
  select at `:930-939`.
- **Text ink is hardcoded black at raster time** (`applyInkDefaults`,
  `src/editor/render/rasterize.ts:108-110`); shapes/QR/code/barcode carry CSS
  `fill`/`stroke` (`src/core/doc/types.ts:155-195`) but they are
  luminance-projected, never ink selectors.
- **Preview needs no rework**: `QuantizedPreviewLayer` draws the raster
  as-is; it shows red pixels the moment the pipeline writes them.
  `renderPageBase`/`renderDocPreview` already produce full-colour RGBA
  pre-quantize.
- **Latent red bugs to fix with the colour path**: `countInkPx` reads the
  red channel only (`renderLabelPage.ts:663` — pure red would count as
  *no ink*, mirror-loss notice undercounts); `invertRgb` flips all channels
  (`:628-635` — red would become cyan); `SingleColorAlt` passes through
  unguarded and the encoder treats it as Single (red → black silently).
- **Where a colour assignment could live**: doc-level
  `LabelDoc.label` slot (`types.ts:315-329`, alongside `printDirection`/
  `printOffset`), per-node `BaseNode` slot (`types.ts:57-98`, alongside
  `quantizerHint`), validation copy sites (`validate.ts:442-455,1021-1037,
  1088-1096`), `toOptionalEnum` pattern at `validate.ts:401`, factory
  defaults (`factory.ts:235-245`).
- **Dither interaction — owner wants dithered red (2026-10-29)**: the core
  converter is RGB → 3-state {paper, black, red} with error diffusion.
  Candidate architectures for the run's plan: (a) **vector error diffusion**
  against the 3-entry palette {white, black, red} — generalized Floyd–Steinberg
  (quantize each pixel to the nearest palette colour, diffuse the RGB error
  vector; naturally mixes black+red dots for dark reds, red/white for pinks);
  (b) **two-scalar decomposition** — diffuse the "ink amount" scalar with the
  existing kernels, then split the ink dots red/black by a second diffused
  "red share" scalar. Reuses more of the engine; two errors to keep coherent.
  Both must respect the per-object policy system: flat authored red
  (text/QR/symbols) should still threshold straight to the red plane by
  per-type default (`memory/dithering.md` §7), images diffuse. The scalar
  `toGray` seam (`colorspace.ts:39-45`) and the R=G=B `writePixel`
  (`quantize.ts:123`, `screentone.ts:294`) are the two hard rebuild points.
  Physical caveat for the metric: thermal red is **heat-selected, not
  pigment** — a red dot is not necessarily as dark as a black dot, so the
  palette distances are calibration values, verified by the test pattern.

## Verification strategy (expensive tape)

1. All pixel-path work golden-tested against expected `rowDataBlack`/
   `rowDataRed` plane bytes (mock transport, existing print-test harness).
2. Copy niim.blue's gating/mechanics verbatim where possible — it has the
   hardware mileage. Its threshold classifier is the flat-red path only;
   the dithered converter is golden-tested software-side.
3. Dither quality judged in the app (preview ≡ print raster) — no tape
   spent iterating on aesthetics.
4. One hardware print at the end: a purpose-built test-pattern label —
   black bars, red bars, mixed black+red rows, black+red text on one row,
   threshold sweep strip, **plus dithered red gradient, dithered red/black
   mix, one photo** — so a single tape pass answers every open question
   including red-dot density and heat interaction on adjacent inks.
5. Re-check upstream niimbluelib for post-0.47.1 dual-color fixes first;
   bump if present (last bump: 0.47.1, storage-safety wave 2).

## Parked with it

- **RedGrayscale / grayscale photo paper** (`MultiorderColor=3`): rejected
  by the library (`writeImageData` throws), zero upstream documentation.
  New lead (owner, 2026-10-30): NIIMBOT sells "grayscale photo paper"; the
  owner's roll reports `consumablesType = 2` (Black) while the official
  app shows "consumable type: black labels; texture: composite thermal
  paper - grayscale" — so the RFID carries a texture/material descriptor
  beyond the type enum, which niimbluelib may not parse today (check the
  `packet_parser` paper-info fields when this unparks). Multimote is
  obtaining a roll to investigate in November 2026 — watch upstream
  niimbluelib/niimblue for findings before planning any grayscale work.
  Out of scope for the dual-color run.
- **`SingleColorAlt=2`**: undocumented; guard it explicitly rather than
  letting it silently degrade.
- **UNPARKED 2026-11-02:** `@mmote/niimbluelib` **0.49.0** now ships
  **16-level grayscale** — `PageColorType.MultiorderColor` was renamed to
  `Grayscale`, and `ImageEncoder` implements the conversion for the
  D110M_V4 task family (the previously rejected `MultiorderColor=3` path).
  Our dependency is bumped (`5f9722e`, gate green). Nothing is wired yet.
  Findings, our seams, the shared print-time-colours design and the test plan
  are in [`grayscale.md`](grayscale.md) — the grayscale and red/black work
  share one page-colour selector and one run. The RFID/texture question is
  still open (the roll still reports as black over RFID), so manual selection
  remains the rule.
- **Re-check on the 0.49 source:** whether `printBitmapRowDoubleColor` emits
  the `PrintBitmapRow` (133) sub-command byte that
  `printBitmapRowWithColor` does. The 0.48/0.49 changelogs do **not** mention
  it, so it is probably unchanged; verify before the red run relies on it.
