# Presets — fill-in labels (`meta.kind`, `data.fields`)

Added by the label-presets run (2026-10-29 → 31). A preset is a `LabelDoc` with
`meta.kind: 'preset'`: it uses the normal label storage, thumbs, delete,
autosave, bundle and orphan machinery. Read before touching the fill dialog,
field bindings, the presets pane, or any copy path.

## Model

- `DocKind = 'label' | 'preset'`; `meta.kind?` is additive (doc `version` stays
  1). Absent / `'label'` = a normal label. The validator keeps exactly those two,
  leaves an absent kind absent (legacy docs are **not** rewritten), and drops
  anything else with a repair. The factory writes `kind: options.kind ?? 'label'`;
  `LabelSummary.kind` is re-checked in `labelRepo.toSummary` because stored
  records are read without validation.
- `data.fields?: FieldDef[]` where `FieldDef = { id, default?, required?, hidden? }`
  (`core/doc/types.ts`), additive and absent by default. `normalizeFieldDefs`
  (`core/doc/fieldDefs.ts`) is the only stored shape: duplicate ids are
  **first wins**; a non-object entry or a blank/non-string id drops the entry;
  `default` is kept only as a non-empty string; `required`/`hidden` are booleans
  (an explicit `false` survives a round-trip, a non-boolean is dropped). Ids and
  defaults are stored **untrimmed** — a binding looks them up exactly.
- `data.fields` absent means no declarations. A **binding does not need a
  declaration**: `{ kind: 'field', name, fallback }` resolves from the injected
  map regardless, and the fill form still lists the bound-but-undeclared name.
- Reserved ids live in `RESERVED_FIELD_IDS` (`csv.row` today). A reserved id is a
  valid declaration but is never offered as a text binding, and its Default input
  is hidden. `ensureCsvRowField` appends it **last**, idempotently, keeping its
  flags; `setDocCsv`/`attachCsv` declare it in the **same undo entry** as the
  attach. Detaching the CSV leaves the declaration alone.
- A field `name` **may be empty** (P4 relaxation): it is the half-authored state
  ("switched to Field, name not typed yet") and must survive validation. An empty
  name is explicitly unbindable (`prepareContent.ownField`, `presetFields`), so a
  stray `''` key never resolves. A missing/non-string `name` still falls back to
  a static `''` source; unknown kinds stay fail-closed.
- Store: `setDocFields` (one undo entry; identical list = no-op) and
  `ensureFieldDef` (blank/declared = no-op). Both autosave; never mutate the doc
  directly.

## Copy contract

- `copyLabelDoc(source, { kind, name?, id?, now? })` in `core/doc/factory.ts`:
  `structuredClone` (JSON fallback) → fresh `id` → **explicit** `kind` (never
  inherited) → name defaults to the source → timestamps = now (epoch seconds) →
  `meta.thumb` removed. It preserves `nodes`, `data` (CSV ref, sample row,
  globals, field declarations), `resources` and `paperTypeId`. It is **not**
  `createLabelDoc`: rebuilding would drop the CSV/globals/fonts.
- Store `saveCopy(source, spec)` mirrors `createLabel`'s fence: build →
  `isLabelDoc` → `repo.save` → `refreshGallery`. It never touches `currentDoc`,
  undo history or the autosave chain, and returns `null` (non-throwing) on
  failure. A gallery-refresh failure does not turn a stored copy into an error.
- Two callers only: File ▸ **Save as preset** (`{ kind: 'preset' }`, shown for an
  open non-preset doc, disabled during transfers; stays on the source and
  notifies) and the fill dialog's **Open in editor**
  (`{ kind: 'label' }` → `openLabel(copy.id)`). The source is never converted.
  Fresh ids also mean trust never carries to a copy.

## Resolution seam

- `prepareResolvedContent({ fields })` resolves a `field` source as
  `finalize(ownField(fields, name), fallback)`: non-empty injected value →
  source `fallback` → `{empty}` placeholder (`resolve.ts`). `ownField` is
  `Object.hasOwn` only, so `__proto__`/`constructor` names read nothing from the
  prototype chain.
- `TemplateContext.fields: Record<string, string>` is **required** and defaults
  to `{}` (`buildRowContext` + `createTemplateContext`), so `ctx.fields.<id>` is
  always readable. Values are injected per pass and never persisted.
- Threading: `runResolvePass` → `prepareResolvedContent`; `useSampleRow(fields?)`
  reads the latest map from a ref and re-runs on a sorted `fieldsKey` (key order
  does not matter); `SampleRowProvider({ fields })`; `usePrintJob({ fields })`
  does the same for every `prepareRow`. Preview and print still share one pass.
- `presetFields(doc)` (`src/editor/presetFields.ts`) returns distinct non-empty
  field names in **node order** (first binding wins); its fallback is the fill
  input's placeholder. Static/CSV/template sources are ignored.

## Fill dialog (`components/gallery/FillPresetDialog.tsx`)

- Loads `labelRepo.get(presetId)` on open, token-guarded and bound to its id: a
  previous preset's document is never shown as `ready`. The attached CSV is read
  alongside; both failures are explicit states. A preset is never `currentDoc`.
- Rows = visible non-reserved declarations in document order, then
  bound-but-undeclared names in node order. Hidden declarations are excluded.
  Initial values = every declaration's `default ?? ''` (hidden included) plus
  `''` for leftovers. An added row starts from the value typed in the add row
  (empty by default).
- **Add field** is a `[id ▾] [value]` row whose dropdown lists **hidden
  declarations only** (visible ones are already rows; reserved ids are
  app-filled). This is how a hidden required id becomes satisfiable.
- Required = declaration flag, empty after `trim()`; reserved ids are excluded
  (they are app-filled). While any required row is missing, Print and "Open in
  editor" are disabled and the dialog names the ids. A default may already
  satisfy one.
- One `usePrintJob` instance feeds both the live preview (`prepareRow`, then
  `renderDocPreview`) and `PrintDialog` — one content path, so preview ≡ print.
  Values, key column and key are local state only and reset on preset/CSV switch.
- **Open in editor** = `saveCopy(preset, { kind: 'label' })` → `openLabel`; a
  rejected `openLabel` is a user-visible error. The session token is invalidated
  by close, external close, preset switch and unmount, so a late copy can never
  notify or navigate.

## CSV row lookup (P6b)

- `src/editor/csvKey.ts`: `findCsvRow(csv, column, key)` = first row whose cell
  equals `key.trim()` after trimming the cell; blank key/column or unknown column
  → `-1`, so a blank cell never matches a blank key and duplicates take the first
  row. `singleRowCsv(csv, rowIndex)` copies the table with **one** row; `-1` or
  out of range yields one all-empty row with the real columns. Pure, no mutation.
- UI: the row control renders only when `csv.row` is declared **and** the
  attached table read successfully. Key column select (first column default) +
  key input. Status: no key ("showing the sample row"), matched row number, or
  "no row matches".
- The dialog always hands `usePrintJob` an explicit `CsvJobSource`:
  `ready` with the one-row table (matched row; the stored sample row when no key
  is typed; an all-empty row on a miss), `loading`/`error` for its own pending or
  failed read, `none` when nothing is attached. Preview resolves row `0` when the
  source is ready.
- **One printed record.** A ready one-row table means one page — never the whole
  CSV. `ctx.index` / `ctx.total` for such a print are `0` / `1` (documented
  caveat: do not use `ctx.index` as a table position).
- **Fail-closed read rule (P12).** A preset with an attached CSV reports
  `loading`/`error`; it never falls back to the document's full table while the
  dialog's own read is pending or broken. Nothing attached (`none`) keeps the
  normal one-page job. A failed read hides the row controls and shows the
  "CSV could not be read" notice; the print dialog's P12 gate disables printing.
- `usePrintJob`'s `csv?: CsvJobSource` is total and present-wins: no repo read,
  `csvStatus` is the source's kind, `csv` is the record only for `ready`, and
  `csvRevision` stays `0`. Absent keeps the repo-backed read, so the editor path
  is unchanged.

## Gallery and routing

- The `templates` section is the **Label presets** pane. It spans five
  vocabularies with no registry: `GallerySection` (`viewSlice.ts`),
  `GALLERY_SECTIONS` (`urlHash.ts`), `NavSidebar` (order/icon/label + hint),
  `MainLayout` (the `PresetSection` branch) and `nav.templates` in `en.json`.
  URL/route tests pin them.
- Partition: `PresetSection` keeps `kind === 'preset'`; `GalleryView` and the
  sidebar's Recent list keep `kind !== 'preset'`. Absent kind is a label.
- Cards reuse `CardArt`/`cardFormat`; the art is the open button (fill dialog),
  delete is a sibling. Delete goes through store `deleteLabel` (confirm +
  autosave flush + revalidation), never a raw repo remove. `useThumbBackfill`
  is mounted in the pane.
- Bundle export/import carries `meta.kind` and `data.fields` through validation
  (import still mints fresh ids, so trust never carries).

## Read before

- Memory: [`csv-templates.md`](csv-templates.md) (bindings, trust, sample row),
  [`app-shell.md`](app-shell.md) (routes, thumbnails),
  [`storage-safety.md`](storage-safety.md) (delete/autosave contracts),
  [`code-organization.md`](code-organization.md) (layer order).
- Code: `core/doc/fieldDefs.ts`, `core/doc/validate.ts`,
  `data/labelRepo.ts`, `store/slices/docSlice.ts`,
  `editor/render/prepareContent.ts`, `core/doc/rowContext.ts`,
  `editor/presetFields.ts`, `editor/csvKey.ts`,
  `components/print/usePrintJob.ts`,
  `components/gallery/FillPresetDialog.tsx`,
  `components/gallery/PresetSection.tsx`,
  `components/editor/FieldsTab.tsx`,
  `components/layout/MainLayout.tsx`.
- Docs: user guide [`docs/user-guide/templates.md`](../../docs/user-guide/templates.md);
  developer contract
  [`docs/developer-guide/template-context.md`](../../docs/developer-guide/template-context.md).
