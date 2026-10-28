# Wave 3 · Phase 14 — `shrink` text loss (D-42)

- Date: 2026-10-28
- Baseline: `main` @ `0996c0e` (P15)
- Reviewer: `review` (logic-heavy — renderer + overlay geometry)
- Commit: `fix(text): keep every wrapped line when shrink scales the box`

## Failure mode (confirmed)

`shrink` measures the text **without** a fixed height, then scales the node down
(`measureKonvaText`: `scale = min(1, w/measuredW, h/measuredH)`). But both
renderers construct the `Konva.Text` with `height: node.h` **and then** multiply
the node scale:

- `src/editor/render/konvaFactory.ts:373-402` (print/raster)
- `src/components/editor/ResolvedShape.tsx:98-111, 156-185` (preview)

Konva lays out into a fixed height and **drops** every line that would pass it
(`node_modules/konva/lib/shapes/Text.js:426-428`, `break`, not clip). So the text
that should fit *after* scaling is truncated *before* scaling: a shrink text
prints fewer lines than the measurement proved fit, and preview/print only agree
because they share the bug.

Second half: the inline editor never shrinks. `TextEditorOverlay` renders a
`<textarea>` at the **natural** font size inside the node box and hides the
overflow (`overflow: 'hidden'`), while its wrapper transform was captured from
the live Konva node — i.e. it carries the *open-time* shrink factor and scales
the whole box, including its width. So a shrink node edits as a clipped box at
the wrong size, and every keystroke can change the correct shrink without the
overlay noticing.

## Design (fixed)

### 1. One shrink helper

Add to `src/editor/render/textMetrics.ts`:

```ts
export interface ShrinkableText {
    text: string; width: number; height: number; fontSize: number;
    fontFamily: string; fontStyle: string; lineHeight: number;
    letterSpacing?: number;
}
/** `shrink`-only uniform factor; `1` for any text that already fits. */
export const shrinkScaleOf = (text: ShrinkableText): number =>
    measureKonvaText({ ...text, wrap: 'word' }).scale;
```

`konvaFactory`, `ResolvedShape`, `TextEditorOverlay` and `PreviewStage` all use
it, so the four never drift.

### 2. Relax the layout box before scaling (the print bug)

When `wrap === 'shrink'`, lay out in the **unscaled** box — `height = node.h / scale` —
then apply `scaleX *= scale`, `scaleY *= scale` as today. `measureKonvaText`
proves `measuredH × scale ≤ h`, so `h / scale ≥ measuredH`: no line can hit the
fixed-height break. Width stays `node.w` (the measurement wraps at `node.w`).
A degenerate `scale === 0` (zero-width or zero-height box) falls back to
`height = node.h` — never divide by zero, never emit `NaN`/`Infinity` geometry.

- `konvaFactory.ts`: compute the shrink factor **before** `new Konva.Text`
  (today it is computed after) and pass `height: node.h / shrink`.
- `ResolvedShape.tsx`: pass `height={node.h / shrinkScale}` to the `<Text>`.
- `shrink !== 1` only; a non-shrink text keeps `height: node.h` byte-identically.

### 3. Overlay: shrink the content, not the box

- `TextEditorSession` gains `letterSpacing?: number` (default `0`) so the live
  measurement matches the renderer; `PreviewStage` passes `node.letterSpacing`.
- `TextEditorOverlay` computes `shrink = wrap === 'shrink' ? shrinkScaleOf({ text: session.text, width: unscaledWidth, height: unscaledHeight, fontSize, fontFamily, fontStyle, lineHeight, letterSpacing }) : 1`,
  memoised on those values.
- Render the textarea inside an inner box of **`unscaledWidth × (unscaledHeight / shrink)`**
  with `transform: scale(shrink)`, `transformOrigin: 'top left'`. Width stays the
  node width (natural wrap), height admits every natural line *before* the scale.
  The textarea keeps its **natural** font size, `letterSpacing` and
  `width/height: 100%`, so:
  - Konva lays the text out at `width = node.w` with the natural font and then
    scales the result by `shrink` — the inner box reproduces exactly that layout
    and then the same single scale;
  - `contentWidth` (`ta.clientWidth`) stays `node.w`, the width Konva wrapped
    into;
  - the visible text block is `node.w × shrink` wide and up to `node.h` tall —
    it sits *inside* the node box, which is what shrink-to-fit looks like on the
    canvas;
  - caret/caret-rect math stays in layout px (natural font); the caret's
    device-pixel rounding must include `shrink`, because the inner transform
    scales the bar too.
  - the textarea carries the node's `letter-spacing`, so the editor's wrap and
    glyph spacing match Konva's `letterSpacing`.
- `shrink === 1` must render byte-identically to today (guard the inner box away
  or use `scale(1)` — assert no style change in the existing tests).

### 4. PreviewStage: don't double-apply the shrink

The overlay transform is captured from the live Konva node, whose `scaleX/scaleY`
already include the `ResolvedShape` shrink. Divide it out:

```ts
const shrink = node.wrap === 'shrink' ? shrinkScaleOf({...}) : 1;
const scaleX = (Math.hypot(nodeM[0], nodeM[1]) || 1) / shrink;
const scaleY = (Math.hypot(nodeM[2], nodeM[3]) || 1) / shrink;
```

The overlay then owns the shrink (live), and the box renders at its true size.

Non-goals: `clip` semantics (P17), `verticalAlign`, any new warning kind, any
change to `wrappedLineStarts`/`caretFromPoint` (they keep working in layout px).

## Files

| File | Change |
| --- | --- |
| `src/editor/render/textMetrics.ts` | `ShrinkableText` + `shrinkScaleOf` |
| `src/editor/render/konvaFactory.ts` | measure before build; relax `height` |
| `src/components/editor/ResolvedShape.tsx` | same via `shrinkScaleOf` |
| `src/components/editor/TextEditorOverlay.tsx` | live shrink, inner scaled box, `letterSpacing` |
| `src/components/editor/PreviewStage.tsx` | pass `letterSpacing`; divide the captured scale by the shrink |

## Tests (must exist before done)

- `src/editor/render/konvaFactory.test.ts` — a `wrap: 'shrink'` text whose natural
  layout is 3 lines in a box that needs ~0.5 scale keeps **3 lines** (assert via
  `text.textArr.length` / `getTextHeight()` after layout) and its `height()` is
  the relaxed box (`node.h / scale`); the same node without `shrink` still drops
  the extra lines (the fixed-height behaviour is unchanged for non-shrink wraps).
- `src/components/editor/ResolvedShape.test.tsx` — the `<Text>` gets the relaxed
  `height` and a `scaleX === scaleY < 1`.
- `src/components/editor/TextEditorOverlay.test.tsx` — overflowing shrink text:
  the inner box carries `transform: scale(s)` with `0 < s < 1`, keeps the node
  box size (`unscaledWidth × unscaledHeight`, so the visible text block is
  `node.w × s`), and the textarea font size stays natural; a fitting text leaves
  the DOM style unchanged (shrink 1). Caret: the synthetic caret geometry is
  unchanged for a fitting text.
- `src/components/editor/PreviewStage.interaction.test.tsx` — double-clicking an
  overflowing shrink text yields a session whose `scaleX` is the canvas scale
  **without** the shrink factor (assert the wrapper's width/height/scale).
- Regression guard: the existing shrink tests in `konvaFactory.test.ts:446-551`
  and `ResolvedShape.test.tsx:237-247` must stay green (they only assert
  `0 < scale ≤ 1` and the width budget).

Gate: full `bun run test` + `tsc --noEmit`.

## Risks

| Risk | Mitigation |
| --- | --- |
| Relaxed height changes non-shrink layout | The `height / scale` box is applied **only** when `wrap === 'shrink'` |
| Overlay wrap still differs from Konva | Natural font + natural box width now match the measurement input; assert in the overlay test |
| Double-shrink after the PreviewStage change | `PreviewStage` divides the captured scale; the overlay applies `shrink` exactly once (session has no shrink field) |
| Caret drifts | All caret math stays in layout px with the natural font; only the inner box is transformed |
