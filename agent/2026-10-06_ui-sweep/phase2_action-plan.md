# Phase 2 — resize parity (#13) + image replace (#2) (action plan)

- Run: `agent/2026-10-06_ui-sweep/` · Plan: `plan.md` · Baseline: P1 @ `27e7595` (tsc clean, 1227 tests).
- Commit: semantic `fix(editor): …` at end of phase (coordinator asks first).

## Tasks (disjoint files → parallel)

| # | Task | Files | Agent |
| - | ---- | ----- | ----- |
| 13 | Anchor-aware resize commit — corner = aspect, side = free stretch; commit matches the live gesture exactly (no post-hoc collapse); groups excluded from the Transformer | `PreviewStage.tsx`, `src/editor/transformGesture.ts`, `src/core/doc/geometry.ts` (+ tests) | general (E) |
| 2 | Replace image in place: Asset section "Replace image" → `importImageFile/Url` → `updateImageRef(imageId, {source,widthPx,heightPx})` (node keeps `imageId`, one undo entry, no orphans — shrinks D-12) | `src/components/editor/ImageImportDialog.tsx`, `src/components/editor/ObjectTab.tsx` (+ tests) | general (F) |

## #13 context (verified by coordinator)

- Live gesture: `Transformer keepRatio={selectedNodesPreserveAspect}` (`PreviewStage.tsx:696`). Konva applies `keepRatio` **only to corner anchors**; side anchors (`top-center`/`bottom-center`/`middle-left`/`middle-right`) always free-stretch (Konva `Transformer.js`).
- Commit: `handleTransformEnd` (`PreviewStage.tsx:566-599`) calls `transformEndPatch(source, target, preserveAspectFor(source, inverted), live)` → `resizeNodeGeometry` → `sizeFactors` (`geometry.ts:67-80`). When `preserveAspect` is true, `sizeFactors` collapses both axes to `Math.max(rawX, rawY)` (`geometry.ts:77-79`) → a side-anchor drag **snaps** to the larger axis on release, and the live `x/y` (committed verbatim, `transformGesture.ts:86-87`) no longer holds the anchored edge → the node **moves**.
- **Owner decision (#13):** corner anchors keep aspect; side anchors free stretch; the commit must match the live gesture exactly, anchor-aware, **no post-hoc `Math.max` aspect collapse**. `anchorSize` already 10 (P1). Groups excluded from Transformer resize until D-10 (impl default — flag at review).
- Required rule: capture the active anchor at `onTransformStart` (`transformerRef.current?.getActiveAnchor()`; it is cleared by `transformend`), then at commit `preserveAspect = isCornerAnchor(anchor) && preserveAspectFor(node, inverted)`; side anchors ⇒ `false`. With a corner gesture Konva's live `scaleX == scaleY`, so `target.w/base.w == target.h/base.h` and the uniform factor is exact (the `Math.max` branch must only ever run for such a uniform gesture — document that, or pass the live uniform scale explicitly).
- **Ellipse origin quirk:** the resolved ellipse is **centre-origin** — bounds `rectCorners(-rx,-ry,w,h)` (`src/editor/render/resolve.ts:343-356`) — while Konva's Transformer node `x/y` is the AABB top-left. Committing Konva's live `x/y` verbatim shifts an ellipse by `(rx, ry)`. Handle it and add a test.
- Rounding (`Math.round(target.w)`, `Math.round(live.x)`) must be documented.
- Tests: `transformGesture.test.ts:90-100` pins the current aspect collapse — update; add side-anchor parity + ellipse cases. `geometry.test.ts` if `sizeFactors` changes.

## #2 context (verified)

- Inspector already renders image affordances: `IMAGE_FIELDS` → `imageId` select + Import + `fit` (`ObjectTab.tsx:668-692`) and an Asset section with **Name/Alt only** (`:807-822`). Re-import rides the (now-fixed) `ImageImportDialog`; there is **no in-place source/URL edit**.
- `updateImageRef` already accepts `{source,widthPx,heightPx}` (`storeTypes.ts:209`, `ImageRef` `types.ts:162-169`); the only caller sends `{name?, alt?}`. With one image imported the dropdown has nothing to swap to.
- Fix: a "Replace image" affordance in the Asset section → the import dialog in a **replace** mode → `updateImageRef(imageId, {source, widthPx, heightPx})` via the existing `importImageFile/Url` builders (`src/editor/render/assetImport.ts:88-150`). Node keeps its `imageId`; one undo entry; no orphan ref.
- Owner decision (#2): replace-in-place (not always-new-ref).

## Environment (pass to every subagent)

- WSL, repo on `/mnt/c`. `bun` = `bun` (absolute; bare `bun` not on PATH).
- **Never `bun test`** → `…/bun.exe run test:run`. Typecheck `…/bun.exe run tsc`.
- Vitest default `node`; DOM tests need `// @vitest-environment happy-dom` on line 1.
- Typed i18n keys in `src/i18n/locales/en.json`; no hardcoded UI strings.
- No subagent delegation (depth 1). No commits — coordinator commits.

## Verification gates

- `tsc` clean · `bun run test:run` green.
- Review: `experimental-review` primary (`review-alt` fallback).
- Headed check of the resize parity (#13) — the core of this phase.

## State

- Status: **done** (2026-10-07). Gate: tsc clean · 1249 tests green (109 files).
- Review: `experimental-review` → CHANGES-NEEDED (no blockers) → fixed → `review` (VPN up) → CHANGES-NEEDED (flip bug) → fixed → `review-fast` **APPROVE**.
- Fix rounds: (1) structural `imageDialog` state, `commitPreservesAspect` + `liveUniform`, real-canvas ellipse test, test rename; (2) **flip preservation** — the commit was discarding Konva's mirror (`flipEnabled` defaults true); now `transformEndPatch` keeps the scale **sign** and only the magnitude is baked into geometry.
- Verified deviations: the planned ellipse `(rx,ry)` origin conversion is **not** needed — Konva's `Ellipse.x()/y()` is the node origin (centre), already matching `resolve.ts`; pinned by a real-canvas test.
- Headed check (#13): ellipse side-handle free-stretches one axis (W=1500 default, H=1000→1682; the old collapse would give W=2523), scale resets to 1, rotation preserved. Live↔commit parity additionally pinned by unit tests + reviewer math.
- Not committed yet — awaiting owner approval.
