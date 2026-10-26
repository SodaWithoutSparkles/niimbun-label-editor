# Wave 3 · Phase 12 — Print CSV readiness (GitHub #6/#7)

- Date: 2026-10-26
- Baseline: `main` @ `20e89f0`
- Reviewer: `review` (logic-heavy)
- Commit: `fix(print): gate printing on the attached CSV actually loading`

## Failure mode (confirmed in code)

`usePrintJob` reads the attached CSV in an effect whose only state is
`csv: CsvRecord | null`. A rejected `get()`, a missing record and "no CSV
attached" all collapse to `null`. Consequences:

1. `PrintDialog` builds `buildCsvPrintJob(doc, null, …)` → `rows = 1`
   (`src/print/printLabel.ts:190`), so **Print stays enabled and prints one
   fallback page** while the CSV is still loading or has failed to load.
2. `PrintPagePreview`'s render effect deps are
   `[enabled, doc, rowIndex, optionsKey]` and `prepareRow` is read through a
   ref, so a CSV that arrives after the first paint never re-renders the page.

Correct baseline: **no attached CSV ⇒ one static page is right**. Only an
*attached* CSV that is not yet readable must block.

## Design (fixed — do not redesign)

### 1. `usePrintJob` exposes a status + a content revision

```ts
export type PrintCsvStatus = 'none' | 'loading' | 'ready' | 'error';

export interface PrintJobDeps {
    csv: CsvRecord | null;
    /** `none` = nothing attached (a 1-page job is correct). */
    csvStatus: PrintCsvStatus;
    /** Bumped whenever the CSV read settles or the attachment changes. */
    csvRevision: number;
    prepareRow: (rowIndex: number) => Promise<ResolveContext>;
    assets: AssetDeps;
}
```

Semantics (derive, do not set a lagging state):

| Condition | `csvStatus` | `csv` |
| --- | --- | --- |
| `doc?.data.csv?.csvId === undefined` | `none` | `null` |
| attached, no settled read for **this** `csvId` yet | `loading` | `null` |
| read settled with a record | `ready` | record |
| read settled with `null` (record gone) | `error` | `null` |
| read threw, or `csvRepo === null` while attached | `error` | `null` |

- Keep the settle result in state keyed by `csvId`
  (`{ csvId, csv, revision } | null`) so a **stale** settle for a previous
  `csvId` cannot report `ready`, and so the first frame after the dialog opens
  already reads `loading` (no one-frame window where Print is enabled).
- Keep the existing `cancelled` guard on the effect. The effect deps stay
  `[open, csvId, csvRepo]`; bump the revision when a read settles.
- Dialog closed ⇒ `csv: null` as today; `prepareRow` stays identity-stable.
- Do **not** add retry/backoff. Re-opening the dialog re-reads (effect re-runs
  on `open`), which is the recovery path.

### 2. Gate the button **and** job creation

`PrintDialog`:

- New optional props: `csvStatus?: PrintCsvStatus` and `csvRevision?: number`.
  When `csvStatus` is omitted, derive `csv !== null ? 'ready' : 'none'` so the
  dev harness `src/components/dev/PrintCsvSmoke.tsx` keeps working untouched.
- `const csvNotReady = csvStatus === 'loading' || csvStatus === 'error';`
- `printDisabled` gains `|| csvNotReady`.
- `handlePrint` returns early when `csvNotReady` (defense in depth — the button
  is disabled, but the builder must never be reached with a not-ready CSV).
- Surface the state in the Pages section: while `csvNotReady`, render the
  message instead of the page list / page preview —
  `print.csvLoading` for `loading`, `print.csvUnavailable` for `error`
  (a plain `<p role="status">`; no dialog, no retry button).

### 3. `PrintPagePreview` invalidates on the revision

Add `contentRevision?: number` (default `0`) to `PrintPagePreviewProps` and
append it to the render effect's dependency array. It is not read inside the
effect — its only job is to re-run the pass when the CSV content changes
identity under a stable `rowIndex` (e.g. re-attaching a different table with
the same row count). `PrintDialog` passes `csvRevision`.

`usePrintThumbnails` already keys its cache on the `csv` object identity, so it
needs no change — verify that claim in review, don't touch it.

### 4. i18n (`src/i18n/locales/en.json`, `print.*`)

- `print.csvLoading` — "Loading the attached CSV…"
- `print.csvUnavailable` — "The attached CSV could not be loaded. Reopen this dialog to retry."

## Files

| File | Change |
| --- | --- |
| `src/components/print/usePrintJob.ts` | status + revision state, settle keyed by `csvId` |
| `src/components/print/PrintDialog.tsx` | props, `csvNotReady`, gate button + `handlePrint`, status message, revision prop |
| `src/components/print/PrintPagePreview.tsx` | `contentRevision` in deps |
| `src/components/editor/EditorShell.tsx` | pass `csvStatus` / `csvRevision` |
| `src/i18n/locales/en.json` | two keys |

## Tests (must exist before done)

`usePrintJob.test.tsx`:
- no attachment → `csvStatus: 'none'`, `csv: null`.
- attachment with a **pending** `get()` → `'loading'`, `csv: null`; resolve →
  `'ready'`, record present, `csvRevision` increased.
- `get()` rejects → `'error'` (**replaces** today's "degrades to null" assertion
  at line ~326 — update the test, keep the "no crash" intent).
- `get()` resolves `null` (record gone) → `'error'`.
- `csvRepo === null` while attached → `'error'`.
- a stale settle: attach A, resolve B's read late ⇒ status never reports A's
  content for B (cancel or `csvId` key must hold).

`PrintDialog.test.tsx`:
- attached CSV still loading → **Print disabled** and the loading message shown;
  clicking the (disabled) button creates no job (assert runner not called).
- `csvStatus: 'error'` → Print disabled, error message shown.
- `csvStatus: 'none'` (no CSV) → Print enabled with the 1-page plan (existing
  behaviour must stay green: `printLabel.test.ts:332`).
- after the status flips to `ready` (rerender with the record) → Print enabled
  and the page preview re-renders (spy on `prepareRow`/render count).

Gate: `bun run test` (full) + `bun run build`; no changes outside the table.

## Risks

| Risk | Mitigation |
| --- | --- |
| One-frame window with Print enabled | Derive `loading` from `settled.csvId !== csvId`, not from an effect-set flag |
| Blocking print forever on a corrupt CSV | Message names the recovery path; `error` is per-attachment, cleared by closing the dialog |
| A stale settle overwrites a newer attachment | Settle state keyed by `csvId`; `cancelled` guard retained |
| Breaking the dev harness | `csvStatus` optional with a derived default |
