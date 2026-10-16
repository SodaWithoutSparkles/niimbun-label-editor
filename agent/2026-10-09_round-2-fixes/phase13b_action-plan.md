# Phase 13b — the P13 deferred backlog (action plan)

## Outcome (2026-10-17) — DONE

- **All 8 backlog items shipped, one commit each, every one reviewed before commit:**
  | # | Item | Commit | Review |
  |---|---|---|---|
  | P1 | D-37 draw drafts above the objects | `f157cbb` | `review-fast` approve |
  | N1 | hash navigation (`#/gallery`, `#/editor?doc=`, `#settings`) | `cac5005` | `review` 4M+2R → fix → re-review approve |
  | P2 | selected-object priority for overlapping clicks | `4096e0b` | `review` (1 major declined w/ ruling) → fix → re-review |
  | N2 | paste images/text as objects | `9888b01` | `review` 2 bugs → 2 fix rounds (atomic undo, stale-doc abort, orphan reclaim) |
  | N4 | groups folder-plus button | `7bea704` | `review-fast` approve → nits |
  | N3 | recent-card document preview (D-50) | `e75c596` | `review` → full rework → 2 more rounds → approve |
  | P4 | non-passive wheel listener (D-36 hardening) | `7a3a953` | `review` 0 findings, keep-ruling |
  | P3 | pan tool + space+drag | `fa8f541` | `review` 1M+1R+1m → fix → re-review approve |
- **`tsc` clean; 161 files / 2083 tests green** (baseline 154 / 1945 → **+7 files / +138 tests**).
- **Closed:** D-36 (upstream browser/OS rail behaviour — owner-reproduced on other sites; mitigations =
  pan tool + space+drag + middle-drag), D-37 (fixed in P1), D-50 (producer landed; backfill residual
  recorded).
- **Docs landed with this phase:** `memory/app-shell.md` (new area file: URL grammar, thumbnail pipeline,
  pan inputs, D-36 closure) + an index line; `tech-debt.md` D-36/D-37/D-50 rows; `code-organization.md`
  "not every folder is a layer" + the type-only exception.
- **⚠ Reviewers could not run commands** (`Permission denied: shell` for `review`/`review-fast`/`review-alt`
  this session) — every review was static and the coordinator ran the scoped test/tsc commands itself.
- **Owner browser checks owed:** pan tool + space+drag feel; hash deep links (fresh tab, Back/Forward,
  `#settings`); paste (image/text, and with the printer popover open); groups button; gallery recent cards
  showing the document after an edit.

- Run: `agent/2026-10-09_round-2-fixes/` (round 2). Source: `plan.md` §P13 + **§Deferred** of
  [`phase13_action-plan.md`](phase13_action-plan.md) (the committed next-session queue).
- Baseline at start: `main` = `5d002fa`, **8 commits ahead of `origin/main`** (unpushed), tree clean,
  `tsc` clean, **154 files / 1945 tests** green.
- Owner decisions 2026-10-17: **all 8 items**, **one commit per item**, waves where files allow.
- Reuse the ENV BRIEF in [`state.md`](state.md) verbatim (bun, `tsc` via `node_modules/typescript/bin/tsc`,
  no `bunx`/`npx`, i18n direct `en.json` edits, `dialog[open]` guards, StrictMode, depth-1 subagents,
  **never `git stash`**, browser checks are owner-manual).
- **One writer per file per wave.** `en.json`: **one writer per wave** (see waves).
- Review routing: `review` for logic; `review-fast` for mechanical/narrow diffs.

## Recon (5 × `explore`, verified — do not re-derive)

- **D-36** is **not** an app-side axis lock: `PreviewStage.tsx:1265-1292` applies **both** `deltaX` and
  `deltaY` on a plain wheel; the only axis-zeroing is the shift branch (`:1287-1288`).
  `scout` verdict (2026-10-17, **cited**): React 17–19 register `wheel` on the root container with
  `{ passive: true }` (`react-dom` 19.2.4 `cjs/react-dom-client.development.js:19251-19265`; PR #19654),
  so a React DOM `onWheel`'s `preventDefault()` is a **documented no-op** — Blink returns before setting
  `default_prevented_` and logs *"Unable to preventDefault inside passive event listener invocation."*
  Chromium's axis railing is applied to `cc::ScrollStateData` / synthesized gesture scrolls, **never to
  the wheel deltas JS receives** (WPT `scroll-axis-lock.js`: "The wheel delta will always be the unlocked
  value"); the only wheel-rails filter in Chromium main is **macOS-only**, and Windows precision-touchpad
  axis lock is OS/driver-level and not configurable.
- **⚠ PREMISE CORRECTION (P4 worker, 2026-10-17; under independent review).** The passive finding above is
  true for a **React DOM** `onWheel` — but the stage's `onWheel` was **react-konva's**, not a DOM prop:
  react-konva forwards no `onWheel` to the DOM (`react-konva/es/ReactKonvaCore.js:116-125`) and turns
  `onWheel` into a **Konva event binding** (`react-konva/es/makeUpdates.js:136-138`); Konva binds its own
  DOM `wheel` with **`{ passive: false }`** (`konva/lib/Stage.js:300-307`). So `preventDefault()` was
  **already effective** and P4 is **behaviour-neutral hardening** (the guarantee becomes local + tested),
  not the D-36 fix. Consequence: **D-36 is still unexplained by app code** — the OS/driver axis-lock
  conclusion stands, and the pan tool (P3) is the actual free-direction-pan mitigation.
- **D-36 re-diagnosed.** The register entry ("locked to cardinal if the initial movement is cardinal, even
  if the user changes direction ???") describes the **pre-P4 heuristic wheel classifier**, which P4
  (2026-10-10, owner-directed) **deleted** in favour of the 3-line modifier map, so the register entry was
  stale. Also stale: my own passive-`onWheel` theory (see the PREMISE CORRECTION above). **P4 = a native
  `{ passive: false }` listener on the stage container** — done (`7a3a953`); the reviewer independently
  confirmed the react-konva/Konva claims and **ruled keep** (the guarantee is local and regression-tested
  instead of inherited from a library's binding options). **D-36 CLOSED 2026-10-17 as upstream browser/OS
  rail behaviour**: the owner reproduced the identical rail on **other zoomed-in websites**, so no change
  in this repo can affect it. Mitigations shipped in the same phase — the **pan tool** and **space+drag**
  (P3), plus the pre-existing middle-button drag; none read wheel deltas. See the D-36 row in
  `agent/memory/tech-debt.md`.
- **D-37**: the content `<Layer>` (`:1597`) paints polygon draft (`:1598-1620`) → `InsertBoxDraft`
  (`:1621`) → `resolved.map` (`:1622-1636`) → `<Transformer>` (`:1637`). Both drafts are **below** the
  objects. `listening={false}` is irrelevant to paint order. Fix = JSX order.
- **Select priority**: selection is decided on `pointerdown` (`:724-845`) via `hitTestWorld(world, targets)`
  (`core/viewport.ts:222-232`) — a linear AABB scan over `flattenResolved` order keeping the **last**
  match (= topmost). `targets` built `:452-455`; per-node world AABB map already exists as
  `nodeBoundsById` (`:544-548`, mirrored `nodeBoundsRef` `:582`). Nothing gives the selected node priority.
- **Groups already exist end-to-end**: `groupNodes` (`editorSlice.ts:788`), `Ctrl/Cmd+G`
  (`EditorKeyboardShortcuts.tsx:77`), Edit ▸ Group (`EditMenu.tsx:55`), `GroupNode` (`core/doc/types.ts:94`),
  resolve/validate/konva all handle it. Missing = only the header button in `LayersPanel.tsx:113-115`
  (a plain div; `editor.layers.title` = "Objects"). `groupNodes` returns `null` unless ≥2 ids share a
  parent → the button must be gated on that, not just on count.
- **Navigation**: no routing at all (no router dep, no history/hash reads in `src/`; the only
  `window.location` use is dev flags in `App.tsx:9-14`). `view` (`docSlice.ts:53-62`, writer `openLabel`
  `:180`, `Header.tsx:163`) and `gallerySection` (`viewSlice.ts:23-28`) are store state, not persisted.
  Docs have `meta.id` only — **no tag**.
- **Paste**: zero `paste`/`drop` listeners anywhere; no `navigator.clipboard` use. `en.json:253` has an
  unused `dropToInsert` string. Image chain = `importImageFile` (`assetImport.ts:88`) → `addImageRef`
  (`editorSlice.ts:419`) → `createImageNodeForRef` (`insertActions.ts:274`) → `addNode` (`:347`);
  called from `InsertRail.tsx:98` / `ObjectTab.tsx:533`. Text = `createNodeForInsert` (`insertActions.ts:94`,
  text case `:97-107`, empty static value).
- **Gallery recent preview**: `LabelCard.tsx:82-86` shows `summary.thumb` else `PlaceholderArt` (`:23-58`).
  `labelRepo` resolves `thumb` from the thumbs IDB store then `meta.thumb.dataUrl`
  (`labelRepo.ts:92-102`); **`putThumb` (`:198`) has no caller**, so every card is a placeholder
  (**D-50**). Autosave seam = `saveDoc` (`editorSlice.ts:242-281`) + `flushAutosave` `:286-304`.

## Owner decisions 2026-10-17

1. **Navigation = hash routing**: `#/gallery`, `#/gallery/<section>`, `#/editor?doc=<id>`, `#settings`.
   No SPA rewrite needed. Two-way: URL → store on boot + `hashchange`; store → URL on change.
2. **Doc parameter = `?doc=<meta.id>`** (documents have no tag; no model change, no tag field added).
3. **Recent preview = render-on-save thumbnail + backfill** (wire `labelRepo.putThumb` into the save
   path; a doc without a thumb keeps the placeholder until it is next saved).

## Items, file ownership, waves

Each item: implement → review → fix → **one semantic commit**. A worker never commits.

| # | Item | Files (single writer per wave) | Rev |
|---|---|---|---|
| P1 | D-37 draft paint order | `PreviewStage.tsx`, `PreviewStage.interaction.test.tsx` | fast |
| N1 | Hash navigation | `navigation/urlSync.ts` (new), `App.tsx`, tests (new) | full |
| N2 | Paste handling | `editor/clipboardPaste.ts` (new), tests (new), `EditorShell.tsx` | full |
| N3 | Recent-card doc preview (D-50) | `gallery/thumbnails.ts` (new), `LabelCard.tsx`, `labelRepo.ts` (if the resolve path needs it), save seam, **`en.json`**, tests | full |
| P2 | Overlapping-object select priority | `PreviewStage.tsx`, `PreviewStage.interaction.test.tsx` | full |
| N4 | Groups folder-plus button | `LayersPanel.tsx`, `LayersPanel.test.tsx`, **`en.json`** | fast |
| P3 | Pan tool | `toolsSlice.ts`, `ViewControls.tsx`, `PreviewStage.tsx`, **`en.json`**, tests | full |
| P4 | D-36 non-passive wheel listener | `PreviewStage.tsx` | fast |

- **Wave A**: P1 ∥ N1 ∥ N2 ∥ N3 (en.json writer: N3).
- **Wave B**: P2 ∥ N4 (en.json writer: N4).
- **Wave C**: P3 (en.json writer: P3).
- **Wave D**: P4.
- Rationale: `PreviewStage.tsx` is the repo's most bug-prone file (D-55 / R13-d) → **never two writers**;
  `App.tsx`, `en.json` likewise single-writer per wave.

## Per-item detail

- **P1** move the polygon draft `<Line>` and `<InsertBoxDraft>` **after** `resolved.map` (keep
  `listening={false}`). Test: assert the Konva child order (draft index > last shape index).
- **N1** `urlSync.ts` = pure `parseHash(hash) → {view, docId, section, settingsOpen}` +
  `buildHash(state)` + `applyHash(state)` + `subscribeUrlSync(store)`. Boot-applies, listens to
  `hashchange` (back/forward), writes on store change with a re-entrancy guard; malformed/unknown →
  fall back to gallery, never throw; unknown doc id → stay in gallery.
- **N2** `clipboardPaste.ts` = pure `pastePayload(dataTransfer) → {kind:'image',file}|{kind:'text',text}|null`
  (images win) + the window `paste` handler. Guards: `document.querySelector('dialog[open]')`, and skip
  when the target is `input`/`textarea`/`contenteditable` so the inline text editor keeps native paste.
  Inserts at the viewport centre; `addNode` + `selectNode`. Mount editor-only (`EditorShell.tsx`).
  **No new `en.json` keys.**
- **N3** `gallery/thumbnails.ts` renders a doc to a small blob and the save path calls `putThumb`
  (after `repo.save`, non-fatal). Verify the `LabelCard` resolve path shows it; keep `PlaceholderArt`
  when absent. Backfill = next save. Sole `en.json` writer of wave A.
- **P2** in `handlePointerDown`, before the topmost scan: if the world point is inside a **currently
  selected** node's box (`nodeBoundsById`), that node wins (topmost among selected); otherwise the
  existing topmost-scan behaviour is unchanged. Tests for both branches + the shift-click path.
- **N4** header row becomes flex; right-aligned `FolderPlus` (lucide) button, shown only when ≥2
  selected **ids with a common parent** (mirrors `groupNodes`'s own precondition); click →
  `groupNodes(selectedNodeIds)`; `en.json` key for the title/aria label. Sole writer of wave B.
- **P3** `InsertAction` gains `'pan'` (+ `INSERT_ACTIONS`, `normalizeInsertAction`); icon in the
  **view** icon section (`ViewControls.tsx:188-232`); `PreviewStage`: `activeTool === 'pan'` arms the
  existing `panRef` path on `pointerdown` (`:740-745` → `:912-933`) instead of drawing/selecting,
  `grab`/`grabbing` cursor (`:1571` container cursor), no draft, no selection change. Sole writer of wave C.
- **P4** swap React `onWheel` for a native `addEventListener('wheel', h, { passive: false })` on the
  stage container so `preventDefault()` is effective (scout-verified: the React path is passive, so the
  call is currently a no-op and the browser keeps running its own scroll gesture). Keep the intent map and
  all pan/zoom semantics **unchanged**; adapt the handler from `Konva.KonvaEventObject<WheelEvent>` to a
  plain `WheelEvent` (Konva's `stage.getPointerPosition()` still works) and make sure a canvas without a
  `stageRef`/backing is still a safe early return. Remove the now-dead React `onWheel` prop.
  Escalation rule: D-36's "cardinal lock" as described was the **deleted pre-P4 classifier**; if the owner
  still reproduces it live, do not chase it in app code — report it as OS/driver behaviour.

## Risks

- **R13b-1** `PreviewStage` serialization is mandatory (D-55); the wave table encodes it.
- **R13b-2** `en.json` one-writer-per-wave, relaxed from the phase's original "one writer per track".
- **R13b-3** thumbs add real canvas work to the save path — must be non-fatal (`catch`), and must not
  block the autosave flush. Bounded by the autosave debounce.
- **R13b-4** URL sync must never fight the store (re-entrancy): write only on a real state change and
  ignore the `hashchange` it caused itself.
- **R13b-5** navigation must not persist `view`/`gallerySection` (a reload with no hash must still land
  in the gallery) — `useStore.ts:150-161` `partialize` stays untouched.

## Out of scope

Drop-to-insert (`dropToInsert` key stays unused), `meta.tag`, a real router dep, SPA rewrite, the debt
register beyond D-50 (if N3 lands) and D-36/D-37, and the rest of the P13 misc list.

## N3 fix round 1 — adjudicated review (2026-10-17)

`review` → request-changes (0 blocker / 5 major / 1 risk). Verified against the tree with `explore`:

- **Rejected — "no backfill".** The owner chose *"render-on-save thumb + backfill (existing docs backfill
  once when opened+saved)"*; the reviewer's ask (idle / first-gallery regeneration) is exactly the option
  the owner did **not** pick. Residual, recorded as debt. Not a defect of this diff.
- **Accepted — no asset providers (`thumbnails.ts:49-51`).** `renderLabelPage(doc, ctx, { dpi })` with no
  `opts.assets` → **"absent, those leaves simply draw nothing"** (`renderLabelPage.ts:89-94`): a doc with a
  local image or an imported font rendered a thumbnail *missing its content*. Fix: use the existing
  `createResourceAssetDeps(resourceRepo)` (`usePreparedAssets.ts:99-107`, already used by
  `usePrintJob.ts:95`) — no new provider code.
- **Accepted — layering (`editorSlice.ts:5`).** `code-organization.md:10` "Nothing below imports anything
  above it"; the contract's legal layers are `core/data/store/editor/components` + siblings
  `print/templates/utils` — **`src/gallery/` is not a layer**, and store→editor is already an existing
  violation (`editorSlice.ts:6-7`). Fix: the producer leaves the store graph entirely.
- **Accepted — explicit save bypasses the seam (`docSlice.ts:200`).** `saveCurrentLabel` calls
  `repo.save(updated)` directly (and so does `createLabel` `:148`); only `editorSlice.saveDoc` `:253` wrote
  a thumb → with autosave off, an explicit save produced no preview. Fix: drive the producer off doc
  changes instead of off one save seam.
- **Accepted — no gallery refresh (`GalleryView.tsx:11-73`).** The gallery never reloads on mount and just
  renders the cached `state.gallery`; `refreshGallery` (`docSlice.ts:105-126`) has 4 callers but **not** the
  autosave path or `setView`. So a fresh thumb was invisible until the next create/delete/explicit save.
  Fix: refresh after a successful thumb write.
- **Accepted — out-of-order renders (`editorSlice.ts:256`).** Fire-and-forget renders can land out of
  order; guard with a per-doc monotonic token.

**Fix shape (revised, simpler than injected seam):** repurpose the producer from "store save hook" to a
**components-layer hook** — this removes the layering violation *and* fixes the explicit-save and refresh
gaps at once:

- `src/editor/render/docThumbnail.ts` — pure `renderDocThumbnail(doc, assets?, ctx?) → Promise<Blob|null>`
  (moved from `src/gallery/thumbnails.ts`; editor layer is a legal home), test moved with it plus an
  **assets-present** case.
- `src/components/editor/useDocThumbnail.ts` (new) — debounced on `currentDoc` change (≥1 s, coalesced,
  final write on doc-id change/unmount), renders with `createResourceAssetDeps(resourceRepo)`, writes via
  `labelRepo.putThumb`, refreshes the gallery, per-doc monotonic token for out-of-order renders, never
  throws.
- `EditorShell.tsx` mounts the hook; `editorSlice.ts` drops the `../../gallery/thumbnails` import and the
  `putThumb` call (`:5`, `:255-256`); delete `src/gallery/thumbnails.ts`.
- `LabelCard.tsx` + its test + the `gallery.previewAlt` key stay as they are.
- Scheduling: after N2 (paste) commits — `EditorShell.tsx` is N2's file.

