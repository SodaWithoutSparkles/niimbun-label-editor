# Action plan — resize fixes (2026-10-08)

Fixes for two known issues in `agent/known-issues/2026-10-06_round-2.md`:
1. "Unexpected behaviours when resizing a rectangle"
2. "Dragging text node should change the text box size and not aspect ratio"

## Root cause (confirmed)

Konva's Transformer mutates the selected node's own `scaleX`/`scaleY` during a
gesture and never resets them. `handleTransformEnd` bakes the magnitude into
document geometry but collapses the doc scale to its sign, and react-konva
(strict mode off) never re-applies the now-unchanged `scaleX`/`scaleY` prop — so
the node renders at `base·k²`. Same mechanism distorts text glyphs and the QR
group. Separately, `resizeNodeGeometry` scales `strokeWidth` on resize, which
the reference app does not.

## Changes

1. `src/components/editor/PreviewStage.tsx` — `handleTransformEnd`: after reading
   the live scales, reset the Konva node to the sign-preserving scale
   (`konvaNode.scale({ x: Math.sign(sx) || 1, y: Math.sign(sy) || 1 })`).
2. `src/core/doc/geometry.ts` — remove `scaleStroke` from every resize branch
   (line/polygon, rect/ellipse, image/qr/barcode); delete the helper.
3. `src/editor/transformGesture.ts` — stop emitting `strokeWidth` from
   `transformEndPatch`.
4. Tests: update `geometry.test.ts` stroke case to assert invariance; add a
   mounted-stage regression in `PreviewStage.interaction.test.tsx` asserting the
   Konva node scale returns to `1` after `transformend` and the doc box updates.

## Out of scope (residual)

- QR side-handle box can still commit non-square; the `contain` raster keeps the
  code's own aspect, so the visible aspect-ratio defect is fixed. A uniform
  all-anchor policy for qr would also change ellipse side-resize — defer.
- `cornerRadius` still scales by the uniform factor (unchanged).

## Verify

- `bun run test` (Vitest) — focused: `src/core/doc/geometry.test.ts`,
  `src/components/editor/PreviewStage.interaction.test.tsx`,
  `src/editor/transformGesture*.test.ts`, `src/store/slices/editorSlice.test.ts`.
- `tsc` via `bun run build` (or `bunx`-free `node_modules/.bin/tsc`).
- Browser smoke: create rect, resize right/corner → edge lands on pointer; text
  resize → glyphs unchanged; line resize → stroke width constant.
