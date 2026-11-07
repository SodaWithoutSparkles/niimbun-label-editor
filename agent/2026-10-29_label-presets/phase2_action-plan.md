# P2 — Resolution seam: field values end-to-end

Run: [`plan.md`](plan.md) (P2 row, D2). Depends on P1 (`9a2d61c`). `general`
implements; `review` gates. P1 notes: [`state.md`](state.md).

## Goal

A `{kind:'field', name, fallback}` source resolves from an **injected values map**
through the one existing content path, and JS templates can read `ctx.fields`
alongside `ctx.row` and `ctx.globals`. No UI, no dialog, no i18n (P5).

## Design (fixed here — do not re-litigate)

- One source of truth: `prepareResolvedContent` stays the single pre-pass.
  Preview and print both call it (preview via `useSampleRow`, print via
  `usePrintJob`), so "one path" is preserved by construction.
- Values map shape: `Record<string, string>`, keyed by the field **name** exactly
  as stored (untrimmed, case-sensitive), mirroring CSV column binding.
- Precedence per node, identical to the CSV rule: injected value when non-empty →
  source `fallback` → `{empty}` placeholder (`finalize` already does the last
  two). An injected empty string is treated as "no value" in P2 (same as an
  empty CSV cell); the fill dialog (P5) owns the "user cleared it" nuance.
- Lookup must be own-property only (`Object.hasOwn`) so a field named
  `__proto__`/`constructor` reads nothing from the prototype chain.
- Templates get `fields` as a required `Record<string, string>` on the context,
  defaulting to `{}` (same treatment as `globals`), so `ctx.fields.price` is
  always readable and the worker `postMessage` payload stays a plain object.

## In scope (files + changes)

1. `src/templates/engine.ts`
   - `TemplateContext` gains `fields: Record<string, string>` (JSDoc: injected
     preset field values, keyed by field name; always present, `{}` when none).
   - `TemplateContextInput` gains `fields?: Record<string, string>`;
     `createTemplateContext` outputs `fields: input.fields ?? {}`.
2. `src/core/doc/rowContext.ts`
   - `BuildRowContextInput` gains `fields?: Record<string, string>`; the returned
     context carries `fields: input.fields ?? {}`. Update the header comment
     (context shape now includes `fields`).
3. `src/editor/render/prepareContent.ts`
   - `PrepareContentInput` gains `fields?: Record<string, string>` (JSDoc).
   - Forward it into `buildRowContext`.
   - Replace the P1 `continue` for `field` sources with
     `finalize(ownField(fields, source.name), source.fallback)`, where
     `ownField` = `Object.hasOwn(map, name) ? map[name] : undefined`.
   - Update the module contract comment (the bullet list: `field` binds by name
     from the injected map; absent/empty degrades to `fallback`).
4. `src/components/editor/useSampleRow.ts`
   - `ResolvePassInput` gains `fields?: Record<string, string>`; `runResolvePass`
     forwards it to `prepareResolvedContent`.
   - `useSampleRow(fields?: Record<string, string>)`: keep the latest map in a
     ref (read at pass time) and add a stable `fieldsKey = JSON.stringify(fields ?? {})`
     to the resolve-pass effect deps, so a new object identity alone does not
     re-run the pass but a changed value does. Explicitly support "no stored CSV":
     when the doc has no `data.csv` the pass must still resolve fields (it already
     can — `csv` is `null`); add the test, don't add a code path.
   - `src/components/editor/sampleRowContext.tsx`: `SampleRowProvider` takes an
     optional `fields?: Record<string, string>` prop and passes it to
     `useSampleRow` (P5 feeds it; default keeps today's behaviour).
5. `src/components/print/usePrintJob.ts`
   - `UsePrintJobOptions` gains `fields?: Record<string, string>`; keep it in a
     ref and pass it into `runResolvePass` from `runPrepare`, so every
     `prepareRow(rowIndex)` (dialog thumbnails and the print job) resolves the
     same values. Do **not** change `buildCsvPrintJob` / `printLabel.ts`: content
     already flows through `deps.prepareRow`.
   - `EditorShell` keeps calling `usePrintJob({ open: isPrintOpen })` — no UI in
     this phase.

## Out of scope

- Any UI: fill dialog, preset section, JsTab "Field" option, `en.json`.
- CSV row lookup by key (P6), row-by-key/`data.csv` changes, new object types.
- Persisting field values anywhere: no doc schema change, no new store slice, no
  settings key. The values map lives only in memory for a preview/print pass.
- `docHasTemplateSources`, trust, globals: untouched.

## Tests (P2 exit criteria)

- `src/editor/render/prepareContent.test.ts`
  - injected value wins; absent name → fallback; injected `''` → fallback; empty
    fallback with no value → `{empty}` placeholder (`placeholder: true`);
  - field named `__proto__` with a hostile prototype does **not** leak a value;
  - a template source reading `ctx.fields.price` + `ctx.row.sku` +
    `ctx.globals.rate` in one expression resolves (stub engine asserting the
    context it receives, plus an end-to-end pass with a fake engine that
    evaluates the string);
  - the pass does not mutate the doc (assert a deep-cloned snapshot equality —
    field values never reach the document).
- `src/core/doc/rowContext.test.ts`: `fields` defaults to `{}`; supplied map is
  carried through; `createTemplateContext` default (worker test or engine test).
- `src/components/editor/useSampleRow.test.tsx`: no CSV attached + injected
  fields → override map carries the value; changing `fields` re-runs the pass;
  unchanged object identity does not.
- `src/components/print/usePrintJob.test.tsx`: `usePrintJob({open:true, fields})`
  → `prepareRow(0)` returns overrides with the injected value.
- Preview≡print golden (put it with the existing render/print golden tests):
  one doc with a field-bound text node; editor raster
  `renderLabelPage(doc, { overrides })` and the print job's raster for the same
  page are byte-identical, and the print job's `prepareRow` overrides deep-equal
  the editor's map.

## Verification

- `node node_modules/typescript/bin/tsc --noEmit`
- `bun run test:run -- src/core/doc src/editor/render src/components/editor src/components/print`
  (the Windows bun binary from global memory is the only working runner in this
  WSL shell — use it, but never write its path into any file)
- Full `bun run test:run` before reporting done.

## Envelope reminders

- Public repo: never write an absolute machine path into any file.
- No commit, no `git stash`, no destructive git. Depth 1: do not delegate.
  Missing info → terminal `needs-info. q: … . hint: … . next: …`.
