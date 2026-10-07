# Phase 5 — per-node quantizer parameters (#3)

- Objective: persist and edit optional per-node threshold/strength, with policy deduplication and graceful fallback at the 8-entry palette cap.
- Status: complete; TypeScript clean, focused tests 187/187 green, full suite 1281/1281 green.
- Commit: `feat(editor): add per-node quantizer controls`.

## Tasks

- [x] Add validated/clamped `quantizerParams` to the document model and round-trip tests.
- [x] Carry quantizer options per policy through mask building and rendering; dedupe and cap 8 distinct policies, reporting overflow.
- [x] Expose threshold/strength controls in the Object tab with typed i18n labels.
- [x] Test option routing, deduplication, cap behavior, and preview/print render seam.
- [x] Run targeted tests, TypeScript, full Vitest suite, review diff, and update issue status.

## Files

- `src/core/doc/types.ts`, `src/core/doc/factory.ts`, `src/core/doc/validate.ts` (+ tests)
- `src/core/render/policy.ts`, `src/core/render/pipeline.ts` (+ tests)
- `src/editor/render/renderLabelPage.ts` (+ tests)
- `src/editor/inspectorModel.ts`, `src/components/editor/ObjectTab.tsx` (+ tests)
- `src/components/print/PrintDialog.tsx` (+ tests), `src/i18n/locales/en.json`
- `agent/known-issues/2026-10-06_round-1.md`, plan/state
