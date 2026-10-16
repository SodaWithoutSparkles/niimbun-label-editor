# Plan — known-issues round-2 fixes

- Date: 2026-10-09 (updated same day: print-preview research, stacking-quantization issue, 2D-code issue, quiet zones)
- Source: [`agent/known-issues/2026-10-06_round-2.md`](../known-issues/2026-10-06_round-2.md)
- Verification (2026-10-09, 9 explore agents, HEAD after `214aef2`/`5c756e8`) is taken **verbatim as correct** — do NOT re-explore those facts: [`verification report`](../2026-10-09_known-issues-verification/verification-report.md), [`module-size brief`](../2026-10-09_known-issues-verification/module-size-warning-brief.md), [`state`](../2026-10-09_known-issues-verification/state.md). The round-2 doc's research findings and owner decisions (including everything after line 417) are likewise taken as facts.
- Repo memory: read [`agent/memory.md`](../memory.md) first; area files per phase (see ENV BRIEF).
- Relevant documents:
  - [Known issue doc](../known-issues/2026-10-06_round-2.md) (also describes the findings as facts, and )

## Owner decisions (2026-10-09, recorded)

1. **Scope:** all open items, phased. (Not bugs-only.)
2. **Printer surfaces:** keep the **top-right chip only**. Remove the editor status-bar `<ConnectionChip/>` (`EditorStatusBar.tsx:182`, the true bottom-right printer icon) AND the gallery dot+text duplicate (`BottomBar.tsx`). Top-right chip becomes the single printer surface and the anchor for the new info/connect popover.
3. **QR resampling artifact:** option **D — disable smoothing** on the symbol draw (qr/barcode only; photos/images keep smoothing). The symbol keeps filling the authored box; fractional pitches give N/N+1 device-px modules — **owner-accepted**: at most 1 px at the 203 dpi printhead = 0.125 mm, too small to notice and within scanner noise. Consequence: the decided target-based verdict formula is correct verbatim (no drawn/target divergence — R1 resolved).
4. **UI routing:** **no ui-designer.** Owner supplies screenshots as the spec (per [`memory/ui-design-workflow.md`](../memory/ui-design-workflow.md): owner designs the UI; never redesign). `general` implements from screenshots.
5. **Commits:** semantic git commit **per phase**, after its review pass.
6. **2D code formats (new issue):** **new "2D code" object** — a separate palette category from QR (QR stays untouched, backward compatible by construction), with a format picker (datamatrix, aztec, pdf417, …) over one shared bwip-driven symbol engine (fill, quiet zones, module-size verdict all shared).
7. **Quiet zones for qr/barcode:** **in scope, default ON.** Project is v0 alpha — breaking changes allowed. Existing docs' symbols shrink to make room for the zone and some will newly trip the too-small warning; that is intended and accepted. Explicit/derived quiet-zone option per symbology with a sensible default (QR ≥ 4 modules/side), NOT via bwip's `paddingwidth` (scale-unit based, currently zeroed).
8. ~~User: i18n `en.json` can be handled later after round finished.~~ **SUPERSEDED (owner, 2026-10-12): `en.json` edits are allowed per phase again.** The batching was only intended to speed the round up, not to defer correctness. P7 is the first phase that needs key **deletions** and **value edits**, not just additions, and deferring those made them easy to get wrong. Agents now edit `en.json` directly, in their own phase, and keep it correct.

## Scope

All still-open items in the round-2 doc, including the additions after line 417: **stacking quantization policies** (bug, owner-decided fix (A) + `fill` + quiet zones), **alternative 2D code formats** (feature, decision 6), and the **print-preview research** (folded into its phase). **Already fixed at HEAD — excluded, no work:** text resize "wide putin" (scale reset at commit), rectangle resize overshoot (+ `strokeScaleEnabled` and stolen-pointer/`pointercancel` follow-ups), shape line-width scaling on resize (`scaleStroke` removed — verified gone).

## ENV BRIEF (carry into every phase)

- Package manager: **bun** (at `bun`) (never npm). Tests: `bun run test` (Vitest, in-process). **Never** `bun test`, never package executors (`bunx`/`npx`). Use bun abs path.
- Typecheck: prefer `tsc` alone over `bun run build` (drvfs is slow; build = `tsc && vite build`).
- All product strings via `t()` with typed i18n keys (`src/i18n/locales/en.json`); dynamic keys via the literal-map pattern ([`memory/i18n.md`](../memory/i18n.md)). New `print.*` keys auto-derive types (`src/@types/i18next.d.ts:5-7`).
- Global `keydown`/`paste`/`drop` handlers must bail when `<dialog open>` exists (native `inert` does not stop them).
- `<React.StrictMode>` active — effects fire twice; interval/subscription code must be idempotent (matters: P6 refresh tick).
- Reviewer routing (owner instruction): **`experimental-review` primary**, `review-alt` fallback, `review-fast` for mechanical/narrow re-reviews. Re-check availability near 2026-10-10.
- Depth-1: subagents must NOT delegate further. No `git stash` (shared repo, parallel runs).
- `template-webui` reference lives in a **sibling repo** (`template-webui`) — reference only, do not edit.
- **Line-drift corrections (verified, use these, not the round-2 doc lines):** aspect-lock predicate `PreviewStage.tsx:385-389` + `geometry.ts:50-53`; live-scale read `PreviewStage.tsx:913-914`; commit `:943-959`; `keepRatio` conditional `:1094`; scale reset `:925`; `GRID_STEP_HM` has **5** call sites in `PreviewStage` (4 snap + 1 overlay).
- **F1 (printer icon):** the round-2 finding about `EditorStatusBar` was wrong — it DOES render `<ConnectionChip/>` (real `<Printer>` icon, bottom-right). Gallery `BottomBar` duplicate is bottom-left, iconless dot+text.
- **H2 (duplicate/bulk drag):** the issue text is wrong — no selection swap exists at HEAD (`cloneNode` never touches `selectedNodeIds`; callers ignore its return). Both fixes are new work, not regressions.
- **C1 (trust):** persistent decisions are unreachable **anywhere** — `gate.always`/`gate.never` have no production caller; the `trustPrompt.ts:7-10` comment claiming an "editor trust control" is stale/false. Widen the prompt AND wire the persistent branches.
- Extract grammar (owner question, answered): array indexing `a.b[0].c` → **NO**; jq-style → **NO** (`|` is the fallback separator). Only **dot-numeric** indices work: `a.b.0.c` (`globals.ts:126-144`).
- **Print pipeline facts (stacking issue, owner-confirmed 2026-10-09):** policy defaults `barcode/qr: 'threshold'`, `image: 'floydSteinberg'` (`policy.ts:17-22`); the per-object policy mask is built from **filled rects** over the drawn leaf rect, last-write-wins (`renderLabelPage.ts:312-334`, `policy.ts:86-90`) — that over-claim is the bug; the unified RGBA pipeline is **plan decision #1** (`agent/2026-09-29_label-editor-v1/plan.md:325`, sourced from `docs/references/gpt-review.md §4` which explicitly rejected per-object-then-composite) — fix (B) reverts it and is **rejected**; `applyInkDefaults` skips `Konva.Image` (`rasterize.ts:106`); `rasterize.ts:162-173` adds the opaque white base (stays — fix (D) not chosen); bwip sets no `backgroundcolor` today (`qrImage.ts:47-54`, `barcodeImage.ts:49-56`); editor preview is never quantized; error-diffusion across policy boundaries is debt **D-05** (`policy.ts:81-84`), deliberately deferred; `memory/objects-assets.md:38-42` documents the drawn-rect mask as deliberate — **superseded by P2**, update that note when P2 lands.
- **The `baseW = 2·moduleCount` (2 device px per module) measurement is verified for `qrcode` only** — other bcids (datamatrix, aztec, pdf417) must be measured the same way in P11 before wiring the verdict.

## Phases

Bugs first, features last. Each phase: action plan → implement → review → fix → commit (semantic). Phases are independent except where noted.

### P1 — Symbol print pipeline (QR/barcode)
Items: "QR too small warning mis-measures (2× unit error)"; "Triangle / non-square module artifact".
- **Verdict fix (owner-decided formula, applies verbatim under D):** `moduleCount = baseW / 2`; `belowMinModule = Math.min(targetW, targetH) / moduleCount < minModulePx`. Under D the symbol still fills the box, so the target-based module IS the printed module — no drawn/target divergence. Keep `MIN_MODULE_MM = 0.25` (do NOT re-tune; owner data: 6 mm = 0.24 mm/module practical minimum, 5 mm marginal). 1D barcodes unaffected by the 2× unit bug (`scaleX` is genuinely px/narrow-module) — parity-check only. NOTE: P2's quiet zones extend this budget — expected, not rework. **[P2 review round 1 correction]:** the barcode verdict was subsequently amended to the **drawn** pitch `scaleX * drawScale` (`drawScale = min(targetW/canvas.width, targetH/canvas.height)`), because symbols are drawn with `fit:'contain'` and a height-constrained box shrinks the whole raster; the bare `scaleX` form under-warned there. Coordinator-approved; see `phase2_action-plan.md` "Key formulas".
- **Option D:** disable smoothing on the symbol draw only (`imageSmoothingEnabled = false`) for qr/barcode in the placement path (`fitImageAttrs` / `konvaFactory.ts:163-167` symbol branches, and the print/quantize draw). Photos/images keep smoothing. Nearest-neighbour upscale → hard module edges, no antialiased greys straddling the 128 threshold → triangles/notches gone; modules are N/N+1 device px where the pitch is fractional — owner-accepted (≤ 1 px at 203 dpi = 0.125 mm, within scanner noise).
- Regression tests: 25-module payload, `minModulePx = 3` → 100 px box `belowMinModule: false` (was true), 74 px box `true`. Validate through **`renderLabelPage`**, not `PreviewStage` (preview zoom hides it) — also assert crisp module edges (no fractional greys) in the rendered page. Files: `qrImage.ts`, `prepareAssets.ts`, `konvaFactory.ts`, `barcodeImage.ts` (parity), tests `assets.test.ts` + `renderLabelPage.assetDpi.test.ts` pattern.

### P2 — Symbol `fill` + ink-aware quantization masks + quiet zones (stacking fix)
Relevant documents: [Round 2 issue doc](../known-issues/2026-10-06_round-2.md:437-504) (READ FIRST)
Items: "Stacking different quantization level objects yield unexpected results" (owner-decided fix (A) + `fill`); quiet zones (decision 7).
- **Fix (A) — ink-aware mask coverage (architecturally consistent; preserves decision #1's unified pipeline):** build the per-object policy mask from **visible ink**, not the drawn rect: stencil the prepared asset's opaque pixels (draw `asset.image`, tint `source-in`) in `renderLabelPage.ts:312-334`, in z-order (last-write-wins among leaves). Transparent modules then inherit the background leaf's policy; recombination stays **selection, not alpha blending** (`policy.ts:92-140` already does this — only the mask build changes). Do NOT take route (B) (per-object quantize-then-composite) — it reverts decision #1.
- **Owner warning (explicit): be extra careful about alpha/transparency and z-order** — transparent fill + image behind, opaque fill over image, symbol-over-symbol overlaps. Test matrix below.
- **`fill` on `QrNode`/`BarcodeNode`:** reuse the `ShapeNode.fill` pattern (`types.ts:108`, default `'transparent'`): `transparent` → light modules see-through (ink-only mask); a colour/white → opaque symbol background via bwip `backgroundcolor` (or a bg rect) and the mask legitimately owns the whole rect (WYSIWYG). Thread through validate (migration default `transparent`), resolvers, `ObjectTab` inspector, i18n.
- **Quiet zones (default ON, breaking at v0 alpha — accepted):** explicit/derived quiet-zone option per symbology with sensible defaults (QR ≥ 4 modules/side; 1D per-symbology requirement), derived ourselves — not bwip `paddingwidth`. Couples: zone colour = `fill` (transparent when fill transparent); module budget — effective module ≈ `box / (moduleCount + 2·quietModules)` — **update P1's verdict formula and tests** accordingly; `baseW` grows for the fit; the zone is background, so mask coverage excludes it.
- **Refined architecture (owner, verbatim target):** (1) per-policy ink/transparency/alpha-aware, layer-aware masks; (2) quantize those regions with the respective policies, masked onto the global RGBA stage; (3) re-stack. The GPT proposal's v1 is what the pipeline already does — only mask coverage + `fill` are new.
- Tests: `renderLabelPage`-level — barcode(threshold) over image(floydSteinberg): transparent modules → image's dither shows through (no pure black/white projection inside light modules); opaque `fill` → threshold owns the whole rect; symbol-over-symbol z-order; quiet-zone shrink + verdict-on-new-budget; `validate` round-trip for `fill` + quiet fields. Update `memory/objects-assets.md:38-42` + debt D-05/D-34 entries at phase end.

### P3 — Selection & resize semantics
Items: QR side-handle aspect; "broken duplicate / bulk-select drag" (H2); "Mixed selection alignment" (tiling).
- **QR side-handle (primary):** compute `enabledAnchors` (corners only) on the `<Transformer>` (`PreviewStage.tsx:1091`) when `selectedNodesPreserveAspect` — a non-uniform box can then never be committed. Keep text free-resize. Do NOT drop the `isCornerAnchor` gate in `commitPreservesAspect` (`transformGesture.ts:211-222`) — risks the #13 release-snap.
- **Keep-out defensive fix (also heals pre-existing malformed docs):** make `nodesIntersectNonPrintable` / `nodeLocalPoints` (`regionOverlay.ts:243-255`, `resolve.ts:261-281`) use the `contain`-fitted rect for qr/image/barcode instead of raw box corners — kills the false "outside the printable area" warning on letterboxed symbols.
- **Duplicate → select clones:** `cloneNode` (`editorSlice.ts:628-642`) returns new ids; callers (`Header.tsx:58`, `EditorKeyboardShortcuts.tsx:56`) select the clones and deselect the source.
- **Preserve multi-selection on drag:** pointer-down on an already-selected node keeps the whole selection moving; collapse to `[hitId]` only on a click **without** drag (`selectionModel.ts:31`, `PreviewStage.tsx:526-534`). Keep shift-click semantics.
- **Tile vertical / horizontal:** sort selected by center (cy or cx), lay out with a gap, reuse the `alignTransformPatch` commit path (`ObjectTab.tsx`).
- Tests: `PreviewStage.interaction.test.tsx` (real gesture regressions), `editorSlice.test.ts`, `ObjectTab.test.tsx` tiling cases; UI regression — select A+B, duplicate, assert clones selected, drag one clone, both move.
- **Text live-resize glyph aspect (added 2026-10-09; [round-2 doc](../known-issues/2026-10-06_round-2.md:510-515)):** `<Transformer keepRatio={selectedNodesPreserveAspect}>` (`PreviewStage.tsx:1094`) is `false` for text (`preservesAspectByDefault`, `geometry.ts:50-53`), so every anchor free-stretches live and the glyph aspect distorts until release (commit leaves `fontSize` unchanged, resets live scale — `geometry.ts:176-188`). Reference (`template-webui`) omits `keepRatio` ⇒ corners uniform live. Decide: adopt the reference corner `keepRatio`, or go further and keep glyphs constant live (box-only, like the stroke-width fix). Owns the live-`keepRatio` half of the `enabledAnchors`/`keepRatio` work above.

### P4 — Viewport & keyboard
Items: "Arrow keys don't move"; "zooming does not deselect the real view"; "Touchpad gesture zooming"; "Options → settings grid spacing".
- **Arrow nudge:** ArrowUp/Down/Left/Right move selection 0.1 mm → 1 mm → 2 mm on key repeats; held key moves continuously and faster. New move action in `editorSlice`; handler branch in `EditorKeyboardShortcuts.tsx` — must bail on `<dialog open>`. `PopoverSlider` has the continuous-press accelerator pattern to copy.
- **Zoom desync:** wheel zoom routes through the store (`zoomMode: 'manual'` like the toolbar steps) instead of local `setViewport` only; Real button forces a re-derive/recenter even when already active (recenter effect deps `PreviewStage.tsx`).
- **Wheel classifier:** `ctrlKey`+wheel = pinch → zoom (keep); Shift+wheel = pan; plain wheel = zoom for mouse, pan for touchpad via best-effort heuristics (`deltaMode`, `deltaX` presence, magnitude/continuity). Pan stays clamped. Unit-test the classifier with synthetic events; browser-check the four gestures.
- **Grid spacing setting:** persisted preference + settings control; thread through all 5 `GRID_STEP_HM` call sites (snap + overlay stay on one value); default 5 mm. Files: `gridConstants.ts`, settings store/section, `PreviewStage.tsx`, `Overlays.tsx`.

### P5 — Text line-wrap options
Item: "Text missing line wrap options".
- `TextNode` gains a wrap mode: **word** (default) | **character** | **clip** (no wrap, cut off) | **shrink to fit**. Applies to the **post-expansion** string (CSV/template content resolves before render — already feasible).
- Model + validate + round-trip; render in `ResolvedShape.tsx` (Konva `Text` wrap/ellipsis; clip = fixed box + clipping; shrink = measure + scale down); inspector options in `ObjectTab.tsx`. Renderer test per mode.
- **Inline text editing (added 2026-10-09; [round-2 doc](../known-issues/2026-10-06_round-2.md:517-520)):** the port has **no WYSIWYG editor** — `PreviewStage.onDblClick` (`:1037-1039`) only finishes polygons, so text is authored only via the MFP `<textarea>` (`ObjectTab.tsx:650-657`). Port `template-webui`'s `TextEditorOverlay` + `useTextEditor`: absolutely-positioned, rotated, zoom-scaled DOM `<textarea>` over the canvas; triggers on double-click (or text-tool draw); hides the real Konva node while editing; commit on blur/`Ctrl+Enter`, Esc cancels. Watch the overlay/Konva mismatches: `lineHeight 1.2` (overlay) vs Konva `1`, and `verticalAlign` differences.
- **Newlines / overflow (added 2026-10-09; [round-2 doc](../known-issues/2026-10-06_round-2.md:522-528)):** `\n` is preserved end-to-end (`resolveContent` passes it verbatim; no trim/split on the node-text path), so "cannot enter new lines" is a perception side effect of (a) no inline editor and (b) **Konva silently dropping overflow lines** (fixed `height` stops building lines when `currentHeightPx + lineHeightPx > maxHeightPx`, `ellipsis` off). Surface the drop (ellipsis / auto-grow / clip mode from the wrap options above) so newlines don't look broken; only rendered-case default box `{w:2000,h:800}` / `fontSize 300` shows 2 lines.

### P6 — Templates, globals & trust
Items: "Globals only allow online"; "Unclear extraction"; "missing API contract"; "template trusting unclear" (C1); "Template does not refresh".
- **Static globals:** `GlobalSpec` gets `kind: 'remote' | 'static'` + static value; `validate.ts` migration defaults `remote`; prefetch skips static entries (`templates/globals.ts`); `GlobalDataTab` form variant (value editor instead of URL/extract/expiry). Round-trip test + render test that the value reaches `ctx.globals.<name>`.
- **Extract normalization:** `createExtract` strips a leading `.` (and accepts a leading `$.`) → `.rate` works. Pin the grammar in tests (dotted paths, dot-numeric indices, `|fallback`).
- **Contract surface:** user-facing docs of `TemplateContext` (`index`, `total`/`rowCount`, `row`, `now`, `label`, `globals`, `fmt`), the extract grammar, fallback rules, forbidden operations — i18n help panel reachable from the template-related tabs. Plus **`ctx.seeds.docSeed`** (owner-decided): stable per-document seed so the same document + data always generates the same label (asset-tag UUID use case). Docs sits `docs/user-guide/*.md` (new). Developer-facing docs sit `docs/developer-guide/*.md` (new). Tests: `globals.test.ts`, `validate.test.ts`, `trust.test.ts`, `trustPrompt.test.ts`, `TrustSection.test.tsx`, `useSampleRow.test.tsx`. Later phases would add a docs repo and a docs static website to be linked to, but that is out of scope for this round.
- **Trust prompt (C1):** widen to four choices — allow once / always allow / deny once / never allow — wiring `gate.always`/`gate.never`; dismiss = session deny (fail-closed). New `trust.prompt.*` i18n keys. Delete the stale `trustPrompt.ts:7-10` comment.
- **Refresh tick:** 1 s tick enqueued through the single-flight queue (`useSampleRow.ts:293-298` enqueue point; superseded passes bail by run id). No pass when the document has no template sources or live globals. Fake-timer tests; StrictMode-idempotent cleanup.
- Tests: `globals.test.ts`, `validate.test.ts`, `trust.test.ts`, `trustPrompt.test.ts`, `TrustSection.test.tsx`, `useSampleRow.test.tsx`.

### P7 — Shell & printer surfaces
Items: "Top header home button"; "Minor: incorrect branding"; "Leftover status bar artifacts"; "Duplicated printer icon" (F1 decision); "Pressing printer should bring up printer info"; "Template in main UI confusing" (rename).
- **Home:** File menu action → `setView('gallery')` (store already exposes it).
- **Branding:** rename the app to **Label Editor** — the visible branding still says "Drawing App" because `template-webui` was a demo drawing app. `index.html:8` `<title>` and `about.message` (`en.json:93`) are the only two occurrences.
  - **[Owner correction 2026-10-12]** the original wording of this line also named `settings.shortcuts.drawingModifiers`. That was wrong: `drawingModifiers` is the *section heading* for the modifier keys used while drawing ("Drawing Modifiers", `en.json:135`) — a correct descriptive label, **not** branding. Leave it unchanged. The intent was the app-name change only.
- **Gallery `BottomBar` cleanup:** drop drawing-app leftovers (tool name, tool hints, autosave/relative-time) and the dot+text duplicate chip; sweep unused `bottomBar.*`/`toolHints.*` i18n keys.
- **Editor chip removal (F1):** remove `<ConnectionChip/>` from `EditorStatusBar.tsx:182`. Single printer surface = top-right chip.
- **Printer popover** anchored to the top-right chip: connected → info panel + **disconnect** button; disconnected → connect chooser: **web serial / web bluetooth** + "remember this choice" persisted setting (changeable in settings). Remembered choice auto-uses the method next connect. Web Bluetooth needs a real user gesture — the chooser button satisfies it. Transport is currently hard-coded bluetooth (`appTransport.ts`); the adapter already accepts the client type.
  - **[Owner decision 2026-10-12 — content scope.]** The panel should carry **mostly the same information as the reference** (`references/niimblue/src/components/PrinterConnector.svelte`), keeping the reference's **layout** (owner likes it) but re-styled to our colour scheme / component vocabulary. Keep: device version block (HW/SW/FW), the RFID label-tag block (usage bar, consumables type, paper dimensions), battery, model/device name. **Drop:** firmware flashing, the sound-setting toggles, the advanced/verbose info dump, and the debug block.
  - **[Owner decision 2026-10-12 — two additions.]** (1) **A refresh button** — re-fetch printer + RFID info on demand (the adapter fetches both at connect but keeps only 5 fields). (2) **Poll battery periodically** instead of showing the connect-time value forever; the lib's `startHeartbeat`/`stopHeartbeat` + `HeartbeatData.batteryPercents` is the idiomatic path, on a slow interval, stopped on disconnect.
  - NOTE: (1) and (2) mean `PrinterStatus` **grows** beyond the five fields the original wording assumed, and `PrinterTransport` may need a refresh method — adapter + mock work, not pure UI. See [`handoff-p7.md`](handoff-p7.md) for the verified facts.
- **Gallery nav rename:** "Templates" → "Label presets", keep the coming-soon placeholder. (The preset→"paper type" rename belongs to P8.)
- Tests: `ConnectionChip.test.tsx` extends to the popover (mocked `PrinterStatus`); preference round-trip; gallery/editor render test asserting a single printer indicator.

### P8 — Paper management
Item: "Paper management is broken".
- Paper type catalogue: model + `paperRepo` (global store keyed by id, pattern of `csvRepo`), gallery CRUD UI (list/add/edit/search/delete), **default paper** setting used when creating a new label.
- Rename "preset" → "paper type" in `CreateLabelDialog` + `label-presets` i18n. Design point for the action plan: seed the catalogue from the fixed `LABEL_PRESETS` registry on first run (presets are code; paper types are user data). Existing docs carry their own geometry — no doc migration needed.
- Tests: store test for default-paper selection; nav smoke; repo tests mirroring `csvRepo.test.ts`.
- Different from "Label presets" in gallery: label preset is a user-defined pre-designed label, with just data missing. Then the user can use a preset, fill in specific data, and print. 
- Paper type is a user-defined paper size and shape, such that the user can create a new label with that paper type easily.
- Maybe worth the time to do a quick sweep to prevent future naming confusion: `LABEL_PRESETS` in code should've been more accurately described as `PAPER_TYPES`, for example. 
- **[Owner decision 2026-10-13] Polygon authoring = preview canvas + manual (x,y) point rows** (Option A), NOT reuse of the editor's polygon draw gesture. The preview is fed by `traceUnion` — the same tracer the editor overlay and the raster print clip use — so the paper-type preview is WYSIWYG by construction. The gesture was rejected: it is inlined in `PreviewStage` (not extracted), drags in editor-only concerns a paper type has no use for (node-bounds snap, grid preference, `dialog[open]` guards), inherits open bugs **D-32**/**D-37**, and can only *produce* points — no vertex drag, delete or reorder, all of which a re-editable paper type needs. `closed: true` is hard-coded (an open polygon is silently non-printable) and manual points are validated through the existing pure `finishPolygonPoints`. Also decided: `PaperTypeId` is a plain `string`; the built-in registry is demoted to seed data. **⚠ Superseded 2026-10-13 by decision 9** — the "keep the four ids verbatim" caveat is retired. **[Owner decision 2026-10-13] Guides are persisted label data, not derived.** The score line must be **a part of the label**, not a hard-coded `PRESET_GUIDES` lookup keyed on the paper-type id. So `LabelDoc.label` gains `guides: Guide[]` (carried from the paper type by `createLabelDoc`, validated in `validate.ts`), `PaperType` gains `guides`, the `ftagSpare-25x78` seed carries its score line as data, `resolveGuides` collapses to `doc.label.guides ?? []`, and `PRESET_GUIDES` + the `FTAG_SCORE_*_HM` constants are **deleted**. This retires the R8a trap entirely (nothing keys on the id any more), so `meta.presetId` → `meta.paperTypeId` is a safe provenance-only rename. **[Owner decision 2026-10-13] v0 alpha — breaking changes accepted**, no back-compat shims. A guide is still **not** a region: never clip/print, never in `union(regions)`; the paper-type preview draws the silhouette and the guides as two separate passes. Action plan: [`phase8_action-plan.md`](phase8_action-plan.md). 

### P9 — CSV & media management
Items: "Data source CSV is broken"; "New media management tab".
- Gallery-level **CSV** management: list/upload/view/edit/delete via existing `csvRepo` CRUD.
- Gallery-level **media** management (new nav section, same pattern) via `resourceRepo`.
- When adding photos to a label, besides the existing File/URL, allow pick from the media repo ("Use existing"). When using this option, allow "Import by Clone" (copy, duplicated and reference to the new) or "Import by Reference" (simple reference to the original).
- Similarly for CSV, beside "Choose file", we can re-use the same UI and logic for media.
- **Orphan sweep:** `list()` exists on both repos with no production caller; the sweep named in `DataSourceTab.tsx:169,204` comments does not exist. Implement orphan detection = `list()` diffed against all document refs; surface orphans for deletion.
- Tests: `csvRepo.test.ts` pattern for the UI; orphan-detection unit tests.

### P10 — MFP panel & print preview rework (owner screenshots); and UI changes
Items: "MFP UI is not user friendly"; "Print preview too small".
- **Prereq:** owner supplies screenshots as the spec at the phase gate — request them before implementing; never redesign beyond them.
- MFP: responsive 2+ columns at wide viewports (`EditorShell.tsx` right column + `MfpPanel.tsx` one-column stack today); icon toggles for bold/italic/alignment etc.; light text for popover content (dark-on-dark today); **portal** `PopoverSlider` panels (clipped by the scroll container today); JS tab: collapse controls to one row, code textarea takes the width (it is the panel's focus). Optional icon row between View and Layers — ask owner with the screenshots.
- Print preview (research facts, 2026-10-09): "View as" `Select` (reuse `PrintDialog.tsx:439-440` pattern) with **Queue | Page**, **default AND reset to `'page'`** (reset in the open effect `PrintDialog.tsx:120-135`); `viewMode: 'queue' | 'page'` + `selectedPage` local state; Page view = one large preview rendered via `renderLabelPage` at `{ dpi: doc.label.dpi, ...overrides }` (`renderLabelPage.ts:80`, dimensions `:453`) filling the area, with a page-number row and prev/next arrows (Chevron stepper pattern `PopoverSlider.tsx:244-254`, `EditorStatusBar.tsx:139-171`); guard `MAX_RASTER_PIXELS = 16_000_000` (`renderLabelPage.ts:128` throws `RangeError` beyond). **Do not share the thumbnail cache** — `usePrintThumbnails.ts:38` is capped at `THUMBNAIL_DPI = 50`, keyed by `rowIndex` only (`thumbnails.ts:112-115`, LRU-32/concurrency-2) — Page needs its own render path. Index `activeRows` (`printDialogModel.ts:36-46`) vs `plan.pages` for "page" — implementer decision. Files: `PrintDialog.tsx`, new `PrintPagePreview.tsx` (or inline), `usePrintThumbnails.ts` sibling path, `en.json`. Validate in `PrintDialog.test.tsx` via `renderLabelPageMock` asserting `opts.dpi === doc.label.dpi`.
- Owner: right panel is already wide enough; no need to split "view" icons to two rows. The "zoom in/out", "zoom to fill", "zoom to real" buttons can be the same row as the grid/magnet/ruler/rotate icons.
- Owner: Use icons for alignment buttons, and remove them from MFP. Because they are generic stuff. e.g. `mdi:align-vertical-center`, `mdi:align-horizontal-center`, `mdi:align-horizontal-distribute`, `mdi:align-horizontal-left`, `mdi:format-vertical-align-top`, etc.
- Text specific buttons only shows on right side when text is selected. e.g. `mdi:format-align-left`, `mdi:format-align-center`, `mdi:format-align-right`, `mdi:format-align-justify`, wrapping, font style, etc.


### P11 — 2D code formats (new object)
Item: "Minor: Alternative code format than QR code" (decision 6).
- **New "2D code" palette object** as a separate category from QR — QR stays untouched. One shared bwip-driven symbol engine under both (generalize `qrImage.ts` internals; format picker: datamatrix, aztec, pdf417, …).
- **Measure before wiring:** the `2 device px per module` / `baseW = 2·moduleCount` fact is verified for `qrcode` only — measure each new bcid's base render the same way (v1/v2/v3/v7 method) before wiring the too-small verdict and quiet-zone budget.
- Reuse P2's machinery: `fill` option, quiet zones (default ON, per-symbology defaults), ink-aware mask coverage. New node kind → model, `validate`, palette, `ObjectTab` inspector, warnings integration (too-small verdict per format; "data is arbitrary text" rule per [`memory/warning-center.md`](../memory/warning-center.md)), i18n.
- Tests: per-format render + verdict budget; node round-trip; palette/inspector smoke.

### P12 — Grid duplication (linked/derived)
State: Cancelled by owner (2026-10-16) — the feature is **not** needed for v0 alpha yet.
Item: "Additional feature request: Grid duplication".
- Dialog: rows × columns × spacing, duplicated from the original selection in a grid pattern. New items are **derived/linked**: they follow edits, move, and delete together. **Unlink** per item or all — unlinked items become independent.
- Cross-cutting model work (provenance/link metadata on nodes + propagation in slice reducers). Action plan must contain a short model design (link group, propagation rules, unlink semantics) before code. Keep last so it cannot destabilize the earlier phases.

### P13 — Miscellaneous
This section contains debts/issues that are discovered during the fixes.
- **D-36**: Touchpad panning is locked to cardinal if the initial movement is cardinal, even if the user changes direction. 
- **D-37**: Polygon draw preview is rendered at the lowest layer, it should've been rendered at the top layer.
- Incorrect select logic for overlapping objects. Click on layer list = selected = priority to be dragged. If the user clicks inside the control box of the selected object, it should take priority over whatever is stacking above it. If user clicks outside the control box of the selected object, it should select the topmost object at that point. 
- Fix navigation. Maybe use paths `/editor` for the editor. Use `?tag=...` for the document tag. `#settings` or `#gallery` for the view, etc.
- No way to create "Groups". Add a "folder-plus" icon in the same row as the  "Objects" header, right-aligned, to create a new group. Only show the icon when multiple objects are selected. 
- user requested a "pan" feature for the editor. Add one more icon in the view icon section.
- Handle paste properly. Paste images -> imported as a new image object. Paste text -> imported as a new text object. 
- Recent view in gallery doesnt show a preview of the document. It only shows the label's preview image. Add a small preview of the document in the recent view.

### P14 — Quantization round 2 (tone curve, Ostromoukhov, live preview)
State: **Planned 2026-10-17 (owner items); NOT STARTED.** Deferred out of the P13b session, which closed
the P13 backlog — this is its own phase with its own action plan when it runs (`phase14_action-plan.md`).
Owner item list (2026-10-17), in the owner's order:

1. **Tone curve / gamma LUT, per strategy, with a sensible default.**
   A pre-dither tone mapping applied before the quantizer, configurable **per strategy** (`threshold` /
   each diffuser) alongside the existing per-strategy defaults. Insertion point is the engine in
   `src/core/render/quantize.ts` (before the threshold/diffusion pass, i.e. on the projected 8-bit value).
   Params must ride the existing plumbing end-to-end: `QuantizerDefaultParams`/`QuantizerDefaults`
   (`quantize.ts:42-50`) → `quantizerDefaults` in the settings store → `resolveQuantizerParams` /
   `policyKeyOf` / `quantizerSettingsKey` (`src/core/render/policy.ts`) → `preferenceValidation.ts`
   → the **Rendering** settings section (`src/components/settings/RenderingSection.tsx`).
   **⚠ Any pixel-changing param MUST be keyed in `policyKeyOf`** (`id:threshold:strength:serpentine` today)
   or two nodes differing only in the tone curve silently share one mask slot and the first wins — that is
   exactly the D-57(b) trap; and it must be in `quantizerSettingsKey` or previews/thumbnails go stale
   (R13-c). The 8-slot mask palette (**R13-a**) gets one more way to overflow.
   - **Open decision (settle before coding):** "sensible default" = **neutral identity** (gamma 1.0 /
     amount 0 — every existing doc renders byte-identically until the user sets it) **or** a **non-neutral
     recommended default** (e.g. gamma ≈1.8, per the ScreenStyle demo's `index.html:88-89`, which visibly
     changes every existing document — acceptable at v0 alpha but a deliberate output change).
2. **Drop Bayer / screentone / ScreenStyle / ScreenVAE — for now** (owner decision 2026-10-17).
   No ordered/Bayer dithering, no screentone, no ScreenVAE/ScreenStyle integration. This is a
   **documentation/register** item: make the "what is missing" lines say **dropped by owner**, not
   "pending" (`memory/dithering.md` §4/§7 — including the head-locked-pitch precondition for screentone —
   and `memory/screenstyle-quantization.md`), and update the debt register accordingly. Keep the analysis
   for a future revisit; do not delete it.
3. **Implement Ostromoukhov** (variable-coefficient error diffusion, SIGGRAPH 2001).
   - **BLOCKER, resolve first:** `memory/dithering.md:35` records the coefficient table as
     **unobtained** — *"Table size / range / values are unverified — do not invent them."* The phase must
     **obtain a citable table** (paper appendix or a reputable implementation) *before* writing engine
     code. If it cannot be sourced, stop and take it back to the owner — do not invent coefficients.
   - Implementation shape: a new table-driven diffuser path beside `createDiffuser`
     (`quantize.ts:66-139`) — coefficients selected by the current pixel's intensity (the paper's table is
     indexed by level, with the alternating/perturbation details to be taken from the source), then the
     usual plumbing: `QuantizerId` + `QUANTIZERS`, per-strategy params, the inspector
     (`inspectorModel.ts RESERVED_FIELDS` + `quantizerParamVisibility`), persistence validation, and the
     Rendering section. Leave `DEFAULT_POLICY_BY_TYPE` alone unless the owner wants it selectable as a
     per-type default.
   - Interacts with **D-05**: the error must stay contained per policy region, and it must respect the
     mask/policy pass and the 8-slot palette budget (**R13-a**).
4. **Live quantization preview while tuning.**
   While a quantization value changes — the per-node inspector knobs and/or the per-strategy defaults —
   the canvas should show the **quantized** result, then revert to the normal colour view after a short
   timeout with no further change. Rationale: the editor canvas draws colour Konva shapes, so today
   nothing on screen shows what the printer will actually produce, which makes tuning blind.
   - **Recommended: preview the whole canvas**, rendered through the same pipeline as print
     (`renderLabelPage`) and overlaid on the label area (the existing DOM-overlay precedent —
     `Overlays.tsx` / `TextEditorOverlay`) with `pointer-events: none`; debounce the render (target
     <100 ms), cap the dpi, and auto-revert after ~1.5 s idle. An **object-only** preview is *not*
     recommended: quantization is a **global** pass with per-object policies (policy fallback and the
     shared mask palette are decided across the whole label), so a per-object view would show something
     the printer will not produce.
   - Reuses the P13 cache-key work (`quantizerSettingsKey`, `previewOptionsKey`, `overridesContentKey`) so
     a stale result cannot be shown.
   - **Open decision (settle before coding):** the per-strategy/per-type defaults live in the **Rendering
     settings modal** (`SettingsModal` → a modal `<dialog>`), where the canvas is hidden behind the
     dialog — so a canvas preview is pointless there. Choose one: **(a)** trigger from the **inspector**
     knobs only (canvas visible; the main tuning surface), **(b)** give the settings surface its own
     inline preview (like the print dialog's page preview, `PrintPagePreview` from P10/W5), or **(c)** make
     that section non-modal. The owner left the choice open ("depending on what's more convenient").
   - Risks: per-keystroke/drift render cost (debounce + dpi cap), and the preview must never mutate the
     doc or push an undo entry.

Sequencing suggestion: items **1 ∥ 3-research** first (both are engine work gated by the two open
decisions above and, for 3, by the table), then **4** (UI-heavy, depends on the tone curve/Ostromoukhov
params existing), then **2** (docs-only cleanup, any time). One semantic commit per item, after its review
pass — the run's standing convention.

## Risks & checkpoints

- **R1 — resolved by the D decision (2026-10-09).** D keeps the symbol filling the authored box, so the owner-decided target-based verdict formula is correct verbatim: no drawn/target divergence, no 6–8.4 mm shrinkage band, no checkpoint table needed. Residual, owner-accepted: N/N+1 device-px module pitch where the factor is fractional (≤ 1 px at 203 dpi = 0.125 mm, within scanner noise).
- **R2 — enabledAnchors (P3):** corners-only via `enabledAnchors`, keep the `isCornerAnchor` gate in the commit path (release-snap risk).
- **R3 — multi-selection preserve (P3):** click-without-drag must still collapse; shift-click must still work. Test matrix before review.
- **R4 — refresh tick (P6):** must ride the single-flight queue (superseded passes bail) and stay silent without live sources; StrictMode double-mount idempotent.
- **R5 — global handlers (P4):** arrow-key branch respects the dialog-open guard.
- **R6 — drvfs slow:** prefer `tsc`; full builds only at the end.
- **R7 — linked duplication (P12):** most invasive model change; last phase, design first, reviewer gate hard.
- **R8 — stacking fix alpha/z-order (P2, owner-explicit):** the mask must follow actual visible coverage per leaf in z-order — transparent fill (ink only), opaque fill (whole rect), symbol-over-symbol (top ink wins, transparent parts inherit below). Test the full matrix through `renderLabelPage`; error-diffusion across policy boundaries stays debt D-05.
- **R9 — quiet zones default ON (P2, accepted breaking):** existing docs' symbols shrink (v2 QR: 25→33 module budget ≈ 24% smaller modules) and some newly warn — intended at v0 alpha. P2 must update P1's verdict budget and tests in the same phase (expected extension, not rework). Zone rendering couples to `fill` colour/transparent.

## Execution notes (coordinator)

- Per phase: write `phase{N}_action-plan.md` here, then implement → review (`experimental-review` primary) → fix (max 2 rounds) → semantic commit → ask owner before the next phase.
- Sub-agents: `general` for logic, `small-coder` for bite-size mechanical items, no `ui-designer` this run (owner screenshots instead, P10).
- Parallelize independent items inside a phase (background subagents) — see [`memory.md`](../memory.md) fan-out notes.
- At the end: escalate durable facts to `agent/memory.md` / area files (P2 supersedes `objects-assets.md:38-42`; reconcile D-05/D-34); keep this dir task-scoped.
