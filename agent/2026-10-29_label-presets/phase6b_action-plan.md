# P6b — Fill form from declarations + `csv.row` key lookup

Run: [`plan.md`](plan.md) § "Owner amendment (2026-10-31)".
Depends on P6a (`f72c4fe`: `data.fields`, reserved ids, Fields panel) and P5
(`8670cf8`: the fill dialog + one content path).
Run state: [`state.md`](state.md).

## Goal

The fill dialog is built from the document's **declarations** (plus bound
leftovers), honours default/required/hidden, can add ad-hoc rows, and — when the
preset declares `csv.row` and has a CSV — finds one record by a typed key so the
printed label is exactly that record.

## Owner decisions carried in

- Declarations drive the form; **bound-but-undeclared ids still appear**
  (leftovers), so nothing hides silently.
- Defaults prefill; required blocks printing while empty; hidden ids are absent
  from the default list but reachable via "add field".
- "Add field" = `[id dropdown] [value]` row.
- `csv.row` = key lookup: choose the key column, type the key (exact, trimmed);
  a miss is explicit (fallbacks shown, what you see prints).

## Design (fixed here)

- **Row sources.** Form rows = declarations in document order (skipping `hidden`)
  **then** leftover bound ids (first node order, not declared, non-empty name,
  not already listed). Hidden declarations and leftover-but-hidden? (leftovers
  have no hidden flag) are addable through "add field".
- **Values.** Initial map = every declaration's `default ?? ''` (hidden included,
  because a hidden default still applies). Leftovers start `''`. Add-field rows
  default to `''`. Values stay in dialog state (P5 invariant).
- **Required.** A row is missing when its value is empty after `trim()`. While
  any required row is missing, Print and Open in editor are disabled and an
  inline message lists the missing ids. `add field` can satisfy a hidden
  required id.
- **CSV row selector.** Rendered only when `csv.row` is declared **and** the
  loaded document has an attached CSV that reads successfully. Control: key
  column `Select` (all columns, default first) + key `Input`. Status line: no key
  typed ("showing the sample row"), matched row number, or "no row matches".
  - Matching: `findCsvRow(csv, column, key)` — first row whose cell at that
    column equals `key.trim()` after trimming the cell; blank key or unknown
    column → `-1`.
  - **Single-record print.** Whenever the preset has a readable CSV, the dialog
    hands `usePrintJob` a one-row table so preview and print both show exactly
    one record: the matched row, or the stored sample row when no key is typed,
    or one all-empty row (real columns, blank cells) when the key misses — the
    explicit fallback state. `usePrintJob` therefore gains a `csv` override.
  - `ctx.index`/`ctx.total` for a key-matched print are `0`/`1` (the synthetic
    single-row seam). Documented trade-off; note it in the P7 user guide.
- **No CSV attached** (or the read failed): no row control, no override, the
  job is the document's normal one page.

## In scope

1. `src/editor/csvKey.ts` (new, `.ts` only)
   - `findCsvRow(csv: CsvRecord, column: string, key: string): number` (first
     exact trimmed match, `-1` for blank key/column miss/unknown column).
   - `singleRowCsv(csv: CsvRecord, rowIndex: number): CsvRecord` — a copy with
     `rows: [csv.rows[rowIndex] ?? columns.map(() => '')]`; `-1`/out of range ⇒
     the all-empty row. Never mutates the input.
2. `src/components/print/usePrintJob.ts`
   - `UsePrintJobOptions.csv?: CsvRecord | null` — when the key is present, that
     table is used verbatim (no repo read): `csvStatus = 'none' | 'ready'`,
     `csvRevision = 0`, and `prepareRow` resolves against it. Absent keeps
     today's read (editor unchanged). Read through a ref like `doc`/`fields`.
3. `src/components/gallery/FillPresetDialog.tsx`
   - Load the attached CSV (`csvRepo.get(doc.data.csv.csvId)`) on open alongside
     the doc, token-guarded; a failed read degrades to "no row selector".
   - Build the form rows as described (declarations + leftovers), prefill
     defaults, add-field rows, required gating.
   - Row selector + `singleRowCsv` override passed to `usePrintJob`; preview uses
     `prepareRow(0)` whenever an override is in play (the hook's table has one
     row), otherwise `prepareRow(doc.data.sampleRowIndex)`.
   - `PrintDialog` keeps receiving the hook's `csv`/`csvStatus`/`csvRevision`, so
     one page is printed for a key-matched preset.
   - Preset/CSV switch resets values, key column and key (session token rules
     from P5 stay).
4. `src/i18n/locales/en.json` (single writer) — reuse `fields.*` copy where it
   fits; add `presets.row.*` (label, column, key, keyPlaceholder, noKey,
   noMatch, matched, csvUnavailable), `presets.addField`,
   `presets.requiredMissing`, `presets.fieldId`, `presets.fieldValue`.

## Out of scope

- No fuzzy/partial matching, no multi-row selection, no per-row uniqueness check.
- No changes to P6a's model, the Fields panel or node bindings.
- No doc schema change; no persistence of typed values/keys.
- No hardware verification (owner deferred).

## Tests

- `src/editor/csvKey.test.ts`: exact trimmed match; duplicate keys → first row;
  unknown column / blank key → `-1`; blank cells never match a blank key;
  `singleRowCsv` copies (no mutation), keeps columns/name/id, out-of-range and
  `-1` yield one all-empty row.
- `src/components/print/usePrintJob.test.tsx`: the `csv` override wins over the
  repo (no read), reports `ready`, and `prepareRow(0)` resolves that table's row;
  `csv: null` reports `none`; absent keeps the repo path.
- `FillPresetDialog.dom.test.tsx`:
  - form rows come from declarations with defaults prefilled; hidden not shown;
    leftover bound id shown; add-field adds a row (`[id ▾][value]`) and its value
    reaches the preview overrides; adding a hidden id works.
  - required: Print/Open disabled with the missing-id message until filled.
  - row selector: appears only with `csv.row` declared + CSV attached; typing a
    key resolves that row into the preview (`ctx.row`/`ctx.overrides` evidence);
    no key uses the sample row; a miss shows the notice and the fallback preview;
    print receives a **one-row** table (assert `csv.rows.length === 1` on the
    `PrintDialog` prop) for matched, sample and miss cases.
- Keep P5's invariants green (one job, no persistence, copy-not-convert).

## Verification

- `node node_modules/typescript/bin/tsc --noEmit`
- `bun run test:run -- src/editor src/components/gallery src/components/print`
  (Windows bun binary from global memory; never write its path into a file)
- Full `bun run test:run` before reporting done.

## Envelope reminders

- Public repo: no absolute machine paths in any file.
- One `en.json` writer (this phase). Typed `t()` keys catch stale references.
- StrictMode double-effects; token-guard every async load/preview; no state write
  after close/preset switch.
- No commit, no `git stash`, no destructive git. Depth 1: do not delegate.
  Missing info → terminal `needs-info. q: … . hint: … . next: …`.
