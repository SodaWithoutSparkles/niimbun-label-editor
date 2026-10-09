# Brief — "Symbol modules may be too small to scan"

- Date: 2026-10-09 · verified by read-only `explore` at HEAD.

## What it is
`'too-small'` member of the `AssetWarning` union (`src/editor/render/assets.ts:33`).
Surfaced as warning kind `asset` (`src/editor/previewWarnings.ts:53-59`,
`id: 'asset:'+nodeId`), key `editor.mfp.warningAssetTooSmall`
(`src/i18n/locales/en.json:420`) rendered by `WarningsTab.tsx:15,21`
(`{{node}}` = the node label from `PreviewStage.tsx:257-266`).

## Producer
Computed inside the symbol engines and reported into the asset warning map:
- QR: `qrImage.ts:68` — `belowMinModule: scale < minModulePx`
- Barcode: `barcodeImage.ts:73` — `belowMinModule: scaleX < minModulePx`
- Set: `prepareAssets.ts:232` (qr) / `:248` (barcode) → `warnings.set(node.id,'too-small')`
- Published: `PreviewStage.tsx:278-299` → `buildPreviewWarnings` (`previewWarnings.ts:48`).

## Formula (units: hm = 0.01 mm)
- `MIN_MODULE_MM = 0.25` (`prepareAssets.ts:38`).
- `minModulePxFor(imageScale) = max(1, ceil(MIN_MODULE_MM * imageScale * 100))`
  (`prepareAssets.ts:45-46`). `imageScale` = device px per hm, so this is px
  equivalent of 0.25 mm.
- `requiredPx(w,h,imageScale) = { max(1, round(w*imageScale)), max(1, round(h*imageScale)) }`
  (`prepareAssets.ts:32-35`), used at `:221` (qr) / `:237` (barcode).
- QR module px: render base at scale 1, `scale = max(1, floor(min(tW/baseW, tH/baseH)))`
  (`qrImage.ts:57-63`); **`scale` = px per module** (bwip-js scale).
- Barcode module px: `scaleX = max(1, floor(tW/baseW))` (`barcodeImage.ts:66`).
- Trigger: chosen integer module px **<** the 0.25 mm px-equivalent — i.e. the
  physical module is under 0.25 mm at the current render resolution.

## Inputs
Payload length (QR version / barcode module count) → base size; QR EC level
(`qrImage.ts:50`) / barcode symbology (`barcodeImage.ts:50`); node box `w/h`;
and `imageScale`:
- Preview: `effectiveZoom * devicePixelRatio` (`usePreparedAssets.ts:118`).
- Print: `effectiveDpi / HM_PER_INCH`, `effectiveDpi = deps.dpi ?? doc.label.dpi`
  (`prepareAssets.ts:190-197`, threaded by `renderLabelPage.ts:486-491`).

## Behaviour notes
- **Zoom-invariant** in the normal case: `requiredPx` and `minModulePx` both scale
  linearly with `imageScale`, so the verdict holds across zoom except at
  `max(1,·)`/`ceil`/`floor` boundaries.
- **Resize flips it** (box px changes) and **dpi flips it** (threshold changes) —
  a thumbnail render at `dpi:50` can pass where the full-dpi render warns
  (`renderLabelPage.assetDpi.test.ts:75-80`).
- **Low `imageScale` disables it**: once `minModulePxFor` floors to `1`, and
  `scale ≥ 1` by construction, `scale < 1` is impossible → warning cannot fire.
- **No quiet zone is emitted.** `paddingwidth/height: 0` (`qrImage.ts:52-53`, barcode path) means `baseW = 2·moduleCount` exactly — the symbol fills the box with no quiet zone. (QR wants ≥4 modules/side; see the quiet-area note in the round-2 stacking issue.) Module count is measured from the bwip base render at scale 1.
- **Applies to QR and 1D barcodes** equally; barcodes use the narrow X-module as
  the "module" (`barcodeImage.ts:13-14,30,73`).
- Screen accuracy depends on the calibrated screen ppi
  (`core/viewport.ts:103`, `CalibrationDialog.tsx:20-57`).

## References
- `agent/memory/warning-center.md:9-11,16`; `agent/memory/objects-assets.md:51-62`;
  `agent/memory/tech-debt.md:25` (D-15: 0.25 mm floor is conservative).
- Content is never validated as a URL — "QR data is arbitrary text".

## Related: QR "too small" verdict is ~2× too strict (2 px/module unit error)

- bwip-js renders `qrcode` at **2 device px per `scale` unit** (verified v1/v2/v3/v7, all EC: `baseW = 2·moduleCount`, always even). `qrImage.ts:68` compares `scale` (units) to `minModulePx` (device px), so it needs `scale ≥ 3` (300 dpi) → warns until ~12.7 mm instead of the ~6.25 mm the 0.25 mm floor implies. 1D barcodes are fine (`scaleX` = px/narrow-module).
- Owner data (300 dpi, `https://example.com` EC M = 25 modules): 6 mm = 0.24 mm/module practical minimum; 5 mm = 0.20 mm marginal. `MIN_MODULE_MM = 0.25` is correct — **do not re-tune**.
- Fix: `moduleCount = baseW/2`; verdict on effective module `min(targetW,targetH)/moduleCount`.

## Related: triangle / non-square module artifact (resampling)

- The integer-module raster (`baseW·scale ≤ box`) is upscaled by `contain` into the box (fractional `boxPx/rasterPx`, smoothing on), then 1-bit-thresholded (`threshold`, cutoff 128). Antialiased corners cross the cutoff → triangles/notches; fractional pitch → non-square modules.
- Upscale factor oscillates with size (5 mm 1.18×, 6 mm 1.42×, 8 mm 1.88×, 8.47 mm 1.00×) — worst just under a multiple of `baseW`, crisp on a multiple. Explains size-dependent symptoms and the "eaten ECC budget" at 5 mm.
- Fix options (separate pass): bwip qrcode = 2 px/module per integer `scale`, so only 50/100/150 px rasters exist for 25 modules → resampling is unavoidable. **(A) rejected** — 1:1 "never upscale" shrinks the symbol (7 mm → ~4.2 mm). **(B) rejected** — snapping the box to a producible raster (±2.1 mm). **(C)** draw the module grid at the box's exact px (best). **(D)** disable smoothing (Konva `Context.imageSmoothingEnabled`, needs custom `sceneFunc`) — keeps the box size, crisp nearest-neighbour squares with ≤1 device px (0.085 mm) width variation; **owner-accepted**. **(E)** generate higher + downscale once. Validate via `renderLabelPage`.
