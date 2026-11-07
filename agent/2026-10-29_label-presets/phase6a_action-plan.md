# P6a — Field declarations, reserved ids, Fields panel

Run: [`plan.md`](plan.md) — **owner redesign, 2026-10-31**: P6 is now split into
P6a (this) + P6b (fill dialog). The old "key column stored on the preset" sketch
is replaced by a reserved `csv.row` placeholder.
Depends on P1–P5 (`52fd3b2`, `d24e4ed`, `8670cf8`).

## Owner decisions (2026-10-31)

1. The document declares its fields (id, default, required, hidden); node
   bindings reference a declared id.
2. The fill form is driven by **declarations plus bound-but-undeclared ids**
   (leftovers stay visible, so no data hides silently).
3. Reserved ids exist; `csv.row` is the CSV row selector (P6b: key lookup by a
   chosen column + typed key).
4. Default / required / hidden are edited in a **new Fields panel** in the MFP.
5. Scope: extend this run — P6a (model + authoring), P6b (fill form + row
   lookup), then P7.

## Model (additive, doc `version` stays 1)

```ts
// src/core/doc/types.ts
export interface FieldDef {
    /** Binding id referenced by `{ kind: 'field', name }`. Never empty. */
    id: string;
    /** Value pre-filled in the fill form. */
    default?: string;
    /** The fill form refuses to print while this is empty. */
    required?: boolean;
    /** Not shown in the default form; reachable via "add field". */
    hidden?: boolean;
}
// LabelDoc.data gains:
fields?: FieldDef[];
```

- Absent `fields` = no declarations (legacy docs are not rewritten).
- Duplicate ids: **first wins**, later duplicates dropped with a repair note.
- `id`: non-empty string, stored untrimmed. A non-string/absent id drops the
  whole entry.
- `default`: string only (default `''` is just absent); `required`/`hidden`:
  booleans only; a non-boolean flag is dropped, not coerced from a string.
- Reserved ids: `RESERVED_FIELD_IDS = ['csv.row'] as const` +
  `isReservedFieldId()` in `src/core/doc/fieldDefs.ts`. Reserved ids are valid
  declarations; they are **never** offerable as a plain text binding.
- Attaching a CSV ensures `csv.row` is declared (ordered last); clearing the CSV
  leaves the declaration alone (the author's settings survive a re-attach).
- Boundary rule: a declaration is **not** required for a binding to work. A
  `{kind:'field'}` binding whose id has no declaration still resolves (field
  values map / fallback) and still appears in the fill form as a leftover.

## In scope

1. `src/core/doc/types.ts` — `FieldDef`; `LabelDoc.data.fields?: FieldDef[]`.
2. `src/core/doc/fieldDefs.ts` (new) — `RESERVED_FIELD_IDS`, `isReservedFieldId`,
   `normalizeFieldDefs(raw): { fields: FieldDef[]; repairs: string[] }` (dedupe
   first-wins, drop invalid ids/defaults/flags) and `ensureCsvRowField(fields)`
   (idempotent append). Pure, no React/DOM.
3. `src/core/doc/validate.ts` — validate `data.fields` through
   `normalizeFieldDefs`, include it in the rebuilt `data` literal only when
   present (`...(fields ? { fields } : {})`); repairs flow into the existing
   `repairs` array. `migrate` stays identity.
4. `src/store/storeTypes.ts` + `src/store/slices/docSlice.ts`
   - `setDocFields(fields: FieldDef[])` — one undo entry, identical list = no-op
     (mirror `setDocGlobals`).
   - `ensureFieldDef(id: string)` — no-op when blank/declared; otherwise one undo
     entry appending `{ id }`. Called by binding authoring so a typed new id is
     registered exactly once.
   - `setDocCsv`/`attachCsv` — after attaching a CSV, ensure `csv.row` exists
     (same undo entry as the attach, so the user sees one step).
5. `src/components/editor/FieldsTab.tsx` (new) + `MfpPanel.tsx`
   - New MFP tab "Fields" (`editor.mfp.fields`), available whenever a doc is
     open, placed after "Data".
   - Per declaration row: id (read-only text — renaming would orphan bindings),
     Default `Input` (hidden for reserved ids), Required / Hidden checkboxes,
     Remove button.
   - "Add field": id `Input` + Add button (blank/duplicate disabled).
   - "Bound but not declared" section: every non-empty binding id missing from
     `data.fields`, each with an "Add declaration" action.
   - When a CSV is attached and `csv.row` is not declared: a one-line
     "Add CSV row selector" action. Reserved rows show a short explanatory hint.
   - All writes go through `setDocFields`/`ensureFieldDef`/`setDocCsv` — never a
     direct doc mutation.
6. `src/components/editor/JsTab.tsx` + `ObjectTab.tsx`
   - Writing a `{kind:'field'}` binding with a non-empty name calls
     `ensureFieldDef(name)` after the node patch (idempotent; a second undo entry
     is acceptable and safe in either undo order).
   - Do not change the binding `name` semantics or the empty-name rule.
7. `src/i18n/locales/en.json` (single writer) — `editor.mfp.fields` plus the
   `fields.*` copy (title/hint, column labels, add, remove, required, hidden,
   default, undeclared section + action, reserved hint, addRowSelector).

## Out of scope (P6b)

- Fill dialog changes: form from declarations, add-field rows, required
  validation, `csv.row` key lookup, single-record print, hidden defaults.
- No rename of declared ids, no per-field types/validation rules beyond
  required/empty, no field grouping/ordering UI.
- No doc `version` bump; no migration.

## Tests

- `src/core/doc/fieldDefs.test.ts`: dedupe first-wins; blank/absent/non-string
  ids dropped; non-string default dropped; non-boolean flags dropped; reserved
  id preserved; `ensureCsvRowField` idempotent and appends last.
- `src/core/doc/validate.test.ts`: `data.fields` round-trips (all flags, order,
  reserved id); absent stays absent (`'fields' in doc.data === false`); a bad
  entry is dropped with a repair, the rest survive.
- `src/core/doc/factory.test.ts`: a new doc has no `fields` key.
- `src/store/docSlice.test.ts`: `setDocFields` = one undo entry, no-op on
  identical input, autosave-persisted; `ensureFieldDef` idempotent/blank-safe;
  `attachCsv` declares `csv.row` in the same entry; clearing keeps it.
- `src/components/editor/FieldsTab.test.tsx` (DOM): renders declarations, edits
  default/required/hidden (persisted through the store), add/remove, lists
  bound-but-undeclared ids, adds the row selector for an attached CSV; reserved
  row has no default input.
- `JsTab.test.tsx` / `ObjectTab.test.tsx`: typing a new field name registers a
  declaration; typing an existing one does not duplicate; blank name registers
  nothing.
- `src/data/bundle.test.ts`: export→import carries `data.fields` verbatim.

## Verification

- `node node_modules/typescript/bin/tsc --noEmit`
- `bun run test:run -- src/core/doc src/store src/components/editor src/data/bundle.test.ts`
  (Windows bun binary from global memory; never write its path into a file)
- Full `bun run test:run` before reporting done.

## Envelope reminders

- Public repo: no absolute machine paths in any file.
- One `en.json` writer (this phase). Typed `t()` keys catch stale references.
- No commit, no `git stash`, no destructive git. Depth 1: do not delegate.
  Missing info → terminal `needs-info. q: … . hint: … . next: …`.
