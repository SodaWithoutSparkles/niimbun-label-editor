# Phase 6 Action Plan — CSV + templates (M6)

**Run:** `agent/2026-09-29_label-editor-v1` · **Written:** 2026-10-05 · **Owner:** Coordinator
**Plan:** `plan.md` P6 row (line 313) · **Handoff:** `HANDOFF-p6.md` · **Prev:** `HANDOFF-p5.md` (P5 DONE)

**Exit criteria (plan):** Attach CSV → bind text/QR → editor previews row N. Plus: template trust
prompt + 250 ms timeout/error badge; globals prefetch once.

---

## 0. Read first (subagents get an explicit slice; do not roam)

1. `plan.md` P6 row (313), Template system (237–245), Storage (207–220), Data model; decisions
   3, 4, 24, 28, 32, 33, 40, 42.
2. `HANDOFF-p6.md` §3 "what already exists", §4 locked decisions.
3. Memory: `agent/memory/objects-assets.md` (async asset seam), `agent/memory/testing.md`,
   `agent/memory/store-and-slices.md`, `agent/memory/dialogs.md`, `agent/memory/i18n.md`.
4. Reference clone (gitignored): `references/niimblue/src/utils/canvas_preprocess.ts`,
   `PrintPreview.svelte`, `defaults.ts`.

## 1. Locked decisions (do NOT relitigate)

- **Trust model (dec 3):** templates = trusted user code (Office-macro boundary). Worker + 250 ms
  timeout + no secrets. **No hostile sandbox.**
- **Trust = local state (inv 11, dec 32):** IDB `trust` store keyed by doc id, written only by the
  user, never by import. `always` silent; `never` blocks everywhere incl. authoring machine until
  re-enabled in settings; absent/`ask` prompts on open. Prompt allow/deny = session only; persisting
  needs Always/Never. Import/duplicate mint a new `meta.id`.
- **`ctx.now` = `Date.now()` (ms) at resolve time, never stored (dec 24).** Doc `meta` = epoch seconds.
- **Globals:** `GlobalSpec.expiresAt` = epoch **seconds** (dec 33); prefetch **once per job**, shared
  cache keyed by `expiresAt`, deep-clone into worker. Templates never fetch.
- **CSV = an `AssetRef` like every asset (dec 28).** `CsvRecord.name` = original import filename;
  `CsvRef.name` = user-editable display name.
- **i18n (dec 40):** every product string via `t()`; dynamic keys via the literal-map pattern.
- **Differentiator isolation (dec 42):** a doc with no template sources is **never gated** by trust;
  the plain CSV→bind→preview→print path must not depend on the template engine.
- Integer `hm`; `src/core/` stays React/Konva/DOM-free (`headless.test.ts`).
- Global `keydown`/`paste`/`drop` handlers bail on `dialog[open]`.
- Reviewer routing: `review` + `experimental-review` (both available); `review-fast` for narrow
  re-reviews. **Commit per area; ask the owner before each.**

## 2. Open decisions — ASK THE OWNER BEFORE DISPATCHING (handoff §5)

| # | Question | Coordinator recommendation |
| - | -------- | -------------------------- |
| O1 | CSV import provenance | `local` (IDB `csvs`), mirroring P5 files |
| O2 | New dep `papaparse@5.7.0` + `@types/papaparse` | approve `bun add` |
| O3 | Worker packaging | `new Worker(new URL('./worker.ts', import.meta.url), {type:'module'})` (Vite-native); verify build |
| O4 | Template surface | raw JS only (`return (ctx) => {…}`); `{{ }}` sugar deferred |
| O5 | `$times` column | **defer to P7** (batch quantity is P7 scope); P6 treats `$times` as a normal column |
| O6 | Globals UI | **owner:** a separate **Global data** tab next to Data source (MFP), for `GlobalSpec` editing |

### Resolved (owner, 2026-10-05)

- **O1 = `local`.** CSV bytes/table live in IDB `csvs`; doc `data.csv.source = { kind:'local', mediaType:'text/csv', resourceId }`.
- **O2 = approved.** `bun add papaparse@5.7.0` + `bun add -d @types/papaparse`.
- **O3 = Vite-native module worker** `new Worker(new URL('./worker.ts', import.meta.url), {type:'module'})`; verify the production build emits it.
- **O4 = raw JS only.** `return (ctx) => {…}`; no `{{ }}` sugar in P6.
- **O5 = defer `$times` to P7.** Treated as a normal column in P6.
- **O6 = new "Global data" MFP tab** beside Data source, owning `data.globals`.

## 3. Workstreams

> Sequencing: O1–O6 → **W3 interface** + **W1 (CSV)** → **W4 (trust)** → **W2/W5 (bind/globals)** →
> **W6 (UI)** → review per area → fix → headed check → owner hardware smoke → commit per area.

### W1 — CSV import (PapaParse) + store + virtualized preview component + cap
- Files: `src/data/csvImport.ts` (new), `src/data/csvRepo.ts` (unchanged unless needed), new
  `src/components/editor/CsvPreviewTable.tsx` (self-contained, no store), `docSlice` wiring.
- `csvImport.ts`: `parseCsv(file|text, {onProgress}) → {columns, rows, warnings}` via PapaParse
  (header row → `columns`; step/worker parse for large files). **Hard cap 50k rows**: parse up to the
  cap, emit a `rows-capped` warning with the dropped count (protects memory/IDB).
- Store: parsed `CsvRecord` → `csvRepo.put`; wire a `csvRepo` on the shared IDB adapter in `docSlice`
  (mirror `resourceRepo`); add an **undoable** action to attach a CSV to the doc
  (`data.csv: CsvRef {csvId, name, source:{kind:'local', mediaType:'text/csv', resourceId}}`).
- UI: `CsvPreviewTable` = windowed/virtualized table (columns + rows). **Do not touch
  `DataSourceTab`** — W6 mounts it. i18n keys for every string.
- Tests: `csvImport.test.ts` (quoting/CRLF/header/cap), csvRepo round-trip, docSlice attach.

### W2 — Row context + binding resolution (csv/template → value) + fallbacks
- Files: `src/core/doc/` (add a `RowContext`/resolve-input type if needed),
  `src/editor/render/resolve.ts` + a **new async prepare/execute seam** (mirror P5's
  `prepareResolvedAssets`).
- **Keep `resolve` sync.** Add an async pre-pass that evaluates csv/template sources for a given row
  and returns a resolved-content override map keyed by node id; `resolve` consumes it. Do NOT make
  `resolve` async.
- `resolveContent` stays the fallback path: absent column/row → `fallback`; empty → placeholder.
- Binding by column name; document render path uses `data.sampleRowIndex`.

### W3 — Template engine + Web Worker (frozen ctx, 250 ms timeout, reset, error badge)
- New `src/templates/`:
  - `engine.ts` — `interface TemplateEngine { evaluate(source, ctx): Promise<Value> }`.
  - `worker.ts` — receives `{code, ctx}`, wraps code as `return (ctx) => {…}`, evaluates, posts
    `{ok, value | error}`.
  - `jsEngine.ts` — `JavaScriptTemplateEngine` (spawn worker per call or pooled; **250 ms timeout →
    worker.terminate() + reset + error**).
  - `freeze.ts` — deep-frozen ctx via throwing `Proxy` (mutation throws; unit test asserts).
  - Guard: no DOM/app refs, no dynamic `import()`, no network (document + tests).
- Error → error badge on the object (reuse the P5 warning/badge seam).
- `src/core/` stays DOM-free — keep the worker/engine in `src/templates` (browser edge).

### W4 — Trust gate (IDB `trust` repo + prompt + settings section)
- `src/data/db.ts`: add `'trust'` to `StoreName`/`STORE_NAMES`/schema + `DB_VERSION` bump (2) in a
  **non-destructive** `runUpgrade` (existing `contains` guard already handles it). `createMemoryAdapter`
  seeds `trust`.
- `src/data/trustRepo.ts` (new): `get(docId)`, `set(docId, 'ask'|'always'|'never')`, `list()`,
  `remove(docId)`, `clear()`. Absent = `'ask'`.
- Prompt via `dialogService` on open when a template source is present and trust is `ask`; allow/deny
  = session only (in-memory session set); Always/Never persist.
- `SettingsModal` section (new `TrustSection.tsx` + registry entry): list stored decisions, revoke/reset.
- **Isolation:** no template sources → never gated.

### W5 — Globals prefetch once per job + cache by `expiresAt`
- `src/templates/globals.ts`: `prefetchGlobals(specs, ctx)` — concurrency cap, per-spec timeout,
  shared cache keyed by `expiresAt`; freeze + deep-clone into worker as `globals.<name>`.
- `GlobalSpec.extract` = how to pull the value from the fetched response (define the small expression
  semantics; keep it non-Turing — a dotted path or tiny selector, owner-confirmable).
- Job-scoped: prefetch once per print/preview job, reused across rows.

### W6 — Editor preview of row N + inspector csv/template wiring + MFP tabs
- `data.sampleRowIndex` (exists, `setSampleRowIndex` undoable) picks the editor's row; the editor
  executes csv/template for that row (static stays as-is).
- `DataSourceTab`: attach CSV (uses W1 `CsvPreviewTable`), column list, sample-row pick, globals.
- **New `GlobalDataTab`** (O6): edit `data.globals: GlobalSpec[]` (name/url/extract/expiresAt) —
  mounted in `MfpPanel` beside Data source.
- `JsTab`: template source editor + trust state + error badge (enabled once trust allows).
- `ObjectTab` / `inspectorModel`: wire `contentSource` (static/csv/template) editing — **fixes the
  P3/P5 bug where a csv/template source silently rewrites to static**; reserved `contentSource` +
  `templateTrust` fields get consumed.
- `PreviewStage`: feed the prepared row context into the render.

## 4. Review routing

| Area | Reviewer(s) |
| ---- | ----------- |
| W3 (engine/worker) | `review` + `experimental-review` (security-adjacent) |
| W4 (trust) | `review` + `experimental-review` |
| W1/W2/W5/W6 | `review` (logic) or `review-fast` (mechanical) per size |
| fixes | narrow `review-fast` re-review |

Fix rounds ≤2 per area; deadlock → escalate to Build.

## 5. Gate (P6)

1. `bun run test:run` green · `node_modules/.bin/tsc.exe --noEmit` clean · `bun run build` green.
2. Exit criteria demonstrated (headed, `ab` + dev server): attach CSV → bind text/QR → editor previews
   row N; template trust prompt + timeout/error badge; globals prefetch once.
3. Review per area (`review` + `experimental-review`); fix ≤2; re-review APPROVE.
4. Update `state.md` + this file; escalate lessons to `agent/memory/*`.
5. Semantic commit(s) per area (ask owner first). Owner hardware smoke (50×30) recorded.

## 6. Commands / rules

- Tests: `bun run test:run` (testTimeout 15 s); typecheck
  `node_modules/.bin/tsc.exe --noEmit`; build `…/bun.exe run build`. **Never `bunx`/`npx`/`bun test`.**
- Real-canvas tests via `src/test/canvasHarness.ts`; browser-only interactions (CSV picker, trust
  prompt, worker) verified **headed** with `ab` (dev server
  `bun run dev`, `?print=1`, `?hardware=1`).
- Subagents must **not delegate** (depth 1). Missing info → terminal
  `needs-info. q: … . hint: … . next: … .`
- Owner runs all **hardware smoke** (50×30 preset + Ruler calibration variant).

## 7. Status

| WS | Area | Status |
| -- | ---- | ------ |
| W1 | CSV import + store + virtualized preview + cap | **DONE** — `22fc00e`; review APPROVE (review + review-fast) |
| W2 | Row context + binding resolution + fallbacks | in progress |
| W3 | Template engine + Web Worker | **DONE** — `e1b8872`; experimental-review + review-alt APPROVE (2 fix rounds) |
| W4 | Trust gate (IDB trust + prompt + settings) | in progress |
| W5 | Globals prefetch once per job | pending |
| W6 | Editor preview row N + inspector wiring | pending |

## 8. Review record

- **W3** (`review` provider-error → `experimental-review` + `review-alt`): round 1 = CHANGES-REQUESTED
  (runtime `SyntaxError` misclassified; `getOwnPropertyDescriptor`/`getPrototypeOf` freeze escapes;
  250 ms budget included worker cold start; disposed leak) → fix → `review-alt` found 2 regressions
  (own `constructor` key shadowed; `instanceof Object` broken) → fix → **APPROVE** (0 blocking).
  Engine now: ready handshake, direct strict-mode body compile, timeout scoped per request, lazy
  reset, `context`/`worker` error kinds. 41 template tests.
- **W1** (`review`): round 1 = CHANGES-REQUESTED (preview window not clamped on shrink; `Object.prototype`
  leak on `__proto__`/`constructor` headers; blank header discarded; unbounded error list; unvalidated
  `setDocCsv`) → fix (parser reworked to `header:false` + manual split) → `review-fast` **APPROVE**
  (6/6 resolved). 23 CSV-import tests.
- Gate at W1+W3 commit: **800 tests / 76 files**, `tsc` clean, build green.

**Next action:** W4 + W2 in flight; then W5 → W6 → full-gate re-review → headed check → owner hw smoke.
