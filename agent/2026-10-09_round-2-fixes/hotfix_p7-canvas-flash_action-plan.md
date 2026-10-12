# Hotfix action plan — canvas flash + drag lag (found during P7)

Owner report 2026-10-13 (during P7 browser verification): the canvas "flashes while elements
update" on a steady ~1 s rhythm, and dragging objects is laggy. Owner refined the symptom:
**image / QR / barcode leaves flash; shapes, static text and templated text do not.**

Owner decision: **hotfix now, flash + lag**, before P8. Owner verifies in the browser manually.
Not a P7 regression — see *Attribution*.

## Root cause (verified, not hypothesised)

1. Only the three async-prepared raster types read `assets`. Shapes/text never do → that is exactly
   the set the owner observes flashing.
2. `PreviewStage.tsx:310` — `resolved = useMemo(() => resolvePreviewTree(doc, overrides), [doc, overrides])`.
   Each resolve pass commits a **fresh `overrides` object** (`useSampleRow.ts:450`/`:465`), so
   `resolved` gets a **new array identity even when the resolved content is identical**.
3. `usePreparedAssets.ts:169` —
   `return state.nodes === nodes && state.doc === doc ? state.prepared : EMPTY;`
   Any identity change ⇒ `EMPTY` for one render ⇒ the asset leaves render their dashed **placeholder**,
   then the async prepare lands and flips back to the raster = **the flash**.
   The comment at `:129-132` calls this deliberate (must-fix #6: never briefly show the *previous
   document's* rasters).
4. Writers of that identity churn: **P6's 1 s refresh tick** (`useSampleRow.ts:325-331`, the owner's
   "1 s template refresh") and **every drag frame** (`updateNodeTransient`,
   `editorSlice.ts:641-649`, called from `PreviewStage.tsx:820`). The same per-frame
   clear→prepare cycle is the drag lag.

### Attribution

**Pre-existing (P5 assets + P6 tick), NOT the P7 diff.** The tick is P6's and the cache is P5's; P7
added no per-frame writer. P7's only canvas-path footprint is the 15 s printer heartbeat
re-rendering `EditorShell` (which has subscribed to `printerStatus` at `EditorShell.tsx:35` since
before P7). The owner's "started with P7" is a coincidence of noticing — but the report is real and
gets fixed here.

## The fix

### H1 — key the asset cache on content, not identity  [writer 1: `src/components/editor/usePreparedAssets.ts`]

Replace the `nodes`/`doc` **identity** comparison with a **content signature of the inputs
`prepareResolvedAssets` actually reads**:

- the asset-bearing leaves only (`image`/`qr`/`barcode`) in `flatResolved` order;
- per leaf: `id`, `type`, `w`, `h`, plus **exactly the fields `prepareAssets.ts` reads for that type**
  (derive the list from `prepareAssets.ts:180-260+` — e.g. image: `imageId` + the referenced `ImageRef`
  source/bytes identity; qr: `text`, `errorCorrection`, `quietModules`, `fill`, `placeholder`;
  barcode: whatever its case reads). Do not hardcode a list that can drift — mirror the reader;
- `doc.meta.id` (preserves must-fix #6: a real document switch still clears);
- the scale inputs (`deps` identity is already in the dep array: `imageScale`/`symbolScale`/fonts).

Behaviour:
- **signature unchanged** → keep the previous `prepared` (no `EMPTY`, and **skip the prepare effect
  entirely** — no `ensureFonts`, no `prepareResolvedAssets`). This kills the flash **and** removes the
  per-frame/per-tick async work (a large share of the drag lag).
- **signature changed** → current behaviour exactly (return `EMPTY` for one render, then the async
  prepare commits). Must-fix #6 is preserved.

Do **not** weaken P5's synchronous `resolvePreviewTree` per render (`PreviewStage.tsx:310`) — memory
`csv-templates.md:125-128` records that a drag must repaint immediately; rendering the pass's resolved
snapshot is explicitly forbidden.

**Tests (this is unit-testable — do it):** a new/extended `usePreparedAssets` test file:
- re-render with a **new `nodes` array identity carrying identical content** ⇒ the previous prepared
  assets are **retained** (no empty frame) and no prepare re-runs;
- a real asset edit (e.g. qr `text`, image ref swap, `w`/`h` change, zoom/`imageScale` change) ⇒
  `EMPTY` for one render, then the new asset (must-fix #6 still holds);
- switching `doc.meta.id` ⇒ clears;
- a doc with only shapes/text ⇒ never prepares.

### H2 — stop the per-frame store writes on the drag path  [writer 2: `src/components/editor/PreviewStage.tsx`]

**Confirm each item before changing it, and fix only what you confirm is a real per-frame write:**

1. **Warnings effect** (`PreviewStage.tsx:352-373`) calls `setEditorWarnings` on every run, and its
   deps include `[doc, …]` which changes every drag frame ⇒ a store write per frame, cascading to every
   `editorWarnings` subscriber. Dedupe: only write when the payload actually differs (compare the
   produced warnings to the current store value before writing).
2. **Recenter effect** (`PreviewStage.tsx:285-293`) depends on `backing`, which is
   `useMemo(…, [doc])` (`:248-251`) ⇒ new identity every drag frame ⇒ `setViewport(centeredViewport(…))`
   re-fires per frame writing a value-equal viewport. Guard with a value comparison before writing.
3. Report anything else you find in the same file that writes store state on the per-frame path
   (do not go hunting beyond `PreviewStage.tsx` — other per-frame churn is out of this hotfix's scope).

## Outcome (2026-10-13)

**Shipped — commit `c17bfab`** `fix(editor): stop asset raster flash and per-frame store writes on the drag path`.
`tsc` clean; full suite **121 files / 1621 tests** green (+17 from this hotfix).

- **H1** — the cache key is now a content signature mirroring `prepareResolvedAssets`'s reader
  (asset leaves + per-type fields, sources keyed **once per object** through a WeakMap by cached
  content key, `doc.meta.id`, `doc.label.dpi`, fonts). Unchanged signature ⇒ reuse the rasters **and
  skip the prepare**; changed ⇒ the old clear-then-prepare (must-fix #6 intact). `deps` stays an
  effect dep only, so a zoom keeps the old raster while re-capping (no new flash).
  - Implementer caught a trap worth remembering: a **monotonic identity token** for sources would
    flash on **frame 1 of every drag**, because `updateNodeTransient` deep-clones the doc on its
    first frame (`editorSlice.ts:639`) and mints new-but-equal `source` objects — hence the cached
    *content* key.
  - Added a bounded self-heal: a prepare reporting `missing`/`invalid` arms `focus`/`online` retries
    and disarms on the next failure-free commit (restores the retry story the removed per-frame
    churn used to provide).
- **H2** — the warnings effect was publishing **and** clearing `editorWarnings.preview` every drag
  frame (two identity-changing store writes per frame, cascading to every subscriber); now deduped
  (`sameWarnings`) with the cleanup split out and keyed on doc id. The recenter effect re-fired a
  value-equal `setViewport` every frame because `backing` re-memoises on every doc change; now a
  functional update that bails on an unchanged viewport.
- **Review:** `review` region-blocked → `review-alt`: **approve**, 0 blockers / 0 majors, 2 risks +
  3 nits. Both risks closed in a second round (per-frame payload stringify → WeakMap content key;
  lost self-heal → bounded retry) plus the signature-coverage test gap. Nits accepted and recorded:
  **D-44** (fonts in the raster key ⇒ a font edit flashes rasters once) and **D-45** (no regression
  test for the recenter bail-out).
- **Owner verifies the visual result in the browser manually** (agreed 2026-10-13) — this is a
  timing/repaint bug, so unit tests alone do not prove the flash is gone.
- Explicitly **out of scope** (unchanged): the deliberate per-render synchronous `resolvePreviewTree`,
  other per-frame re-renders in `ObjectTab`/`MfpPanel`/`LayersPanel`/`JsTab`/`WarningsTab`, D-21, and
  `EditorShell.tsx:35`'s `printerStatus` subscription (P7's 15 s heartbeat re-render).

## Process

- Two writers in parallel (different files), then `tsc` + full suite, then **`review`** (primary; this
  is logic-heavy — a cache-key change can silently serve stale rasters, which is the exact failure the
  review must hunt), fix ≤2 rounds, then commit.
- Commit message: `fix(editor): stop asset raster flash and per-frame store writes on the drag path`.
- Owner verifies in the browser manually (agreed 2026-10-13).
- Must not regress: preview ≡ print raster equality for a changed asset (the print path has its own
  prepare; only the preview cache key changes).

## Risk

- **Stale raster** if the signature misses an input: a QR whose `text` changed would keep the old
  raster. Mitigation: derive the field list from `prepareAssets.ts`'s reader, not from memory; the
  negative tests above (real edit ⇒ re-prepare) are the guard. Reviewers: hunt this specifically.
- **Stale on zoom**: `imageScale`/`symbolScale` must stay in the signature/deps (the resolution cap
  follows the on-screen scale) — otherwise zooming up would keep a low-res raster.
