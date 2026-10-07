# Plan — UI sweep (known-issues round-1 fixes)

- Date: 2026-10-06. Owner: you. Driver: `coordinator` (this plan is the handoff).
- Source: `agent/known-issues/2026-10-06_round-1.md` (14 items) + `agent/known-issues/2026-10-06_round-1-investigation.md` (root causes, receipts, decisions).
- Baseline: `main` @ `9b8d4a5` (D-31/D-30 landed there — ink-aware overflow warning + print-direction control). Suite was 1204 green at `1b26bd3`; re-verify at P1 start.
- Precondition (D-31/D-30 WIP) **satisfied** — `9b8d4a5`. Its files are now clean to touch.
- Commit strategy (owner, 2026-10-06): **semantic commit at the end of each phase** (`fix(editor): …` / `feat(editor): …`), coordinator asks before each. Phase docs (`phase{N}_action-plan.md`) commit with their phase; `state.md` stays gitignored.
- Excluded: #4 false clipping (= D-31, in flight) · D-30 (in flight) · serpentine UI (owner chose threshold+strength only).

## Owner decisions (2026-10-06, all folded in)

| # | Decision |
| - | -------- |
| 1 | Import button with no file → opens OS picker + auto-imports the chosen file. Keep the no-file error as fallback for an empty picker result. |
| 2 | Changing an image node's file/URL → **replace the existing ref in place** (`updateImageRef`, node keeps `imageId`, one undo entry, no orphans — shrinks D-12). |
| 3 | Quantizer params **per node**: `threshold` + `strength` (no serpentine). Respect the 8-distinct-policy palette cap (`renderLabelPage.ts:255`) — dedupe rounded params, warn on overflow. Preview≡print by construction (single `renderLabelPage` seam). |
| 5/6 | Node keeps a generic ⚠ icon; **detailed per-kind text lives in the warning center**. Warning center = **5th MFP tab, next to JS**. **QR data is arbitrary text — never treat/validate as URL** (no URL heuristics; URLs are one use case). |
| 7 | Polygon = **click-to-add-points**, double-click/Enter finishes, Esc cancels (disarm already exists). |
| 8 | **Real static style support now**: `fill`/`stroke`/`strokeWidth` honored end-to-end (schema → validate → resolve → BOTH renderers → inspector). Defaults (**revised 2026-10-08**): fill = **no fill** (`'transparent'`), stroke `#374151`, `strokeWidth` **50 hm (0.5 mm)**. Invalid optionals dropped with repair, never fatal. |
| 9 | Grid step **stays 5 mm** (`GRID_STEP_HM=500`). Fix = un-occlude (paint after silhouette) + `strokeScaleEnabled={false}`. |
| 10 | Draft state committed on blur/Enter (copy `EditorStatusBar.commitDraft` pattern, `EditorStatusBar.tsx:40-98`). Store untouched. |
| 11 | Calibration = ruler + slider + live number dialog on the shared `Modal`, writes existing `setScreenDpi`. Raw number field stays. |
| 12/13 | **Corner anchors = keep aspect; side anchors = free stretch** (normal-user expectation). The commit must match the live gesture exactly — anchor-aware, **no post-hoc `Math.max` aspect collapse**. `anchorSize` 8→10. Groups excluded from Transformer resize until D-10 (impl default, flag at review). |
| 14 | Front-most child first (Photoshop convention) + **collapsed-group affordance** (expand/collapse group rows). |

## Phases

Each phase: action plan → implement → review → fix (≤2 rounds) → semantic commit. Serial across phases (shared files); parallel tasks within a phase where noted.

### P1 — mechanical wins (parallel tasks, small-coder/general)

| # | Task | Files |
| - | ---- | ----- |
| 1 | Import opens picker + auto-import (`fileInputRef.click()` from Import; auto-run from `onChange`) | `src/components/editor/ImageImportDialog.tsx` |
| 9 | Grid painted after silhouette + `strokeScaleEnabled={false}`; step stays 500 | `src/components/editor/Overlays.tsx` (+ test) |
| 10 | DPI draft-on-blur/Enter | `src/components/settings/GeneralSection.tsx` |
| 12 | `handlePointerDown` ignores Transformer anchors; delete `nodeRefs` clear effect (`PreviewStage.tsx:232-234`); `anchorSize` 10 | `src/components/editor/PreviewStage.tsx` (+ tests) |
| 14 | Per-level front-to-back rows (new `treeRows` mode / `layerRows`), drop global `.reverse()`, front-most-first, collapse affordance; re-verify `onDrop` mapping | `src/editor/selectors.ts` (+ test), `src/components/editor/LayersPanel.tsx` |

Review: `review-fast` per task or one pass over the batch.

### P2 — resize parity + image replace

- **#13** anchor-aware commit: corner → uniform/aspect; side → single-axis stretch; commit the live box (honor live `x/y`); remove the `Math.max(rawX, rawY)` collapse (`geometry.ts:77-79`) except where the gesture was uniform; rounding documented; groups not attached to the Transformer. Files: `PreviewStage.tsx`, `src/editor/transformGesture.ts`, `src/core/doc/geometry.ts` (+ tests — aspect collapse is shared by ellipse/QR/image, `transformGesture.test.ts:90-100`).
- **#2** replace-in-place: Asset section "Replace image" → `importImageFile/Url` (`assetImport.ts:88-150`) → `updateImageRef(imageId, {source, widthPx, heightPx})`. Files: `ImageImportDialog.tsx`, `ObjectTab.tsx`. Depends on P1/#1.

### P3 — real shape styles (#8)

Schema (`types.ts` `fill?`/`stroke?` on shape nodes) → validate/repair (`validate.ts`) → factory defaults → resolved types (`resolve.ts`) → **both renderers** (`ResolvedShape.tsx`, `konvaFactory.ts` — preview≡print) → wire `strokeWidth` (already persisted, unread) → inspector `ColorPicker`/`PopoverSlider` fields wired (`inspectorModel.ts`, `ObjectTab.tsx`) → i18n. ~5–8 files. Owner screenshot-check of defaults.

### P4 — polygon draw mode (#7)

Arm `shape:polygon` → accumulate world points on click (no node until finish); live preview Line; dblclick/Enter finish; Esc cancel; create node from collected points (`insertActions.ts` point-based factory); snap-aware. Files: `PreviewStage.tsx`, `insertActions.ts`, `toolsSlice.ts`, preview overlay, i18n hints, tests. After P3 (default fill visible).

### P5 — quantizer per-node params (#3)

`BaseNode.quantizerParams? {threshold?: int 0–255; strength?: 0–4}` → validate clamp+repair → per-policy options seam (`policy.ts`, `pipeline.ts`: options per policy index, not one shared `opts`) → `renderLabelPage` policy mask keyed `(id, params)` + dedupe/cap-8 + overflow warn → inspector numeric fields (new `FieldKind`) + nested read/write (`ObjectTab.tsx`) → i18n → tests (validate/policy/renderLabelPage/inspectorModel/ObjectTab). ~8–10 files. Editor canvas stays unquantized (print previews show dither).

### P6 — warning center (#6 + #5 text)

5th MFP tab "Warnings" (next to JS). Aggregate: asset warnings (`missing|invalid|too-small` — lift from component-local `usePreparedAssets` to shared context/slice), keep-out, global-data warnings, template errors; print doc-level warnings (incl. in-flight ink-aware overflow) as **non-jumpable** entries. Entries `{id, kind, nodeId?}`; per-kind detailed i18n text; jump via `selectNode` (`selectionSlice.ts:16`). Node badge stays the generic ⚠ (owner). Do NOT reuse `NotificationCenter` (auto-dismiss). QR = arbitrary text. Host options for aggregation: extend `SampleRowContext` or a small `warnings` slice — coordinator picks with review. ~5–8 files. Owner screenshot-check of the tab.

### P7 — calibration dialog (#11)

`CalibrationDialog` on shared `Modal` (not `dialogService` — prompt-only). On-screen ruler length `mm / 25.4 * dpi` (inverse of `realZoom`, `core/viewport.ts:103`); slider + live number; writes existing `setScreenDpi` (clamped/persisted as today). Calibrate button next to the dpi input (`GeneralSection.tsx`). i18n + test + **headed browser pass** (`agent/memory/dialogs.md` preflight pitfall).

## Verification gates (every phase)

- `tsc` clean · `bun run test` green (never `bun test`).
- Review per repo routing (`experimental-review` primary, `review-alt` fallback, `review-fast` mechanical).
- UI phases: headed check (browser skill) + owner screenshot pass where noted.
- When an issue lands: tick it in `agent/known-issues/2026-10-06_round-1.md`.

## Risks

- `PreviewStage.tsx` is touched by P1/#12, P2/#13, P4, (P6 badge) — serialized by phase order.
- P2 regression risk: resize math is pinned by existing tests; aspect nodes (ellipse centre-origin, `resolve.ts:343-356`) need cases.
- P5 palette cap: >8 distinct `(id, params)` policies must degrade gracefully (warn, not throw).
- StrictMode double-fire pitfall class (thumbnail precedent) — idempotent effects.
- All new strings = typed i18n keys in `en.json` (WIP collision → precondition).
- Memory escalation at end: promote project-relevant facts (`agent/memory/*.md`), delete fixed debt lines in `tech-debt.md` (D-12 shrinks via P2/#2; D-15 stays).
