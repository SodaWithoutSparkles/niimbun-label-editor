# P3 action plan — colour thumbnails + D-50 backfill

- Parent plan: [`plan.md`](plan.md) §P3. Status: **DONE** (2026-10-20) — reviewed, committed.
- Goal: a saved preview is the **colour design the user made**, not a quantized render. The gallery
  shows whatever was saved (stale included), with no quantized path in the gallery. **Fixes D-50.**

## Decisions (parent-plan open question 3)

1. **Composition:** keep the white page + region clip, at the existing **100 dpi**
   (`GALLERY_THUMBNAIL_DPI`). The thumb is the rasterized page, clipped to the printable union — it
   still reads as a label, and it matches the print geometry.
2. **Stale is allowed (owner decision 6):** an existing quantized thumb stays visible until its label
   is reopened; **no invalidation sweep and no marker field**. Backfill only covers labels with **no**
   thumb (`LabelSummary.thumb` is absent when both the `thumbs` store and `meta.thumb` are empty).
3. **One render, two outputs:** the 100-dpi PNG `Blob` for the `thumbs` IDB store **and** a
   downscaled `meta.thumb` data URL (≤512 px longest side, ≤64 KB decoded). The `thumbs` write stays
   in the hook; `meta.thumb` is written into the **in-memory `doc.meta`** (repo-side only would be
   clobbered by the next `labelRepo.save`, which replaces the whole record from `doc.meta`).
4. **No quantized path in the gallery.** `renderDocPreview` skips mask build, quantization and the
   print-only overrides (invert/mirror/offset — all post-quantize today).
5. **Print-queue thumbnails stay quantized** (`usePrintThumbnails`, 100 dpi) — the owner's decision
   does not touch them.

## Fact base (verified this phase)

- Producer today: `editor/render/docThumbnail.ts` → `renderLabelPage` at 100 dpi → PNG `Blob` →
  `labelRepo.putThumb` (`thumbs` store). `meta.thumb` has **no writer anywhere** ✔.
- `meta.thumb` type: `{ mediaType; dataUrl; at }`, raster MIME only, **≤512 px** longest side,
  **≤64 KB** decoded (`core/doc/types.ts:280-285`); `validate.ts:731-758, 856-874` **strips** an
  invalid thumb but keeps the doc.
- `labelRepo.save` replaces the whole record (`{meta: structuredClone(doc.meta), docGz, …}`) ✔ —
  `data/labelRepo.ts:159-174`. `toSummary` resolves `thumbs` first, then `meta.thumb.dataUrl`
  (`:92-119`); the gallery reads `summary.thumb` (`LabelCard.tsx:82`).
- No `setDocMeta`/`patchDoc` action exists; `updateNodeTransient` is the history-free plain-`set`
  precedent, and autosave is scheduled explicitly (`commit`/`commitDoc`/undo/redo), not by a
  subscription ✔.
- `renderLabelPage` pre-quantize prelude (dpi validation → resolve → dims → cap → fonts → asset prep
  → `rasterizeResolved`) is lines ~562-611; post-quantize overrides start at `:638`.
- Worklist is free: `listDetailed()` → `toSummary` per record; a missing thumb means both stores are
  empty, so no extra read is needed to build the list.

## Work items — wave 1

### W1 — shared render prelude + colour producer (owner: `general`)

**a. Extract the pre-quantize prelude** from `renderLabelPage` into an exported helper **in the same
module**, used by both entry points so the colour path cannot drift from the print path:

```ts
export interface BasePage {
  dpi: number; nodes: ResolvedNode[]; widthPx: number; heightPx: number;
  imageData: RgbaBuffer; assets: ReadonlyMap<string, PreparedAsset>;
  warnings?: ReadonlyMap<string, AssetWarning>;
}
export const renderPageBase = async (doc, ctx, opts: { dpi?: number; assets?: AssetDeps }): Promise<BasePage>
```

It owns exactly: dpi resolution + validation, `resolve`, `rasterDimensions`, integer checks,
`MAX_RASTER_PIXELS`, `ensureFonts`, `prepareResolvedAssets` (threading the effective dpi), and
`rasterizeResolved`. `renderLabelPage` calls it and continues unchanged (mask → clip → quantize →
overrides → clip → canvas). **Behaviour must be byte-identical** — the whole existing
`renderLabelPage.*` suite is the guard.

**b. Colour producer** in `editor/render/docThumbnail.ts` (rewrite of the module):

```ts
export interface MetaThumb { mediaType: string; dataUrl: string; at: number }
export interface DocPreview {
  canvas: HTMLCanvasElement; rgba: RgbaBuffer;
  blob: Blob | null;              // 100-dpi PNG for the `thumbs` store
  metaThumb: MetaThumb | undefined; // ≤512 px / ≤64 KB, shapecorrect for `meta.thumb`
}
export const renderDocPreview = async (doc, assets?: AssetDeps, ctx?: ResolveContext): Promise<DocPreview | null>
```

- `renderPageBase` at `GALLERY_THUMBNAIL_DPI` → `applyRegionClip(imageData, {widthPx,heightPx},
  doc.label.regions, HM_PER_INCH / dpi)` → draw RGBA to a fresh canvas. **No mask build, no
  quantize, no invert/mirror/offset.**
- `blob` = PNG of that canvas (as today; never throws → `null`).
- `metaThumb` = downscaled copy: fit the **512 px** longest side; encode PNG; if the decoded size
  exceeds **64 KB**, re-encode as JPEG (`quality 0.85`), then progressively halve the longest side
  (bounded, min 128 px) until it fits; **give up (undefined) rather than fail the preview**. `at` =
  epoch **seconds** (`Math.floor(Date.now()/1000)`), matching `meta.updatedAt`.
- Export the cap constants from `core/doc/validate.ts` (`THUMB_MAX_SIDE`, `THUMB_MAX_BYTES`) and
  import them here so the producer and validator cannot drift.
- Keep `never throws` (`null` on any failure). Update the module doc comment: colour, not quantized;
  the `thumbs` store + `meta.thumb` outputs; the layer rule.

**Tests (W1):** colour output is **not** 1-bit (a doc whose nodes hint `threshold` still yields
intermediate RGB values); the region clip still white-outs outside the union; `renderPageBase`
parity is covered by the existing `renderLabelPage` suites (run them); `metaThumb` passes
`parseDoc` **with the thumb kept** (≤512 px, ≤64 KB) for a large label and a photo-heavy one;
unrenderable doc → `null`.

## Work items — wave 2 (after W1)

### W2 — hook writes both outputs + `meta.thumb` store action (owner: `small-coder`)

- New history-free store action `setDocThumb(thumb)` (editorSlice): if the current doc's
  `meta.thumb.dataUrl` is identical, **no-op**; else plain `set` of the patched `currentDoc` (no
  `docPast`, no `updatedAt` stamp) and `scheduleAutosave()` so the record persists when autosave is
  on. Add the type/seed/reset entries the slice idiom needs.
- `useDocThumbnail`: call `renderDocPreview` once per debounce; `putThumb(docId, blob)` as today;
  patch `doc.meta.thumb` **only when the produced `metaThumb` differs** from the doc's current one
  (prevents a render → patch → render loop; the thumb patch changes `currentDoc` identity, so the
  next debounce runs once more and then no-ops). Keep the per-doc token, dirty flag, transition
  refresh and StrictMode guarantees.
- Tests: writes both stores; a second identical render does not patch again (no loop); no undo
  entry; an autosave is scheduled when autosave is on; a superseded token still cannot write.

### W3 — D-50 backfill (owner: `small-coder`)

- New hook `src/components/gallery/useThumbBackfill.ts`, mounted in `GalleryView`.
- Worklist = `gallery` summaries with **no `thumb`**; take a **bounded** batch (≤8 per gallery
  visit, chunks of 2 with an idle gap via `requestIdleCallback` + a `setTimeout` fallback).
- Per item: `labelRepo.get(id)` → `renderDocPreview(doc, providers)` → `putThumb(id, blob)` +
  patch `doc.meta.thumb` + `labelRepo.save(patchedDoc)`; then **one** `refreshGallery` per batch.
- **Once-guard**: a module-level `Set<string>` of attempted ids (survives StrictMode remounts) +
  an in-flight token; never retry an attempted id in the same session. Stop when the view leaves
  the gallery or the hook unmounts. Non-fatal: any failure just moves on.
- Providers: memoized `createResourceAssetProviders(resourceRepo)`.
- Tests: only no-thumb labels are picked; the batch is bounded; a second mount does not re-process
  attempted ids; a label with a thumb is untouched; one refresh per batch; StrictMode-safe.

## Verification (coordinator runs)

- `bun.exe run test:run src/editor/render/docThumbnail.test.ts src/components/editor/useDocThumbnail.test.tsx src/components/gallery src/editor/render/renderLabelPage.test.ts`
- `node node_modules/typescript/bin/tsc --noEmit`
- Full suite before the commit.

## Review + commit

- Reviewer: `review` (logic-heavy: render extraction, producer caps, hook/backfill lifecycle).
- Max 2 fix rounds; narrow re-review with `review-fast`.
- Commit: `feat(gallery): colour thumbnails of the saved design`.
- Memory after commit: `app-shell.md` (thumbnail pipeline: colour + `meta.thumb` + backfill),
  `tech-debt.md` (**D-50 closed**), `state.md`.

## Outcome (2026-10-20)

- Shipped: `renderPageBase` extracted from `renderLabelPage` (one pre-quantize prelude shared by the
  print path and the colour path); `renderDocPreview` = colour 100-dpi page (region clip, no
  mask/quantize/overrides) producing the `thumbs` blob **and** a validator-safe `meta.thumb`
  (≤512 px / ≤64 KB, PNG→JPEG→downscale); `setDocThumb` history-free doc patch; the hook writes both
  outputs independently; `useThumbBackfill` fills no-thumb labels (bounded 8/visit, chunks of 2,
  restart-safe attempted set, fresh read before `save`, cancellation before every write).
- **Review round 1 (`review`, CHANGES NEEDED)**: a cancelled backfill could save a stale parsed doc
  (whole-record replace); a valid `metaThumb` was discarded when the blob failed; a partial write
  (blob ok, save failed) skipped the batch refresh. Fixed. Re-review: **APPROVE** with 3 minors — a
  deleted-label orphan thumb row, a `dirty` flag set on a no-op patch, and a missing in-flight
  cancellation test. All fixed.
- Verification: full suite **2294 passed / 170 files**, `tsc --noEmit` clean.
- Memory: **D-50 closed**, `app-shell.md` §Gallery card art rewritten, `memory.md` index updated.
