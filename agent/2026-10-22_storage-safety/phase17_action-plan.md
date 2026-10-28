# Wave 3 · Phase 17 — `clip` semantics + a real `cut` mode (D-42)

- Date: 2026-10-29
- Baseline: `main` @ P16 commit
- Owner decision (2026-10-29): **keep `clip` as shipped** (wrap at words, hide
  lines past the box height) and **add a fifth mode `cut`** (no wrapping, hard
  cut at the box edge). No existing document changes rendering.
- Reviewer: `review`
- Commit: `feat(text): add a no-wrap cut mode and settle the clip contract`

## Failure mode (confirmed)

Two docs disagree and the code follows one of them:

- `src/core/doc/objects.ts:50-55` + `konvaFactory.ts:108-110`: `clip` wraps at
  words and **hides lines past the box height** — this is what ships
  (`konvaTextWrap` maps `clip → 'word'`; Konva's fixed height drops the rest).
- `src/core/doc/types.ts:127-132`: `clip` = **no wrap, cut at the box**.

`types.ts` is wrong about the shipped behaviour, and there is no mode that does
what it describes. Owner picked: fix the doc, add `cut`.

## Design (fixed)

### 1. Contract (`objects.ts`, `types.ts`, i18n, inspector)

- `TEXT_WRAPS = ['word', 'char', 'clip', 'shrink', 'cut']`.
- `clip`: wraps at words, hides lines past the box height (unchanged behaviour).
- `cut`: **no wrapping**; one line per hard `\n`, each cut at the box edge; no
  ellipsis, no growth, no shrink.
- `en.json` `editor.mfp.wrap.cut` = `"Cut at box edge"`.
- `ObjectTab`'s `WRAP_LABEL_KEYS` gains `cut` (the `satisfies Record<TextWrap,
  string>` makes the missing key a tsc error).
- `inspectorModel.ts:126` options list gains `'cut'`.

### 2. Renderers

`konvaTextWrap` (`konvaFactory.ts:113`) returns `'word' | 'char' | 'none'`:
`char → 'char'`, `cut → 'none'`, everything else `'word'`.

A Konva `Text` with `wrap: 'none'` does **not** clip: a long line overflows the
box. So a `cut` node is drawn inside a clipping group, in both renderers:

- `konvaFactory`: build the Text without the node transform, wrap it in
  `new Konva.Group({ clipX: 0, clipY: 0, clipWidth: node.w, clipHeight: node.h })`
  and apply the node transform to the group (`withTransform`), so the clip is in
  the node's local space.
- `ResolvedShape`: the same structure with react-konva
  (`<KonvaGroup clipX={0} clipY={0} clipWidth={node.w} clipHeight={node.h} {...attrs}>`).
- Every other wrap mode keeps its current node structure (no group).
- The raster, the policy mask (`paintCoverage`) and thumbnails inherit the clip
  through `createKonvaNode`, so print and preview agree.

### 3. Inline editor

- `wrapStyle('cut')` → `{ whiteSpace: 'pre', overflowWrap: 'normal' }` (the base
  textarea is `pre-wrap`; the later spread wins), so the textarea itself cuts at
  the box instead of soft-wrapping.
- `wrappedLineStarts(ctx, text, width, font, wrap)` — with `cut`, break **only**
  on hard `\n` (no soft breaks at the width), so caret lines and `caretFromPoint`
  stay correct for a single long line.
- The overlay geometry (P14's inner box) is unchanged.

### 4. What is explicitly *not* done

- No new warning kind for cut/clip content loss (the warning centre has no
  text-overflow producer). Logged as debt D-72 rather than smuggled into this
  phase.
- `shrink` measurement is untouched (`cut` never shrinks).
- No migration: old documents have no `cut` value, and `clip` renders as before.

## Files

| File | Change |
| --- | --- |
| `src/core/doc/objects.ts` | `TEXT_WRAPS` + contract doc |
| `src/core/doc/types.ts` | `wrap` doc (clip fixed, cut added) |
| `src/editor/render/konvaFactory.ts` | `konvaTextWrap` → `'none'`; clip group for `cut` |
| `src/components/editor/ResolvedShape.tsx` | clip group for `cut` |
| `src/components/editor/TextEditorOverlay.tsx` | `wrapStyle`, `wrappedLineStarts` |
| `src/editor/inspectorModel.ts`, `src/components/editor/ObjectTab.tsx`, `src/i18n/locales/en.json` | the new option |
| `src/store/*` / `settings` | none |

## Tests

- `src/editor/render/konvaFactory.test.ts` — `cut` maps to Konva `wrap: 'none'`;
  the node is a clipping group (`clipWidth === node.w`, `clipHeight === node.h`)
  holding the Text; `clip` still produces a `'word'` Text with no group; a cut
  text is **not** shrunk (`scaleX === 1`).
- `src/components/editor/ResolvedShape.test.tsx` — the same structure for `cut`.
- `src/editor/render/renderLabelPage*.test.ts` — a raster with `cut` keeps ink
  inside the box (a long string does not paint past `node.w`), and a `clip` node
  keeps only the lines that fit.
- `src/components/editor/TextEditorOverlay.test.tsx` — `cut`: the textarea style
  is `white-space: pre` and `wrappedLineStarts` returns only the hard-`\n` line
  starts (no soft break); `clip` keeps word wrapping.
- `src/core/doc/validate.test.ts` — `'cut'` round-trips; an unknown wrap is still
  dropped.
- `src/editor/inspectorModel.test.ts` — the options list includes `cut`.

Gate: full suite + `tsc --noEmit`.

## Risks

| Risk | Mitigation |
| --- | --- |
| `wrap: 'none'` overflowing the box unnoticed | The clip group is the invariant, and a raster test pins ink inside the box |
| Existing labels change rendering | `clip` keeps its exact behaviour; `cut` is a new persisted value only |
| The clip group breaks transforms/rotation | Clip lives inside the node transform (`withTransform` / group attrs), so rotation and scale compose as before |
| Caret drift on a long cut line | `wrappedLineStarts` gets an explicit no-soft-break branch, tested |
