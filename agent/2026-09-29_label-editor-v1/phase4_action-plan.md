# Phase 4 Action Plan — Render pipeline + color (M4) — vertical slice

**Run:** `agent/2026-09-29_label-editor-v1` · **Owner:** Coordinator · **Plan ref:** `plan.md` P4 (line 293)
**Status:** ACTIVE (2026-10-04). **Prereq:** P3 DONE (`da6d4c8`…`8df77ba`, `HANDOFF-p3.md`). Read this file first.

## 0. Orient first (do not skip)

1. This file.
2. `HANDOFF-p3.md` — what P3 installed and the P4 carry-overs.
3. `plan.md` lines **208–217** (rendering pipeline), **254–258** (testing), the **P4 row (293)**, and the **⚠ nonzero-winding clip requirement (187)**.
4. Memory: `agent/memory/print-transport.md` (⚠ **P4 must use `ImageEncoder.encodeCanvas` / `encode`, never a hand-built `rowsData`**; EncodedImage gotchas), `agent/memory/testing.md` (browser-only list), `agent/memory/niimblue-reference.md` (dither adoption: trapezoid diffusion + `denom`/`normalize`, atkinson `normalize:false`, `serpentine` default true, `strength` 0–1.5).
5. Reference clone (craft only): `references/niimblue/src/utils/dither.ts`, `src/utils/post_process.ts`, `src/components/PrintPreview.svelte` (`updatePreview` ≈ our quantize pass; `generatePreviewData` ≈ our rasterize).
6. Existing code LIFTED into: `src/editor/render/{resolve,konvaFactory,regionOverlay,guides}.ts` (P3), `src/print/{transport,mockTransport,niimbotAdapter}.ts` (P1), `src/core/doc/*`.

## 1. Scope (frozen)

P4 is the **vertical slice**: one weird label rendered WYSIWYG and printed end-to-end. Deliver:

1. **Resolver reuse + rasterize** — `resolve(doc)` already exists (P3, static content only). Add the RGBA intermediate renderer: resolved tree → `createKonvaNode` → offscreen Konva → RGBA at target dpi.
2. **Region clip** — `union(regions)` applied as a mask, **NONZERO winding, no interior holes** (plan §187). Overlapping F-tag regions must produce zero holes.
3. **ColorSpace (Mono)** × **4 quantizers** (`threshold`, `floydSteinberg`, `stucki`, `atkinson`) + extensible registry + RedBlack seam (interface only).
4. **Per-object quantizer policy masks** (decision 1) — a node hint selects the dither policy for its pixels inside one unified final-pixel pass; no hint ⇒ global pass (guardrail: the killer path never depends on it).
5. **Golden-pixel tests** on a real canvas in Vitest.
6. **Single-label print end-to-end** (mock + real): `resolve → createKonvaNode → rasterize → clip → quantize → ImageEncoder.encode → PrinterTransport.print`.

**Exit criteria (plan):** preview raster ≡ print raster (golden test); one weird label prints on hardware (owner-run).

**Out of scope:** templates/CSV/trust (P6); image/QR/barcode engines (P5 — resolve returns `undefined` for them, so they stay blank); batch/preview dialog/job runner/print knobs (P7); asset import (P5).

## 2. Locked decisions (owner, 2026-10-04)

- **Test rasterization runs on a real canvas in Vitest** — add `@napi-rs/canvas` as a dev dependency and a harness that lets **Konva draw and produce pixels** under happy-dom. No "browser-verify only" for raster output; browsers stay for interaction.
- **Render code placement: reuse in place.** `resolve`/`konvaFactory` stay under `src/editor/render/`; the print path imports them. New *pure* pipeline modules go in `src/core/render/` (headless, zero React). Relocating the P3 render modules is a logged follow-up, not P4 work. **Record this as a P4 deviation.**
- **P4 print is triggered by a dev-gated harness** (`?print=1`, same pattern as `src/components/dev/HardwareSmoke.tsx`). Do **not** build the P7 print UI.
- **Reviewers:** `review` **and** `experimental-review` both available — route each area to both (or `review` primary + `experimental-review` second opinion on the whole diff); `review-fast` for narrow re-reviews. Fix rounds ≤ 2 per area.
- **Commits:** one semantic commit per area; **coordinator asks the owner before each commit**.
- No other new dependencies without asking.

## 3. W0 — Headless Konva canvas harness (gating spike, do first)

The whole test plan rests on this. If it fails, stop and report before W1/W2 write goldens.

- **Dep:** `bun add -d @napi-rs/canvas` (install prompts — owner approves).
- **Deliverable:** `src/test/canvasHarness.ts` + a self-test proving a real raster:
  - Patch globals so Konva uses `@napi-rs/canvas` for `HTMLCanvasElement`: override `HTMLCanvasElement.prototype.getContext`, `.width/.height`, `.toDataURL`, and provide `ImageData` (napi's) on `globalThis` when happy-dom lacks a real one.
  - Prove: `new Konva.Stage({ container, width, height })` + `Layer` + a `Konva.Rect` → `stage.toCanvas()` (or `layer.getCanvas()._canvas` / `toDataURL`) yields the expected pixels (e.g. a 2×2 black/white pattern read back via `getImageData`).
  - Prove `document.fonts.ready` absence is handled (guard; happy-dom may not have `document.fonts`).
- **Fallback if Konva refuses to render:** report to the coordinator (do not silently switch to a hand-rolled rasterizer — that would fork the factory). A last-resort option the coordinator may approve is rasterizing `createKonvaNode` objects onto a napi context via Konva's `node.drawScene(canvas)`.
- **Note:** the harness is test-only; it must never be imported by product code and must not alter production behaviour.

## 4. W1 — Pure color pipeline (`src/core/render/`, zero React, zero Konva)

All of this is pure over `ImageData`-shaped buffers and unit/golden-testable.

- `dimensions.ts` — `rasterDimensions(doc)` / `hmToPxAtDpi(hm, dpi)`: `px = hm / 2540 * dpi` (1 in = 25.4 mm = 2540 hm), rounded; `{ widthPx, heightPx }` from `backingW/H`. Integer outputs.
- `colorspace.ts` — `ColorSpace` interface `{ toChannel(rgba): Uint8Array }` (or in-place) + `MonoColorSpace` (luminance 0.299/0.587/0.114). Registry with only `mono`. **RedBlack/RedGrayscale are typed seams, not implemented** (post-v1).
- `quantize.ts` — `createDiffuser(denom, grid, {normalize})` ported from the reference, plus `threshold`, `floydSteinberg` (16), `stucki` (42), `atkinson` (8, `normalize:false`). Options `{ threshold=128, strength=1, serpentine=true }`. Each quantizer is **stateless w.r.t. the document** and deterministic. Registry keyed by `QuantizerId`.
- `policy.ts` — `QuantizerId`, `DEFAULT_POLICY_BY_TYPE` (`text`/`qr`/`barcode` → `threshold`; `image` → `floydSteinberg`), `resolveQuantizer(node)` (explicit hint wins, else type default, else `undefined`), and the `PolicyMask` type (`Uint8Array` policy index per pixel; `0` = global). `applyPolicy(rgba, mask, policies, opts)` applies the selected quantizer per pixel/region inside one pass.
- `pipeline.ts` — `quantizeRgba(rgba, dims, { globalQuantizer, policies })` orchestrating colorspace → per-policy quantize → final black/white RGBA (exact `0x000000`/`0xffffff`, which is what `ImageEncoder` keys on).
- **Tests (headless, golden):** pure fixtures for each quantizer (deterministic expected 1-bit output); edge cases; `atkinson` discards 2/8 error; `serpentine` default; policy: two overlapping objects with different hints resolve by topmost; no hints ⇒ single global pass.

> **Placement note (owner: reuse in place).** `src/core/` must never import `src/editor/`, so the **region clip lives in `src/editor/render/clip.ts`** (W2), not here. It reuses `regionUnionPath` and fills with the default **nonzero** winding on a real canvas — the canonical rule — instead of re-deriving point-in-region math. Keep `src/core/render/` canvas-free and Konva-free.

## 5. W2 — Rasterize + shared render (`src/editor/render/`, browser/canvas)

This is the **one** function preview and print both call (invariant 7).

- `src/editor/render/clip.ts`:
  - `applyRegionClip(rgba, { widthPx, heightPx }, regions, hmPerPx)` — pixels outside `union(regions)` → white (blank), inside → unchanged.
  - **Implementation:** build a mask with `regionUnionPath(regions)` scaled by `hmPerPx`, fill with the canvas default **nonzero** winding onto a white canvas, read it back, force outside pixels white. Do **not** pass `'evenodd'` and do not use even-odd point tests. This reuses the editor overlay's exact union and avoids duplicated rounded-rect math.
- `src/editor/render/rasterize.ts`:
  - `rasterizeResolved(nodes: ResolvedNode[], { widthPx, heightPx }): { canvas, ctx }` — offscreen Konva stage/layer sized in px, `createKonvaNode` per node, hm→px scale applied **once at the stage/group level** (Konva objects are in hm; scale = `dpi/2540`). White background. `await document.fonts.ready` (guarded) + explicit font loads before draw (risk table: blank text).
  - Return the canvas **and** its `ImageData` so callers never re-read.
- `src/editor/render/renderLabelPage.ts` — the shared path:
  `renderLabelPage(doc, ctx, opts) → { rgba, widthPx, heightPx }`:
  `resolve(doc) → rasterizeResolved → build policy mask → applyRegionClip → quantizeRgba` (colorspace Mono). No document mutation (invariant 2). Determinism: same doc+ctx ⇒ byte-identical output.
  - Build the **policy mask** by drawing each policy-carrying node's coverage (fill its transformed outline into a keyed offscreen buffer, read back → policy index; later draws overwrite ⇒ topmost wins). Document the approximation if exact per-pixel node coverage is not achievable; the mask must at least be exact for node outlines (not bboxes) where feasible.
- **Preview vs print:** both call `renderLabelPage`; encode is the only difference (none — both pass the same RGBA to `ImageEncoder.encode`). Golden test: run it twice / via both entry points → **byte-identical**.
- **Tests (real canvas via W0):** encode a small doc (text + rect + ellipse), assert non-empty ink inside the union, blank outside, and F-tag union has no holes; preview≡print identical.
- **Direction:** `ImageEncoder.encodeCanvas` rotates only for `printDirection === 'left'`; other directions are sent unrotated. Match the reference and confirm on hardware in W4; document the chosen mapping.

## 6. W3 — Per-object quantizer field + inspector wiring

- `src/core/doc/types.ts`: add `quantizerHint?: QuantizerId` to `BaseNode` (document data, optional). Keep it out of `ContentSource`.
- `src/core/doc/validate.ts`: accept/repair the enum (drop unknown → absent); update the integer-scan test if it enumerates keys.
- `src/editor/inspectorModel.ts`: flip `quantizerHint` from `{ wired:false, reason:'quantizer' }` to a wired select (`kind:'select'`), options from the quantizer registry.
- `en.json`: option labels via `t()` (typed keys).
- Component: the ObjectTab control renders the select (owner's existing field layout); keep it disabled-less and functional.
- **Tests:** validate keeps/drops the field; inspector model exposes it wired; resolve/policy reads it.

## 7. W4 — Single-label print end-to-end + dev harness

- `src/print/printLabel.ts` — `buildLabelPrintJob(doc, opts, deps)`:
  - `renderLabelPage` → encode via **`ImageEncoder.encodeCanvas(canvas, pageColor, printDirection)`** (or `ImageEncoder.encode(CanvasImageSource, …)`) — **never hand-build `rowsData`**.
  - Return a `PrintJob` (`totalPages: 1`, `pages` an async iterable of one `PrintPage{ data, quantity:1 }`) + default `pageColor: PageColorType.SingleColor`. Reuse the adapter's option conventions (defined keys only).
- `src/components/dev/PrintSmoke.tsx` — gated `?print=1` (mirror `HardwareSmoke.tsx` wiring in `App.tsx`): pick/print the current label doc, `NiimbotTransport` + `MockTransport` toggle, status/progress display. Dev-only, not a route.
- **Tests (headless, real canvas):** doc → `buildLabelPrintJob` → `MockTransport.print` → assert `pagesPrinted === 1`, page decodes to the expected bit plane (`ImageEncoder` output rows non-empty), and the job equals the preview `renderLabelPage` output.
- **Hardware smoke (owner-run):** the F-tag with text + shapes prints correctly through the dev harness. Record result in `state.md` (advisory like P1).

## 8. Rules

- `src/core/` stays React-free (`src/core/headless.test.ts`); `src/core/render/` adds no React/Konva. Konva only in `src/editor/render/`.
- **Integer hm discipline** in the doc; px only in the raster (floats allowed there).
- **Never hand-build `rowsData`** — `ImageEncoder` is the encoder.
- **Nonzero winding** for the clip; a test pins no-holes.
- Every product string through `t()`.
- `tsc` strict; tests typechecked. Working commands in this checkout: `bun run test:run` and `node_modules/.bin/tsc.exe --noEmit`. **Never** run tests/build through `bunx`/`npx`.
- Subagents must **not** delegate further (nesting depth 1). If info is missing, emit `needs-info. q: … . hint: … . next: … .` and stop.
- Do not redesign. If a visual/UX decision is needed, ask the owner.

## 9. Gate

1. `bun run test:run` green · `bun run build` green · `tsc` clean.
2. Golden test proves **preview raster ≡ print raster** byte-for-byte; clip no-holes test green.
3. `review` + `experimental-review` on the phase diff; must-fix round ≤2; re-review APPROVE.
4. Headed/browser check of the dev print harness (mock) + owner hardware smoke.
5. Update `state.md` + this plan; escalate project lessons to `agent/memory/*`.
6. Semantic commit(s), one per area (ask owner before each).

## 10. Workstreams & sequencing

| WS | Area | Files | Depends on |
| -- | ---- | ----- | ---------- |
| W0 | Headless Konva canvas harness + `@napi-rs/canvas` | `src/test/canvasHarness.ts`, `package.json` | — (gating) |
| W1 | Pure color pipeline (colorspace, quantizers, policy) + goldens | new `src/core/render/*` | — (parallel with W0) |
| W2 | Clip + rasterize + shared `renderLabelPage` | new `src/editor/render/{clip,rasterize,renderLabelPage}.ts` | W0, W1 |
| W3 | Quantizer hint field + inspector wiring | `core/doc/{types,validate}`, `editor/inspectorModel`, ObjectTab, `en.json` | types (parallel with W1/W2) |
| W4 | Single-label print + dev harness | new `src/print/printLabel.ts`, `components/dev/PrintSmoke.tsx`, `App.tsx` | W2, W3 |

**Round 1:** W0 (background spike) + W1 (parallel, disjoint). **Round 2:** W2 + W3. **Round 3:** W4. **Round 4:** review → fix → browser/hardware → commits.

**Expected commits (ask before each):**
1. `test(render): headless napi-rs canvas harness for golden pixel tests` (W0)
2. `feat(render): Mono color pipeline — clip, colorspace, 4 quantizers, policy masks` (W1)
3. `feat(render): shared rasterize path, preview≡print` (W2)
4. `feat(doc): per-object quantizer policy field + inspector wiring` (W3)
5. `feat(print): single-label print end-to-end + dev harness` (W4)

## 11. Report (phase receipt)

```
## Phase 4 — {summary}
- done: [what shipped]
- tests: [result, incl. golden preview≡print + clip no-holes]
- reviewed: [by whom, verdict]
- browser/hardware: [what was verified]
- committed: [hashes]
- next: [P5 ready | escalation]
```
