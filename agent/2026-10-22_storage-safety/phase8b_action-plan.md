# P8b — Import/export UI

Source: folded plan P8 (upstream `7a65ce5`). P8a (`src/data/bundle.ts`) is
committed. This phase wires the File menu.

## Deliverables

### 1. New `src/components/layout/useLabelTransfer.ts`

A small hook so the logic is testable without the whole Header.

```ts
export interface LabelTransfer {
    /** Parse + import a picked file. Never throws. */
    importFile: (file: File) => Promise<void>;
    /** Export the open document (no-op when none). */
    exportCurrent: () => Promise<void>;
    /** Export every stored label. */
    exportAll: () => Promise<void>;
    /** True while an import/export is running (disables the menu items). */
    busy: boolean;
}

export const useLabelTransfer = (): LabelTransfer;
```

Rules:

- Read `labelRepo`, `resourceRepo`, `csvRepo`, `currentDoc`, `gallery`,
  `refreshGallery`, `addNotification` from the store (individual selectors).
- `importFile`:
  1. `file.size > MAX_IMPORT_BYTES` ⇒ error notification (`importLabels.tooLarge`),
     return.
  2. `JSON.parse(await file.text())` in try/catch ⇒ `importLabels.failed` on a
     parse error, return.
  3. `await importBundle(raw, { labelRepo, resourceRepo, csvRepo })`.
     No `labelRepo` ⇒ `importLabels.failed`.
  4. `await refreshGallery()`.
  5. Notify:
     - `imported === 0` or errors.length > 0 and imported === 0 ⇒
       `importLabels.failed` (append the first error as `{{message}}` if the key
       supports it).
     - errors.length > 0 with some imported ⇒ `importLabels.partial`
       (`{{count}}`, `{{failed}}`).
     - else `importLabels.done` (`{{count}}`).
- `exportCurrent`: `buildBundle([currentDoc], { resourceRepo, csvRepo })` ⇒
  `downloadJson(bundle, filename)`. Filename from the label name, sanitised
  (`[^\w.-]+` → `-`, trim, fallback `label`), plus `.json`.
- `exportAll`:
  1. `labelRepo.listDetailed()`; if `errors.length > 0` still export the readable
     ones, but count the failures.
  2. For each summary `get()`; skip null (count as failed).
  3. `buildBundle(docs, …)` ⇒ download as `niimbun-labels-<YYYY-MM-DD>.json`.
  4. Notify `exportLabels.done` (`{{count}}`) / `exportLabels.failed`.
- `downloadJson(value, filename)` (module-local, exported for tests):
  `Blob` + `URL.createObjectURL` + a temporary `<a download>` click +
  `URL.revokeObjectURL` in a `finally`. Guard `typeof URL.createObjectURL`.
- `busy` toggles around each operation; concurrent calls are ignored
  (`if (busyRef.current) return;`).

### 2. `src/components/layout/header/FileMenu.tsx`

Add three items, in this order: after **Save**, before **Print**:

- `Import labels…` → `onImport()`
- `Export this label…` → `onExportCurrent()`, `disabled={exportDisabled}`
- `Export all labels…` → `onExportAll()`, `disabled={exportAllDisabled}`

Props: `onImport`, `onExportCurrent`, `onExportAll`, `exportDisabled`,
`exportAllDisabled`, `transferBusy` (disable all three while busy).
Keep the existing doc comment accurate (it currently says import/export is P8
scope).

### 3. `src/components/layout/Header.tsx`

- `const transfer = useLabelTransfer();`
- A hidden `<input type="file" ref={importRef} accept=".json,.gz,application/json,application/gzip">`
  rendered once; `onChange` picks the first file, resets `event.target.value`
  (so the same file can be re-picked) and calls `transfer.importFile(file)`.
- Wire the three FileMenu props: `onImport={() => importRef.current?.click()}`,
  `onExportCurrent={() => void transfer.exportCurrent()}`,
  `onExportAll={() => void transfer.exportAll()}`,
  `exportDisabled={!hasDoc || transfer.busy}`,
  `exportAllDisabled={gallery.length === 0 || transfer.busy}`,
  `transferBusy={transfer.busy}`.

### 4. `src/i18n/locales/en.json`

- In `fileMenu`: `importLabels`, `exportCurrent`, `exportAll`.
- New `importLabels` block: `done` (`Imported {{count}} label(s).`),
  `partial` (`Imported {{count}} label(s); {{failed}} failed.`),
  `failed` (`Could not import the labels.`),
  `tooLarge` (`The file is too large to import.`).
- New `exportLabels` block: `done` (`Exported {{count}} label(s).`),
  `failed` (`Could not export the labels.`).

Use i18next plural keys only if the repo already does (`_one`/`_other`); check
`en.json` for the existing pattern and match it.

### 5. Tests

`src/components/layout/useLabelTransfer.test.tsx` (happy-dom):
- imports a bundle built with `buildBundle` from a memory adapter, asserts the
  label lands in `labelRepo`, the gallery refreshes, and `importLabels.done` is
  notified;
- rejects a file over `MAX_IMPORT_BYTES` without parsing;
- rejects invalid JSON with `importLabels.failed`;
- reports `partial` when one doc is invalid and one valid;
- `exportCurrent` produces a JSON blob containing the doc and triggers a
  download (spy on `URL.createObjectURL` / anchor click);
- `exportAll` reads every stored label.

`src/components/layout/header/FileMenu.test.tsx`:
- renders the three new items and calls their handlers;
- the two export items are disabled from their props.

## Constraints

- Do not change `src/data/bundle.ts` (P8a) except if a genuine bug is found —
  report it instead.
- No new dependencies; no `file-saver`.
- 4-space indent, single quotes.
- Never trust an imported file: size guard first, then parse, then validate.
- Imported docs keep their fresh ids (P8a); do not touch trust.

## Done when

- `bun run test -- src/components/layout/useLabelTransfer.test.tsx src/components/layout/header/FileMenu.test.tsx` passes.
- `node node_modules/typescript/bin/tsc --noEmit` clean.
