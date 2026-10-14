# Phase 9 action plan — CSV & media management

Reads with [`plan.md`](plan.md) §P9, [`state.md`](state.md), and
[`known-issues/2026-10-06_round-2.md`](../known-issues/2026-10-06_round-2.md) §"Data source CSV is broken"
(`:288-294`) + §"New media management tab" (`:296-302`). Also [`memory/paper-types.md`](../memory/paper-types.md)
(the P8 pattern this phase reuses) and [`memory/objects-assets.md`](../memory/objects-assets.md).

Base: `main` at the P8 tip. Owner direction: **reuse the P8 `PaperTypeSection` shape twice.**

## Verified recon (taken as fact — do not re-explore)

- **Repos already exist and share one interface** (`get/has/list/put/remove/saveAll/clear`):
  `csvRepo` (`CsvRecord {id,name,columns,rows}`, store `'csvs'`) and `resourceRepo`
  (`ResourceRecord {id,mediaType,bytes}`, store `'resources'`). **Both stores already exist** in
  `db.ts` `STORE_NAMES` → **no DB_VERSION bump needed**.
- **CSV ref:** `LabelDoc.data.csv?: CsvRef` (singular, max one per doc) — `CsvRef {csvId,name,alt?,source}`
  (`core/doc/types.ts:246-251,282`). `csvId === source.resourceId === CsvRecord.id`; CSV bytes live in
  `csvs`, never `resources`. Attach/detach live in **`editorSlice`** (`setDocCsv` `:501-541`,
  `attachCsv` `:549-…`), not a csv slice.
- **Media refs:** doc holds `resources: {fonts: FontRef[]; images: ImageRef[]}` (`types.ts:283`).
  Bytes live in `resources`; `imageId === resourceId` (local) and `fontId === asset.resourceId`.
  Only `local` sources reference storage (`ImageRef.source.kind==='local'`; fonts
  `imported.asset.kind==='local'`). `remote`/`inline`/`external`/system fonts write nothing.
  Import path: `src/editor/render/assetImport.ts` (`importImageFile` `:88-115`, font `:166-178`).
- **`ResourceRecord` has NO name/dimensions** — only `{id,mediaType,bytes}`. The display name and
  `widthPx/heightPx` live on `ImageRef`/`FontRef` in the *document*. A media UI needs metadata on the
  record → this phase **adds optional metadata to `ResourceRecord`** (see W2).
- **Orphan sweep is NOT a plain diff:** `labelRepo.list()/listDetailed()` carry **no refs** → the sweep
  must `get()` (and gunzip) every doc to read `data.csv` / `resources.*`. Two independent diffs
  (`csvs` ids vs `doc.data.csv.csvId`; `resources` ids vs every local `ImageRef`/`FontRef`).
  `removeNode` does **not** prune `doc.resources.*` (`editorSlice.ts:706-713`) → a resource is
  "referenced" if it appears in **any doc's `resources` array** (conservative), not only via a live node.
  The 3 `DataSourceTab.tsx:168-205` comments name a sweep that does not exist.
- **P8 pattern to reuse** (`PaperTypeSection.tsx` shell; `usePaperTypes.ts` token-cancellation +
  notify-on-failure; `PaperTypeDialog.tsx` add/edit Modal; `filterPaperTypes` pure predicate;
  test harness `PaperTypeSection.dom.test.tsx`). All are **inline / paper-coupled** — reuse means
  extracting a generic shell (W1).
- **Nav wiring:** `gallerySection: 'recent'|'paper'|'templates'|'csv'` (`viewSlice.ts:23`);
  `NavSidebar` label/icon maps + `ORDERED_SECTIONS` (`:10-24`); `MainLayout.tsx:36` pane swap.
  `templates` + `csv` are still "coming soon" placeholders (MainLayout falls through to `GalleryView`).
- Upload pattern = hidden `<input type=file>` + click + value reset. Delete-confirm =
  `await confirm({danger:true})`.

## Owner/plan requirements (scope)

1. Gallery-level **CSV management**: list / upload / view / edit / delete (`csvRepo`).
2. Gallery-level **media management**: new nav section, same pattern (`resourceRepo`).
3. Adding photos to a label: besides File/URL, **"Use existing"** from the media repo, with
   **Import by Clone** (copy → new record) or **Import by Reference** (point at the same resource).
4. CSV: beside "Choose file", **pick an existing** table (same clone/reference idea).
5. **Orphan sweep**: `list()` diffed against all doc refs; surface orphans for deletion.
6. Tests mirroring `csvRepo.test.ts` + the P8 DOM harnesses.

## Decisions locked (coordinator, 2026-10-15)

- **D1 — extract the P8 shell.** New generic `useCatalogue<T>(repo, i18nPrefix)` (repo-agnostic,
  token-cancellation + notify) and a presentational `CatalogueLayout` (title/add/search/states/grid as
  slots). **Migrate `PaperTypeSection` onto them** (its DOM test is the safety net) so there is one
  shape, then build `CsvSection`/`MediaSection` on it. Report if the migration is skipped.
- **D2 — media metadata.** Extend `ResourceRecord` with **optional** `name?`, `mimeType?`,
  `widthPx?`, `heightPx?`; set them in `assetImport.ts` on image/font import. Back-compat: absent
  metadata → the UI falls back to the id / a type icon. No DB bump (same store).
- **D3 — CSV "edit" = rename** (+ read-only preview table). Full cell editing is **out of scope**
  (logged as debt) — the issue's goal is "don't waste storage", i.e. list/view/delete.
- **D4 — nav:** the existing `csv` (`nav.dataSource`) section becomes the real CSV surface; add a new
  `media` section **after `csv`** (`gallerySection` gains `'media'`). `templates` stays a placeholder.
- **D5 — orphan sweep** is a pure `findOrphanIds(allIds, referencedIds)` + a
  `collectReferencedIds(docs)` collector, surfaced per section as an "unused" badge + "delete unused".
  Conservative (any doc `resources` entry counts as referenced).
- **D6 — v0 alpha:** breaking changes OK; no shims.

## Work items & waves

| Wave | Worker | Scope | Files |
| ---- | ------ | ----- | ----- |
| **W1** | `general` | Generic extraction (`useCatalogue`, `CatalogueLayout`) + migrate `PaperTypeSection` + **`CsvSection`** (list/upload/view/rename/delete) + `useCsvs` + `csvs.*` i18n + nav `csv`→pane wiring | `components/gallery/*`, `components/paper/usePaperTypes.ts`, `viewSlice`/`NavSidebar`/`MainLayout`, `en.json` |
| **W2** | `general` | `ResourceRecord` metadata + set on import; **`MediaSection`** (list/preview/rename/delete/upload) + `useMedia` + `media.*` i18n + nav `media` + `gallerySection` | `data/resourceRepo.ts`, `editor/render/assetImport.ts`, `components/gallery/*`, `viewSlice`/`NavSidebar`/`MainLayout`, `en.json` |
| **W3** | `general` | **"Use existing"**: image picker (Clone/Reference) in `ObjectTab`; CSV picker in `DataSourceTab` | `components/editor/ObjectTab.tsx`, `ImageImportDialog.tsx`, `DataSourceTab.tsx`, `editorSlice` |
| **W4** | `general` | **Orphan sweep**: `findOrphanIds`/`collectReferencedIds` + surface in the three sections + tests | `data/*` or `components/gallery/*`, sections |
| gate | `review` → fix (≤2) → narrow re-review → commit | | |

**Commits:** A = W1 (generic shell + CSV), B = W2 (media), C = W3+W4 (use-existing + sweep) — or
fewer if they cohere. Implementer's call; report which.

## Risks

- **R9a generic extraction regresses P8** — `PaperTypeSection.dom.test.tsx` must stay green; the
  migration is the risky half of W1.
- **R9b orphan sweep over-deletes** — must be conservative (doc `resources` array counts; a resource
  listed in a doc is NOT an orphan even if no node uses it). Never delete on the write path.
- **R9c sweep cost** — O(docs) `get()`+gunzip; must not block the UI (async, loading state) and must be
  non-throwing per doc.
- **R9d "reference" vs "clone"** — a referenced image must keep working when the original doc is
  deleted (it's a shared `resources` entry; do not delete it on doc delete — already true) and when the
  original resource is deleted from the media UI (the sweep/section must treat a shared id as
  referenced). Verify `imageId` may differ from `source.resourceId` for a reference.
- **R9e `resourceRepo` bytes are `Uint8Array`** — previews need object URLs (revoke them); no `name`
  for legacy records.
- **R9f i18n** — one `en.json` writer per wave.
- **R9g StrictMode** — async loads/dialogs cancellation-guarded (mirror `usePaperTypes`).
