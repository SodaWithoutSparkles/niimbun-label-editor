# P8 — red/black width clamp (post-print workaround)

Follow-up to P7. Owner-confirmed: a 48 mm red/black print is clean; the library
bug is the printer trimming the packet tail (D-77). Ship a print-preview-stage
**clamp to the printhead width**, on by default for red/black, with an escape
hatch.

## Semantics

- The printer's printable width = `capabilities.printheadPixels` dots at the
  printer's dpi → `headWidthHm = floor(printheadPixels * HM_PER_INCH / printerDpi)`.
- For `DoubleColor` pages whose **head-axis size** (width for `top`/`bottom`,
  height for `left`/`right`, matching `printheadOverflow`) exceeds
  `headWidthHm`, the render raster is **cropped on that axis** (left/top
  aligned) to the head width before encoding.
- Default **on**; a dialog toggle ("Clamp to print head") is the escape hatch —
  off = old behaviour (may print wrong-ink bars).
- Only `DoubleColor`; mono/grayscale paths are unchanged.
- The same option flows to the Page preview, queue thumbnails and the print job
  (invariant 7), so preview = print.

## Implementation

1. `src/editor/render/renderLabelPage.ts`
   - `RenderLabelPageOptions.maxHeadHm?: number` (doc: printer head width in hm;
     crop the head axis to it).
   - Compute `limitPx = Math.round(maxHeadHm * dpi / HM_PER_INCH)`; validate
     finite/positive (`RangeError` otherwise, like dpi).
   - After the offset stage, crop **both return paths**:
     - head axis = `doc.label.printDirection === 'left' || 'right' ? height : width`;
     - if `axisPx > limitPx`, copy the kept left columns / top rows into a new
       `Uint8ClampedArray` + canvas at the cropped size (exact 1:1 copy, no
       resampling); return cropped `rgba`, `widthPx`, `heightPx`, `canvas`.
   - Keep the rest of the result fields (`warnings`, `policyOverflowCount`,
     `notices`).
2. `src/print/printLabel.ts`
   - `PrintOverrides.maxHeadHm?: number`; `renderOptionsOf` forwards it.
3. `src/components/print/PrintDialog.tsx`
   - Derive `headWidthHm` from `capabilities.printheadPixels` +
     `(printerStatus.dpi ?? resolved.dpi)`; `undefined` if either missing.
   - `needsHeadClamp = pageColor === DoubleColor && headWidthHm !== undefined &&
     (printDirection left/right ? doc.label.backingH : doc.label.backingW) > headWidthHm`.
   - State `clampRedBlack` default `true`, reset on open; `headClampHm =
     needsHeadClamp && clampRedBlack ? headWidthHm : undefined`.
   - Add `maxHeadHm: headClampHm` to `printOverrides` and `thumbnailOverrides`
     (defined only when clamping); deps updated.
   - UI: when `needsHeadClamp`, a `SettingRow` under the page-colour row with a
     `Toggle`:
     - label `t('print.clampToHead')`;
     - description `t('print.clampToHeadHint', { width: (headWidthHm / 100).toFixed(0) })`.
4. `src/components/print/usePrintThumbnails.ts`
   - `PrintThumbnailOverrides.maxHeadHm?`; forward into the render options;
     append to `overridesContentKey` only when defined (existing keys unchanged).
5. `src/editor/render/previewKeys.ts`
   - `previewOptionsKey` appends the clamp only when defined.
6. i18n `src/i18n/locales/en.json`
   - `print.clampToHead`: `"Clamp to print head"`.
   - `print.clampToHeadHint`: `"Red & black pages are cropped to the printer's printable width ({{width}} mm). Turn this off only for testing."`

## Tests

- `renderLabelPage`: crop width (`top`), crop height (`left`), left/top aligned
  pixel preservation, offset path also cropped, no clamp = byte-identical,
  invalid `maxHeadHm` throws.
- `previewKeys`: key changes only when the clamp is set; mono keys unchanged.
- `usePrintThumbnails`: forwards the clamp and rebuilds the cache when it changes.
- `PrintDialog`: 50 mm DoubleColor + head 567 @300 dpi → toggle visible, default
  on, job/render options carry `maxHeadHm: 4800`; toggle off removes it; 48 mm
  doc hides the toggle; mono hides; unknown head size hides.
- `printLabel`: `renderOptionsOf` forwards `maxHeadHm`.

## Docs

- `agent/memory/tech-debt.md` D-77: workaround is now implemented (clamp +
  escape hatch), upstream fix still pending.
- `agent/memory/print-colours.md` + `P7-VERIFY.md`: note the clamp and the 48 mm
  confirmation.
