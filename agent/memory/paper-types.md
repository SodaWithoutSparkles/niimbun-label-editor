# Paper types (P8)

The paper-type catalogue, persisted guides, and the paper-type management UI.
Read before touching `src/data/paperRepo.ts`, `src/data/paperSeeds.ts`,
`src/core/doc/paper-types/`, `src/core/doc/factory.ts` (`guides`), the gallery
`PaperTypeSection`, or the create-label dialog.

## Model

- `PaperRecord { id: string; name: string; backingW: hm; backingH: hm; regions: Region[]; guides: Guide[] }`
  (`src/data/paperRepo.ts`) — **pure data**, no binary analogue.
- `paperRepo` mirrors `csvRepo`: `get/has/list/put/remove/saveAll/clear`. `put` runs the full
  `isPaperRecord` guard (which reuses `validate`'s `isGuide`); `get`/`list` use the cheap
  `isPaperRecordShape`. IDB store `'papers'`; `DB_VERSION` is **3** (additive upgrade).
- `PaperTypeId = string` (user-minted UUIDs). `PaperType` (`src/core/doc/paper-types/types.ts`)
  = the record shape. `PAPER_TYPE_SEEDS` (`paper-types/index.ts`) is the five built-ins
  (`ftagSpare-25x78`, `rounded30x20`, `rounded48x30`, `stacked50x15`, `rounded50x30`) demoted to
  **seed data**. `rounded48x30` (4800×3000 hm) is the common NIIMBOT 48 mm stock; the 50 mm preset is
  deliberately **not** edited — ids are referenced by `meta.paperTypeId`.

## Seeding (first run + versioned additions)

- `src/data/paperSeeds.ts`: `seedPaperTypesIfNeeded(repo, storage)` / `ensurePaperTypesSeeded(repo)`.
- **Per-record `has`-gated fill**, gated by the localStorage marker `labeleditor.paperTypes.seeded`
  **and** the seed-set version `labeleditor.paperTypes.seedVersion` (currently `2`):
  - version current → strict no-op (a user-deleted seed is **never** resurrected);
  - version missing but the legacy marker set (a v1 install) → only the ids added in v2
    (`rounded48x30`) are candidates, so deleted v1 seeds still stick;
  - neither marker (fresh install) → insert only missing ids;
  - the markers are set **only** when every missing seed was written, so a partial failure retries
    next boot without duplicating.
- Adding another built-in later: append its id to `SEEDS_ADDED_IN_V2` (rename to a version list) and
  bump `PAPER_SEED_VERSION`; never edit an existing seed's geometry.
- `initPersistence` (`src/store/slices/docSlice.ts`) awaits seeding **before** `set({ paperRepo })`, so
  a `paperRepo` visible in the store implies the catalogue is seeded.
- **D-46:** a transient write failure leaves the catalogue incomplete for that session (retry is
  per-boot only).

## Guides are persisted doc data (not derived)

- `LabelDoc.label.guides: Guide[]` (**required**), copied from the paper type by `createLabelDoc`
  exactly like `regions`; `validate.ts` rounds/validates them (`isGuide`); `resolveGuides(doc)`
  returns `doc.label.guides ?? []`. `PRESET_GUIDES` + `FTAG_SCORE_*_HM` were **deleted** — the F-tag
  score line lives on the `ftagSpare-25x78` seed.
- `meta.presetId` → `meta.paperTypeId` (provenance only — it drives **nothing** render-critical).
- A guide is **never** a region: it never clips, prints, or enters `union(regions)` /
  `regionUnionBounds` / `regionUnionPath` / `traceUnion`.

## UI

- `gallerySection` (`src/store/slices/viewSlice.ts`) selects the main pane; `MainLayout` renders
  `PaperTypeSection` when it is `'paper'`, else `GalleryView`. `NavSidebar` reads the store key.
- `PaperTypeSection` = main-pane **searchable card grid** (`filterPaperTypes`, a pure predicate) +
  `PaperTypeCard` (preview, name, W×H mm, region count, default badge, edit/delete/set-default).
- `PaperTypeDialog` = `Modal`, preview left / fields right; delete uses the promise
  `confirm({danger:true})`; deleting the current default clears `defaultPaperTypeId`.
- Shared editors: `RegionEditor` (editable polygons, `closed:true` hard-coded, validity via
  `finishPolygonPoints`), `GuideEditor` (4 mm fields, `kind:'score'`), `PaperTypePreview`.
- `NumberField` + `src/utils/mm.ts`: `mmString` is **hm-exact** (hm = hundredths of mm → at most 2
  decimals, trailing zeros trimmed); `parseMm(mmString(hm)) === hm`. Do not round to 1 dp.

## Preview canvas

- `PaperTypePreview` (`src/components/paper/PaperTypePreview.tsx`): DPR-aware DOM `<canvas>`.
  Pass 1 = `traceUnion(ctx, regionUnionPath(regions), scale)` + nonzero `fill()` (**never**
  `'evenodd'`). Pass 2 = each `guide.line` stroked separately. Bounds = `regionUnionBounds(regions)`
  ∪ guide endpoints; empty regions → backing outline only (never a blank filled box).

## Create-label dialog

- Lists **catalogue records only** (no synthetic "Custom size" entry). Async open effect
  (StrictMode-safe, deps `[open, paperRepo]`). Default = the stored `defaultPaperTypeId` if it
  resolves; otherwise **custom** (40×30 mm, no `paperTypeId`, no guides).
- Submit passes explicit `backingW/backingH/regions/guides` **and** `paperTypeId` (provenance).
