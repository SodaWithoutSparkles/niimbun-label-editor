# Phase 5 — Objects + fonts + assets (M5) — ACTION PLAN

**Run:** `agent/2026-09-29_label-editor-v1` · **Owner:** Coordinator · **Started:** 2026-10-04
**Plan:** `plan.md` P5 row (line 312), decisions 6/17/22/23/29/30/31/36/42 · **Prev:** `HANDOFF-p4.md` · **Handoff:** `HANDOFF-p5.md`
**Status:** DONE ✅ (2026-10-05) — committed `a34f401`…`2ab28b4`; hardware smoke passed. See `state.md` P5 record.

## 0. Scope (frozen from plan:312)

Deliver objects + resources so **text / image / QR / barcode place, render, print**:

1. **Image objects** — resource store wiring, resolution-cap rule, render + print an `ImageNode`.
2. **QR + barcode objects** — templatable `ContentSource` payloads (static only in P5; execution P6), render + print.
3. **Imported fonts** — upload → **SHA-256 once** → IDB `resources`; `FontRef system|imported`; missing → fallback + ⚠ badge; badges `✓ imported / ⚠ system / ⚠ missing`.
4. **Asset name/alt + rename UI** — `ImageRef`/`FontRef` carry `name` + optional `alt`; rename never breaks references.
5. **Barcode-lib spike** — decided (below).

**Exit criteria:** text/image/QR/barcode place, render, print; font badges correct; assets identifiable by name.

## 1. Locked owner decisions (2026-10-04)

- **Barcode + QR library = `bwip-js`** (owner override 2026-10-04; active, ESM-clean, broad symbology set, and it **also renders QR** via `bcid:'qrcode'`). Therefore **no separate `qrcode` dependency** — the plan's `qrcode@1.5.4` row is superseded by bwip-js. **Install approved:** `bun add bwip-js@4.11.4` (types bundled).
- **Support a broad symbology set**, not just CODE128/EAN-13: the stored `BarcodeNode.symbology` is a **union of bwip-js `bcid` strings in the doc schema** and the render path is generic (barcodes are vector bars, not per-format rasters). Union (bwip-js bcids): `code128`, `code39`, `code39ext`, `code93`, `code93ext`, `code11`, `ean13`, `ean8`, `ean5`, `ean2`, `upca`, `upce`, `upc`, `itf14`, `interleaved2of5`, `industrial2of5`, `iata2of5`, `datalogic2of5`, `matrix2of5`, `coop2of5`, `code2of5`, `pharmacode`, `pharmacode2`, `rationalizedCodabar`, `codabar`, `msi`, `plessey`, `telepen`. Extending = one line in `BARCODE_SYMBOLOGIES`.
- **Image import writes `local` (file upload) or `remote` (URL).** `inline`/`external` stay P8 export policy. Test URL: `https://http.cat/images/200.jpg` (any http code works).
- **Resolution cap = `min(source, required px)`**, never upscale. Editor required = node on-screen CSS px × DPR; print required = node box px at doc dpi.
- **Fonts: system picker + file upload, both in the inspector.** Badges on each entry.
- Unchanged: `src/core/` stays React/Konva/DOM-free; integer `hm`; preview ≡ print (single `renderLabelPage`); every product string via `t()`; global handlers bail on `dialog[open]`; reviewer routing `review` + `experimental-review` (both available), `review-fast` for narrow re-reviews; **one semantic commit per area, ask the owner before each**.

## 2. Design seams (P5 owns these; do not relitigate P4)

### 2.1 Schema additions (`src/core/doc/`) — types only, DOM-free

```ts
// new: src/core/doc/objects.ts  (single source for the object enums + defaults)
export const BARCODE_SYMBOLOGIES = [/* the bwip-js bcids above */] as const;
export type BarcodeSymbology = (typeof BARCODE_SYMBOLOGIES)[number];
export const DEFAULT_BARCODE_SYMBOLOGY: BarcodeSymbology = 'code128';

export type ImageFit = 'contain' | 'cover' | 'stretch';       // default 'contain'
export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H';        // default 'M'; mapped to bwip-js `eclevel`

// types.ts deltas
TextNode.fontId?: string;              // links to FontRef.fontId; fontFamily stays the resolved family
ImageNode.fit?: ImageFit;             // resolution cap is DERIVED, never stored
QrNode.errorCorrection?: QrErrorCorrection;
BarcodeNode.symbology?: BarcodeSymbology;
```

- `validate.ts`: accept + repair the new optionals (unknown `symbology` → dropped/CODE128; unknown `fit`/`errorCorrection` → dropped; non-string `fontId` → dropped). Never fail the whole doc on a bad optional (mirror `quantizerHint`).
- `factory.roundNode`/`createLabelDoc`: no new rounding needed (all enums/strings); keep `resources:{fonts:[],images:[]}`.
- `src/core/headless.test.ts` must stay green (no DOM import added).

### 2.2 Async asset seam (the P5 crux)

`resolve` stays **synchronous and DOM-free**: it emits geometry + payload only. Real pixels are produced by a separate async prep step and injected.

```ts
// resolve.ts — new resolved leaf types
ResolvedImage   { type:'image';   imageId:string; w;h; fit:ImageFit }
ResolvedQr      { type:'qr';      text:string;    w;h }   // text from resolveContent(node.data)
ResolvedBarcode { type:'barcode'; text:string;    w;h; symbology:BarcodeSymbology }
```
Add these to `ResolvedNodeType`/`ResolvedNode`. `nodeLocalPoints` already treats them as the `(0,0,w,h)` box. `resolve` resolves their `ContentSource` via existing `resolveContent` (csv/template → static `fallback`, execution P6).

```ts
// new: src/editor/render/assets.ts  (interfaces only, no IDB)
export type PreparedAsset = { image: CanvasImageSource; widthPx: number; heightPx: number };
export interface BytesProvider { getBytes(resourceId: string): Promise<Uint8Array | null>; }
export interface AssetDeps { images?: BytesProvider; fonts?: BytesProvider; }

// new: src/editor/render/prepareAssets.ts
prepareResolvedAssets(nodes, doc, deps): Promise<Map<nodeId, PreparedAsset>>
```
- image → decode `AssetRef.local` (via `deps.images`) / `inline` / `remote`; apply the resolution cap; missing → no entry.
- qr → bwip-js `toCanvas(canvas, { bcid: 'qrcode', text, eclevel: errorCorrection, scale… })`.
- barcode → bwip-js `toCanvas(canvas, { bcid: symbology, text, scaleX: 1, scaleY: …, includetext: false, paddingwidth: 0 })`; wrap in `try/catch` (invalid payload for a format throws) → no entry + a render warning seam.
- One cache keyed by `imageId`/`nodeId+fingerprint` so the editor does not re-decode per render.

`rasterizeResolved(nodes, opts, assets?)` and `renderLabelPage(doc, ctx, opts)` call `prepareResolvedAssets` first (opts gains `assets?: AssetDeps`). `buildLabelPrintJob` gains `deps.assets?` passthrough. **Preview ≡ print preserved**: both still go through `renderLabelPage`.

`konvaFactory.createKonvaNode(node, assets?)` gains `image`/`qr`/`barcode` cases → `Konva.Image` with the prepared source, fit-computed draw rect. Missing asset → draws nothing (editor placeholder handled in `ResolvedShape`).

**Known integration points (flagged for review):**
- `rasterize.applyInkDefaults` must NOT black-fill image/qr/barcode (currently fills any unstyled `Konva.Shape`).
- `renderLabelPage.paintCoverage` must give image/qr/barcode their **box** coverage for the policy mask (their defaults already resolve: image→FS, qr/barcode→threshold).

### 2.3 Resource store + fonts

- `docSlice`: create a `resourceRepo` on the **same adapter** in `initPersistence`; expose `resourceRepo`/`setResourceRepo` (tests inject a memory-backed repo). `BytesProvider` implementations in `src/editor/render/assetProviders.ts` wrap it.
- `src/data/hash.ts`: `sha256Hex(bytes)` via Web Crypto (`crypto.subtle.digest`). Fingerprint computed **once at import**, stored on the `AssetRef.local`, never re-hashed.
- `src/editor/render/fontAssets.ts`: register imported fonts (`FontFace(familyName, bytes)` + `document.fonts.add`), `awaitFontsReady`; pure `fontBadge(ref, availability) → 'imported'|'system'|'missing'`; missing → fallback family + ⚠.
- `src/editor/assetImport.ts`: file/URL → bytes → fingerprint → `resourceRepo.put` → `ImageRef`/`FontRef` (name/alt defaults from filename; `widthPx/heightPx` decoded for images).
- Store actions (one undo entry each): `addImageRef`, `updateImageRef`, `addFontRef`, `updateFontRef`.

### 2.4 Editor UI wiring

- **InsertRail**: enable image/qr/barcode. Image button opens the import dialog (file **or** URL) then places at centre sized to aspect. QR/barcode arm → click-to-place with a default static payload (QR `https://example.com`; barcode `123456789012`) + sensible default symbol size.
- **PreviewStage/ResolvedShape**: a hook loads prepared assets (editor required-px cap) and `ResolvedShape` renders `Image`/`Qr`/`Barcode` from the map; missing → labelled placeholder box.
- **inspectorModel + ObjectTab**: wire image `imageId` (resource select + Import) and `fit`; qr `data` (static text) + `errorCorrection`; barcode `data` (static text) + `symbology` (full union); text `fontId` (font select + Import). Add asset name/alt rename fields for the selected node's referenced asset.
- **i18n**: every new string through `t()` (typed keys; literal-map pattern for dynamic keys). `?print=1` sample extended to include an image + QR + barcode.

## 3. Workstreams

| WS | Area | Files | Status |
| -- | ---- | ----- | ------ |
| W0 | Doc schema + validate + factory (`fontId`, `fit`, `errorCorrection`, `symbology`) | `src/core/doc/*` | **DONE** — reviewed (no blocking) |
| W1 | Render seam + image engine + resolution cap | `src/editor/render/{resolve,konvaFactory,rasterize,renderLabelPage,assets,prepareAssets,imageAssets}` | **DONE** — 2 review rounds + narrow re-review |
| W2 | QR engine | `src/editor/render/qrImage.ts` (+ seam) | **DONE** |
| W3 | Barcode engine (all symbologies) | `src/editor/render/barcodeImage.ts` (+ seam) | **DONE** |
| W4 | Resources + fonts (SHA-256, store, badges, loader) | `src/data/*`, `src/store/*`, `src/editor/render/fontAssets|assetProviders` | **DONE** |
| W5 | Asset name/alt/rename UI | inspector + `dialogService` + i18n | **DONE** — review + fix round |
| W6 | Insert-rail enable + inspector + preview wiring | `src/components/editor/*`, `?print=1` sample | **DONE** — review + fix round |

**Note on parallelism:** W1/W2/W3 share `resolve`/`konvaFactory`/`rasterize`/`renderLabelPage`, so they are implemented **as one seam** (one agent), not three parallel editors of the same files. W4 is disjoint (data/store/new modules) and runs **in parallel** against W1's interfaces. W5/W6 follow once W1–W4 land.

## 4. Sequencing

1. **W0** schema (`small-coder`) → `tsc`.
2. **W1+W2+W3** seam+engines (`general`) ∥ **W4** resources+fonts (`general`) — parallel, distinct files; both code against §2.2/§2.3 interfaces.
3. Review W1–W4 per area (`review` + `experimental-review`), fix ≤2 rounds.
4. **W5+W6** UI wiring (`general`), then review.
5. `bun run test:run` green · `tsc --noEmit` clean · `bun run build` green.
6. Headed check (`ab`, `?print=1`) place→render→print image/QR/barcode; font badges.
7. Owner hardware smoke (advisory; P5 exit criteria include printing image/QR/barcode).
8. Update `state.md` + this plan; escalate lessons to `agent/memory/*`; **commit per area (ask owner first)**.

## 5. Commands

- Tests: `bun run test:run` · typecheck `node_modules/.bin/tsc.exe --noEmit` · build `…/bun.exe run build`. **Never `bunx`/`npx`/`bun test`.**
- Real-canvas tests via `src/test/canvasHarness.ts`. Browser-only interactions verified **headed** (`bun run dev`, `?print=1`).
- Subagents must **not delegate** (depth 1); missing info → terminal `needs-info. q: … . hint: … . next: … .`.

## 6. Risks / carry

- Invalid payload for a strict format (EAN/UPC length, CODE39 charset) throws in bwip-js → must be caught; render a placeholder, never crash the pipeline. Same for QR (empty/oversized payload).
- bwip-js is large (~250–280 KB gzip, no real tree-shaking) and covers both QR + barcodes — one dependency instead of two; bundle-size cost accepted by the owner.
- Remote images are a network fetch at render — the gallery rule "never fetch" (decision 37) applies to the **gallery**, not the editor/print of an open doc; keep fetches out of gallery code paths.
- Keep the plain place→render→print path independent of name/alt/fingerprint (differentiator isolation, decision 42).
