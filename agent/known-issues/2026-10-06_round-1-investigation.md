# Known issues — round 1 investigation

- Date: 2026-10-06. Companion to [`2026-10-06_round-1.md`](2026-10-06_round-1.md) (owner UI-test backlog, 14 items).
- Method: 7 parallel read-only `explore` agents (CTO dispatch, one per area). All receipts cited `file:line` were verified by reading code.
- **Excluded:** "False clipping reminder" (#4) = **D-31**, fixed in-flight (uncommitted WIP: `hasInkBeyondPrinthead` + PrintDialog wiring). Also **D-30** (printDirection control) is in the same WIP. Several fixes below add i18n keys to `src/i18n/locales/en.json`, which that WIP also edits — **land the D-31/D-30 WIP first**.
- Verdicts: **6 root-caused** (#1, #8, #9, #10, #12, #14) · **3 partially-explained** (#2, #5, #13) · **4 feature-gaps** (#3, #6, #7, #11).

## Summary

| # | Issue | Verdict | Est | Files |
| -- | ----- | ------- | --- | ----- |
| 1 | Import image doesnt work | root-caused | S | 1–2 |
| 2 | Unable to edit image node | partial + gap | S–M | 2–3 |
| 3 | Quantizer detailed configs | feature-gap | S global / M per-node | 4 / 8–10 |
| 5 | False QR code warning | partial | S–M | 3–4 |
| 6 | Missing warning center | feature-gap | M–L | 5–8 |
| 7 | Polygon tool is broken | feature-gap | M | 4–6 |
| 8 | Unable to edit stroke/fill of shapes | root-caused | S msg / M real | 3 / 5–8 |
| 9 | View → grid is broken | root-caused | S | 1 |
| 10 | Screen dpi clamped while typing | root-caused | S | 1 |
| 11 | Screen dpi calibration | feature-gap | M | ~4 |
| 12 | Resize control not working | root-caused | S | 1 |
| 13 | Resize not WYSIWYG | partial | M | 2–3 |
| 14 | Group childs above group in layers | root-caused | S | 2–3 |

## Findings

### #1 — Import image doesnt work — root-caused (S, 1–2 files)

- The dialog renders a **bare visible `<input type="file">`** (`src/components/editor/ImageImportDialog.tsx:146-154`) and a footer **Import** button → `runImport` (`:115-122`).
- `runImport` never opens a picker: `mode==='file' && file===null` → throws `ImportValidationError(t('editor.imageImportNoFile'))` (`:66`, key `src/i18n/locales/en.json:367`) — exactly the owner's console error.
- `fileInputRef` is declared (`:40`), attached (`:148`), and **dead** — never `.click()`ed. The picker opens only by clicking the raw native input.
- The repo's own pattern is hidden input + button → `.click()` (`DataSourceTab.tsx:242-253`, `ObjectTab.tsx:826-836`) — this dialog was never wired to it.
- **Not StrictMode**: reset effect keys on `[open]` only (`:46-57`); `Modal.showModal()` is idempotent (`Modal.tsx:73-85`).
- Entry points: `InsertRail.tsx:116-123`, `ObjectTab.tsx:683-689`.
- **Fix:** Import (or a Choose-file button) → `fileInputRef.current?.click()`; optionally auto-run the import from `onChange`. Keep the error as fallback for an empty picker result.
- **Owner decision:** Import opens picker + auto-imports, vs a separate "Choose file" button (repo pattern).

### #2 — Unable to edit image node — partial + feature-gap (S–M, 2–3 files)

- The inspector **does** render image affordances: `IMAGE_FIELDS` (`src/editor/inspectorModel.ts:165-168`) → `imageId` Select + Import button + `fit` (`ObjectTab.tsx:668-692`), and an Asset section with **Name/Alt only** (`:807-822`, `AssetRenameFields:850-899`).
- Two gaps: (1) re-import rides the broken #1 seam; (2) **no in-place source/URL edit** — `updateImageRef` accepts `source/widthPx/heightPx` (`src/store/storeTypes.ts:209`, `ImageRef` `src/core/doc/types.ts:162-169`) but the only caller sends `{name?, alt?}`. With one image imported, the dropdown has nothing to swap to.
- **Fix (in-place replace):** give `ImageImportDialog` a replace path → `updateImageRef(imageId, {source, widthPx, heightPx})` via the existing `importImageFile/Url` builders (`src/editor/render/assetImport.ts:88-115,124-150`). Node keeps its `imageId`; one undo entry; no orphan ref (also shrinks **D-12**).
- **Owner decision:** replace-in-place vs always-new-ref.

### #3 — Quantizer detailed configs — feature-gap (S global / M per-node)

- The quantizers **already accept params**: `QuantizeOptions {threshold?=128; strength?=1; serpentine?=true}` (`src/core/render/quantize.ts:20-29`, read `:85,:128`); `QuantizerId = threshold|floydSteinberg|stucki|atkinson` (`:35`, registry `:165-170`).
- Nothing production-side ever passes them: the pipeline applies **one shared `QuantizeOptions` to every policy** (`src/core/render/policy.ts:102,117`); the label-level `RenderLabelPageOptions.threshold/strength` knobs exist (`src/editor/render/renderLabelPage.ts:60-65`) but no caller sets them (`renderOptionsOf` forwards only dpi/invert/mirror/offset, `src/print/printLabel.ts:113-122`; `usePrintThumbnails.ts:200-206` same).
- Schema exposes only a bare `quantizerHint?: QuantizerId` (`src/core/doc/types.ts:55`; validate `src/core/doc/validate.ts:272-282`); inspector renders a select only (`src/editor/inspectorModel.ts:198-205`, `ObjectTab.tsx:650-667`).
- **Hard constraint for per-node params:** the policy mask is 1 byte/pixel, palette caps **8 distinct policies** (`renderLabelPage.ts:138-147`, throw `:255`); keying by `(id, params)` can exceed it. Per-policy options seam needed (`policy.ts` + `src/core/render/pipeline.ts:35-48`).
- Reference (niim.blue): dither config is **global, not per object** (`agent/memory/niimblue-reference.md:18,22` — denom+normalize, strength 0–1.5, serpentine).
- Preview≡print holds either way (single `renderLabelPage` seam). Note: the editor canvas itself never quantizes (full colour) — dither is visible only in print previews.
- **Option B (label/global, matches reference):** reuse the already-plumbed `RenderLabelPageOptions` knobs + one control. S, ~4 files.
- **Option A (per-node):** `quantizerParams?` on `BaseNode` + per-policy options + inspector numeric fields (new `FieldKind`). M, ~8–10 files.
- **Owner decisions:** scope (label vs node), params (threshold only vs +strength (+serpentine)).

### #5 — False QR code warning — partial (S–M, 3–4 files)

- **No URL/format validator exists anywhere**: `validate.ts:424-437` never inspects QR data; `resolve.ts:383-395` passes payload through unvalidated. `https://example` (15 bytes, QR v2) is the same version as the app's own insert default `https://example.com` (`insertActions.ts:35`) which is a **passing valid-QR fixture** (`assets.test.ts:235-240`) — content is provably not the trigger.
- The badge is one of two payload-independent predicates: (1) **too-small** — `belowMinModule` (`src/editor/render/qrImage.ts:68`, surfaced `src/editor/render/prepareAssets.ts:232`), the conservative 0.25 mm/module floor = **D-15**; fires iff the node is < ~6–8 mm; zoom-invariant; or (2) **keep-out** — node crosses the printable-region union (`src/editor/render/regionOverlay.ts:243-255` → `Overlays.tsx:115-133` `!` badge), fires on position alone.
- All three asset-warning kinds render the **identical unlabeled ⚠** (`ResolvedShape.tsx:158,171-179`) — the readability gap that makes it look like "invalid data".
- **Fix:** (a) per-kind i18n labels on the badge/tooltip (no content heuristic — the correct state "example URLs are valid" is already true); (b) optionally soften D-15's floor. Overlaps #6 (aggregation).
- **Owner decisions:** confirm repro (QR shrunk? near edge?) — or approve label-the-badge regardless.

### #6 — Missing warning center — feature-gap (M–L, 5–8 files)

- **Six producers, five transient consumers, zero aggregation, zero jump.**
  1. Asset warnings `missing|invalid|too-small` (`assets.ts:33`; produced `prepareAssets.ts:186-248`) → ⚠ badge `ResolvedShape.tsx:171-179` + print `RenderedLabelPage.warnings` (`renderLabelPage.ts:104,461,521,575`). Not listed anywhere.
  2. Keep-out (`regionOverlay.ts:243-255` → `Overlays.tsx:115-133`). No text.
  3. Global-data warnings (`templates/globals.ts:408-443` → banner `PreviewStage.tsx:731-743`). Only text list, transient.
  4. Template errors/trust (`useSampleRow.ts:135-149` → `PreviewStage.tsx:711-719`); collapsed to a count.
  5. CSV parse warnings (`DataSourceTab.tsx:203-207`, tab-local).
  6. Font badges (`ObjectTab.tsx:361,699-700`); toasts (`NotificationCenter.tsx:163-198`, auto-dismiss). Print-dialog warnings = in-flight D-31 (doc-level, non-jumpable).
- **Seams:** aggregation host = `SampleRowContext` (`sampleRowContext.tsx:13-18`, already carries globalWarnings + templateErrors) extended with assetWarnings + keepOut, **or** a small `warnings` slice next to `notificationsSlice.ts`. Entries `{ id, kind, nodeId? }`. Jump = existing `selectNode` (`selectionSlice.ts:16`). UI host = `EditorStatusBar` popover (`EditorStatusBar.tsx:106-183`, same pattern as row selector) or a 5th `MfpPanel` tab. Do **not** reuse `NotificationCenter` (auto-dismisses).
- **Owner decisions:** host, persistence vs dismissible, how non-jumpable doc-level warnings (D-31 overflow) render.

### #7 — Polygon tool is broken — feature-gap (M, 4–6 files)

- **No click-to-add-points / double-click-finish mode exists anywhere** (only a comment at `viewportController.ts:43`; no `onDblClick` in PreviewStage; no point-accumulation state).
- First pointerdown creates a **finished default polygon** via one-shot insert: `PreviewStage.tsx:303-312` → `createNodeForInsert` (`insertActions.ts:100-107`) → `points: [[0,0],[1200,0],[1200,1200],[0,1200]]` = a 12 mm square → `addNode` + select + disarm.
- "Blank": the renderer draws line/polygon **stroke-only, never fill** (`ResolvedShape.tsx:141-153`; print `konvaFactory.ts:171-180`). "Blue box + control points": the selected polygon's blue outline (`strokeOf` `ResolvedShape.tsx:44-48`, width 2) overlapped by the Transformer box + 8 px anchors (`PreviewStage.tsx:674-685`).
- The "warning at top right": the only node-triggered warnings are the keep-out badge (at the node's top-right, `Overlays.tsx:115-133`) — a 12 mm square clicked near an edge straddles the printable region; or possibly the globals banner (`PreviewStage.tsx:731-743`) which a polygon cannot produce. Owner should confirm which.
- **Fix:** drawing mode — arm `shape:polygon`, accumulate world points (no node on click), live preview Line, finish on dblclick/Enter/click-first-point, create node from collected points (Esc already disarms, `PreviewStage.tsx:519-529`). Give closed shapes a visible default fill (pairs with #8 real style support).
- **Owner decisions:** draw mode vs one-shot + vertex editor (`points` is a stub field, `inspectorModel.ts:145`); default fill.

### #8 — Unable to edit stroke width/fill/stroke of shapes — root-caused (S message / M real)

- **Not a CSV/template binding at all.** `SHAPE_FIELDS` marks `stroke`/`fill`/`strokeWidth` (and `points`/`cornerRadius`) `wired: false, reason: 'content'` (`src/editor/inspectorModel.ts:145-155`). `disabledReason` maps that generic unwired reason through `REASON_KEYS.content` (`ObjectTab.tsx:93,528-529`) to the CSV-specific string `en.json:418` — "This content is bound to a CSV or template…". No predicate exists; it trips regardless of data sources. Exactly the reported symptom.
- Fields are unwired because the renderer ignores them: `fill`/`stroke` **are not in the schema** (`types.ts:39-101`); `strokeWidth` persists (`types.ts:49`, `validate.ts:324`, `factory.ts:82`) but no renderer reads it (`ResolvedShape.tsx:125-152` fixed `#374151` / selected 2px; `konvaFactory.ts:171-190` neither).
- `contentSource` is text/qr/barcode-only (`src/templates/contentSource.ts:9-13` per `agent/memory/csv-templates.md`) — style props are not content; the content-source framing doesn't apply.
- **Fix (quick, S, 3 files):** new `FieldReason` `'style'` + i18n key ("Shape fill/stroke editing isn't supported yet."), map in `REASON_KEYS` for these fields.
- **Fix (real, M, ~5–8 files):** optional `fill?`/`stroke?` on `ShapeNode`/`BaseNode` (`types.ts`), validate/round (`validate.ts`, `factory.ts`), thread into resolved types (`resolve.ts`) + **both renderers** (`ResolvedShape.tsx`, `konvaFactory.ts` — preview≡print), wire `strokeWidth` (already persisted), mark fields `wired: true`.
- **Owner decisions:** message-now vs real support now; static-only (recommended) vs CSV/template-bindable style (larger design).

### #9 — View → grid is broken — root-caused (S, 1 file)

- The toggle **is wired end-to-end and a grid renderer exists** — it is painted **under** the opaque white label silhouette: in `src/components/editor/Overlays.tsx` the grid is layer child #1 (`:89`) and the solid-white `UnionSilhouette` is #2 (`:90`); React-Konva paints in JSX order. The intended order is documented at `PreviewStage.tsx:649` ("silhouette, grid, guides, keep-out") — actual order inverted. The default preset's 3 full-backing regions (`src/core/doc/label-presets/f-tag-spare.ts:37-44`) mean the silhouette always covers the grid. No test asserts grid visibility.
- Secondary: `GridLines` uses `strokeWidth={1}` in **world units** on a zoom-scaled layer (`layerAttrs` `PreviewStage.tsx:659`) → ~0.06–0.16 px at fit zoom; faint even un-occluded.
- Wiring: `ViewMenu.tsx:59` → `toggleGrid` (`viewSlice.ts:20`, `gridVisible :19`) → `PreviewStage.tsx:117,654` → `Overlays.tsx:89`. **Snap is not dead** (gates drag logic, `PreviewStage.tsx:372-421`).
- **Fix:** move the grid JSX after the silhouette; add `strokeScaleEnabled={false}` (1 screen px at any zoom). Optionally step `GRID_STEP_HM` `500`→`1000` — **owner decision: 5 mm (current) vs 1 cm (issue text)**. Doc-space (scales with zoom) matches "1 cm apart on the label" — keep it.

### #10 — Screen dpi clamped while typing — root-caused (S, 1 file)

- Controlled input commits on **every keystroke** with no draft: `src/components/settings/GeneralSection.tsx:63-72` `onChange` → `setScreenDpi(parsed)`; the setter clamps `min 24` (`src/store/slices/settingsSlice.ts:64-66`, `SCREEN_DPI_MIN=24` `src/store/storeDefaults.ts:15`). `96` minus `6` → `9` → clamped to `24`. Empty string → `NaN` → no set → snaps back to `96`.
- Rehydrate-time validation (`preferenceValidation.ts:124-131`) is not involved.
- **Fix:** local draft state committed on blur/Enter — the in-repo pattern already exists twice: `EditorStatusBar.commitDraft` (`EditorStatusBar.tsx:40-98`) and `ObjectTab.AssetRenameFields` (`ObjectTab.tsx:859-898`). `Input` already spreads `...rest` (`Input.tsx:13`) so `onBlur`/`onKeyDown` pass through. Store/persistence unchanged. No owner decision needed.

### #11 — Screen dpi calibration — feature-gap (M, ~4 files)

- No calibration UI; interactive ruler-drag calibration was explicitly **parked** (`agent/2026-09-29_label-editor-v1/ui-spec.md:161-165,182,206`). `screenDpi` only feeds `real` zoom (`viewportController.ts:20-31`) + status-bar readouts (`EditorStatusBar.tsx:31,113`).
- Existing inventory: setting + clamp + persistence (`storeTypes.ts:119`, `storeDefaults.ts:13-16`, `useStore.ts:143`); sections general/shortcuts/trust/tools (`SettingsModal.tsx:30-67`); the dev-only printed-ruler sample (`src/components/dev/PrintSmoke.tsx:102-231,387`, `?print=1`) is a **different feature** (printer calibration — don't merge).
- **Seam:** Calibrate button next to the dpi input (`GeneralSection.tsx:58-75`) → new `CalibrationDialog` built on the shared `Modal` (`src/components/common/dialogs/Modal.tsx` — the promise `dialogService` only offers confirm/promptText/alert, insufficient for a live ruler). On-screen ruler length from `mm / 25.4 * dpi` (inverse of `realZoom`, `core/viewport.ts:103`); adjustment writes the **existing** `setScreenDpi` live. ~4 files: new dialog + `GeneralSection` + `en.json` keys + test.
- Risks: Tailwind-preflight-vs-UA `<dialog>` pitfall (see `agent/memory/dialogs.md`) → needs a real-browser pass.
- **Owner decisions:** control type (slider / ± / both), reference length (50/100 mm), keep the raw number field.

### #12 — node → resize control is not working — root-caused (S, 1 file)

- The Stage-level `handlePointerDown` (`PreviewStage.tsx:286-334`) **never distinguishes Transformer anchors** (Konva's anchor mousedown does not `cancelBubble`, `node_modules/konva/lib/shapes/Transformer.js:382-384`). The anchor centre sits on the node corner: **inner half** of the 8 px anchor is inside the node AABB → `hitTestWorld` (`:315`) arms a **move drag** (`:324`); **outer half** → selection cleared + marquee (`:329-331`). Either way the transform is hijacked.
- Second defect: `nodeRefs.current.clear()` runs in a **passive** effect (`:232-234`) *after* React re-attaches callback refs, so any doc change makes the next effect (`:237-245`, dep `resolved`) call `transformer.nodes([])` — **anchors detach mid-gesture** (the "control disappears" symptom), and `transformend` (`:547`) then reads a detached node.
- The resize cursor is honest-to-the-anchor (`Transformer.js:392-399`) — the click is stolen; `anchorSize={8}` (`PreviewStage.tsx:684`) makes misses common.
- **Fix (S, `PreviewStage.tsx` only):** (1) early-return in `handlePointerDown` when `event.target` is a Transformer descendant (`hasName('_anchor')` / `findAncestor('Transformer')`); (2) delete the ref-clearing effect; (3) bump `anchorSize` ~10. Bonus: removes the **two-undo-entries per anchor drag** and part of #13.
- **Owner decisions:** anchor size / corner-only anchors; exclude groups from the Transformer until D-10 (their resize is a no-op, `editorSlice.ts:553`).

### #13 — node → resize is not WYSIWYG — partial (M, 2–3 files)

- Deterministic divergence on **non-corner anchors**: Konva ignores `keepRatio` for top/bottom-center and middle-left/right (`Transformer.js:575-577,602-607,632-634`) — live preview free-stretches one axis; the commit path `resizeNodeGeometry` re-collapses to a uniform factor `Math.max(rawX, rawY)` (`src/core/doc/geometry.ts:77-79`) — release **snaps** to the larger axis.
- The commit takes live `x/y` verbatim (`src/editor/transformGesture.ts:86-87`) — but Konva positioned that origin for the raw box it kept anchored; after the aspect-collapse the held edge is no longer held → the node **moves**. Secondary: integer rounding (`PreviewStage.tsx:567`, `transformGesture.ts:86-87`); ellipse origin is centre, not top-left (`resolve.ts:343-356`).
- The #12 anchor-hijack is a second, timing-dependent cause (fixing #12 partially fixes #13).
- **Fix:** align anchor policy with the node's aspect rule — corner-only `enabledAnchors` for `preservesAspectByDefault` nodes (image/QR/ellipse) or a `boundBoxFunc` enforcing the ratio on every anchor, so the `Math.max` collapse becomes a no-op. Files: `PreviewStage.tsx` ± `transformGesture.ts` / `geometry.ts`. Aspect collapse is shared by ellipse/QR/image — tests exist (`transformGesture.test.ts:90-100`).
- **Owner decisions:** hide side anchors (WYSIWYG by construction) vs aspect-preserving side anchors; Shift/Alt as free-stretch modifier.

### #14 — Group childs above group in layer list — root-caused (S, 2–3 files)

- `LayersPanel` reverses the whole flat row list: `[...treeRows(doc)].reverse()` (`src/components/editor/LayersPanel.tsx:39`). `treeRows` is a **depth-first pre-order** walk emitting parents **before** children (`src/editor/selectors.ts:169-191`) back-to-front; a global reverse flips the parent/child relation — children render above their group.
- Children are **not duplicated** and grouping is correct: `groupNodes` reassigns `parentId` and splices the group after the topmost selected child (`src/store/slices/editorSlice.ts:701-735`, asserted `editorSlice.test.ts:614` → `['a','b',groupId,'c']`). Indentation already works (`row.depth * 12`, `LayersPanel.tsx:110`).
- Canvas z-order = `nodes[]` array order; the Konva render path (`resolve.ts:415-417`, `konvaFactory.ts:134-137`) does not use `treeRows` — **display-only bug**.
- **Fix:** reverse sibling order **per level** (e.g. `treeRows(doc, {frontToBack: true})` or a new `layerRows`) and drop the global `.reverse()`. Files: `selectors.ts` (+ test), `LayersPanel.tsx`.
- **Watch-item:** drag-to-reorder `onDrop` (`LayersPanel.tsx:48-63`) maps target indices from sibling **array** order while displaying reversed — re-verify under the new ordering.
- **Owner decisions:** inside a group, front-most child first (Photoshop convention)? collapsed-group affordance?

## Cross-cutting

- **Shared seams:** #1+#2 (image import flow) · #12→#13 (anchor hijack) · #5 + #8-quick → #6 (per-kind warning labels are the input to the warning center) · #7 + #8-real (default fill needs real fill support).
- **Sequencing:** land the in-flight D-31/D-30 WIP first (several fixes add typed i18n keys to the same `en.json`) · serialize `PreviewStage.tsx`-heavy fixes (#7/#9-Overlays/#12/#13) · #12 before #13 · #1 before #2 · #8-real before #7's default fill.
- **Debt interactions:** D-05 (per-policy passes — #3 Option A inflates) · D-09/D-10 (groups: drag/resize) · D-12 (double undo on image import — #2 replace-in-place shrinks) · D-13 (CORS on remote image URLs) · D-15 (0.25 mm/module floor — #5).
- **Conventions for all fixes:** typed i18n keys in `en.json` (never hardcoded strings) · preview≡print must stay by construction (single `renderLabelPage` seam) · invalid optional doc fields are dropped with a repair, never fatal · tests required (suite currently 1204 green).

## Proposed batches

- **Batch 1 — quick wins (S, mechanical):** #1 import wiring · #9 grid reorder + `strokeScaleEnabled` · #10 draft-on-blur · #12 pointer guard + effect deletion + anchor size · #14 per-level reverse (+ onDrop recheck) · #8-quick honest message.
- **Batch 2 — medium (after dependencies):** #13 anchor policy (needs #12) · #2 in-place replace (needs #1) · #5 label-the-badge · #7 polygon draw mode · #11 calibration dialog · #3 Option B or A.
- **Batch 3 — feature work:** #6 warning center · #8-real static fill/stroke/strokeWidth.

When an issue is fixed, tick it off in `2026-10-06_round-1.md` and delete the matching debt line in `agent/memory/tech-debt.md` (none of these have IDs yet except the #4/D-31 exclusion).

## Owner decisions — resolved 2026-10-06

All 12 open questions answered (per-node quantizer params; real shape styles now; warning center = 5th MFP tab with detailed text, generic badge stays; corner=aspect/side=stretch; front-first layers + collapse; 5 mm grid; ruler+slider calibration; replace-ref-in-place; import auto-runs picker). **QR data is arbitrary text — never treat or validate as URL.** Full decision table + phases: [`../2026-10-06_ui-sweep/plan.md`](../2026-10-06_ui-sweep/plan.md) (P1–P7, coordinator handoff).
