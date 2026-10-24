# Storage safety — destructive deletes and autosave ordering

Landed 2026-10-22 (run `agent/2026-10-22_storage-safety/`), fixes GitHub #1, #4, #5.
Read this before touching the gallery's unused-cleanup path, `LabelCard`/
`GalleryView` delete, or the autosave scheduler.

## Reference inventory (`src/data/referenceScan.ts`)

`scanReferences({ labelRepo, csvRepo, resourceRepo, liveDocs })` returns
`{ csvIds, resourceIds, complete }` where the two sets are **orphan** (unreferenced)
stored ids and `complete` means every label, catalogue listing and live doc was
read successfully.

- Uses `labelRepo.listDetailed()`, never `list()`. `list()` cannot reject — it
  drops `errors` and returns `[]`, which used to make a failed read look like
  "nothing is referenced" (#4).
- A per-doc `get()` returning `null` **or** throwing flips `complete: false`.
  The old silent skip made a corrupt label's refs invisible.
- Catalogue `list()` failures are collected with `Promise.allSettled`; a failed
  store yields an empty set **and** `complete: false`.
- `liveDocs` is where the unsaved editor state enters. `useOrphans` passes
  `currentDoc` + `docPast` + `docFuture` read non-reactively via
  `useStore.getState()` — do **not** subscribe, or the O(docs) sweep re-runs per
  keystroke. This is the #5 fix: autosave-off attachments are protected.
- Never throws. `labelRepo === null` = storage not booted ⇒ complete + empty.

## Destructive-action rules

- **Batch "Delete unused"** renders only when `complete` is true. On confirm it
  re-scans and deletes only `shown ∩ freshOrphans`; an incomplete or superseded
  (`null`) re-scan deletes nothing and shows `*.orphanReadError`.
- **Single delete** (`CsvSection`/`MediaSection`) scans before confirming and
  picks `deleteConfirm` (proven orphan) / `deleteInUseConfirm` (referenced) /
  `deleteUnverifiedConfirm` (scan incomplete). The user can still override.
- Deleting a **label** does not prune its resources. They surface as orphans and
  are reclaimed by the sweep.
- Residual **D-70**: the re-scan and the delete loop are not atomic. A second tab
  saving inside that window can still lose bytes; `StorageAdapter` has no
  transaction API. Single-tab is safe.

## Autosave ordering (`src/store/slices/editorSlice.ts`)

`autosaveWrites` is a promise chain of **every** write started so far, and
`queuedAutosave` holds at most the newest not-yet-started snapshot (a stalled
write must not queue one full `LabelDoc` per debounce tick).

- Timer fire → `enqueueAutosave(doc, repo)`.
- `flushAutosave()` appends a still-scheduled doc, then returns the chain, so it
  resolves after every write started up to that call. It returns the chain in
  every branch (`autoSave` off, no repo) — only the *append* is gated.
- **Chain, never replace, the tail.** Replacing drops a newer write.
- Consumers rely on it: `deleteLabel` must settle the in-flight save before
  `repo.remove` (otherwise the late write recreates the label, #1),
  `saveCurrentLabel` must settle it before its own newer save (must-fix #8).

## Label delete

`deleteLabel` (docSlice) removes the record, then **only on success** clears
`currentDoc` and calls `setView('gallery')` (which also closes the print dialog).
A failed remove must not close the open document. It also bumps a monotonic
`openRequestId` so an `openLabel(id)` already reading the deleted record cannot
commit it afterwards.

## Label transfer (P8, 2026-10-22)

- `src/data/bundle.ts` is the format: `{ kind: 'niimbun-label-bundle', version: 1,
  exportedAt, docs, csvs }`. `buildBundle` clones the docs, rewrites every
  `local` image / imported-font ref to `inline` (base64 data URL) and embeds each
  referenced CSV **once**. `importBundle` accepts a bundle, a `LabelDoc[]` or a
  single doc; it **mints a fresh doc id** (trust is keyed by id, so an import
  resolves to `ask` — never carry trust), stores inline bytes as `local`
  resources, remaps CSV ids (including `CsvRef.source.resourceId`) and saves.
- Invalid docs are skipped one by one; a missing embedded CSV is a warning, not a
  failure. `MAX_IMPORT_BYTES` (64 MB) bounds the file; the hook also caps the
  decompressed JSON before parsing.
- UI: `src/components/layout/useLabelTransfer.ts` (File ▸ Import / Export this
  label / Export all). The picker accepts `.json` and `.gz`; gzip magic is
  decompressed with `utils/compress`. Exports download a Blob (object URL revoked
  in `finally`).
- Imported docs keep `createdAt`, get `updatedAt = now`, and land in the gallery
  after `refreshGallery()`. `paperTypeId` is provenance only — a missing paper
  type does not block the import.
