# P6 action plan — warning center

- **Objective:** Provide a persistent-in-session warning list in the MFP, with detailed localized messages and selection jumps for node warnings.
- **Status:** Complete (2026-10-08). `tsc` clean · full suite 114 files / 1317 tests green.
- **Reviews:** `experimental-review` → CHANGES-NEEDED (no blocker) → fix round → narrow re-review **APPROVE** → residual fixes → `review-fast` delta.
- **Deviations:** CSV warnings publish at parse time and are NOT cleared on `DataSourceTab` unmount (the MFP unmounts inactive tabs; scope-based cleanup instead) — reviewed and confirmed sound. Font warnings are a bonus producer (moved into always-mounted `PreviewStage`). Print warnings clear when the dialog closes (accepted).

## Todo

- [x] Add transient, document-scoped warning aggregation for preview, CSV, and print producers.
- [x] Add the Warnings MFP tab with localized details and node selection actions.
- [x] Cover asset, keep-out, global/template, CSV, and print warnings; retain existing producer behavior.
- [x] Add focused tests, run TypeScript and the smallest relevant test set, then review the change.
- [x] Update the UI-sweep plan/state and round-1 issue status.

## Files to touch

- `src/store/storeTypes.ts`, `src/store/useStore.ts`, new warning slice
- `src/components/editor/PreviewStage.tsx`, new warning tab, `MfpPanel.tsx`
- `src/components/editor/DataSourceTab.tsx`, `src/components/print/PrintDialog.tsx`
- Related component tests and `src/i18n/locales/en.json`
- `agent/2026-10-06_ui-sweep/plan.md`, `agent/known-issues/2026-10-06_round-1.md`, run state
