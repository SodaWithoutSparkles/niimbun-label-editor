# Phase 2 action plan — rotation & canvas editing (5 bugs)

Run: `agent/2026-11-21_review-fixes/`. ENV BRIEF: [`state.md`](state.md). Anchors verified 2026-11-21 by explore (session `ses_e0560705dffeEqSiQ6QHAJDsEP`); all 5 reproduce at HEAD (post-P1-commit). Two existing tests codify wrong behavior and get rewritten. **Start only after the P1 commit** (shared tree).

## Shared decision — rotation normalization (owner, 2026-11-21)

One signed range **[-360, 360]**, step/rounding **0.1°**, raw signed display (270° shows as 270°), values outside the range **wrap** (not clamp — wrapping preserves the visual angle; clamping 400°→360° would rotate the object).

### Wave 0 — shared helper first (small-coder, blocks A1+A3)

New `src/editor/rotation.ts` (pure, `.ts`-only layer) + `rotation.test.ts`, exact contract:

- `normalizeRotDeg(value: number): number`
- Non-finite input → `0`.
- If `|value| <= 360`: pass through, rounded to 1 decimal (`Math.round(v*10)/10`), `-0` → `0`. In-range values are NEVER rewritten otherwise (raw signed display).
- Else: `value % 360` (JS remainder, keeps sign) then same rounding. `400→40`, `-390→-30`, `720→0`.
- Rounding happens AFTER wrapping. Visual angle is always preserved.

## Bug 1 — angle controls: range & precision (inspector half → wave-1 A1)

Verified: **no rotation control exists** — `rotDeg` is a generic `kind:'number'` inspector field (`src/editor/inspectorModel.ts:97`) whose `numberRange` (`ObjectTab.tsx:442-479`) falls through the `default` at **:476-477** → `{min: 0, max: 100000, step: 1}`. Typing `-15` + Enter: `PopoverSlider.handleConfirm` (:292-302) rounds then **clamps** → `Math.max(-15, 0) = 0`. Canvas handle: `transformEndPatch` (`transformGesture.ts:138`) commits raw `konvaNode.rotation()` — arbitrary fractional degrees.

**Fix (A1):**
1. `numberRange`: add `case 'rotDeg': return { min: -360, max: 360, step: 0.1 }`. Do NOT touch `default` (`strokeWidth` relies on it; `ObjectTab.test.tsx:207` pins it).
2. `PopoverSlider.tsx`: add optional circular mode (e.g. `circular?: boolean`, default false → existing behavior byte-identical). In `handleConfirm` (:292-302): when `circular`, wrap the rounded value into `[min,max]` by span-modulo instead of clamping — typed `400` commits `40`, not `360`. The live typing path (:470-481) stays unclamped.
3. `ObjectTab.setNumber` for `rotDeg`: run `normalizeRotDeg` before `transformPatch` (the live typed path sends raw values into the store).
4. Wire the `rotDeg` field's `PopoverSlider` (`ObjectTab.tsx:1001-1025`) with `circular`.
5. **Rewrite codified tests:** `ObjectTab.test.tsx:205-212` (asserts the buggy `{0,100000,1}`) and `:264-267` (`it('leaves rotation on its unchanged fixed range')`). Add: typed out-of-range wraps (400→40), typed `-15` commits `-15`, 0.1 rounding.

**Bug 1 canvas half → A3** (owns `transformGesture.ts`): `transformEndPatch:138` `rotDeg: normalizeRotDeg(live.rotDeg)`.

Note: no on-canvas rotation badge/tooltip exists; the only other angle display is the text overlay's matrix-derived CSS rotation — leave it. `validate.ts` does not wrap `rotDeg` (only rejects non-finite) — **deliberately unchanged** (no silent doc rewriting on load).

## Bug 2 — arrow keys in rotated view (→ wave-1 A2)

`EditorKeyboardShortcuts.tsx:57-63` `ARROW_DELTAS` are document-space; `:169` `state.nudgeNodes(arrow.dx*step, arrow.dy*step, …)`. View rotation is `0|90` only (`viewSlice.ts:50-58`, `Viewport.rotation` `core/viewport.ts:23`); authoritative mapping `viewport.ts:60-77`: at 90°, `screenToWorld` is `x: dy/zoom, y: -dx/zoom` — so screen-space Right currently nudges world `+x` which renders as screen **down**.

**Fix (A2):** at `:169`, when `state.viewRotation === 90`, nudge with the screen-space direction converted through the inverse view rotation: `(dx,dy) = (arrow.dy, -arrow.dx)` (Right → world `(0,-step)` → appears right at 90°). Store-side `nudgeNodes` is already world-space-correct (`translateWorldPatch` handles rotated parents — do NOT add parent rotation here). Step escalation (`:164`) and coalescing unchanged.

**Tests:** `EditorKeyboardShortcuts.test.tsx:240` `it('nudges in the direction of each arrow')` — add a `viewRotation: 90` variant: Right → world −y, Up → world +x, etc.

## Bugs 3+4+5 + canvas precision (→ wave-2 A3, one writer for PreviewStage/transformGesture/TextEditorOverlay)

**Bug 3 — child drag in rotated group.** `PreviewStage.tsx:1201-1203` adds the world delta raw into parent-local `x/y` via `movePatch` (`transformGesture.ts:30-42`); origins (`:807-821` `beginDrag`) copy only `node.transform`. **Fix:** capture each dragged node's parent rotation at `beginDrag` (via `effectiveTransform(parent)`, `core/doc/derive.ts:144` — parent transforms are stable during a child-only drag), and convert the world delta into parent-local before adding: new pure helper `worldDeltaToLocal(dx, dy, parentRotDeg)` in `src/editor/transformPatch.ts` (rotating by `−parentRot`); thread through `movePatch` or a sibling patch fn. Unrotated view + 90° group: drag right must move the child right in document space. **Add `src/editor/transformPatch.test.ts`** (no test file exists today). Out of scope (flagged adjacent flaw): group+child both selected get no top-level filtering (`nudgeNodes` has it at `editorSlice.ts:438-449`); record as follow-up, don't fix.

**Bug 4 — rotation-only gesture must not resize.** `handleTransformEnd` (`PreviewStage.tsx:1685-1796`): rotation gestures fall into `transformerTargetSize(base, konvaNode.scaleX(), …)` (:1722) where live scale includes the text **shrink display scale** (`ResolvedShape.tsx:211-224` folds `shrinkScale` into the node scale) → 10×1 mm box × 0.5 shrink commits `5×0.5 mm`. Same corruption hits any node with `transform.scale ≠ 1` (inspector scale) — the rotation-only fix covers both. **Fix:** detect rotate-only (the `'rotater'` anchor — `handleTransform` early-returns at `:1642` before `boxOnlyTextRef` is set, so anchor state is the reliable signal) and commit a new pure `rotationOnlyPatch(source, live)` in `transformGesture.ts`: `{ transform: { …source.transform, rotDeg: normalizeRotDeg(live.rotDeg) } }` — no `size`/`points`/`fontSize`. Also apply `normalizeRotDeg` in `transformEndPatch:138`. **While in the seam, verify** the flagged shrink-text **resize** suspicion (:1649-1656 box-only branch multiplies `konvaNode.width()` by `|scaleX|` which includes `shrinkScale`): if a real defect is confirmed (write the failing assertion first), fix by dividing out the shrink scale; if tests at `PreviewStage.interaction.test.tsx:1380/:1415` already pin correct behavior, leave it and report.

**Bug 5 — double-click caret.** `PreviewStage.tsx:1031` passes `gutter, gutter` to `localPointOf`, but `pointer` is already stage-local (gutter is CSS padding on the container) → caret seeded 24 stage-px off; `TextEditorOverlay.tsx:442-443` multiplies `clickLocal` by `session.scaleX` though `clickLocal` is already layout px (scale is re-applied by the wrapper CSS at `:567`) → double zoom/shrink. **Fix:** drop the gutter args at the `localPointOf` call; drop the `* scale` multiply (keep `localPointOf`'s subtract-offsets contract — `TextEditorOverlay.test.tsx:85` pins the helper, change the caller not the helper). **Tests:** the double-zoom is currently unobservable (session fixture `scaleX: 1` at `:284`) — add a `scaleX ≠ 1` caret case asserting `caretFromPoint` receives the unscaled `clickLocal`; extend the `localPointOf` caller coverage (rulers-on dblclick at stage coords, `PreviewStage.interaction.test.tsx:1308-1311`).

## Delegation waves

- **Wave 0 (parallel):** small-coder builds `rotation.ts` + tests (contract above); **A2** (bug 2) — independent files.
- **Wave 1 (parallel, after helper lands):** **A1** (bug 1 inspector: ObjectTab/PopoverSlider/tests) + **A3** (bugs 3+4+5 + canvas rounding: PreviewStage/transformGesture/transformPatch/TextEditorOverlay + tests).
- Then: `review` over the full phase diff → fixes → full suite → commit.

## Files (for the commit message + review scope)

`src/editor/rotation.ts` (new), `src/editor/transformGesture.ts`, `src/editor/transformPatch.ts` (+ new test), `src/components/editor/ObjectTab.tsx`, `src/components/common/PopoverSlider.tsx`, `src/components/editor/EditorKeyboardShortcuts.tsx`, `src/components/editor/PreviewStage.tsx`, `src/components/editor/TextEditorOverlay.tsx`, + the 6 test files.
