# P5 action plan — dithered-view mode (status bar + Q hotkey)

- Parent plan: [`plan.md`](plan.md) §P5 (owner follow-up). Status: **DONE** (2026-10-20) — reviewed,
  committed.
- Goal: a first-class **render mode** in the editor — `normal` or `quantized` (dithered). A status-bar
  control switches it, and **Q** toggles it: tap = toggle, hold = dithered while held, release =
  back to the previous mode. The existing inspector-tune peek stays as-is in normal mode.

## Decisions

1. **State:** session-only store field `renderMode: 'normal' | 'quantized'` (view state, not
   persisted). `setRenderMode(mode)` + `toggleRenderMode()`. Default `normal`.
2. **Hotkey Q wins.** Q is currently the **rectangle tool** default (`storeDefaults.ts:72`); move
   that default to `r`. The render-mode handler runs before the tool-shortcut loop, so a persisted
   user mapping of a tool to `q` can never hijack it (documented precedence). Only a bare `q` (no
   modifiers), not while typing, not while a `<dialog open>` exists, and `event.repeat` ignored.
3. **Tap vs hold:** `RENDER_MODE_HOLD_MS = 300`.
   - keydown (first, not repeat): remember the current mode; start a 300 ms timer.
   - timer fires (still down) ⇒ **peek**: `setRenderMode('quantized')` (a no-op if already there).
   - keyup before the timer ⇒ **tap**: `toggleRenderMode()`.
   - keyup after a peek ⇒ restore the remembered mode.
   - window `blur` while Q is down ⇒ cancel the timer and restore, so a missed keyup cannot stick.
4. **Overlay behaviour:** in `quantized` mode the existing live preview becomes **persistent**:
   it renders without an inspector trigger, re-renders on any document/context/base-dpi change
   (60 ms debounce), does **not** idle-revert, and does not dismiss on a tool change. It still
   dismisses on a document switch until the new raster lands, and (as always) never mutates the
   document. Normal-mode behaviour (trigger on knob change, 1.5 s idle revert, tool-change dismiss)
   is unchanged.
5. **Accepted approximation stays:** the 1 M px budget can still lower the dpi; the chip semantics
   carry over.

## Work items (single wave, one agent)

### W1 — store + hook + status bar + hotkey + i18n

1. `src/store/slices/viewSlice.ts` (or the slice that owns `view`) + `storeTypes.ts`:
   `renderMode`, `setRenderMode`, `toggleRenderMode`; reset on `resetView` if one exists.
2. `src/components/editor/useQuantizedPreview.ts`:
   - option `mode?: 'normal' | 'quantized'` (default `'normal'`), threaded from `PreviewStage`;
   - persistent branch: skip the trigger effect; schedule a debounced render on `doc`/`ctxKey`/
     `baseDpi` changes; no idle timer; no `revertOn` dismiss; still revert on doc-id switch;
   - keep every existing guarantee (supersede tokens, content match, StrictMode, never mutate).
3. `src/components/editor/PreviewStage.tsx`: read `renderMode` and pass it; keep `revertOn`.
4. `src/components/editor/EditorStatusBar.tsx`: a toggle chip in the left group (next to zoom/DPI):
   label `editor.status.renderMode` with the current value (`Normal` / `Dithered`), `aria-pressed`,
   `title` describing "Q — click or tap to toggle, hold to peek", `data-testid="render-mode-toggle"`.
5. `src/components/editor/EditorKeyboardShortcuts.tsx`: the Q tap/hold logic per decision 3, wired
   to the store; `window.blur` cleanup; before the tool loop.
6. `src/store/storeDefaults.ts`: rectangle tool default `q` → `r`.
7. i18n: the status-bar strings + the toggle title. **Single `en.json` writer.**
8. Update `QuantizedPreviewLayer.tsx`'s doc comment (transient vs persistent).

### Tests

- store: default `normal`, toggle/set.
- `EditorKeyboardShortcuts.test.tsx`: tap toggles; hold ≥300 ms shows dithered and release restores;
  hold from dithered restores dithered; repeat ignored; typing target/dialog ignored; `q` no longer
  arms the rectangle tool.
- `useQuantizedPreview.test.tsx`: persistent mode renders with no trigger, stays up past the idle
  window, re-renders on a doc change, hides on a doc switch, and ignores a tool change.
- `EditorStatusBar.test.tsx`: the toggle renders the current mode and flips the store.
- `PreviewStage.test.tsx`: the overlay appears when `renderMode === 'quantized'` with no selection
  (the persistent path), if the existing harness makes that cheap.

## Verify

- `bun.exe run test:run src/components/editor src/store`
- `node node_modules/typescript/bin/tsc --noEmit`; full suite before the commit.

## Review + commit

- `review-fast` (narrow, UI/state change) → fixes → commit
  `feat(editor): dithered-view mode (status bar + Q toggle/hold)`.
- Memory: `dithering.md` §10 (preview modes + the Q shortcut + the rectangle default move),
  `state.md`.

## Outcome (2026-10-20)

- Shipped: session `renderMode` (view slice), status-bar toggle chip, Q tap/hold (300 ms) with the
  configured-key branch before the tool shortcuts, persisted `keyboardShortcuts.quantizedView`
  (default `q`, editable in Settings → Shortcuts → View), rectangle default `q` → `r` with an
  idempotent migration of persisted `tools.rectangle === 'q'`, and the persistent preview mode in
  `useQuantizedPreview`.
- Review round 1 (`review-fast`, CHANGES NEEDED): persisted shortcuts would keep rectangle on `q`
  (added the migration); a chip click during a hold could be undone (restore now requires the peek
  to have applied and the mode to still be the peeked one); a peek could re-apply when the press
  started dithered (now it never writes); Space bindings were rejected by the blank check. All fixed
  with tests; re-review **APPROVE** + the two follow-up nits fixed.
- Verification: full suite **2409 passed / 174 files**, `tsc --noEmit` clean.
- Memory: `dithering.md` §10 (dithered-view mode), `settings-store.md` (migrations).
