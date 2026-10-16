# Phase 13 — Configurable dithering + drag-to-draw shapes (action plan)

- Run: `agent/2026-10-09_round-2-fixes/`. Source: owner request 2026-10-16 (2 items), folded into
  plan.md §P13 (the miscellaneous bucket). The **older P13 items stay open** — see §Deferred.
- Recon: 3 × `explore` (shape insert path + the `template-webui` reference; quantizer defaults
  plumbing; settings surface). Facts below are verified.
- Two independent tracks → one review gate, **one commit per track**.

## Outcome (2026-10-17) — DONE

- **Track R shipped:** `8bbc59b` · **Track S shipped:** `1e5d2e7` · docs/memory: `c543c29`,
  `4e8ca0a`. Review gate 1 = request-changes (0 blockers / 3 majors / 1 risk / 1 nit) → fix round 1
  → narrow re-review **approve** (0 findings). The two real majors were one root cause:
  `applyPolicy` merges the global base **under** each policy's options, so an omitted `serpentine`
  silently inherited the base value — every pixel-changing knob is now explicit per policy, and the
  global pass reads its own strategy's default.
- `tsc` clean; **154 files / 1945 tests** green (+1 file / +65 tests this phase). **D-57 closed.**
- One reviewer finding was **declined**: a `shape` entry in the per-type quantizer select (a solid
  fill cannot be dithered meaningfully, and it would spend one of the 8 mask-palette slots).
- **Remaining work of the P13 bucket = §Deferred below** — this is the next session's queue.

## Owner decisions (2026-10-16 — all accepted)

1. **Drag scope:** `shape:rectangle`, `shape:ellipse`, `shape:line`. text/image/qr/barcode/code keep
   click-to-place with their fixed default boxes (they are content boxes, not drawn shapes).
2. **Click without drag:** falls back to the **current default box** (`DEFAULT_BOX` 1500×1000) —
   reusing `COLLAPSE_DRAG_THRESHOLD_PX = 3`. No dead gesture; drag is the primary path.
3. **Modifiers / ellipse:** **shift** = square/circle (line: 45° snap); **ellipse is box semantics**
   (corner-to-corner, like the rect) — *not* the reference's centre-origin radius drag.
4. **Dither scope — all three:** per-strategy param defaults **and** a per-object-type default
   quantizer **and** per-node `serpentine` (which closes **D-57(b)**).
5. **Terminology:** `threshold` → "Threshold"; `floydSteinberg`/`stucki`/`atkinson` → "**Error
   diffusion**" + a "Serpentine scan" control. The generic "Dither strength" label for every strategy
   goes away (that was D-57(c)). Settings live in a **new "Rendering" settings section**.

## Track R — configurable dithering

### R1 — model + plumbing (no UI)
- **Settings state** (copy the `gridSpacingHm`/`connectMethod` precedent — `storeDefaults.ts`,
  `storeTypes.ts:125-149`, `settingsSlice.ts:62-106`, `useStore.ts:29-39,146-155`,
  `preferenceValidation.ts:18-28,152-176,182-209,218-237`, `legacyStorage.ts`):
  - `quantizerDefaults: Partial<Record<QuantizerId, { threshold?: number; strength?: number; serpentine?: boolean }>>`
    — allow-list keys against `QUANTIZERS`; clamp threshold `[0,255]` int, strength `[0,4]` 2 dp.
  - `defaultQuantizerByType: Partial<Record<NodeType, QuantizerId>>` — **seeded from
    `DEFAULT_POLICY_BY_TYPE`** (`core/render/policy.ts:17-22`), which stays the fallback.
- **Read sites** (exhaustive, from recon):
  - `renderLabelPage.ts:523-529` global pass (`opts.quantizer ?? 'threshold'`) and `:404-411`
    `buildQuantizeOptions`;
  - `:514-517` mask defaults + `:268-269` per-node fallback (currently literal `?? 128` / `?? 1`);
  - `policy.ts resolveQuantizer` (`DEFAULT_POLICY_BY_TYPE`) — **`core/` must stay store-free**:
    take the maps as an argument with the module constant as the default. Same for `print/`.
  - **Layer contract:** nothing under `core/` or `print/` may import the store. Thread the maps
    through `RenderLabelPageOptions` (like `dpi`) and have the store-aware components
    (`PrintDialog`, `PrintPagePreview`, `usePrintThumbnails`, `EditorShell`) supply them.
- **Per-node `serpentine`** (closes D-57(b)): `quantizerParams.serpentine?: boolean` in
  `core/doc/types.ts:79`; a **new `toOptionalBoolean`** guard in `validate.ts` (mirror `toQuietZone`
  `:333-338`, drop-with-repair) + `factory.ts:98-118` round-trip; **extend `policyKeyOf`
  (`renderLabelPage.ts:210-211`) to include `serpentine`** — without it two nodes differing only in
  serpentine share one mask slot and the first silently wins.
- **Cache/staleness:** `previewOptionsKey` (`PrintPagePreview.tsx:76-84`) and `overridesContentKey`
  (`usePrintThumbnails.ts:127-136`) key only `dpi|invert|mirror|offset` → add the quantizer settings
  (or a settings revision) or a default change shows a stale preview/thumbnail.

### R2 — per-strategy UI + settings section
- **New `Rendering` settings section** (`SettingsModal.tsx:30-69`; model it on `ToolsSection`;
  primitives are `components/common/forms/{Input,NumberField,Select,Toggle,SettingRow}`; the
  number-field-to-persisted-setting pattern to copy is `GeneralSection.tsx:225-247`):
  per strategy — `threshold`: a Threshold number; `floydSteinberg`/`stucki`/`atkinson`: an **Error
  diffusion** number + a **Serpentine scan** toggle; plus per-object-type default-quantizer selects.
- **Inspector per-strategy labels** (`ObjectTab.tsx:639-644` gate becomes per-strategy):
  `threshold` shows **Threshold only** (strength/serpentine hidden — they do nothing);
  diffusers show **Error diffusion** + **Serpentine scan**. Add a `quantizerSerpentine` field to
  `inspectorModel.ts RESERVED_FIELDS` (`:208-217`) — a **select** with `['', 'on', 'off']` mapped to
  `undefined | true | false`, reusing the existing `''`-means-auto convention from `quantizerHint`
  (avoids inventing a new field kind). Field labels/ranges at `ObjectTab.tsx:196-197,287-290,543-557`.
- i18n (this track is the only `en.json` writer): `settings.rendering.*`, the per-strategy labels,
  `quantizerStrength` → "Error diffusion", a new serpentine label, replacing the generic
  "Dither strength" (`en.json:687-689`).

### R3 — tests
Settings default/reset/normalize round-trip (`preferenceValidation.test.ts` pattern) + a section
render test (`GeneralSection.test.tsx` pattern); render-level: a settings strength/threshold changes
the quantized output, `defaultQuantizerByType` wins over the module constant, per-node
`serpentine` reaches the diffuser, and **`policyKeyOf` distinguishes two nodes differing only in
serpentine** (the D-57(b) guard); validate round-trip + repair for `serpentine`.

## Track S — drag-to-draw shapes

### S1 — geometry + gesture
- `insertActions.ts`: add a box-based insert for rect/ellipse/line (e.g.
  `createNodeForBox(action, start, end)`, keeping `createNodeForInsert` for the click fallback).
  **Normalize** a negative/up-left drag to min-corner + `abs` size (the doc stores
  `transform.x/y` + `size{w,h}`; the reference's signed w/h do not map). Shift = square/circle;
  line = 45° snap. Reuse `shapeKindForAction`/`SHAPE_ACTIONS`/`base()` and `DEFAULT_BOX` for the
  click fallback.
- `PreviewStage.tsx`: turn the armed-tool branch (`:654-663`) into a press-drag gesture —
  `pointerdown` records the start, `pointermove` updates a **live draft** (follow the polygon
  precedent: dashed Konva draft at `:1390-1412`, `screenToHm`, `snapPolygonPointIfEnabled` with
  `SNAP_THRESHOLD_PX`, `gridSpacingHm`), `pointerup` commits via `addNode` + `selectNode` (one undo
  entry). Reuse the existing window-level `pointercancel`/`blur` finalizer (`:1026-1040`) and add a
  mid-gesture **Escape abort that does not clear the armed tool** (`:1126-1130` currently clears
  both). Sub-threshold drag (`COLLAPSE_DRAG_THRESHOLD_PX`, `:66`) → the default-box fallback.
  No `setPointerCapture` exists in the file today — decide capture vs. the window finalizer and say
  which (window finalizer already covers off-canvas release).

### S2 — tests
Unit: box math incl. negative drags, min-corner normalization, shift constrain, 45° line, click
fallback. Interaction (`PreviewStage.interaction.test.tsx` pattern): drag creates one node at the
dragged geometry with one undo entry; Escape aborts and keeps the tool armed; snap applies.

## Sequencing
R1 ∥ S1 (disjoint files) → R2 ∥ S2 → `review` gate → fix round(s) → **two commits**
(`feat(settings)`, `feat(editor)`) or one if the gate prefers; ask the owner.

## Risks
- **R13-a** per-strategy params multiply distinct `(id, params)` combos → the **8-slot mask palette**
  (`renderLabelPage.ts:134,271`) overflows sooner; a node then silently falls back to the global
  pass. Bounded by the per-strategy (not per-node) settings scope + `policyKeyOf` dedup.
- **R13-b** settings must not leak upward: `core/`+`print/` stay store-free (thread via options).
- **R13-c** stale preview/thumbnail if the cache keys are not extended (R1) — the most likely
  "it works but looks wrong" failure.
- **R13-d** the drag gesture touches `PreviewStage`'s pointer lifecycle (already the repo's most
  bug-prone file per `tech-debt.md` D-55): reuse the polygon wiring, do not invent a second
  gesture state machine.
- **R13-e** `serpentine` semantics: default `true`; the inspector's `''` = auto must resolve to the
  settings default, not to `true`, or the setting becomes unreachable for nodes with a hint.

## Deferred — **ALL DONE 2026-10-17 (P13b)**

Every item in this queue shipped, one commit each, each reviewed before its commit:

| Item | Commit |
| --- | --- |
| D-37 polygon preview layer | `f157cbb` |
| navigation (hash scheme, not paths — owner decision) | `cac5005` |
| overlapping-object select priority | `4096e0b` |
| paste handling (image → image node, text → text node) | `9888b01` |
| groups (the folder-plus icon; `groupNodes` + `Ctrl+G` already existed) | `7bea704` |
| gallery "recent" preview (D-50 producer) | `e75c596` |
| D-36 → **closed as upstream touchpad rail behaviour**; mitigation = pan tool + space+drag | `7a3a953`, `fa8f541` |

The phrase "plus the **D-57(a/c) residue**" was **stale** — D-57 is closed (a/b/c) as of this phase
(`8bbc59b`). Full outcome + per-item review verdicts: the Outcome section of
[`phase13b_action-plan.md`](phase13b_action-plan.md).

**Remaining quantization work is a different list** — see `agent/memory/dithering.md` §4/§7 and
`agent/memory/screenstyle-quantization.md`, plus debt **D-05** (error diffusion across policy boundaries
+ the per-label multi-pass cost) and **R13-a** (8-slot mask palette overflow).
