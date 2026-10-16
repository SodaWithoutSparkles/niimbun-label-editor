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
- **P11 2D `code`**: `objects.ts` also owns `CODE_FORMATS` / `CodeFormat` /
  `DEFAULT_CODE_FORMAT` (`'datamatrix'`) / `CODE_FORMAT_PX_PER_MODULE` /
  `CODE_FORMAT_QUIET_MODULES` / `codeQuietModules(format)` (7 bcids stored **raw**
  in `CodeNode.format`, like `BarcodeNode.symbology`). `CodeNode` = `type:'code'` +
  **required** `format`, `data`, `fill?`, `quietZone?`. An invalid/absent stored
  `format` is **coerced to `DEFAULT_CODE_FORMAT`** by validate (unlike
  `QrNode.errorCorrection`, which is dropped to absent). `DEFAULT_POLICY_BY_TYPE.code
  = 'threshold'` (`src/core/render/policy.ts`) — omitting it silently routes the
  code through the global dither pass (unscannable); `geometry.ts` aspect-locks `code`.
- `TextNode.fontId` links to `FontRef.fontId`; `fontFamily` stays the resolved
  family string Konva uses. Keep them consistent: selecting a font sets both;
  editing a system family clears `fontId` unless it matches the linked ref.

## Render seam — resolve stays sync, pixels are injected

`resolve()` is synchronous and DOM-free and now emits
`ResolvedImage {imageId,w,h,fit}` / `ResolvedQr {text,placeholder,w,h,errorCorrection}`
/ `ResolvedBarcode {text,placeholder,w,h,symbology}` /
`ResolvedCode {text,placeholder,w,h,format,fill,quietModules}`. Real pixels come
from an **async prep step**, keyed by **resolved node id**:

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
- `qrImage.ts` / `barcodeImage.ts` / `codeImage.ts` — **bwip-js** over the shared
  `symbolEngine.ts` (see below).
- `konvaFactory.createKonvaNode(node, assets?)` + shared `fitImageAttrs`; a fitted
  image is wrapped in a **transform group** so the fit offset and the node
  transform compose. The policy mask (`buildPolicyMask`, `maskAssetSceneFunc`)
  paints an **ink stencil**, not the drawn rect: the prepared asset is tinted to
  the policy key and only its **opaque pixels** claim the leaf's policy; opaque
  `fill` claims the whole rect (a qr/barcode symbol's default `fill` is now
  opaque white, so it claims its whole rect unless explicitly `'transparent'`).
  Transparent pixels (a photo's clear area, a
  `fill:'transparent'` symbol's light modules + quiet zone) leave whatever policy
  is on the leaf below, so mask-topmost == raster-topmost. `applyInkDefaults`
  skips `Konva.Image`.
- `rasterizeResolved`/`renderLabelPage` take `assets?: AssetDeps`;
  `renderLabelPage` calls `fonts.ensureFonts(doc)` first (a rejection degrades to
  fallback fonts). `RenderedLabelPage.warnings?` carries the warning map.
  `buildLabelPrintJob` forwards `deps.assets`. Preview ≡ print preserved.

To add a new asset leaf type: add a `Resolved*` type + `ResolvedNode` union entry
and a builder case in `resolve.ts` (plus a `nodeDrawnLocalPoints` branch if it is
a fitted leaf), a per-type case in `prepareResolvedAssets` (`prepareAssets.ts`), a
`createKonvaNode` case (`konvaFactory.ts`), a mask-carrier + ink-stencil case
(`buildPolicyMask`, `renderLabelPage.ts`), a `leafSignature` case + the
`assetSignatureOf` leaf collection (`usePreparedAssets.ts`), and a preview case in
`ResolvedShape.tsx`.

## bwip-js (QR, barcodes, 2D codes)

- **One dep for all three**: `import { toCanvas } from 'bwip-js/browser'` — the
  bare `bwip-js` resolves to the Node build under Vitest and exports **no
  `toCanvas`**.
- `src/editor/render/symbolEngine.ts` (P11) is the shared core `qrImage.ts` (86
  lines) / `barcodeImage.ts` (93) / `codeImage.ts` all build on: `BwipOptions`,
  `integerPx`, fresh per-shape option builders (`qrBwipOptions` /
  `barcodeBwipOptions` / `codeBwipOptions`), `padSymbol(symbolCanvas, quietPxX,
  quietPxY, fill)` (fills the whole canvas when `hasFill`, then
  `imageSmoothingEnabled = false` + 1:1 `drawImage`), and
  `drawnPitchBelowMinModule(modulePx, targetW, targetH, canvasW, canvasH,
  minModulePx)`. `renderCode(text, format, targetWpx, targetHpx, minModulePx = 1,
  options) → GeneratedSymbol | null` is the 2D entry point; QR/barcodes were
  rewritten onto the core with **byte-identical behaviour**.
- `toCanvas` **writes `scaleX`/`scaleY` back onto the options object**
  (`FixupOptions`) — so options must be **built fresh per call** (hence the
  builders are functions, not constants). Spreading a previously-used options
  object silently pins its scale.
- **Generate at an integer scale ≥1 and never resample** — a non-integer
  downscale drops/merges bar columns (unscannable) and corrupts the module
  matrix. QR / barcodes budget against the padded module count; 2D codes against
  the padded device-px extent. If the box is smaller than the physical minimum
  module (0.25 mm ≈ `minModulePxFor(imageScale)`), still render at scale 1 but
  flag `'too-small'` (QR's verdict is target-based; `code`'s is the **drawn**
  pitch after the node's uniform `contain` fit).
- QR: `bcid:'qrcode'` + `eclevel`. Barcodes: `bcid` = a `BARCODE_SYMBOLOGIES`
  value, `includetext:false`, `paddingwidth/height:0`. **`code` uses `contain`
  fit (the barcode path), NOT QR's square-fill**: `codeone`/`ultracode` are
  payload-dependent and non-square, so the whole raster is letterboxed uniformly.
- **px/module is per-format** (`CODE_FORMAT_PX_PER_MODULE`): every matrix code
  draws 2 px/module at scale 1 (the QR `baseW / 2 = moduleCount` rule, `/modunit
  2`) **except `pdf417` = 1** (`/modunit 1`) — the `/2` rule does **not**
  generalize; look it up. Measured module grids at scale 1, padding 0, payload
  `'LABEL-EDITOR-2D'` (pinned by `codeFormats.test.ts`): datamatrix 18×18 ·
  azteccode 23×23 · **pdf417 103×27** · microqrcode 17×17 · codeone 22×22 ·
  hanxin 25×25 · ultracode 20×13.
- **Quiet zone is app-supplied** (bwip draws none by default):
  `paddingwidth`/`paddingheight` stay 0 and **`backgroundcolor` must never be
  set** (it makes bwip draw its own border → the quiet zone double-counts).
  Per-format modules/side (`CODE_FORMAT_QUIET_MODULES`): datamatrix 1 · azteccode
  **0** (owner decision) · pdf417 2 · microqrcode 2 · codeone 1 · hanxin 3 ·
  ultracode 1. (QR default 4; 1D via `barcodeQuietModules`.)
- `azteccode` accepts arbitrary text; only `aztecrune` is numeric-only (not
  shipped).
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

## Media management + "use existing" (P9)

- `ResourceRecord` now carries **optional** `name?`, `widthPx?`, `heightPx?` (set on import in
  `editor/render/assetImport.ts`); legacy `{id,mediaType,bytes}` rows still validate. **No DB bump** —
  the `'resources'` store is reused.
- `MediaSection` (nav `media`) lists `resourceRepo` records with an object-URL `<img>` preview
  (created + **revoked** in an effect) or a font icon; rename + delete; built on
  `useCatalogue`/`CatalogueLayout`.
- **"Use existing" import** (`ImageImportDialog`): pick a stored image and either **Reference**
  (`ImageRef.imageId` = a new id, `source = {kind:'local', resourceId: <existing>}` — **no write**; the
  asset provider keys on `source.resourceId`, so a reference renders) or **Clone** (`resourceRepo.put` a
  copy under a new id, `imageId === source.resourceId`). CSV equivalent via `CsvPickDialog`/`DataSourceTab`.
- Async pickers use a per-operation **generation token** (not a shared boolean), so a close/reopen
  mid-flight cannot fire a stale continuation against a later session.
