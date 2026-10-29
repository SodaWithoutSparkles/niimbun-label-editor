# P1 — Doc model: preset flag + field bindings

Run: [`plan.md`](plan.md) (D1, D2, D5). Owner-approved scope. Coordinator drives;
`general` implements; `review` gates.

## Goal

Make the document model able to *express* a preset and a field binding. No UI, no
resolution semantics beyond typing/validation (that is P2).

## In scope (files + exact changes)

1. `src/core/doc/types.ts`
   - `export type DocKind = 'label' | 'preset';`
   - `LabelDoc.meta.kind?: DocKind` — doc comment: absent / `'label'` = normal
     label; `'preset'` = a user-designed label with data left to fill in. Additive
     optional field, doc `version` stays 1.
   - `ContentSource` gains `| { kind: 'field'; name: string; fallback: string }`
     with a comment: field names are a namespace of their own — never collides
     with a CSV `column` or a template.
2. `src/core/doc/validate.ts`
   - `toContentSource`: add `case 'field'` — accept only when `isString(name)`
     is non-empty (after `name.trim()`? **no trimming of the stored value** — a
     field name is an opaque key; reject only empty/whitespace-only) and
     `fallback` is a string (default `''`). Anything else (missing/empty name,
     non-record) returns `undefined` → the existing carrier fallback
     (`{kind:'static', value:''}`) applies. Unknown kinds keep returning
     `undefined` (fail closed) — do not widen that.
   - meta: read `raw.meta.kind`; keep it only when it is exactly `'label'` or
     `'preset'`; otherwise omit it and push a repair
     (`meta.kind: unknown value dropped`). Include it in the returned `meta`
     literal (`...(kind !== undefined ? { kind } : {})`). Absent stays absent —
     legacy docs are *not* rewritten. `migrate` stays identity.
3. `src/data/labelRepo.ts`
   - `LabelSummary` gains `kind?: DocKind`; `toSummary` passes it through when it
     is `'label'`/`'preset'` (defensive: stored records are read from disk
     without full validation). No record-shape change (`LabelRecord.meta` already
     carries `LabelDoc['meta']`).
4. `src/core/doc/factory.ts`
   - `CreateLabelDocOptions.kind?: DocKind`; `meta.kind = options.kind ?? 'label'`
     (new docs are explicit labels; preset creation uses `kind:'preset'`).
5. `src/core/trust.ts`
   - `docHasTemplateSources`: `'field'` is pure data → **not** executable in both
     the text and qr/barcode/code branches (`kind !== 'static' && kind !== 'csv'
     && kind !== 'field'`). Missing/unknown kinds stay fail-closed.
6. `src/store/storeTypes.ts`
   - `CreateLabelSpec` gains `nodes?: Node[]` (comment: lets copy/preset paths
     hand content to the factory; the factory already clones + rounds nodes).
     `docSlice.createLabel` forwards `spec` wholesale — verify, don't rewire.
7. `src/editor/render/prepareContent.ts` (type-narrowing only, no behaviour
   change for existing kinds)
   - The `else` branch currently means "template". Make it explicit
     (`else if (source.kind === 'template')`) and skip `'field'` sources for now
     with a comment: values are injected by P2 of this run; until then a field
     renders its `fallback` through `resolveContent`'s existing path.
   - Do **not** touch `resolve.ts`; `resolveContent` already falls back for any
     non-static kind.

## Out of scope (do not touch)

- No UI (`JsTab`, `ObjectTab`, `FileMenu`, gallery, `MainLayout`, i18n). P3/P4.
- No `fields` in the row context, no injection seam, no `useSampleRow` /
  `usePrintJob` / `buildCsvPrintJob` changes (P2).
- No bundle/import changes (structuredClone + validator already carry it).
- No `{ }` interpolation, no CSV row-key, no doc version bump.
- `ObjectTab.contentKindPatch` / `JsTab.switchKind` else-branches still map a
  hypothetical `'field'` to `'template'` — leave them; P4 owns the UI and will
  pin it. (Nothing calls them with `'field'` until then.)

## Tests (P1 exit criteria)

Add/extend:

- `src/core/doc/validate.test.ts`
  - preset doc (`meta.kind:'preset'`) round-trips through `isLabelDoc`;
  - doc without `kind` validates and `doc.meta.kind` is `undefined`;
  - unknown `meta.kind` is dropped + repair reported;
  - `{kind:'field', name:'price', fallback:'$0'}` survives on a text node and a
    qr/code node; missing `name` / empty `name` / non-record → carrier falls back
    to `{kind:'static', value:''}`; unknown kind still dropped.
- `src/core/doc/factory.test.ts`: default `meta.kind === 'label'`;
  `{kind:'preset'}` honoured.
- `src/core/trust.test.ts`: `docHasTemplateSources` is `false` for a `'field'`
  source and `true` for an unrecognized kind (existing fail-closed test stays).
- `src/data/labelRepo.test.ts`: save→list→get round-trip keeps `meta.kind` on
  the doc and exposes it on `LabelSummary`; a record written without `kind`
  yields a summary with `kind` undefined.
- `src/core/doc/serialize.test.ts` (or validate): compressed round-trip of a
  preset doc with a field binding keeps both.
- `src/store/docSlice.test.ts`: `createLabel({ nodes })` persists the nodes
  (fresh ids not required here — factory clones + rounds).

## Verification

- `node node_modules/typescript/bin/tsc --noEmit`
- `bun run test:run -- src/core/doc src/core/trust.test.ts src/data/labelRepo.test.ts src/store/docSlice.test.ts src/editor/render`
- Full `bun run test:run` before reporting done (drvfs is slow — accept the wait).

## Envelope reminders

- Repo root; never write an absolute machine path into any file (public repo).
- bun only; no `git stash`, no destructive git, no push, no commit (coordinator
  commits after review green).
- Depth 1: do not delegate. Missing info → terminal
  `needs-info. q: … . hint: … . next: …` line.
- Match existing style (4-space indent, JSDoc comments on new public fields,
  explicit over clever).

## Receipt (to fill)

- files changed:
- tests added / result:
- tsc:
- open questions:
