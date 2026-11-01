# Grayscale printing (16 levels) — findings for the next run

Phase-0 research for the **print-time colours** work, written for the Build agent
that plans it. Read with [`dual-color.md`](dual-color.md) (red/black research,
parked) — the two features share the same seam and should probably ship in one
run.

- Written: 2026-11-02, after bumping `@mmote/niimbluelib` **0.47.1 → 0.49.0**
  (`5f9722e`, gate green: tsc, 188 files / 2772 tests, vite build).
- Library source verified against GitHub tag `v0.49.0` (`f451be4`) and the
  published npm dist. Local copy: `node_modules/@mmote/niimbluelib` 0.49.0.
- Nothing is implemented in this repo yet. The encoder can do it; our render
  path still quantizes to 1 bit.

## 1. What 0.49 actually adds

`PageColorType` (0.49):

```ts
enum PageColorType { SingleColor = 0, DoubleColor = 1, SingleColorAlt = 2, Grayscale = 3 }
```

Only the name changed (`MultiorderColor` → `Grayscale`); values are stable.
New `GrayscaleRowType { Void = 0x84, Data = 0x86 }`, command
`TX.PrintBitmapRowGray = 0x8d`, and `NiimbotPacket16` (16-bit length) because
grayscale rows can exceed 255 data bytes.

**The encoder already does the conversion** — no new encoder to call:

```ts
ImageEncoder.encodeCanvas(canvas, PageColorType.Grayscale, printDirection) // signature unchanged
```

Inside `encode` (grayscale path):

- Canvas RGBA; **alpha is ignored** (`getPixelColor` reads RGB only). A
  transparent pixel is RGB 0 → level 15 → **black**. The encoder canvas must be
  opaque white first (we already fill white at `renderLabelPage.ts:879`).
- Level = inverted ITU-R BT.601 luminance, rounded and clamped to 0…15:
  `max(0, min(15, round((1 - luminance/255) * 15)))` — **0 = white, 15 = black**.
- 4 bits per pixel, **2 pixels per byte, high nibble first**; row = `cols/2`
  bytes; `cols` is padded to a multiple of 8 (`ceil(cols/8)*8`).
- All-zero rows become `void`; consecutive identical rows merge into `repeat`.
  "check" rows are still inserted every 100 rows but the gray writer ignores
  them (no check-line packet).
- Rows are RLE-compressed where two adjacent nibbles match (runs of ≥6 px, even
  counts, max 252; compression disabled past 250 run bytes).
- `ImageEncoder.colorToGrayLevel(color)` is **exported** — reuse it for a
  preview that matches the printed levels exactly.
- `writeImageDataGray` is public and standalone if a test ever needs packets
  without a task.

### Print tasks

- New capability `PrintTaskCapability.SupportGrayscale` (= 2). **Only
  `D110MV4PrintTask` accepts it**: models `D110_M` (protocol v4), `D11_H`,
  `B21_PRO`, `B1_PRO`, `C1`, `EP1C`. `findPrintTask` falls back to D110M_V4 for
  `protocolVersion >= 4`.
- Unsupported printer: `validatePage` throws
  `Page color 3 is not supported by this print task` — loud, never silent.
- `PrintOptions.pageColor` must equal `EncodedImage.pageColor` or
  `validatePage` throws (`does not match print task color`).
- No grayscale-specific dpi or label-type restriction in the library. Tube
  printing separately requires `labelType === Continuous`.
- `PrinterCapabilities.sixteenGrayMaxBuffer` is parsed but **never read** by the
  library — no buffer enforcement. Treat large grayscale labels as untested.
- No model/firmware gate inside the task; capability routing only.

## 2. Our seams (verified 2026-11-02)

- **Page colour is already threaded**: `PrintOverrides.pageColor` →
  `PrintJob.pageColor` → `src/print/niimbotAdapter.ts:275`
  (`pageColor: job.pageColor ?? SingleColor`) → `newPrintTask` options. The
  encoder call is `src/print/printLabel.ts:238`
  (`ImageEncoder.encodeCanvas(oriented.canvas, pageColor, oriented.direction)`).
- **The red guard is ours**: `src/print/printLabel.ts:184-188` throws on
  `DoubleColor` ("single-plane v1 render path"). A grayscale mode needs the
  same deliberate decision here — allow `Grayscale`, keep `DoubleColor` gated
  until the red run.
- **Capability surface**: `capabilitiesOf` (`niimbotAdapter.ts:564-592`) maps
  `PrintTaskCapability.SupportDoubleColor` → `capabilities.doubleColor` and
  `SupportTubePrinting` → `tubePrinting`. Add `grayscale` the same way.
- **The dialog's page-colour control is dead today**: `PrintDialog.tsx:475`
  hardcodes `pageColor: PageColorType.SingleColor`, and the `SettingRow` at
  `:930-939` is a one-option `Select` whose `onChange` is a no-op. This is
  where the selector goes (gated by capability); copy keys exist
  (`print.pageColor`, `print.pageColorSingle`).
- **The render path is the real work**: `src/editor/render/renderLabelPage.ts`
  runs `quantizeRgba(...)` at `:788-796` (1-bit output; `pipeline.ts` documents
  "QUANTIZE AN RGBA BUFFER TO 1-BIT BLACK/WHITE"). A grayscale page must skip
  that pass and hand the tone-mapped RGBA to the encoder, which rounds to 16
  levels. Keep the tone curve (gamma), region clip and offset/orient steps.
- **Preview and thumbnails**: the quantized preview layer draws the raster
  as-is, so a 16-level raster needs no new renderer — but the preview and
  `renderDocPreview`/print thumbnails (100 dpi) must use the same grayscale
  path when the mode is on, or preview ≠ print.
- **Mono assumptions to audit for both features** (same list as
  `dual-color.md`): `countInkPx` reads the red channel only
  (`renderLabelPage.ts:663`), `invertRgb` flips all channels (`:628-635`),
  `SingleColorAlt` passes through unguarded (`writeImageData` still throws for
  it: `Page color 2 not implemented`).
- **Batch/CSV jobs**: `buildCsvPrintJob` encodes one canvas per page, so the
  mode is per-job and consistent across pages — no per-row state to carry.

## 3. Design proposal (for the run's plan, not decided here)

- **Grayscale is a print-time page colour**, exactly like the red/black plan:
  doc stays colour-agnostic; selection lives in the print dialog (and the
  preview follows it). No doc schema change.
- **v1 = pass-through**: skip the 1-bit quantizer, keep tone mapping, let the
  encoder round to 16 levels. Cheap, real greys, some banding on gradients — a
  large improvement over mono for photos.
- **16-level diffusion belongs with red/black**: an error-diffused 16-level
  ramp is a single-ink subset of the RGB → {white, black, red} palette problem.
  Building it in the red run avoids two diffusion engines. If banding is
  unacceptable before then, that run can land first and this run just wires the
  pass-through path.
- **Authoring needs nothing for grayscale** (the design is already colour; the
  encoder only reads luminance). Red needs the authoring additions already
  documented in `dual-color.md` (text fill picker, image tint).
- **Paper**: grayscale photo paper cannot be detected over RFID (owner's roll
  reports `consumablesType = 2` / "black" while the app describes a grayscale
  texture; `dual-color.md` §"Parked with it"). Selection is manual, same
  conclusion as red/black. A seeded paper type is optional and needs the owner's
  geometry/name.
- **Shared UI**: one page-colour selector in the print dialog listing what the
  connected task supports (Mono / Grayscale / Red-black), disabled options
  explained rather than hidden. This supersedes the two separate selectors the
  parked plans implied.

## 4. Test plan sketch

- **Golden encode bytes** at 0.49: a small canvas with known greys (0, 7, 15,
  a gradient) must produce expected nibbles/void/repeat/RLE rows. Pin the
  nibble order and the white/black direction — inverting these is invisible
  until hardware.
- **Preview ≡ print**: the dialog preview raster equals the encoder input for
  the same doc/values (existing golden style).
- **Opaque canvas**: a doc with no background must not produce level-15
  background (transparent→black trap).
- **Capability gating**: a task without `SupportGrayscale` offers the option
  disabled (and the job never sends Grayscale); a D110M_V4-family task accepts
  it; `PrintOptions.pageColor === image.pageColor` in the built job.
- **Progress events**: with the 0.48 fix, a job reports `page`/`pagesTotal`
  correctly and the adapter's defensive swap does not fire (regression test).
- **Batch/CSV**: multi-page grayscale job keeps the mode on every page.
- **Hardware (cheap, unlike red tape)**: one gradient/photo test label on
  standard stock to learn how many of the 16 levels are physically distinct.

## 5. Open questions / risks

1. **Banding vs diffusion** — owner call: ship pass-through and judge on a print,
   or wait for the diffused path?
2. **Physical levels** — thermal printers may not render 16 distinct densities;
   one print answers it. Red/black's "heat-selected, not pigment" caveat applies
   to density too.
3. **Buffer** — upstream ignores `sixteenGrayMaxBuffer`; a long grayscale label
   may exceed the printer's buffer. Test a long label early once hardware is
   available.
4. **Paper availability** — composite/photo stock geometry and naming need the
   owner.
5. **Red/black verification still pending** — re-check whether
   `printBitmapRowDoubleColor` now emits the 133 sub-command byte (0.49's
   changelog does not mention it; `dual-color.md` flagged it).
6. **`isHeartbeatStarted`** — the 0.48 changelog claims the inversion fix, but
   0.48/0.49 still return `heartbeatTimer === undefined`. Do not rely on the
   method name. (Not used here.)

## 6. Reading list

- Library: `node_modules/@mmote/niimbluelib/dist/cjs/`
  (`utils/image_encoder.js`, `packets/packet_generator.js`,
  `print_tasks/D110MV4PrintTask.js`) or GitHub tag `v0.49.0`:
  `src/utils/image_encoder.ts`, `src/packets/{enumerations,packet_generator,commands}.ts`,
  `src/print_tasks/{index,AbstractPrintTask,D110MV4PrintTask}.ts`.
- Ours: `src/print/printLabel.ts` (guard + encode), `src/print/niimbotAdapter.ts`
  (pageColor + capabilities + progress), `src/components/print/PrintDialog.tsx`
  (the dead selector), `src/editor/render/renderLabelPage.ts` (quantize step,
  encoder canvas, ink/mirror helpers), `src/editor/render/pipeline.ts`.
- Parked red/black research: [`dual-color.md`](dual-color.md).
