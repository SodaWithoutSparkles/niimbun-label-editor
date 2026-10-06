# Phase 1 — mechanical wins (action plan)

- Run: `agent/2026-10-06_ui-sweep/` · Plan: `plan.md` · Source: `agent/known-issues/2026-10-06_round-1{,-investigation}.md`
- Baseline: `main` @ `9b8d4a5` · gate re-verified at P1 start: **tsc clean, 1213 tests green (105 files)**.
- Commit: semantic `fix(editor): …` at end of phase (coordinator asks first).

## Tasks (disjoint files → parallel)

| # | Task | Files | Agent | Owner decision folded in |
| - | ---- | ----- | ----- | ------------------------ |
| 1 | Import button → `fileInputRef.click()`; auto-import from `onChange`; keep no-file error as empty-picker fallback | `src/components/editor/ImageImportDialog.tsx` | small-coder (A) | #1 opens picker + auto-imports |
| 10 | DPI draft-on-blur/Enter (copy `EditorStatusBar.commitDraft` pattern); store untouched | `src/components/settings/GeneralSection.tsx` | small-coder (A) | — |
| 9 | Grid painted **after** `UnionSilhouette`; `strokeScaleEnabled={false}`; `GRID_STEP_HM` stays 500 | `src/components/editor/Overlays.tsx` (+ test) | small-coder (B) | #9 step stays 5 mm |
| 12 | `handlePointerDown` early-returns on Transformer anchor targets; delete `nodeRefs.current.clear()` effect; `anchorSize` 8→10 | `src/components/editor/PreviewStage.tsx` (+ tests) | general (C) | #12 anchor size 10 |
| 14 | Per-level front-to-back rows (`treeRows` mode / `layerRows`), drop global `.reverse()`, front-most-first, collapse affordance; re-verify `onDrop` index mapping | `src/editor/selectors.ts` (+ test), `src/components/editor/LayersPanel.tsx` | general (D) | #14 front-first + collapse |

## Environment (pass to every subagent)

- WSL, repo on `/mnt/c` (drvfs slow). `bun` = `bun` (absolute path; bare `bun` not on the sanitized PATH).
- **Never `bun test`** → `…/bun.exe run test:run` (Vitest). `…/bun.exe run tsc` for typecheck.
- Vitest default env is `node`; DOM tests need `// @vitest-environment happy-dom` on line 1.
- All product strings via typed i18n keys in `src/i18n/locales/en.json` (bare-key catalog); dynamic keys via literal map.
- No delegation from subagents (depth 1). No commits — coordinator commits.

## Verification gates

- `tsc` clean · `bun run test:run` green.
- Review: `review-fast` over the batch (mechanical).
- Tick each landed issue in `agent/known-issues/2026-10-06_round-1.md`.

## State

- Status: **done** (2026-10-07). Gate: tsc clean · 1227 tests green (108 files).
- Review: `experimental-review` → CHANGES-NEEDED (2 should-fix, no blockers) → fixed → `review-fast` re-review **APPROVE**.
- Fixes applied after review: removed unreachable file-mode no-file fallback + dead `imageImportNoFile` key (cancel fires no `change` event); extracted+tested `isTransformerTarget`; `busyRef` guard; `aria-expanded` on the group chevron; scoped the Overlays grid-line assertion; added onDrop "below-sibling"/"into-group" cases.
- Headed check (browser skill): app loads, **zero console errors**; grid visible over silhouette (5 mm) ✓; group row above children + collapse/expand ✓; DPI types freely, clamps only on blur ✓; corner-anchor drag resizes the node (no hijack) ✓.
- Deviations to flag at phase review:
  - Owner decision #1 said "keep the no-file error as fallback for an empty picker result" — but a cancelled picker fires **no `change` event**, so the fallback is unreachable; removed (and its i18n key deleted). Confirm removal is acceptable.
  - #12 has no automated gesture test (browser-only); covered by the `isTransformerTarget` unit test + the headed drag above.
- App-state note: the headed pass created one label ("F-tag spare 25×78") in the local dev IndexedDB and left it there (no in-app delete affordance found). Screen DPI was restored to 96.
- Not committed yet — awaiting owner approval for the semantic commit.
