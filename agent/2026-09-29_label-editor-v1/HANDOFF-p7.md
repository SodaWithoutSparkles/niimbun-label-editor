# Handoff — Phase 7 (Preview + batch print, M7)

**Run:** `agent/2026-09-29_label-editor-v1` · **Written:** 2026-10-06 · **Owner:** Coordinator
**Plan:** `plan.md` (P7 row, line 314; Print pipeline 246–259) · **Prev handoff:** `HANDOFF-p6.md` (P6 code-complete)
**For:** a NEW coordinator session — you drive P7 end to end. Do not re-plan P1–P6.

---

## 0. Read first (in order)

1. `plan.md` — **P7 row (line 314)**, Print pipeline (246–259), Rendering pipeline (226–235),
   sequence generator + backpressure + progress, decisions **7, 14, 18, 35, 42**.
2. `state.md` P6 record + `phase6_action-plan.md` (what P6 shipped and what it deferred).
3. `agent/memory/csv-templates.md` (P6 CSV/templates/trust), `agent/memory/print-transport.md`
   (transport contract + adapter flow), `agent/memory/objects-assets.md`,
   `agent/memory/testing.md`, `agent/memory/dialogs.md`.
4. Reference clone (gitignored): `references/niimblue/src/components/PrintPreview.svelte`
   (per-row render, `$times`, `offset.{x,y,offsetType}`), `canvas_preprocess.ts`, `defaults.ts`.

## 1. Status: P6 CODE COMPLETE ✅ (2026-10-06)

- Commits `22fc00e`…`f9bbe8e` (+ `d493ffc` docs); **985 tests / 90 files**; `tsc` clean; build green.
- Headed check **7/7 PASS** (attach CSV → bind text/QR → preview row N with a pixel-matched QR;
  trust prompt + fallback error badge; globals fetched once per pass; no console errors).
- **Owner hardware smoke for P6 not run** — P6 has no print UI (that is P7); the editor prints via
  the dev-only `?print=1` harness, which renders a fixed sample, not the editor doc. Decide with the
  owner whether to smoke P6 now via `?print=1` or fold it into P7's print UI.

## 2. P7 scope (frozen — from plan:314)

Deliver **preview + batch print** so a CSV job drives the printer:

1. **Virtualized preview dialog** — LRU ~32 pages, concurrency 2, ~50 dpi thumbnails; per-row render
   via the shared `renderLabelPage` path (preview ≡ print, invariant 7).
2. **Lazy async sequence generator** — grouped (AABBCC: one `printPage`/record, `quantity = copies`)
   vs interleaved (ABCABC: records×copies pages at `quantity: 1`); warn above ~50 interleaved pages.
3. **Job runner** — render → encode → send → wait → next (backpressure), one active job at a time,
   progress (`printprogress`), cancel = abort + **`printEnd()` in `finally`**, one-job guard.
4. **Per-row quantity incl. `$times` column** (deferred from P6; ref `PrintPreview.svelte`).
5. **Print-task override UI + capability gating** (density/speed/labelType/pageColor; gate on the
   connected printer's reported capabilities).
6. **Print knobs** — speed, invert, mirror, offset inner/outer, and a non-blocking
   **printhead-overflow** warning when the label exceeds the printhead dots.

**Exit criteria (plan):** a 100-label CSV job prints reliably; mid-job cancel is clean.

## 3. What already exists (do NOT rebuild)

- **Print pipeline (P1/P4):** `src/print/transport.ts` (`PrinterTransport`), `mockTransport.ts`,
  `niimbotAdapter.ts` (verified flow: `newPrintTask → printInit → printPage/waitForPageFinished →
  waitForFinished → printEnd() in finally`; `totalPages = Σ quantity`), `src/print/printLabel.ts`
  `buildLabelPrintJob` (forwards `deps.assets`; consumes the single `renderLabelPage`).
- **Render:** `src/editor/render/{resolve,prepareContent}.ts`, `prepareAssets.ts`,
  `renderLabelPage`/`rasterizeResolved`; `src/core/render/*` (Mono + 4 quantizers + policy masks).
- **P6 data/templates:** `src/data/csvImport.ts`, `src/data/csvRepo.ts`, `rowContext.ts`,
  `src/templates/*` (engine/worker/globals), `src/core/trust.ts`, `trustRepo`, `useSampleRow`.
- **Dev harness:** `?print=1` (`src/components/dev/…`) and `?hardware=1`; `ab` headed check tool.
- **Store:** `docSlice` (repos on one shared adapter), `editorSlice` (undoable doc ops incl.
  `setSampleRowIndex`, `attachCsv`, `setDocGlobals`).

## 4. Locked decisions to honour (do not relitigate)

- **Preview ≡ print (invariant 7):** both consume `renderLabelPage`; no second render entry point.
- **Sequence generator is lazy async (invariant 9):** do not precompute all pages for a huge CSV.
- **Backpressure + one job at a time; cancel aborts and always `printEnd()` in `finally`.**
- **Printer-reported values never gate printing** (roll size / dpi mismatch = non-blocking warning,
  decision 18). The printhead-overflow warning is likewise non-blocking.
- **`$times`:** adopt now (per-row copies), matching the reference; `CsvRecord` binding already
  exists — read the column, default 1, floor/clamp non-positive.
- **Differentiator isolation (decision 42):** the plain CSV→preview→print path must not depend on
  the template engine or trust gate.
- Integer `hm`; `src/core/` stays React/Konva/DOM-free. i18n for every product string.
- Global `keydown`/`paste`/`drop` handlers bail on `dialog[open]`.
- Reviewer routing: `review` + `experimental-review` (both available); `review-fast` for narrow
  re-reviews. **Commit per area; ask the owner before each.**

## 5. Open decisions to resolve with the OWNER at P7 start (ask, don't guess)

1. **Preview thumbnail source** — rasterize at ~50 dpi (cheap) vs reuse the editor raster scaled?
2. **LRU size / concurrency** — keep 32 / 2, or tune for the 100-label exit job?
3. **Print knobs scope** — which of speed/invert/mirror/offset* actually apply to the B1_PRO?
   (niimbluelib `PrintTask` capabilities) — spike against the adapter before building UI.
4. **`printDirection` `right|bottom`**: P4 carry — encoder is 2-valued; decide pre-rotate 180° vs
   reject at validate **before** P7 batch (plan P4 carry).
5. **`applyPolicy`** does one full-frame pass per distinct policy (bounded 4) — revisit before P7
   batches if profiling shows cost.
6. **P6 hardware smoke** — now via `?print=1`, or defer into P7's print UI?

## 6. Suggested workstreams (coordinator to refine)

| WS | Area | Files | Notes |
| -- | ---- | ----- | ----- |
| W1 | Sequence generator (grouped/interleaved, `$times`, lazy) | `src/print/sequence.ts` (new) | pure + tested; >50 interleaved warning |
| W2 | Job runner (progress, cancel, `printEnd` finally, one-job guard, backpressure) | `src/print/jobRunner.ts` (new) | MockTransport e2e |
| W3 | Virtualized preview dialog (LRU ~32, concurrency 2, ~50 dpi) | `src/components/preview/*` (new) | shares `renderLabelPage` |
| W4 | Print-task override UI + capability gating | `src/components/print/*` | gate on printer-reported caps |
| W5 | Print knobs (speed/invert/mirror/offset) + printhead-overflow warning | adapter + UI | spike capabilities first |
| W6 | Wire the editor **Print** action (invariant: no template/trust dependency for plain CSV) | Header/menu + store | |

**Sequencing:** owner decisions → W1 (sequence, pure) → W2 (job runner on Mock) → W3 (preview) →
W4/W5 (overrides/knobs after the capability spike) → W6 (wire) → review per area → fix → headed Mock
smoke → **owner hardware smoke (100-label CSV)** → commit per area.

## 7. Rules & commands

- Subagents must **not delegate** (depth 1). Missing info → terminal
  `needs-info. q: … . hint: … . next: … .`
- Tests: `bun run test:run`; typecheck `node_modules/.bin/tsc.exe
  --noEmit`; build `…/bun.exe run build`. **Never `bunx`/`npx`/`bun test`.**
- Real-canvas tests via `src/test/canvasHarness.ts`; browser-only interactions headed with
  `ab` (`bun run dev`, `?print=1`, `?hardware=1`).
- `ab upload` needs a **Windows UNC** path, not a WSL path (see `agent/memory/csv-templates.md`).
- Owner runs all **hardware smoke** (50×30 + Ruler calibration variants).
- Commit per area; ask the owner before each.

## 8. Carry-in items (non-blocking, don't lose)

- **P6:** orphan `CsvRecord` sweep deferred (write path no longer deletes); `vitest.config.ts`
  `testTimeout: 15000` from P5 can likely return to default (suite ~23 s); status-bar `rowCount === 0`
  conflates no-CSV/loading/empty; `useSampleRow` `resolveKeyOf` stringifies per node per tick.
- **P5:** remote images need **CORS**; image import = two undo entries (batch if convenient);
  imported-font badge headed check not done; `printDirection` right/bottom (see §5.4).
- **P4:** narrow-roll placement / 0.5 mm left-drift clip → P7 feed/offset knobs + printhead-overflow
  warning; `applyPolicy` per-distinct-policy full-frame pass.
- **Accessibility/UX:** `ObjectTab`/`JsTab` trust-gating copy; session trust decisions now listable
  in Settings (`TrustGate.sessionEntries`).

## 9. Gate (P7)

1. `bun run test:run` green · `tsc` clean · `bun run build` green.
2. Exit criteria demonstrated: 100-label CSV job prints reliably (Mock headed + real hardware);
   mid-job cancel is clean (`printEnd()` ran, no orphaned job).
3. Review per area (`review` + `experimental-review`); fix ≤2; re-review APPROVE.
4. Update `state.md` + `phase7_action-plan.md`; escalate lessons to `agent/memory/*`.
5. Semantic commit(s) per area (ask owner first). Owner hardware smoke recorded.

**Start by writing `agent/2026-09-29_label-editor-v1/phase7_action-plan.md`, then ask the owner the
§5 decisions before dispatching W1.**
