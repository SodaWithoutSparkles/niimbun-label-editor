# Code organization — layering contract + file-size audit

Written 2026-10-16 from a `src/` smell audit. This file holds the **durable rules**
(layer contract, naming, why) and the audit numbers. Per-item debt lives in
[`tech-debt.md`](tech-debt.md); the fix round lives in
[`../2026-10-09_round-2-fixes/`](../2026-10-09_round-2-fixes/) under **P13**.

## Layer contract

Dependencies flow one way. Nothing below imports anything above it.

```
core/      pure, headless, no React / Konva / DOM   (guard: core/headless.test.ts)
  ↑
data/      IndexedDB repos, compress, migrate
  ↑
store/     zustand slices
  ↑
editor/    pure logic (.ts only — no React)
  ↑
components/  React + Konva + DOM
```

`print/`, `templates/`, `utils/` are siblings that may import from `core/` and
`data/`; `components/` may import from all of them.

**Not every folder is a layer (2026-10-17).** The list above is the contract; inventing a new
top-level folder for React + store wiring silently breaks it. Both review rounds in P13b enforced this:
`src/navigation/` was rejected and split into `utils/urlHash.ts` (pure grammar) +
`components/layout/useUrlSync.ts` (the hook), and a proposed `src/gallery/thumbnails.ts` was rejected in
favour of `editor/render/docThumbnail.ts` (render logic) + `components/editor/useDocThumbnail.ts` (the
hook) so that `store/` never imported a renderer.

**Documented exception:** `src/utils/urlHash.ts` imports `type { GallerySection }` from
`store/slices/viewSlice` — **type-only**, compile-erased, so there is no runtime edge. It is deliberate:
duplicating the union would let the URL vocabulary drift from the sidebar. If that import ever needs to
be a runtime one, move the union into `core/` instead.

### Why `src/editor/` is `.ts`-only

`editor/` is where editor *logic* lives (gesture math, viewport control, node
patches, resolve) as opposed to editor *rendering*. Keeping it React-free means it
is unit-testable without a DOM and cannot grow hidden render effects. `editor/render/`
is the one sub-path that touches Konva (the factory is the Konva adapter).

### Enforcing it

`src/core/headless.test.ts` enforces the core rules by reading sources as raw text
via `import.meta.glob(..., '?raw')` and stripping comments before matching. The
same trick is the cheapest way to extend the guard to `src/editor/` (no new dep).
There is **no ESLint config in the repo**, so nothing mechanically stops the next
1500-line file — registered as debt **D-53**.

## Naming and placement rules

- One `types.ts` per module boundary (`core/doc/types.ts`, `store/storeTypes.ts`).
  A `src/types.ts` grab-bag at the repo root is the anti-pattern (see D-51).
- Pure helpers used by an inspector/dialog **live in `src/editor/`**, not above
  the component. Component files hold JSX + wiring only. This is the single most
  repeated smell (D-52).
- Barrels exist in exactly four places: `components/common/dialogs`,
  `components/common/forms`, `core/doc/paper-types`, and the two `render/`
  indexes. Keep them **named re-exports**, never `export *` (D-54).
- Test-file infixes are `describe`-scope markers, not a taxonomy: `.dom` (happy-dom
  vs canvas shim), `.interaction` (real gesture), `.existing` / `.file` (scenarios).
  Nothing depends on the name, so keep adding suffixes only when the extra file
  would otherwise exceed reviewable size.

## Audit numbers (2026-10-16, HEAD `21810d1`)

Scale: **208 prod files / 35,124 LOC**, **147 test files / 33,878 LOC** — test
coverage is 0.68–1.78× prod per area, which is healthy. The problem is file
*shape*, not test discipline.

| File | LOC | Note |
| ---- | --- | --- |
| `components/editor/PreviewStage.tsx` | 1539 | 25 `useStore` subs, 13 `useEffect`, 48 hooks |
| `components/editor/ObjectTab.tsx` | 997 | component starts at line 384 — 383 lines are pure patches |
| `core/doc/validate.ts` | 968 | 12 guards; `isNode` alone is 224 lines / 10 switch cases |
| `store/slices/editorSlice.ts` | 909 | 29 actions; larger than the other 8 slices combined |
| `components/print/PrintDialog.tsx` | 785 | |
| `components/editor/TextEditorOverlay.tsx` | 531 | caret math co-mingled with the component |

### Structural nits

- **Two directories named `render/`** — `core/render/` is the pure colour pipeline,
  `editor/render/` is the Konva/canvas adapter. Unrelated concerns, same word
  (D-56). Renaming `core/render` → `core/color` is the cheap direction.
- **`editor/render/index.ts` is `export *` × 14.** Any barrel import pulls in
  Konva and bwip-js even when the consumer only needs `regionUnionPath`
  (`components/paper/PaperTypePreview.tsx` is a pure-SVG victim) — D-54.
- **`package.json` `name` was `"ui-template"`** — renamed to `"label-editor"` in
  P13. It is the base-template name, not the product.
- **`editor/arrange.ts` vs `components/editor/useArrange.ts`** — *not* a duplicate
  (pure layout vs the hook that commits it), and the split is correct per the layer
  contract. Flagged here only because the names read as a pair.

### Historical note: what is NOT dead code

`src/utils/export/{capture,download,utils}.ts` (114 LOC) has **no importers** and
an audit would call it dead. It is not: v1 plan **P8 (import/export) is still
pending** and these are the ported-from-template export helpers it reuses. Their
`// reserved for P8` headers are accurate. Do not delete.