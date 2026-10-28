# Wave 3 · Phase 16 — Persistent dither settings invalidation

- Date: 2026-10-29
- Baseline: `main` @ P19 commit
- Reviewer: `review-fast`
- Commit: `fix(dither): repaint the preview when the quantizer defaults change`

## Failure mode (confirmed)

`useQuantizedPreview` threads `quantizerDefaults` / `defaultQuantizerByType`
into the render plan (`quantityPreviewOptions`, `planNow`) **by ref only**, and
neither scheduling effect depends on them:

- persistent (`mode === 'quantized'`): deps
  `[enabled, mode, doc, ctxKey, baseDpi, revert, clearTimers, runRender]`;
- normal (peek): the same plus the trigger.

So changing the per-strategy/per-type defaults in the Rendering settings leaves
the painted dithered overlay — and, in persistent mode, the whole view — showing
the previous defaults until some unrelated edit re-runs the effect. `painted`'s
identity check (`sameContent`) does not compare them either, so a raster that is
up stays up.

The trigger must stay settings-free (owner decision D-59: the settings modal
covers the canvas, so settings changes must not *arm* a peek). This phase only
makes an **existing** raster invalidate.

## Design (fixed)

1. `const settingsKey = useMemo(() => quantizerSettingsKey(options.quantizerDefaults, options.defaultQuantizerByType), [options.quantizerDefaults, options.defaultQuantizerByType]);`
   (`quantizerSettingsKey` is the order-independent string already used by
   `previewOptionsKey`; a fresh-but-equal object yields an equal string, so it
   cannot churn the effects).
2. `RenderedContent` gains `settingsKey: string`; set from the plan's inputs when
   a raster is rendered; `sameContent` compares it (a settings change between
   plan and paint must not paint); the normal-mode **non-trigger** branch hides
   a painted raster whose `settingsKey` differs (same rule as `doc`/`ctxKey`/
   `baseDpi`).
3. Add `settingsKey` to **both** effects' dependency arrays:
   - persistent: a settings change repaints (debounced, like a content change);
   - normal/peek: a settings change never starts a render (`previous.key ===
     trigger.key` still holds) — it only hides a stale raster. D-59 preserved.
4. No changes to `quantizedPreviewTrigger`, `quantizedPreviewOptions` or
   `previewOptionsKey` — the settings are already part of `previewOptionsKey`.

## Files

| File | Change |
| --- | --- |
| `src/components/editor/useQuantizedPreview.ts` | `settingsKey`, `RenderedContent.settingsKey`, `sameContent`, both dep arrays, hide rule |
| tests | below |

## Tests

`src/components/editor/useQuantizedPreview.test.tsx`:
- persistent mode: a changed `quantizerDefaults` (e.g. `threshold.gamma`) triggers
  a second render; a **fresh equal** object triggers none (value, not identity);
- normal mode: after a peek is painted, a settings change hides the overlay and
  renders nothing new;
- normal mode: an unarmed peek (nothing painted) plus a settings change renders
  nothing (the existing "does not render when the per-strategy settings change"
  case must stay green — it now also proves D-59);
- `sameContent`: a settings change between plan and paint prevents the paint
  (simulate by changing the prop while the render promise is pending).

## Risks

| Risk | Mitigation |
| --- | --- |
| Settings change arms a peek (D-59 regression) | The trigger key is untouched; only the hide rule and the dep arrays change |
| Effect churn on every render | The dep is a **string** (`quantizerSettingsKey`), not the maps |
| A repaint loop (render → prop identity changes) | `PreviewStage` passes store values; a stable string can only change when the settings do |
