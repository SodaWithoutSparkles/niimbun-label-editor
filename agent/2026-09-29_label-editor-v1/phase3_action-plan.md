# Phase 3 Action Plan — Editor core (M2/M3)

**Run:** `agent/2026-09-29_label-editor-v1` · **Owner:** Coordinator · **Plan ref:** `plan.md` P3
**Status:** ACTIVE (2026-10-04). Owner UI spec received: **`ui-spec.md` (FINAL for P3) is authoritative for the shell.**
**Prereq:** P2 done (`40a7331`…`b0a55f3` + owner preset `97d1720`, docs to `4475352`). Read this file **and `ui-spec.md`** before starting.
**Decisions locked 2026-10-04:** strip the rich-color model (`ColorPreset`/`colorsSlice`/`DualColorPicker`); keep minimal per-object `ColorPicker`, default black; multi-select + transform box in v1; one semantic commit per area (coordinator asks before each). `react-konva@^19.2.1` is already installed — no new dependency needed. `ui-designer` is NOT to be used (owner did the design; `ui-spec.md` is the spec).

> **Owner constraint (2026-10-04): the owner designs the UI/layout first.** This plan therefore covers the
> **engine, document operations, and wiring** — the parts that exist regardless of how the editor looks.
> It deliberately does **not** specify layout, panel placement, toolbars, colors, or component structure.
> Do not delegate to `ui-designer` and do not invent visual design. Where UI is needed, this plan names
> the **seam** and waits for the owner's design.

> **Owner UI direction (2026-10-04) — shuts down the drawing-app defaults:**
> - **Expect a screenshot or crude mspaint drawing as the UI spec.** Treat it as the design: read it, restate
>   the structure/geometry back, ask about ambiguities, implement to fit. Never redesign it.
> - **The full-screen pannable canvas is overkill.** Labels are small (25×78 mm; realistically ≤ ~100×150 mm).
>   The canvas is a **bounded, fit-to-viewport stage** — zoom is a view control, not an infinite pan. It does
>   **not** get the biggest share of the window.
> - **Keep the object/layer stack.** The node tree over `parentId` is real and needed (plan line 247).
> - **Shrink the left tool rail.** The drawing app's 8-tool toolbar is for a sketchpad; the label editor needs
>   few tools (text, shape, image, QR/barcode, group). The freed space goes to config.
> - **Reserve space for object-specific config** — mirror/flip, content source (templating), quantizer hint,
>   visibility/lock/transform. This is where the editor exceeds the template. Likely shell: narrow left rail +
>   bounded centre canvas + **right side stack (object list on top, selected-object config below)**.
> - **Guardrail:** don't let the right panel become a dumping ground. P3 wires only config P3 can act on
>   (transform, visible/locked, z-order, static content, shape/text props). **Templating + trust are P6** and
>   **quantizer policy is P4** — those fields land as the panels' *data model* now, wired when their phase lands.

---

## 0. Orient first (do not skip)

1. This file.
2. `agent/2026-09-29_label-editor-v1/state.md` — P2 outcome, deviations, and the two carry-overs that matter here (§5 below).
3. `agent/memory.md` → `agent/memory/store-and-slices.md` (how the editor slice should fit), `agent/memory/testing.md` (browser-only list — **canvas rendering is in it**), `agent/memory/print-transport.md` (only if touching `src/print`).
4. Plan sections: **Editor / UI architecture** (lines ~244–252), **Phases P3 row** (line 292), **Reuse / strip map** (276–282), **Decisions log** (esp. 5, 9, 20/26, 39).
5. Existing code you build on: `src/core/doc/*` (types/derive/factory), `src/store/slices/docSlice.ts`, `src/components/canvas/*` (the template's Konva editor — **to be stripped/adapted, see §2**), `src/components/layout/MainLayout.tsx`.

**Reference clone (craft only, never copy the model):** `references/niimblue/src/components/LabelDesigner.svelte`, `src/utils/undo_redo.ts`, `src/fabric-object/custom_canvas.ts`. Our model differs by design (flat `nodes[]` + `parentId`, integer hm); use these for *interaction* details only.

---

## 1. Scope (frozen)

P3 makes a label **editable and reloadable**. Deliver the engine and the document operations, plus thin
seams for the owner's UI:

1. **Editor viewport engine** (headless-testable): world ↔ screen transform, **bounded** zoom/pan over a fit-to-viewport stage, hit-testing, snapping math.
2. **Document operations** on `docSlice`: add/remove node, update node props, reparent/reorder, group/ungroup, clone, delete, z-order — all pure and undoable.
3. **Undo/redo**: snapshot-based on the document slice, capped, never serialized (plan line 249).
4. **Editor render path**: resolve `LabelDoc` → Konva nodes for the **editor viewport** only. Region overlay + keep-out warnings (data + class hooks, not styling).
5. **Node tree + inspector data layer**: the operations and selectors the panels need — including the config fields the owner wants reserved (mirror/flip, visibility/lock, transform, content source, quantizer hint). Panel *presentation* is the owner's.
6. **Strip the dead template editor** (plan line 280) — this is scheduled P1–P3 work and is still outstanding.

**Explicitly out of scope:** all visual/layout design; the print/render pipeline + quantizers (P4); templates/trust/CSV (P6); asset import UI (P5). **Do not design UI.**

---

## 2. Strip the dead template editor (do this early)

`plan.md:280` lists the strip list and notes **none of it is stripped yet**. P3 owns removing the drawing-app leftovers so the editor is not carrying two models:

- `useDrawingTools` + shapeHelpers draw state machines; callout/star/arrow tools; drawing `toolSettings`.
- Color-preset model (`ColorPreset` / `colorsSlice` / `DualColorPicker`) — *unless the owner's design reuses it.*
- **Keep (adapt), do not rebuild:** `Toggle`/`SettingRow` form kit, `PopoverSlider` (currently unused — the inspector revives it), `ColorPicker` (minimal). The **object/layer stack panel is kept** (owner 2026-10-04).
- **Tool rail is reduced, not kept as-is:** the drawing app's 8-tool toolbar is overkill. Keep only what a label editor needs (text, shape, image, QR/barcode, group). **Which tools and where is the owner's design** — provide the tool registry, not the layout.
- **`ExportModal` UI**: strip (pure export helpers in `hooks/export/{capture,download,utils}.ts` stay for P8).
- `SaveFile` drawing coupling (`SaveFile` type + `buildSaveFile`) — superseded by `LabelDoc`.
- Dead `polygon` `CanvasItem` type — superseded by the real `Region`/node polygon.
- **`localStorage` autosave** — already removed from `Header.tsx` in P2; confirm nothing else writes `autosave_project`.

**Gate:** after stripping, `bun run test:run` + `bun run build` stay green and the gallery is unaffected.

---

## 3. Editor viewport engine (`src/editor/`, headless)

`src/core/` must stay React-free; put the viewport **math** in `src/core/` (or a new `src/core/viewport.ts`) and keep the React binding thin.

- `worldToScreen(hm, viewport)` / `screenToWorld(px, viewport)` — pure, integer-disciplined (hm stays int; screen px may be float).
- Viewport state `{ x, y, zoom }` — **never stored in the document** (plan line 245).
- **Bounded stage, not an infinite pan (owner 2026-10-04):** the label is small, so the backing is rendered **fit to the available canvas area** and zoom is a view control. Pan is clamped so the label can never be lost off-screen. Do **not** build free-form infinite panning; do not give the canvas the largest share of the window.
- Snapping: to backing edges, region edges, and sibling node bounds; grid snap optional via config. Pure functions returning candidate deltas.
- Hit-testing against transformed node bounds (`effectiveTransform` from `derive.ts`).
- **Tests (unit):** round-trip `screenToWorld(worldToScreen(p)) === p` within tolerance; zoom-independence of hit-testing; snap candidates; **pan clamping** keeps the backing within bounds at every zoom.

---

## 4. Document operations + undo (`docSlice`)

Extend `docSlice` (or add `editorSlice` if cleaner — justify in the receipt) with **pure operations over `LabelDoc`**:

- `addNode(node)`, `updateNode(id, patch)`, `removeNode(id)`, `cloneNode(id)`, `reparentNode(id, parentId, index)`, `moveNodeZ(id, dir)`, `groupNodes(ids)`, `ungroupNode(id)`.
- Every op: operate on a **structured clone** of the doc, **never mutate the stored doc**, set `meta.updatedAt` (epoch seconds), and push one undo entry.
- **Node ids:** `newLabelId()`-style fresh ids (decision 39); clone/reparent must never duplicate an id.
- **Undo/redo:** snapshot the doc slice, capped (~20, matching the template's cap), truncate on branch, **never serialized** into `.lbl.json.gz`.
- **Autosave → IDB** (the P2 carry-over): debounce the editor's doc changes into `labelRepo.save`. This closes P2's "autosave not yet moved to IDB" deviation.
- **Tests (unit):** each op (incl. group/ungroup, reparent cycles rejected), id uniqueness after clone, undo/redo sequences, autosave debounce writes to an injected memory repo.

---

## 5. Editor render path (`src/editor/render/`)

- `resolve(doc)` → a resolved node list (static text/line/rect/ellipse/polygon/groups). **No template execution** (that is P6).
- `createKonvaNode(resolvedNode)` factory — **plain Konva, offscreen**, shared with P4 (plan line 211). P3 wires it for the **editor viewport** only; do **not** build the rasterize→clip→quantize path (P4).
- **Region overlay:** expose region union geometry (reuse `regionUnionBounds`; **respect the nonzero-winding requirement** recorded in `plan.md`/`phase2_action-plan.md`). Non-printable area is *data*; how it looks is the owner's design.
- **Keep-out warnings:** a pure predicate `nodesIntersectNonPrintable(doc)` returning the offending node ids for the UI to badge.
- **Score-line / guide overlay seam (owner 2026-10-04):** the F-tag has a **semi-cut score line** (grey dashed, fold-in-half guide). It is **not** a `Region`, never clips, never prints. Provide a seam so the editor can *show* non-printable guides: a `guides` concept on the resolved/editor view (not in `union(regions)`, not in the doc's region list). Keep it data-only — how it looks is the owner's design. Do **not** model it as a region and do **not** let it affect the clip. **Owner-pinned coordinate (2026-10-04): the F-tag score line runs vertically down the middle of the flag, `(12.5 mm, 0)` to `(12.5 mm, 38 mm)` = `(1250, 0)`→`(1250, 3800)` in `hm`.**
- **Carry-over from P2:** `regionUnionBounds` currently has **no production consumer** — P4 rendering wants union bounds denormalized. If P3 needs them for the overlay, denormalize into `LabelSummary`/the editor's resolved form and record it.
- **Tests:** resolve snapshots (deterministic), keep-out predicate truth table. `plan.md:38` — the editor raster is a **viewport projection** and is *never* pixel-compared to the print raster; do not write golden-pixel tests here (those are P4).

---

## 6. Panels — data layer only (no design)

Provide what the owner's panels will consume; **the owner designs the panels and their layout.**

Owner's intended shell (2026-10-04): **narrow left tool rail + bounded centre canvas + right side stack** (object/layer list on top, **selected-object config below**). The right side is where object-specific config is reserved.

- **Tree:** selectors for hierarchy (children from `parentId`), z-order, selection state, and the mutation actions to reorder/reparent.
- **Inspector — reserve the config fields the owner named:** mirror/flip, visibility/lock, transform, content source (static now; CSV/template are P6), quantizer hint (field now; P4 wires it).
  - **P3 wires only what P3 can act on:** transform, visible/locked, z-order, static content, shape/text props.
  - **Templating + trust = P6; quantizer policy = P4.** Ship those as the **typed field model** so the panel can render a disabled/stub state, but do not implement their engines here.
  - **Per-object vs per-region:** flip/mirror is per-object now. **Per-region mirroring** was flagged by the owner as a future *editor-configuration* feature (regions stay pure geometry, addressed by index — see `agent/memory/niimblue-reference.md`); don't add region schema fields for it.
- **Cross-cutting:** every op must remain correct if the owner changes panel structure — keep operations out of components.

---

## 7. Rules

- `src/core/` and `src/editor/` engine modules: **zero React imports** (invariant: headless engine). Keep the React binding in components.
- **Integer `hm` discipline** everywhere; the doc only stores ints (see P2's integer-scan test).
- **No new dependencies** without the owner's explicit approval (`react-konva` may be needed — **ask first**; `konva` alone may suffice if the owner wants minimal).
- `tsc` strict; tests typechecked. **Never run tests/build through `bunx`/`npx`** (AGENTS.md rule). Working commands in this checkout: `bun run test:run` and `node_modules/.bin/tsc.exe --noEmit` — there is **no** bash symlink at `node_modules/.bin/tsc` (only `tsc.exe`/`tsc.bunx`), and `node node_modules/typescript/bin/tsc` is not on the permission allow-list.
- Canvas/pointer interaction is **browser-only** (`memory/testing.md`): unit-test the math, verify interaction headed.
- Every product string through `t()` (decision 40). Global `keydown`/`paste`/`drop` handlers bail on `dialog[open]`.
- **Do not design UI.** If a decision is visual, stop and ask the owner.

---

## 8. Gate

1. `bun run test:run` green · `bun run build` green · `node node_modules/typescript/bin/tsc --noEmit` clean.
2. Exit criterion demonstrated: **open the F-tag label from the gallery → add text + a shape → move/transform → undo/redo → reload → it persists.**
3. Review: `experimental-review` (primary while available) + one narrow re-check; fix rounds ≤2.
4. Update `state.md` + this plan; escalate project lessons to `agent/memory/*`.
5. Semantic commit(s), split by area (`feat(editor): …`, `refactor(editor): strip …`).

### Browser check (required — P2 taught us this)
The P2 create bug passed 242 headless tests and was only caught headed. **Run the editor flow in a real browser** (Windows-bun dev server + `ab`) before claiming done — canvas rendering, pointer interaction, and drag are all in the browser-only list.

---

## 9. Report (phase receipt)

```
## Phase 3 — {summary}
- done: [what shipped]
- tests: [result]
- reviewed: [by whom, verdict]
- browser: [what was verified headed]
- committed: [hashes]
- next: [P4 ready | escalation]
```

---

## 10. Owner questions — RESOLVED (2026-10-04)

0. **UI spec:** delivered as `ui-spec.md`, FINAL for P3. Layout = Header / Insert rail / Preview / View controls / MFP / Object-layers / Status bar. Right column ~280 px; insert rail ~48 px; row A/B ≈ 55/45. Implement the spec; never redesign it. If a genuinely visual decision is unspecified, stop and ask.
1. **Engine seam:** viewport math + doc ops land first; panels render from selectors. `ui-spec.md §14` is the P3 scope call-out.
2. **`react-konva`** — already installed. No approval needed.
3. **Color presets** — **strip** `ColorPreset`/`colorsSlice`/`DualColorPicker`. Keep minimal `ColorPicker` for per-object stroke/fill, default black. Red+black is post-v1 (too rare to justify a zone). Dither/colour-space work is image/pipeline (P4).
4. **Selection** — multi-select + transform box in v1; marquee + shift-click; MFP bulk mode (`ui-spec.md §10`).
5. **F-tag geometry** — 3-region shape **stays**; the `(1500,3800)` bite is an accepted approximation; the grey score line is **not** geometry (guide seam §5). Do not "repair" the bite.

---

## 11. Workstreams & sequencing (coordinator)

Order avoids double-editing: pure engine first, then store ops, then the shell (which deletes the old layout components), then strip the now-unreferenced dead modules.

| WS | Area | Files (owner) | Depends on |
| -- | ---- | ------------- | ---------- |
| W1 | Viewport engine (headless, zero-React) | new `src/core/viewport.ts` (+ test) | — |
| W2 | Render path (resolve + Konva factory + overlay/keep-out/guides) | new `src/editor/render/*` (+ tests) | core doc types |
| W3 | Document ops + undo/redo + autosave→IDB | new `src/store/slices/editorSlice.ts`, `storeTypes.ts`, `useStore.ts` (+ tests) | — |
| W4 | Tree/inspector selectors + typed inspector field model | new `src/editor/selectors.ts`, `src/editor/inspectorModel.ts` (+ tests) | core doc types |
| W5 | Shell rewrite to `ui-spec.md` (Insert rail, Preview, View controls, MFP, Object/layers) + multi-select/marquee/bulk + one-shot insert in `toolsSlice` | `MainLayout`, `Header`, `BottomBar`, new `src/components/editor/*` | W1–W4 |
| W6 | Strip dead template modules (post-W5) | canvas/* drawing, `colorsSlice`, `DualColorPicker`, `ExportModal`, `SaveFile`, dead polygon, `toolSettings` | W5 (no remaining refs) |
| W7 | Calibration setting + status-bar row popup stub + i18n keys | settings section, `BottomBar`, `en.json` | W5 |

**Parallel round 1:** W1 + W2 (disjoint files, no store edits). **Round 2:** W3 + W4. **Round 3:** W5 (+W7). **Round 4:** W6 strip. Review each area (`experimental-review` primary; `review-fast` for narrow/mechanical), fix ≤2 rounds, commit per area.

## 12. Stubs / deferrals in P3 (ship the seam, wire the engine)

- Insert rail `Image` / `QR` / `Barcode`: entries render **disabled** (P5 engines). `Text` + `Shape` wired.
- MFP `Data source` tab: stub panel (P6). MFP `JS` tab: disabled-with-reason stub (P6 trust).
- Status-bar row selector: stub with "no CSV" empty state (P6).
- Inspector fields for templating/trust/quantizer-policy: typed model + disabled state (P6/P4).
- No new dependencies. Chrome styling inherits the existing template look.

## 13. Node geometry & resize model (owner-confirmed 2026-10-04)

The plan elides node type-specific fields (`plan.md:100`) and P2 shipped only the discriminated union. P3 defines them. Additive, integer `hm`, validated.

**Storage (`src/core/doc/types.ts`):**
- `BaseNode.size?: { w: hm; h: hm }` — local bounding box for text / image / shape(rect|ellipse) / qr / barcode.
- `ShapeNode`: `cornerRadius?: hm` (rectangle); line/polygon use `points: [hm, hm][]` (+ `closed` for polygon) instead of `size`.
- `TextNode`: `fontSize: hm`, `fontFamily?: string`, `fontStyle?: string`, `align?: 'left'|'center'|'right'`, `letterSpacing?: number`, `lineHeight?: number`, `direction?: 'ltr'|'rtl'`; `size` is the text box.
- `ImageNode`: `size` = display box; intrinsic stays on `ImageRef.widthPx/heightPx`.
- `QrNode`/`BarcodeNode`: `size`; payload `data`; symbology options are P5.
- `LabelDoc.meta.presetId?: string` — records the originating preset id (drives guide derivation, §5).

**Transform vs size rule:** `transform.scaleX/scaleY` default `1`. A **leaf resize bakes into geometry and leaves scale at 1** (print math reads geometry directly; no compounding). Group scale/rotate stays post-v1 (decision 13).

**Resize op — `resizeNode(id, target: {w: hm; h: hm}, opts?: { preserveAspect?: boolean })`** (in `editorSlice`, commit path; a transient variant for drag):
- Aspect-preserving is the default for circle/ellipse/QR/image; free resize only when the UI passes `preserveAspect: false`.
- rect/ellipse/image/qr/barcode: `size` scales; `cornerRadius` scales by the **uniform** factor (min of the two axis factors) so corners don't distort.
- text: `size` (box) scales; `fontSize` scales by the uniform factor; free resize changes the box/wrap only (fontSize unchanged).
- line/polygon: each `points` coordinate scales by `(sx, sy)`.
- `strokeWidth` (if present) scales by the uniform factor.
- All results rounded to integer `hm`; `size.w/h` clamped `≥ 0`; `fontSize` stays `> 0`.

**Validation (`validate.ts`):** sizes/radii/points are integers; `size.w/h ≥ 0`; `fontSize > 0`; extra-field handling consistent with existing rules. Update the P2 integer-scan test.

**Wiring:** `resolve.ts` reads the real fields (replaces the temporary `NodeGeometryExtras` defaults); `inspectorModel.ts` lists them per type; `factory.ts` seeds defaults and rounds. Owner reviews the model at the P3 commit gate.
