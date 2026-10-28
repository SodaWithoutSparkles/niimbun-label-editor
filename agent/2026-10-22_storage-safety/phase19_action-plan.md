# Wave 3 · Phase 19 — Label type defaults to the printer's roll

- Date: 2026-10-28
- Baseline: P18 (reported `labelType` on `PrinterStatus`)
- Reviewer: `review-fast`
- Commit: `fix(print): default the label type to the roll the printer reports`

## Failure mode (owner, 2026-10-28)

`PrintDialog` starts with `labelType = undefined` and resolves
`effectiveLabelType = labelType ?? LabelType.WithGaps`
(`PrintDialog.tsx:159, 184, 358`). Nothing reads the printer's reported type, so
every job is built with gap assumptions — on a continuous / transparent /
perforated roll the printer uses gap detection that does not exist, and feed /
cut positions go wrong. There is also no notice when the selected type and the
loaded roll disagree (`rollDpiMismatch` covers roll size + dpi only).

## Design (fixed)

### 1. Seed from the reported type

```ts
const reportedLabelType = printerStatus.labelType;      // P18
const effectiveLabelType = labelType ?? reportedLabelType ?? LabelType.WithGaps;
```

- `labelType` (the user's choice this dialog session) always wins — the user
  keeps the final say.
- The existing open-reset (`:184`) is kept, so every open re-seeds from the
  current roll (which P18 keeps fresh).
- `WithGaps` survives only as the no-information fallback (mock transport, an
  RFID-less printer, or a printer that reports `Invalid`).

### 2. Warn on a reported-vs-selected mismatch (non-blocking)

Mirror `rollDpiMismatch` with a small pure helper in `printDialogModel.ts`:

```ts
export const labelTypeMismatch = (
    reported: LabelType | undefined,
    selected: LabelType,
): LabelType | undefined => (reported !== undefined && reported !== selected ? reported : undefined);
```

- Rendered with the existing warning block (`print-overflow` style), copy:
  "The printer reports {reported}; this job uses {selected}."
- **Never gates printing** (decision 18: roll/dpi mismatch is advisory). The
  user may be about to swap the roll anyway.
- No new store field, no persistence, no effect on `capabilities.paperTypes`
  filtering (which already labels unsupported options).

### 3. Keep the capability gate as it is

`printOverrides.labelType` is still only sent when `labelTypeEnabled`
(`capabilities !== undefined`). With capabilities unknown the adapter's own
default applies — unchanged behaviour, now with a correct visible selection.

## Files

| File | Change |
| --- | --- |
| `src/components/print/PrintDialog.tsx` | seed `effectiveLabelType`, render the mismatch notice |
| `src/components/print/printDialogModel.ts` | `labelTypeMismatch` helper |
| `src/i18n/locales/en.json` | `print.warnings.labelTypeMismatch` |
| tests | below |

## Tests

`PrintDialog.test.tsx`:
- `printerStatus.labelType = Continuous` → the select shows Continuous and the
  built job carries `labelType: Continuous` (the regression this fixes);
- no reported type → `WithGaps` (existing default preserved);
- user picks Perforated → the job carries it, and reopening the dialog re-seeds
  from the reported type;
- reported ≠ selected → the mismatch notice renders; equal → it does not;
- the notice never disables Print.

`printDialogModel.test.ts` (if absent, add next to the existing model tests):
- `labelTypeMismatch` returns the reported type only on a real difference and
  never on `undefined`.

Gate: full suite + `tsc --noEmit`.

## Risks

| Risk | Mitigation |
| --- | --- |
| User's deliberate override silently reset | Override persists for the whole dialog session; the reset is documented as "fresh form per open" (unchanged) |
| Stale reported type sends a wrong label type | P18 refreshes it (events + dialog-open); the mismatch notice tells the user |
| Warning fatigue | One line, only when the printer actually reports a different type |
