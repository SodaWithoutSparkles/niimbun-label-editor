# Handoff — Phase 6 (CSV + templates, M6)

**Run:** `agent/2026-09-29_label-editor-v1` · **Written:** 2026-10-05 · **Owner:** Coordinator
**Plan:** `plan.md` (P6 row, line 313) · **Prev handoff:** `HANDOFF-p5.md` (P5 DONE)
**For:** a NEW coordinator session — you drive P6 end to end. You do not re-plan P1–P5.

---

## 0. Read first (in order)

1. `plan.md` — **P6 row (line 313)**, Template system (237–245), Storage (207–220), Data model
   (`ContentSource`, `CsvRef`, `GlobalSpec`, `data.csv/sampleRowIndex/globals`), decisions
   **3, 4, 24, 28, 32, 33, 40, 42** (trust model, template engine, `ctx.now`, CSV as an
   `AssetRef`, trust = local state/invariant 11, `expiresAt`, i18n, differentiator isolation).
2. `HANDOFF-p5.md` + `state.md` P5 record — what P5 installed (objects/fonts/assets).
3. `agent/memory/objects-assets.md` (asset seam/ContentSource fallback), `agent/memory/testing.md`,
   `agent/memory/store-and-slices.md`, `agent/memory/dialogs.md`, `agent/memory/i18n.md`.
4. Reference clone (gitignored) for craft: `references/niimblue/src/utils/canvas_preprocess.ts`
   (variables/CSV substitution), `PrintPreview.svelte` (per-row render + `$times`), `defaults.ts`.

## 1. Status: P5 DONE ✅ (2026-10-05)

- Commits `a34f401`…`6fdb06f`; 724 tests; `tsc` clean; build green. Hardware smoke **passed**
  (50×30 image/QR/barcode/text label). Ruler calibration printed **exact** (minor 0.5 mm
  left-drift clip → P7 placement).
- **P6 = next.** No P6 code exists yet; the P5 object/asset pipeline is stable — build on it.

## 2. P6 scope (frozen — from plan:313)

Deliver **CSV + templates** so a table drives the label:

1. **CSV import** — PapaParse parse + a **virtualized preview** + the **~50k-row cap/warning**;
   store the parsed table in IDB `csvs` (`CsvRecord {id,name,columns,rows}`), doc `data.csv: CsvRef`.
2. **Bindings by column name + fallbacks** — `ContentSource` `csv`/`template` resolve to a value
   for a given row; the `fallback` shows when a column/row is absent.
3. **Template worker** — `TemplateEngine { evaluate(source, ctx): Promise<Value> }`; first impl
   `JavaScriptTemplateEngine` in a dedicated Web Worker; code wrapped as `return (ctx) => {…}`;
   **250 ms timeout → worker reset + error badge**; context deep-frozen via a throwing Proxy;
   no DOM/app refs, no dynamic `import()`, no network.
4. **Trust gate UI** — reads/writes the IDB `trust` store (docId → `'ask'|'always'|'never'`,
   absent = `ask`); allow/deny **once** (session) vs **always/never** (persisted); prompt via
   `dialogService`; a `SettingsModal` section lists stored decisions with revoke/reset.
5. **Globals** — prefetch each `GlobalSpec` **once per job** (concurrency cap, timeout, shared
   cache keyed by `expiresAt`), freeze, deep-clone into the worker as `globals.<name>`; templates
   never fetch.
6. **Editor preview of row N** — `data.sampleRowIndex` picks the row the editor renders; resolve
   executes csv/template sources for that row (static stays as-is).

**Exit criteria (plan):** Attach CSV → bind text/QR → editor previews row N.

## 3. What already exists (do NOT rebuild)

- **Types**: `ContentSource` (`static|csv|template` with `fallback`), `CsvRef {csvId,name,alt?,source:AssetRef}`,
  `GlobalSpec {name,url,extract,expiresAt}`, `LabelDoc.data {csv?,sampleRowIndex,globals}`.
- **Storage**: `src/data/csvRepo.ts` (`csvs` store, `CsvRecord`; parsing/cap is P6),
  `src/data/db.ts` — `trust` store is **deliberately absent**; `runUpgrade` is version-bump friendly
  (add `trust` to `STORE_NAMES`/schema in a non-destructive upgrade). `createMemoryAdapter` seeds stores.
- **Resolver**: `src/editor/render/resolve.ts` `resolveContent()` returns the static value or the
  `fallback` today — **this is the P6 execution seam**; `resolve` stays sync, so row execution needs
  an async pre-pass like P5's `prepareResolvedAssets` (do not make `resolve` async).
- **Store**: `data.sampleRowIndex` + `setSampleRowIndex` (undoable) already exist; `resourceRepo`
  is created on the shared adapter (mirror for `csvRepo`/`trustRepo`).
- **UI stubs**: `src/components/editor/DataSourceTab.tsx` (MFP → Data source) and `JsTab.tsx`
  (template-only, disabled-with-reason) are placeholders; `inspectorModel` has reserved
  `contentSource` + `templateTrust` fields; `editor.mfp.jsDisabled` exists.
- **Dialogs**: shared `Modal` + promise `dialogService` (confirm/promptText/alert, settle-once).
- **ContentSource editing**: the inspector currently disables editing a non-static source
  (P5 guard) — P6 wires the csv/template editors.

## 4. Locked decisions to honour (do not relitigate)

- **Trust model (decision 3):** templates are **trusted user code** (Office-macro boundary);
  worker + timeout + no secrets. **Do NOT build a hostile sandbox.**
- **Trust is local state, not document data (invariant 11, decision 32):** the `trust` store is
  keyed by doc id, written only by the user, never by import. `always` runs silently; `never`
  blocks everywhere incl. the authoring machine until re-enabled in settings; absent/`ask` prompts
  on open. Prompt allow/deny = **session only**; persisting needs Always/Never.
  **Import/duplicate mint a new `meta.id`** (already), so a doc never arrives trusted.
- **`ctx.now` = `Date.now()` (ms) at resolve time, never stored (decision 24).** Doc `meta`
  timestamps stay epoch **seconds**. A doc never records when a template ran.
- **Globals:** `GlobalSpec.expiresAt` is epoch **seconds** (decision 33); prefetch **once per job**,
  shared cache, deep-clone into the worker. Templates never fetch.
- **CSV participates in `AssetRef` like every asset (decision 28).** `CsvRecord.name` = original
  import filename; `CsvRef.name` = user-editable display name (may differ).
- **i18n (decision 40):** every product string via `t()`; dynamic keys via the literal-map pattern.
- **Differentiator isolation (decision 42):** a doc with no template sources is **never gated** by
  the trust engine; the plain CSV→bind→preview→print path must not depend on the template engine.
- **Integer `hm`; `src/core/` stays React/Konva/DOM-free** (`headless.test.ts`).
- Global `keydown`/`paste`/`drop` handlers bail on `dialog[open]`.
- Reviewer routing: `review` + `experimental-review` (both available); `review-fast` for narrow
  re-reviews. **Commit per area; ask the owner before each.**

## 5. Open decisions to resolve with the OWNER at P6 start (ask, don't guess)

1. **CSV import provenance**: `local` (IDB `csvs`, likely) vs `external`/`inline` — P5 chose
   `local` for files; confirm CSV follows (local).
2. **New dependency**: `papaparse@5.7.0` + `@types/papaparse` (not installed). Approve `bun add`.
3. **Worker packaging**: inline `new Worker(new URL('./worker.ts', import.meta.url), {type:'module'})`
   vs a blob-URL worker. Confirm the Vite/rolldown approach.
4. **Template surface**: raw JS only, or `{{ }}` sugar too? (decision 4 says sugar optional later.)
5. **`$times` column**: adopt it (per-row copies) in P6, or defer to P7 batch? (reference has it.)
6. **Globals UI**: where does the user define `GlobalSpec`s — Data source tab vs settings?

## 6. Suggested workstreams (coordinator to refine)

| WS | Area | Files | Notes |
| -- | ---- | ----- | ----- |
| W1 | CSV import (PapaParse) + store + virtualized preview + cap | `src/data/csvRepo.ts`, new `src/data/csvImport.ts`, `DataSourceTab.tsx` | ~50k cap + warning |
| W2 | Row context + binding resolution (csv/template → value) + fallbacks | `src/core/doc` (context type), `src/editor/render/resolve.ts` + a prepare/execute seam | keep `resolve` sync |
| W3 | Template engine + Web Worker (frozen ctx, 250 ms timeout, reset, error badge) | new `src/templates/*` | `TemplateEngine` interface first |
| W4 | Trust gate (IDB `trust` repo + prompt + settings section) | `src/data/db.ts`/`trustRepo.ts`, `dialogService`, `SettingsModal` section | non-destructive DB bump |
| W5 | Globals prefetch once per job + cache by `expiresAt` | `src/templates/globals.ts` | deep-clone into worker |
| W6 | Editor preview of row N + inspector csv/template wiring | `DataSourceTab`, `JsTab`, `ObjectTab`, `PreviewStage` | `sampleRowIndex` |

**Sequencing:** owner decisions → W3 interface + W1 (CSV) → W4 (trust) → W2/W5 (bind/globals) →
W6 (UI) → review per area → fix → **headed check + owner hardware smoke (50×30)** → commit per area.

## 7. Rules & commands

- Subagents must **not delegate** (depth 1). Missing info → terminal
  `needs-info. q: … . hint: … . next: … .`.
- Tests: `bun run test:run` (testTimeout 15 s); typecheck
  `node_modules/.bin/tsc.exe --noEmit`; build `…/bun.exe run build`. **Never `bunx`/`npx`/`bun test`.**
- Real-canvas tests via `src/test/canvasHarness.ts`; browser-only interactions (CSV file picker,
  trust prompt, worker) verified **headed** with `ab`
  (dev server `bun run dev`, `?print=1` harness exists; `?hardware=1` too).
- **Reviewer routing:** `review` + `experimental-review` (owner, 2026-10-04); `review-fast` for
  narrow re-reviews. **Commit per area; ask the owner before each.**
- Owner runs all **hardware smoke** (use the 50×30 preset + Ruler calibration variant).

## 8. Carry-in items from P5 (non-blocking, don't lose)

- Remote images need **CORS** to render/print; a non-CORS URL import fails with a localised error.
- Image import = two undo entries (`addImageRef` + `addNode`) — batch if convenient.
- Imported-font badge headed check not done (unit-tested).
- `printDirection` `right|bottom` encode unrotated like `top` (decide pre-rotate vs reject before P8).
- Narrow-roll placement / 0.5 mm drift + printhead-overflow warning = **P7**.
- `applyPolicy` = one full-frame pass per distinct policy (bounded 4) — revisit before P7 batches.

## 9. Gate (P6)

1. `bun run test:run` green · `tsc` clean · `bun run build` green.
2. Exit criteria demonstrated: attach CSV → bind text/QR → editor previews row N; template trust
   prompt + timeout/error badge; globals prefetch once.
3. Review per area (`review` + `experimental-review`); fix ≤2; re-review APPROVE.
4. Update `state.md` + `phase6_action-plan.md`; escalate lessons to `agent/memory/*`.
5. Semantic commit(s) per area (ask owner first). Owner hardware smoke recorded.

**Start by writing `agent/2026-09-29_label-editor-v1/phase6_action-plan.md`, then ask the owner the
§5 decisions before dispatching W1.**
