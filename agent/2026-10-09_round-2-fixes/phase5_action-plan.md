# Phase 5 action plan — Text line-wrap options

Plan ref: [`plan.md`](plan.md) §P5. Items: "Text missing line wrap options" + inline WYSIWYG
editing + newlines/overflow surfacing ([round-2 doc](../known-issues/2026-10-06_round-2.md:506-528)).

Verified facts (explore 2026-10-10, HEAD `6dfdf46`):

- `TextNode` (`types.ts:71-87`): `text, fontSize?, fontFamily?, fontStyle?, fontId?, align?,
  letterSpacing?, lineHeight?, direction?`. **No `wrap` / `color` field.** Optional-with-default
  convention: "Absent ⇒ <DEFAULT>" (`types.ts:74-77`).
- `validate.ts:405-421` `case 'text'`: each optional guarded by `isOneOf`/`isString`/`isFiniteNumber`
  → **dropped (absent), never fail**. Enum sets `TEXT_ALIGNS`/`TEXT_DIRECTIONS` at `:82-83`.
- Resolver `resolve.ts:430-447`: emits `ResolvedText { text, placeholder, w, h, fontSize,
  fontFamily, fontStyle, align, paddingHm:0 }`. **Does not read `lineHeight`/`direction`; no wrap.**
- Preview renderer `ResolvedShape.tsx:135-155`: Konva `<Text {...attrs} text width={node.w}
  height={node.h} fontSize fontFamily fontStyle align padding={node.paddingHm} listening={false}
  fill stroke .../>`. **No `wrap`/`lineHeight`/`ellipsis`/`verticalAlign`.**
- Print renderer `konvaFactory.ts:354-367` `case 'text'`: `new Konva.Text({ text,width,height,
  fontSize,fontFamily,fontStyle,align,padding })` + `localTransform`. Same prop set.
- Konva **v10.2** (`package.json:42`). `Text.d.ts` supports `wrap` (`'word'|'char'|'none'`),
  `ellipsis`, `verticalAlign`, `lineHeight`, `getTextWidth()`, `measureSize(text)`, `textHeight`.
- Inspector: `TEXT_FIELDS` (`inspectorModel.ts:118-140`) is data-only; a `select` renders via the
  existing switch and edits through `setString` (`ObjectTab.tsx:607-641`, generic `{[key]:value}`).
  Every field key needs `FIELD_LABEL_KEYS` (`ObjectTab.tsx:61-100`) + an `editor.mfp.field.*` key.
- Inline editor: port `template-webui` `TextEditorOverlay.tsx` + `useTextEditor.ts` (reference, sibling
  repo). Trigger: Stage `onDblClick` (`PreviewStage.tsx:1240-1242`) currently only finishes polygons;
  hit-test via `pointerWorld` + `hitTestWorld` (`PreviewStage.tsx:595`, `viewport.ts:222`) → text node.
  Hide-the-node: skip that `ResolvedShape` in the `resolved.map` loop (`PreviewStage.tsx:1281`).
  Commits via `updateNodeTransient` while typing + `commitDoc()` on finish (mirrors `ObjectTab`).
  Global keydown already bails on `isTypingTarget` (a `<textarea>`), `EditorKeyboardShortcuts.tsx:41`.
- Overflow drop: Konva `Text` with a fixed `height` stops building lines past `maxHeightPx` and
  `ellipsis` is off — lines vanish silently. `\n` is preserved end-to-end (no trim/split).

## Design decisions

### D1 — Model: `TextNode.wrap`
- New optional field `wrap?: TextWrap` where `TextWrap = 'word' | 'char' | 'clip' | 'shrink'`
  (`types.ts`), default `'word'`. Defined in `core/doc/objects.ts` as `TEXT_WRAPS` + `DEFAULT_TEXT_WRAP`
  (single source, mirroring `BARCODE_SYMBOLOGIES`).
- `validate.ts`: `if (isOneOf(value.wrap, TEXT_WRAPS)) node.wrap = value.wrap;` absent ⇒ default.
- Round-trip covered in `validate.test.ts`.
- Mapping to rendering: `word→Konva wrap 'word'`, `char→'char'`, `clip→'word'` + clip at box height
  (`overflow` hidden on the DOM overlay; canvas already clips at box height), `shrink→'word'` + uniform
  downscale (never up) so the **measured** text fits the box.

### D2 — Resolver carries render-ready text fields (preview ≡ print)
- `ResolvedText` gains `wrap: TextWrap` and `lineHeight: number`. `resolve.ts` emits
  `wrap: node.wrap ?? DEFAULT_TEXT_WRAP`, `lineHeight: node.lineHeight ?? 1`.
- Both renderers read them → parity. `lineHeight` also fixes the documented overlay/Konva mismatch
  (overlay must use the node's `lineHeight`, not a hardcoded `1.2`).
- **Shrink (D2a):** computed at the render site by a shared pure helper `measureKonvaText` (new
  `src/editor/render/textMetrics.ts`) that builds a detached `Konva.Text` and reads
  `getTextWidth()`/`textHeight`. `ResolvedShape` uses `useMemo`; `konvaFactory` calls it inline. Both
  apply `scale = min(1, w/tw, h/th)` with `offset {0,0}` + `transformOrigin 'top left'`, so the helper
  is the single source of truth (no drift). Only runs for `wrap==='shrink'`.

### D3 — Inline WYSIWYG editor (port of the reference)
- New `src/components/editor/TextEditorOverlay.tsx` exporting `TextEditorOverlay` (positioned
  `<textarea>`) and `useTextEditor` (session state + start/commit/cancel + store wiring).
- Positioning: `stageRef.getAbsoluteTransform().point({x: node.transform.x, y: node.transform.y})`
  → screen origin; box = `w*zoom` × `h*zoom`; `rotate(rotDeg)` with `transformOrigin 'top left'`.
  Mount inside the stage container (the canvas element is at the container padding-box origin; the
  ruler gutter uses padding so no extra offset — note for the implementer).
- Textarea styling matches Konva: `fontSize*zoom`, `fontFamily`, `fontStyle`, node `lineHeight`
  (not `1.2`), `align`, padding; `overflow:hidden`, `resize:none`.
- **Commit** on blur / `Ctrl+Enter` (one undo entry via `commitDoc`); **Esc cancels** (restores the
  pre-edit doc — see D4) and finishes.
- Triggers: Stage `onDblClick` → hit-test → text node → start session (only when `activeTool==='select'`
  and not already editing). Skip rendering that node while editing; the Transformer attach effect
  re-runs off the callback-ref so it detaches naturally.
- Only **static** text sources open the editor (a CSV/template source is authored in the Object tab);
  non-static nodes are ignored by the dblclick handler.

### D4 — Cancel/undo store seam
- Add one store action `restoreDoc(previous: LabelDoc)`: replaces the current doc and pushes the
  current one to `docPast` (one undo entry), clearing `docFuture` + transient. Reused by the inline
  editor's Esc to undo the live edits in a single entry. (No other store change.)

### D5 — Inspector
- `TEXT_FIELDS` gains `wrap` (`kind: 'select'`, `wired: true`, `options: ['word','char','clip','shrink']`).
- `FIELD_LABEL_KEYS.wrap = 'editor.mfp.field.wrap'`; `en.json` adds the label + four option labels
  (`editor.mfp.wrap.word|char|clip|shrink`). Select edits via existing `setString` generic path.

## Out of scope (unchanged)
- `letterSpacing`, `direction`, `textColor` stay unwired (per `inspectorModel.ts:132-139` comment).
- `verticalAlign`: `<textarea>` has no vertical centering; the reference's `verticalAlign:'middle'`
  is a no-op too. Konva default is top — document the (top-aligned) parity, do not add a field.
- Auto-grow: not a wrap mode; shrink + clip cover the overflow ask.

## Fan-out (3 waves; single writer per file per wave)

### Wave 1 (parallel)
- **W1 `general` — wrap model + render pipeline.** Owns `core/doc/types.ts`,
  `core/doc/objects.ts`, `core/doc/validate.ts`, `editor/render/resolve.ts`,
  `components/editor/ResolvedShape.tsx`, `editor/render/konvaFactory.ts`, new
  `editor/render/textMetrics.ts`, `editor/inspectorModel.ts`, `components/editor/ObjectTab.tsx`
  (FIELD_LABEL_KEYS only), `i18n/locales/en.json` (text-wrap keys only). Tests: `validate.test.ts`,
  `resolve.test.ts`, `inspectorModel.test.ts`, `konvaFactory.test.ts` + a new per-mode render test
  (assert `wrap`, `getTextWidth()` ≤ box for word, `textHeight` overflow for the overflow case,
  shrink scale ≤ 1 / fits).
- **W2 `general` — inline editor unit.** Owns new `src/components/editor/TextEditorOverlay.tsx`.
  Exports `TextEditorOverlay` + `useTextEditor`; consumes `restoreDoc` (D4) + `updateNodeTransient`/
  `commitDoc`; reads node geometry itself. **Touches no shared file.**
- **W3 `small-coder` — `restoreDoc` store action.** Owns `store/storeTypes.ts`,
  `store/slices/editorSlice.ts`, `store/slices/editorSlice.test.ts`. W2 depends on this (same wave →
  W2 may hit `tsc` red until it lands; acceptable, not a blocker).

### Wave 2 (after W1+W2)
- **W4 `general` — PreviewStage wiring.** Owns `components/editor/PreviewStage.tsx` +
  `PreviewStage.interaction.test.tsx`. Dblclick handler, `editingTextId` state, skip the edited node,
  mount `TextEditorOverlay`. Test: fire dblclick on a text node → overlay `<textarea>` appears
  (feasible: existing harness fires `dblclick` with `detail:2`, DOM is queryable).

### Wave 3 — verify
- **tester** — focused render tests per mode through `renderLabelPage`/`konvaFactory`; run `tsc` + the
  text-related suites.

## Accept / verify
- `tsc` clean; `bun run test` green.
- Each wrap mode: word wraps at the box, char breaks per character, clip cuts at the box (no
  `ellipsis` glyph), shrink fits (uniform scale ≤ 1, never upscales).
- Round-trip: `wrap` survives `validate`; invalid value drops to absent.
- Dblclick a text node → textarea overlays it with matching font/size/rotation; typing updates the
  node live; blur/Ctrl+Enter commits one undo entry; Esc discards (one undo restores the old text).
- Newlines enterable via the inline editor; overflow no longer looks broken under clip/shrink.

## Review
`review` primary (owner instruction), `review-alt` fallback, `review-fast` for narrow re-review.
Max 2 fix rounds.

## Commit
`feat(editor): text wrap modes (word/char/clip/shrink) + inline text editor (#P5)`
