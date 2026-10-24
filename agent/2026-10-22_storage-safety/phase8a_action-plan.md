# P8a — Label bundle core (export/import data layer)

Source: upstream survey `7a65ce5` (standardised label JSON, single-or-list import,
export-all). Folded plan P8. This phase is the **data layer only**; the File-menu
UI is P8b.

## Format

A self-contained bundle so a label can move between devices:

```ts
export const BUNDLE_KIND = 'niimbun-label-bundle';
export const BUNDLE_VERSION = 1;
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

export interface LabelBundle {
    kind: typeof BUNDLE_KIND;
    version: typeof BUNDLE_VERSION;
    exportedAt: number; // epoch seconds
    /** Documents with every `local` image/font ref rewritten to `inline`. */
    docs: LabelDoc[];
    /** CSV tables the docs reference, embedded by original id. */
    csvs: CsvRecord[];
}
```

`importBundle` also accepts a bare `LabelDoc` or a `LabelDoc[]` (upstream
"single-or-list import").

## New `src/data/bundle.ts`

Data layer (may import `core/` and the repos; the UI may import this).

```ts
export interface BundleReadDeps {
    resourceRepo: Pick<ResourceRepo, 'get'> | null;
    csvRepo: Pick<CsvRepo, 'get'> | null;
    now?: number;
}

export interface BundleWriteDeps {
    labelRepo: Pick<LabelRepo, 'save'>;
    resourceRepo: Pick<ResourceRepo, 'put'> | null;
    csvRepo: Pick<CsvRepo, 'put'> | null;
    now?: number;
}

export interface ExportBundleResult {
    bundle: LabelBundle;
    /** Local refs that could not be read (left `local` in the export). */
    missing: number;
}

export interface ImportBundleResult {
    imported: number;
    /** Per-document fatal problems (validation / storage). */
    errors: string[];
    /** Non-fatal: a referenced CSV/resource was not in the bundle. */
    warnings: number;
}

export const buildBundle = async (
    docs: readonly LabelDoc[],
    deps: BundleReadDeps,
): Promise<ExportBundleResult>;

export const importBundle = async (
    raw: unknown,
    deps: BundleWriteDeps,
): Promise<ImportBundleResult>;

export const isLabelBundle = (value: unknown): value is LabelBundle;
```

### Export rules (`buildBundle`)

1. `structuredClone` each doc; never mutate the input.
2. For every `doc.resources.images[*].source` with `kind: 'local'`:
   `resourceRepo.get(resourceId)`. Found ⇒ replace with
   `{ kind: 'inline', mediaType: record.mediaType, dataUrl: bytesToDataUrl(...) }`.
   Not found / no repo ⇒ leave `local`, increment `missing`.
3. Fonts: `font.source.kind === 'imported'` and `asset.kind === 'local'` — same
   rewrite on `source.asset`.
4. CSV: for each `doc.data.csv` with a `csvId`, read it and push the record into
   `bundle.csvs` **once per id** (dedupe across docs). Missing ⇒ `missing++`.
   Leave `doc.data.csv` as-is in the export (its `csvId` is remapped on import).
5. Already-`inline`/`remote`/`external` refs are untouched.
6. `exportedAt = now` (epoch seconds), `docs` in input order.

### Import rules (`importBundle`)

1. Normalise the input: bundle envelope → `{ docs, csvs }`; array → docs;
   single object → one doc. Anything else ⇒ one error, `imported: 0`.
2. Per doc: `isLabelDoc(migrate(raw))`. Invalid ⇒ push the validation errors,
   skip that doc, keep going (one bad label must not abort the file).
3. `structuredClone`, mint a **fresh** `meta.id` with `newLabelId()`; set
   `meta.updatedAt = now` (so the import sorts to the top). Keep `createdAt`.
   **Trust is not imported** — trust is keyed by doc id, and a fresh id resolves
   to `ask`; do not touch the trust store.
4. Images: `kind: 'inline'` ⇒ decode the data URL, mint a resource id,
   `resourceRepo.put({ id, mediaType, bytes, name: image.name, widthPx, heightPx })`,
   rewrite the ref to `{ kind: 'local', mediaType, resourceId: id }`.
   `remote`/`external`/`local` are left alone.
5. Fonts: same for `source.kind === 'imported' && asset.kind === 'inline'`.
6. CSV: look up `doc.data.csv.csvId` in the bundle's `csvs`. Found ⇒ mint a new
   id, `csvRepo.put({ ...record, id })`, set `csvId = id` and, when the source is
   `local`, rewrite `source.resourceId = id` (they are the same key by design).
   Not found ⇒ `warnings++`, leave the ref (the existing missing-CSV warning
   handles it).
7. `labelRepo.save(doc)`; a save failure pushes an error and does not count the
   doc. `imported++` only on success.
8. Never throw.

### Helpers

- `bytesToDataUrl(bytes: Uint8Array, mediaType: string): string` — base64 in
  chunks (copy the chunked `btoa` pattern from `labelRepo.ts:76-84`).
- `dataUrlToBytes(dataUrl: string): Uint8Array | null` — require
  `data:...;base64,`; `atob`; `null` on anything else (then treat as missing,
  `warnings++`, leave the ref).
- `isLabelBundle`: shallow structural check only (kind, version, arrays); docs
  are validated per item so one bad doc does not reject the file.
- Export `MAX_IMPORT_BYTES` for the UI's `file.size` guard.

## Tests — `src/data/bundle.test.ts`

Use `createMemoryAdapter` + `createResourceRepo`/`createCsvRepo`/`createLabelRepo`
(see `src/data/*.test.ts` for the pattern).

1. Export inlines a local image and an imported font; the CSV is embedded once
   even when two docs share it.
2. Export counts a missing resource and leaves the ref `local`.
3. Import re-mints doc ids, writes resources/CSVs, and rewrites the refs to
   `local` (byte equality through the data URL round-trip, including `0x00`/`0xFF`).
4. Round-trip: `buildBundle` → `importBundle` → the imported doc references
   readable local assets and its CSV exists.
5. Accepts a single doc, an array, and a bundle envelope.
6. One invalid doc in a list: the valid one imports, the invalid one is reported.
7. CSV absent from the bundle: imports with a warning and keeps the ref.
8. A `remote` image ref survives untouched.

## Constraints

- No UI changes (P8b). No new dependencies. Do not touch `FileMenu`/`Header`.
- `src/data` may import `core/` and repos; do not add an upward import.
- 4-space indent, single quotes.
- Do not change the `LabelDoc` schema.

## Done when

- `bun run test -- src/data/bundle.test.ts` passes.
- `node node_modules/typescript/bin/tsc --noEmit` clean.
