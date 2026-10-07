# Phase 4 — polygon draw mode (#7)

- Objective: replace the broken one-click polygon insert with a point-based drawing workflow.
- Status: complete; TypeScript clean, focused tests 23/23 green, full suite 1275/1275 green.
- Commit: `feat(editor): add polygon drawing tool`.

## Tasks

- [x] Accumulate snapped world-space vertices without creating a node until finish.
- [x] Show a live preview; finish on double-click, Enter, or clicking the first point; cancel on Esc.
- [x] Create/select one valid polygon with the shared shape-style defaults; ignore invalid drafts.
- [x] Add focused tests for polygon normalization, closure, snapping, and validation.
- [x] Run targeted tests, TypeScript, and full Vitest suite; review the diff; update round-1 issue status.

## Files

- `src/components/editor/PreviewStage.tsx`
- `src/editor/insertActions.ts` (+ test)
- `src/editor/polygonDrawing.ts` (+ test)
- `src/i18n/locales/en.json`
- `agent/known-issues/2026-10-06_round-1.md`
- `agent/2026-10-06_ui-sweep/plan.md` and `state.md`
