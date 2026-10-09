# Phase 4 action plan — Viewport & keyboard

Plan ref: [`plan.md`](plan.md) §P4. Items: arrow-key nudge; zoom desync ("zooming does not
deselect the real view"); touchpad/wheel gesture classification; settings grid-spacing control.

Verified facts (explore 2026-10-10, HEAD `644e24b`):

- `PreviewStage.tsx:909-921` `handleWheel` is a React `onWheel` prop (Konva). It **always zooms**,
  reads only `deltaY`, never `ctrlKey/shiftKey/deltaMode/deltaX`, and writes local `setViewport(zoomAt(...))`
  only — the store's `zoomMode`/`manualZoom` are untouched → the desync.
- Viewport state: local `useState` `viewport` (`PreviewStage.tsx:190`, pan+zoom+rotation). Store mirror
  `viewSlice.ts`: `zoomMode: 'fit'|'real'|'manual'` (:56), `manualZoom` (:58), `setManualZoom` (:60, also
  sets mode `manual`), `setZoomMode` (:59), `effectiveZoom` (:63) written back from `viewport.zoom` (:257-259).
- Target zoom memo `PreviewStage.tsx:246-249` (`resolveZoom`); recenter effect `:252-255`
  deps `[zoom, viewRotation, backing, innerSize]` → `setViewport(centeredViewport(...))`. Toolbar zoom
  (`ViewControls.tsx:52` `step`) and Fit/Real (`:87,:94`) route through the store; wheel does not.
- `viewportController.ts`: `resolveZoom` (:20), `centeredViewport` (:34), `zoomAt` (:45), `steppedZoom` (:62);
  `core/viewport.ts` `clampPan` (:148), `centerPan` (:158). `ZOOM_MIN/MAX = 0.005/4` (`PreviewStage.tsx:58-59`).
- Keyboard: `EditorKeyboardShortcuts.tsx` window `keydown` (once, `getState()`); guards `dialog[open]` (:28),
  `isTypingTarget` (:29), `view!=='editor'` (:35). **No arrow handling anywhere.** Multi-select ops loop
  per-id store actions (`:58,:92`). `storeTypes.ts:204 updateNode` — every committed op = one undo entry;
  `updateNodeTransient` (:564) + `commitDoc` (:587) collapse a gesture into one entry.
- `translateWorldPatch(node, byId, worldDx, worldDy)` (`ObjectTab.tsx:406`) is the canonical world→parent-local
  delta helper (align/tile). World-delta nudge must reuse it.
- `GRID_STEP_HM = 500` (`gridConstants.ts:8`), 5 reads in `PreviewStage` (snap `:394,:542,:635,:695`, overlay
  prop `:1191`); `Overlays.tsx:73/106` takes it as a prop. No other production importers.
- Settings pattern (copy `screenDpi`): type `storeTypes.ts:119-121`; default `storeDefaults.ts:13-16`; setter
  `settingsSlice.ts:63-66`; `partialize` `useStore.ts:140-146`; `PersistedSettings`+`normalize*`+`validate*`+`pick*`
  `preferenceValidation.ts:11,124,137,164`; UI `GeneralSection.tsx` (numeric `<Input>` + draft/commit); i18n
  `settings.general.*` (`en.json:115-130`).
- `PopoverSlider.tsx:137-202` press-hold accelerator (`INITIAL_DELAY 500`, accel after 3 s) — reference only.

## Design decisions (this phase)

### D1 — Arrow nudge (world hm, one undo entry)
- New store action `nudgeNodes(dx, dy)` (world-space hm deltas) in `editorSlice`. Delta steps:
  **1st press 0.1 mm (10 hm) → 2nd 1 mm (100 hm) → 3rd+ 2 mm (200 hm)**. Held key = OS auto-repeat
  (`event.repeat`) supplies the repeats; escalation makes it faster (no custom timer — ponytail; note the
  `PopoverSlider` pattern if OS repeat proves insufficient).
- Handler branch in `EditorKeyboardShortcuts` **after** the `[`/`]` branches, before the tool block:
  `!mod && !alt && !shift` arrow → `preventDefault`; no-op on empty selection; escalation tracked in a ref
  keyed by `event.key`, reset on the arrow's `keyup` (add a `keyup` listener in the same effect).
  The existing `dialog[open]`/`isTypingTarget`/`view` guards cover it.
- `nudgeNodes` moves only **top-level-of-selection** nodes (skip a selected node whose ancestor is also
  selected → no double move) and is a **single undo entry** (apply all patches to one working clone, one `commit`).

### D2 — Zoom desync + recenter
- Wheel routes through the store: after the pointer-anchored `zoomAt` local update, call `setManualZoom(next)`
  so `zoomMode` flips to `manual` (**Real/Fit indicators deselect** — the reported bug) and `manualZoom`
  mirrors the live zoom.
- Add `recenterToken: number` to `viewSlice`; `setZoomMode` bumps it (`setZoomMode: (m) => set((s) => ({ zoomMode: m, recenterToken: s.recenterToken + 1 }))`).
  `setManualZoom` does **not** bump (wheel/toolbar steps must not force a recenter).
- PreviewStage recenter effect: deps `[zoom, recenterToken, viewRotation, backing, innerSize]`; keep a
  `viewportRef` (updated before this effect runs) and a `lastTokenRef`. **Skip** the recenter when
  `!forced && |viewportRef.zoom − zoom| < EPS` — so the wheel's pointer-anchored viewport survives, while
  toolbar steps (viewport.zoom ≠ new zoom) still recenter and Fit/Real (forced by the bumped token)
  **always re-derive/recenter, even when already active**. First render: token unchanged, |1 − fitZoom| ≠ 0 → recenters.

### D3 — Wheel classifier (pure, testable) — **[owner override 2026-10-10]**
Owner manually tested the original heuristic mapping and replaced it with an explicit modifier mapping
(no mouse/touchpad heuristics): plain wheel panned vertically but shift+wheel also panned vertically, so
there was **no horizontal pan** at all. New mapping in `src/editor/wheelIntent.ts`:
```ts
export interface WheelInput { ctrlKey: boolean; shiftKey: boolean; }
export type WheelIntent = 'zoom' | 'pan-horizontal' | 'pan-vertical';
export const classifyWheel = (e: WheelInput): WheelIntent =>
  e.ctrlKey ? 'zoom' : e.shiftKey ? 'pan-horizontal' : 'pan-vertical';
```
- **ctrl + wheel** (and touchpad pinch, reported as `ctrlKey`) → **zoom** (pointer-anchored).
- **shift + wheel** → **horizontal pan** (prefer `deltaX`, else use `deltaY` — a mouse reports the gesture on `deltaY`).
- **plain wheel** → **vertical pan**.
`deltaMode` px-normalisation (line ×16, page ×pane) is kept in the pan branches. Unit-tested; owner re-tested
all four gestures in a real browser. Owner also directed that browser-based tests are done manually from now on.

### D4 — Grid spacing setting
- Persisted `gridSpacingHm` (hm), **default 500 (5 mm)**, clamp 100–5000 hm (1–50 mm). Everything mirrors
  `screenDpi`: `storeDefaults`, `settingsSlice` (+ `resetSettings`), `useStore` `partialize`/`persistedDefaults`,
  `preferenceValidation` (`PersistedSettings`, `normalizeGridSpacingHm`, `validate*`, `pick*`). No legacy migration.
- UI: `GeneralSection` numeric input in **mm** (min 1, max 50, step 1), draft + commit on blur/Enter (mm→hm).
  i18n `settings.general.gridSpacing` + `gridSpacingDescription`. **Update `GeneralSection.test.tsx`** — it
  currently assumes a single `spinbutton`; the new input adds a second.
- Thread: read `gridSpacingHm` in `PreviewStage`; replace all 5 `GRID_STEP_HM` reads (overlay prop + 4 snap
  sites) with it; pass to `<Overlays gridStepHm={…}>`. Handlers must not read a stale value — use the
  component-scope value in deps or `useStore.getState().gridSpacingHm` inside the handler.

## Fan-out (2 waves; single writer per shared file per wave)

### Wave 1 (parallel)
- **W1 `general` — store plumbing + helper extraction.** Owns `storeTypes.ts`, `viewSlice.ts`, `editorSlice.ts`,
  `settingsSlice.ts`, `storeDefaults.ts`, `useStore.ts`, `preferenceValidation.ts`, new `src/editor/transformPatch.ts`,
  `ObjectTab.tsx` (re-export moved helper), `gridConstants.ts` (retire → re-export `DEFAULT_GRID_SPACING_HM`
  as `GRID_STEP_HM`, or delete if grep confirms no importer). Tests: `editorSlice.test.ts`,
  `preferenceValidation.test.ts`, `legacyStorage.test.ts` if touched.
  APIs added: `nudgeNodes(dx,dy)`; `recenterToken` + `setZoomMode` bump; `gridSpacingHm` + `setGridSpacingHm`
  + defaults/validation. **Does NOT touch `PreviewStage.tsx`, `EditorKeyboardShortcuts.tsx`, `GeneralSection.tsx`.**
- **W2 `small-coder` — `src/editor/wheelIntent.ts` + `wheelIntent.test.ts`** (pure; no store, no React).

### Wave 2 (parallel, after Wave 1)
- **W3 `general` — PreviewStage wiring (D2+D3+D4).** Owns `PreviewStage.tsx` (+ `Overlays.tsx` only if needed).
- **W4 `general` — arrow nudge handler (D1).** Owns `EditorKeyboardShortcuts.tsx` + its test.
- **W5 `small-coder` — grid control UI (D4).** Owns `GeneralSection.tsx`, `en.json`, `GeneralSection.test.tsx`.

## Files
- Store/core: `storeTypes.ts`, `slices/{viewSlice,editorSlice,settingsSlice}.ts`, `storeDefaults.ts`,
  `useStore.ts`, `preferenceValidation.ts`, `gridConstants.ts`, new `editor/transformPatch.ts`.
- Components: `PreviewStage.tsx`, `EditorKeyboardShortcuts.tsx`, `settings/GeneralSection.tsx`,
  `ObjectTab.tsx` (re-export), `i18n/locales/en.json`.
- New: `editor/wheelIntent.ts`.
- Tests: `editorSlice.test.ts`, `preferenceValidation.test.ts`, `wheelIntent.test.ts`,
  `EditorKeyboardShortcuts.test.tsx`, `GeneralSection.test.tsx`, PreviewStage/viewport tests as applicable.

## Accept / verify
- `tsc` clean; `bun run test` green (full suite).
- Item 1: arrow moves selection 0.1/1/2 mm on repeats; resets on keyup; bails on dialog/typing/empty; one undo entry.
- Item 2: after a wheel zoom the store `zoomMode === 'manual'` (Real/Fit deselect) and the pointer anchor is
  preserved; clicking Real while already real recenters.
- Item 3: classifier unit cases; browser-check the gestures (mouse wheel, shift+wheel, ctrl/pinch, touchpad pan)
  via `tester` + the browser skill (touchpad is heuristic only — document).
- Item 4: setting round-trips through `ui_settings`; grid overlay + all 4 snap sites follow it; default 5 mm.

## Review
`experimental-review` primary (owner confirmed available), `review-alt` fallback; `review-fast` for narrow
re-review. Max 2 fix rounds.

## Commit
`feat(editor): arrow nudge, viewport zoom sync, wheel gestures, grid spacing setting (#14/P4)`
