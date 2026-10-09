# Phase 3 action plan — Selection & resize semantics

Plan ref: [`plan.md`](plan.md) §P3. Items: QR side-handle aspect; broken duplicate / bulk-select
drag (H2); mixed-selection alignment (tiling); text live-resize glyph aspect (owner-decided).

Owner decision 2026-10-10: **text live-resize = "box-only live"** — during a drag the glyphs keep
their size and only the box resizes/reflows; live == commit (same philosophy as the stroke-width
fix). Not the reference corner-`keepRatio` option.

## Deliverables

### 1. QR (and image/ellipse) side-handle lock — corners only
`PreviewStage.tsx` `<Transformer>` (`:1091`): `enabledAnchors` = the four corners when
`selectedNodesPreserveAspect` (single qr/image/ellipse), else `undefined` (Konva default = all 8).
Corners = `['top-left','top-right','bottom-left','bottom-right']`. A side handle can then never
commit a non-uniform box. **Text stays free (all 8 anchors) — text is not aspect-default.**
**Do NOT touch** the `isCornerAnchor` gate in `commitPreservesAspect` (`transformGesture.ts:211-222`)
— it guards the #13 release-snap (R2).

### 2. Keep-out false positive on letterboxed symbols (defensive)
`nodesIntersectNonPrintable` (`regionOverlay.ts:243`) samples raw box corners, so a `contain`-fitted
symbol/image whose box exceeds its content falsely trips "outside the printable area".
- New pure helper in `resolve.ts` (next to `nodeLocalPoints`): `nodeDrawnLocalPoints(node, assetSize?)`
  returning the **contain-fit rect** corners for `image`/`qr`/`barcode`, else `nodeLocalPoints(node)`.
  `assetSize` = `{widthPx,heightPx}`; **qr defaults to square** (`{1,1}`) when absent; image/barcode
  fall back to the raw box when absent.
- `nodesIntersectNonPrintable(doc, assetSizes?: ReadonlyMap<string,{widthPx,heightPx}>)` uses it.
- **Wiring:** `PreviewStage.tsx:273` builds the size map from `assets` (`PreparedAsset.widthPx/heightPx`,
  keyed by node id) and passes it; add `assets` to the memo deps.
- Leave `nodeLocalPoints` itself unchanged (it feeds resolve bounds used by hit-test/marquee/align —
  changing it is out of scope and risky).

### 3. Duplicate → select the clones (H2)
`cloneNode` returns the new root id but callers ignore it.
- `Header.tsx:58` `editClone` and `EditorKeyboardShortcuts.tsx:54-58` (Ctrl/Cmd+D): collect the
  returned ids, `selectNodes(newIds)` (replaces selection ⇒ source deselected automatically).
- Keep the per-node loop (multi-selection duplicates each root).

### 4. Preserve multi-selection on drag (H2 / R3)
Pointer-down on an already-selected node must move the whole selection; collapse to `[hitId]` only on
a click **without** drag.
- New pure helper in `selectionModel.ts`: `pointerDownSelection(current, hitId, additive)` →
  `{ selection, collapseTo: string | null }`:
  - `hitId === null` → additive keeps, else `[]`; `collapseTo: null`.
  - additive → toggle (unchanged); `collapseTo: null`.
  - non-additive + `hitId ∈ current` → `selection = current`, `collapseTo = hitId`.
  - non-additive + not in current → `selection = [hitId]`, `collapseTo: null`.
  Re-implement `selectionAfterClick` in terms of it (`.selection`) so existing tests stay green.
- `PreviewStage.tsx` (`handlePointerDown`, `:524-536`): use the helper; `beginDrag(world, selection)`
  when not additive. Record `collapseTo` **and** a `moved` flag in the drag state.
- `handlePointerMove` drag branch (`:596`): set `moved = true` when displacement exceeds a small
  screen-px threshold (≈3 px → /`viewport.zoom`), so OS jitter on a click does not count as a drag.
- `finalizeGesture` (`:672`): if the drag had `collapseTo` and never moved → `selectNodes([collapseTo])`.
  Keep shift-click semantics (additive branch) intact. `must-fix #5` rule (release over MFP must not
  clear a fresh selection) still holds — this only fires for a captured drag candidate.

### 5. Tile vertical / horizontal (ObjectTab)
- Extract the world-delta → parent-local conversion from `alignTransformPatch` (`ObjectTab.tsx:367`)
  into a small `translateWorldPatch(node, byId, worldDx, worldDy)` and reuse it in both.
- New `tileTransformPatch(node, byId, targetWorldX, targetWorldY)` (or a `tileLayout(nodes, byId,
  axis, gapHm)` returning per-id target world top-left). Sorting is the caller's job.
- `ObjectTab` `tile(axis)` handler next to `align` (`:833`): order selected by center (`cy` for
  vertical, `cx` for horizontal); anchor = the first node keeps its position; place each next node
  adjacently with a fixed `TILE_GAP_HM` (1 mm = 100) gap; cross-axis aligned to the anchor's bounds
  edge. Commit via `updateNode(id, patch)` like `align`.
- Add two buttons in the Align section; i18n `editor.mfp.tileVertical` / `editor.mfp.tileHorizontal`
  (en.json, near `editor.mfp.align*`).

### 6. Text live-resize = box-only live (owner-decided)
`<Transformer keepRatio={selectedNodesPreserveAspect}>` stays `false` for text (text is not
aspect-default). Implement the Konva "resize without scaling" recipe so a live text drag changes the
**box only** (glyphs constant, text reflows live) and live == commit:
- Transformer `onTransform`: when the selection is a single text node, read the live scale magnitudes
  from the base extent, set the Konva node's imperative `width`/`height` to `base × |scale|`, and reset
  the node scale to its **sign** (preserve flip). Set a `boxOnlyTextRef` flag.
- `handleTransformEnd` (`:900-960`): when `boxOnlyTextRef` is set (single text source), derive the
  commit `target` from the node's live `width()/height()` instead of `base × scale`; keep
  `fontSize` unchanged (it already is). Position/rotation still read from the Konva node.
- **Fallback:** if the recipe proves unstable (rotation/jitter), report back with findings instead of
  forcing it — do not degrade the other items.

## Files
- `src/components/editor/PreviewStage.tsx` (items 1, 2 wiring, 4, 6)
- `src/editor/selectionModel.ts` (item 4)
- `src/editor/render/resolve.ts`, `src/editor/render/regionOverlay.ts` (item 2)
- `src/components/layout/Header.tsx`, `src/components/editor/EditorKeyboardShortcuts.tsx` (item 3)
- `src/components/editor/ObjectTab.tsx`, `src/i18n/locales/en.json` (item 5)
- Tests: `PreviewStage.interaction.test.tsx`, `selectionModel.test.ts`, `regionOverlay.test.ts`,
  `editorSlice.test.ts` / `EditorKeyboardShortcuts.test.tsx`, `ObjectTab.test.tsx`.

## Test matrix (R3)
- select A+B → pointer-down on A, move → both move; pointer-up.
- select A+B → plain click on A (no move) → selection collapses to `[A]`.
- shift-click toggles membership (unchanged).
- duplicate a selection → clones are selected, source deselected; drag one clone → both clones move.
- qr/image single selection → only 4 corner anchors; text → 8 anchors; free-stretch text box, glyphs
  constant (assert live glyph scale stays ±1 during the gesture).
- keep-out: a letterboxed qr/image inside a region no longer warns; a genuinely outside node still does.
- tile vertical/horizontal ordering + gap + idempotence.

## Review
`experimental-review` primary (re-check availability 2026-10-10), `review-alt` fallback; max 2 fix rounds.

## Commit
`feat(editor): selection & resize semantics — corner anchors, multi-select drag, clone select, tiling (#14/P3)`
(`fix(editor): text live-resize keeps glyph size` folded in if item 6 lands).

## Fan-out
- **Wave 1 (parallel, disjoint files):**
  - Worker A (`general`): items 1, 4, 6 + `selectionModel.ts` (owns `PreviewStage.tsx`).
  - Worker B (`general`): items 3 + 5 (`Header.tsx`, `EditorKeyboardShortcuts.tsx`, `ObjectTab.tsx`, i18n).
- **Wave 2 (after A frees `PreviewStage.tsx`):** item 2 keep-out (`resolve.ts`, `regionOverlay.ts`,
  `regionOverlay.test.ts` + the `keepOutIds` wiring in `PreviewStage.tsx`).
