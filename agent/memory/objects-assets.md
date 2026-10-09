# Objects, fonts & assets (`src/core/doc`, `src/editor/render`, `src/editor/assetImport.ts`)

Added in P5 (2026-10-05). How images, QR, barcodes, imported fonts, and asset
identity fit into the shared render pipeline. Read before touching
`src/editor/render/*` or the object inspector.

## Object model (doc schema)

- `src/core/doc/objects.ts` is the **single source** for the new object enums +
  defaults: `BARCODE_SYMBOLOGIES` (28 bwip-js bcids), `IMAGE_FITS`
  (`contain|cover|stretch`), `QR_ERROR_CORRECTIONS` (`L|M|Q|H`) + `DEFAULT_*`.
- `types.ts` optionals: `TextNode.fontId?`, `ImageNode.fit?`,
  `QrNode.errorCorrection?`, `BarcodeNode.symbology?`. `validate.ts` accepts and
  **drops invalid optionals with a repair** (never fails the doc), mirroring
  `quantizerHint`.
- `TextNode.fontId` links to `FontRef.fontId`; `fontFamily` stays the resolved
  family string Konva uses. Keep them consistent: selecting a font sets both;
  editing a system family clears `fontId` unless it matches the linked ref.

## Render seam — resolve stays sync, pixels are injected

`resolve()` is synchronous and DOM-free and now emits
`ResolvedImage {imageId,w,h,fit}` / `ResolvedQr {text,placeholder,w,h,errorCorrection}`
/ `ResolvedBarcode {text,placeholder,w,h,symbology}`. Real pixels come from an
**async prep step**, keyed by **resolved node id**:

- `assets.ts` — interfaces only: `PreparedAsset`, `BytesProvider`, `FontProvider`,
  `AssetDeps` (`images`, `fonts`, `imageScale`, optional `resolveImage`),
  `AssetWarning = 'missing'|'invalid'|'too-small'`.
- `prepareAssets.ts` — `prepareResolvedAssets(nodes, doc, deps) → {assets, warnings}`.
  `imageScale` = device px per hm (print default `dpi/HM_PER_INCH`; editor
  `effectiveZoom * devicePixelRatio`). Decode cache is **per provider**
  (WeakMap) and bounded; image loads are concurrency-capped.
- `imageAssets.ts` — `decodeImageBytes` / `loadImageRef` (local via provider,
  inline, remote via `fetch` with a 15 s timeout + 20 MB cap) / `capImageAsset`
  (**aspect-preserving** `min(source, required px)`, never upscale).
- `qrImage.ts` / `barcodeImage.ts` — **bwip-js** (see below).
- `konvaFactory.createKonvaNode(node, assets?)` + shared `fitImageAttrs`; a fitted
  image is wrapped in a **transform group** so the fit offset and the node
  transform compose. The policy mask (`buildPolicyMask`, `maskAssetSceneFunc`)
  paints an **ink stencil**, not the drawn rect: the prepared asset is tinted to
  the policy key and only its **opaque pixels** claim the leaf's policy; opaque
  `fill` claims the whole rect. Transparent pixels (a photo's clear area, a
  `fill:'transparent'` symbol's light modules + quiet zone) leave whatever policy
  is on the leaf below, so mask-topmost == raster-topmost. `applyInkDefaults`
  skips `Konva.Image`.
- `rasterizeResolved`/`renderLabelPage` take `assets?: AssetDeps`;
  `renderLabelPage` calls `fonts.ensureFonts(doc)` first (a rejection degrades to
  fallback fonts). `RenderedLabelPage.warnings?` carries the warning map.
  `buildLabelPrintJob` forwards `deps.assets`. Preview ≡ print preserved.

To add a new leaf type: add a `Resolved*` type in `resolve.ts`, a case in
`prepareResolvedAssets`, a `createKonvaNode` case, and a mask-carrier case.

## bwip-js (QR + barcodes)

- **One dep for both**: `import { toCanvas } from 'bwip-js/browser'` — the bare
  `bwip-js` resolves to the Node build under Vitest and exports **no `toCanvas`**.
- QR: `bcid:'qrcode'` + `eclevel`. Barcodes: `bcid` = a `BARCODE_SYMBOLOGIES`
  value, `includetext:false`, `paddingwidth/height:0`.
- **Generate at an integer scale ≥1 and never resample** — a non-integer
  downscale drops/merges bar columns (unscannable) and corrupts QR matrices. If
  the box is smaller than the physical minimum module (0.25 mm ≈
  `minModulePxFor(imageScale)`), still render at scale 1 but flag `'too-small'`.
- `toCanvas` **mutates the options object** — build fresh options per call.
- Invalid payload for a format throws → catch → `null` + `'invalid'` warning.

## Images — import + provenance

- `assetImport.ts`: `importImageFile` → `local` (bytes in IDB `resources` +
  sha256 fingerprint); `importImageUrl` → `remote` (fetched once at import for
  dimensions; not stored). `importFontFile` → imported `FontRef`.
- **Remote images require CORS** to render/print: the print/quantize path reads
  pixels (`getImageData`), which taints on a cross-origin image without
  `Access-Control-Allow-Origin`. A non-CORS host fails with the localised import
  error. `http.cat` does NOT send CORS; `picsum.photos` does.
- Fingerprint = sha256 **once at import** (`src/data/hash.ts`), never re-hashed.

## Fonts

- `fontAssets.ts`: `createFontProvider({ getBytes })` registers imported
  `FontFace`s from IDB bytes; `classifyFont`/`fontBadges` → `imported|system|missing`.
  Missing → browser fallback + ⚠ in the inspector. The editor hook must call
  `ensureFonts(doc)` or imported fonts fall back in the preview while print works.
- Imported fonts are referenced by `fontId`; names/alt are document data, never
  storage keys — renaming never breaks references.

## Store

- `docSlice` creates a `resourceRepo` on the **same IDB adapter** as `labelRepo`
  (injectable in tests). `editorSlice` has undoable `addImageRef`/`updateImageRef`/
  `addFontRef`/`updateFontRef` (one history entry each; rename leaves node refs).

## Tests

Real-canvas tests via `src/test/canvasHarness.ts`. Heavy render tests need the
raised `testTimeout` (15 s) — they flake at the 5 s default under full-suite
parallel load. bwip-js is exercised at the engine level; injected `resolveImage`
keeps tests offline.
