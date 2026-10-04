# Phase 3 Handoff — Editor core (M2/M3)

**Run:** `agent/2026-09-29_label-editor-v1` · **Written:** 2026-10-04 · **Owner:** Coordinator
**Plan:** `plan.md` (P3 row) · **Action plan:** `phase3_action-plan.md` · **UI spec:** `ui-spec.md`

## Outcome

P3 delivers an **editable, reloadable** label editor: the full engine (viewport,
document operations, undo/redo, render path, node geometry) + the owner-designed shell
(insert rail, preview, view controls, layers, MFP), built on the P2 document/storage layer.

**Exit criterion:** open F-tag from gallery → add text + shape → move/transform →
undo/redo → reload → persists.
- Headless: covered by `editorSlice`/`viewport`/`geometry`/`transformGesture` tests.
- **Headed (verified 2026-10-04, `ab` on localhost:5173):** open F-tag → insert text →
  author "Hello P3" → renders on canvas → **reload → reopen → the text layer persists**.
  White region-union silhouette renders correctly (flag/tail/spare outline, no internal
  seams, non-label area stays background).

## Commits (P3)

| Commit | Content |
| --- | --- |
| `da6d4c8` | `feat(editor)`: viewport engine, render path, selectors/inspector, selection slice, node geometry |
| `ba6efb3` | `feat(editor)`: document ops, snapshot undo/redo, debounced IDB autosave |
| `b130879` | `fix(editor)`: geometry resize/validate edge cases + `resizeNode` action |
| `9caa18e` | `feat(editor)`: editor shell, insert rail, preview, layers, MFP (W5) |
| `3cd7270` | `refactor(editor)`: strip legacy drawing app, doc-aware save, View menu (W6) |
| `c2da182` | `fix(editor)`: P3 gate must-fix round (transform, text authoring, overlays) |

## Gate record

Three-way final review (`review`, `review-alt`, `experimental-review`) on the whole P3
diff — **all CHANGES-REQUESTED** on the first pass. Findings fixed in `c2da182`:

- Preview obscured: white union silhouette filled black + overlay layer painted over the
  scene. **Fixed** (`ctx.fillStrokeShape` + overlay renders first).
- Transform handles were a silent no-op / dropped gesture translation. **Fixed**.
- No text-authoring field (inserted text stayed empty). **Fixed** (+ undo batching).
- reparent/ungroup lost world transform; shape-kind change produced empty geometry.
- pan unclamped; sibling snapping unwired; autosave flush ordering inverted; unmount
  dropped transient edits; layers `inheritedLocked` inverted; MFP duplicated visible/lock.
- W6 leftovers contradicting "trimmed to the live surface" (ColorPreset, dead history,
  stripped-tool shortcut rows). **Removed.**

Re-review of `c2da182` in flight at handoff (see `state.md`).

## Architecture installed (P4+ builds on this)

- `src/core/viewport.ts` — bounded fit-to-viewport world↔screen, view-only 0|90 rotation,
  pan clamping, `HitTestable {id,bounds(world AABB),visible,locked}` hit-test, snap candidates.
- `src/core/doc/{geometry,types,validate,factory}.ts` — node geometry model (§13 of the
  action plan): base `size {w,h}` + per-kind extras; `resizeNodeGeometry` (aspect-preserving
  default for circle/ellipse/QR/image); `meta.presetId`.
- `src/editor/render/` — `resolve(doc)` (static content), `konvaFactory` (**plain Konva**,
  no consumer yet — P4 print raster's first user per decision 9), `regionOverlay`
  (`regionUnionPath` nonzero union), `guides` (F-tag score line vertical `(1250,0)→(1250,3800)`).
- `src/editor/{insertActions,selectionModel,viewportController,transformGesture,selectors,inspectorModel}.ts`.
- Store: `editorSlice` (ops + transient/commit + undo/redo + autosave), `docSlice`
  (`saveCurrentLabel`, view-orientation), `viewSlice`, `toolsSlice` (one-shot), `selectionSlice`.
- `src/components/editor/*` — the shell per `ui-spec.md`.

## Carry into P4 (non-blocking)

- `createKonvaNode` (konvaFactory) has no production consumer; P4's print raster wires it.
  Editor uses react-konva `ResolvedShape`; keep the editor/print paths separate (decision 9).
- `regionUnionBounds` has no production consumer yet; P4 clip wants the union.
- `ResolvedShape` renders `image`/`qr`/`barcode` blank (P5 engines).
- Score-line guide coordinate is owner-pinned; if the real fold differs, change the single
  constant in `guides.ts`.
- `PreviewStage` has no unit tests (browser-only surface per `memory/testing.md`) — keep the
  headed check for pointer/transform changes.
- P4 MUST clip with **nonzero winding** (plan.md:187) — the F-tag regions overlap on purpose.
- **P4 must use `ImageEncoder.encodeCanvas`**, not a hand-built `rowsData`.

## Open items logged (not blockers)

- i18n: some select option labels still render raw values (`left`/`italic`) — translate in a
  later sweep; dead i18n keys pruned but a couple of catalogue entries may remain.
- `deleteLabel` has no UI caller (pre-existing P2 gap) and `deleteFailed` key is unused.
- Ctrl+D/Delete over N nodes = N undo entries (nit).
- `docsEqual` is a full `JSON.stringify` per gesture end (nit; fine at P3 sizes).
