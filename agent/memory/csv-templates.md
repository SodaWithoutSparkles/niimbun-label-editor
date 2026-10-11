# CSV, templates & trust (`src/templates`, `src/data/*`, `src/editor/render/prepareContent.ts`)

Added in P6 (2026-10-06). How a table + trusted JS drive a label, and how the
trust gate works. Read before touching `src/templates/*`, the Data source / JS /
Global data tabs, or the sample-row preview.

## CSV (W1)

- `src/data/csvImport.ts` — PapaParse wrapper. **Deliberately `header: false` +
  manual header/data split** (not `header: true`): the object-row form leaks
  `Object.prototype` for a header named `__proto__`/`constructor`/`toString`.
  First non-blank physical row = header; blank cells get `column1…N`; duplicate
  names de-duplicated; rows are `string[][]` padded to the column count.
- **Cap = hard 50,000 rows**: keep the first `cap`, emit `{kind:'rows-capped', cap,
  total}`. `ParsedCsv.rowCount` is the **retained** count (`rows.length`); the
  pre-cap total lives only in the warning. Past the cap nothing accumulates (errors
  included), so a huge malformed file can't blow memory.
- `CsvRecord {id,name,columns,rows}` in IDB `csvs`; `doc.data.csv: CsvRef` with
  `source.kind:'local'` and `resourceId === csvId`. `CsvRecord.name` = import
  filename; `CsvRef.name` = editable display name.
- Attach is **one undoable store action** (`attachCsv` → `setDocCsv` + row reset).
  The `csvs` store is **not undoable**, so the write path must **never delete**
  records — undo would restore a `data.csv` ref to deleted bytes. Orphan sweep is
  a deferred cleanup pass.

## Row binding (W2)

- `src/core/doc/rowContext.ts` `buildRowContext(...)` — the resolve context
  `{index,total,row,rowCount,now,label,globals,fmt?,seeds}`. `row` is a
  **null-prototype**
  object built via `Object.defineProperty` so `__proto__`/`constructor` columns
  read normally. Duplicate columns are **first-wins** (matches `columns.indexOf`).
- **`ctx.seeds.docSeed` (P6)** — `TemplateSeeds { docSeed: string }`, required on
  `TemplateContext` (defaults `{docSeed:''}`). `prepareContent` supplies
  `seeds: { docSeed: doc.meta.id }`, so the seed is stable per document, survives
  round-trip, and needs no persisted field. The same document + the same data
  therefore always generates the same label (asset-tag UUID case).
- **Contract surface (P6)**: `docs/user-guide/templates.md` (author-facing) and
  `docs/developer-guide/template-context.md` (the `TemplateContext` contract,
  extract grammar, `docSeed`, trust model). `src/templates/contextContract.test.ts`
  pins the documented member list to `keyof TemplateContext` at compile time and
  asserts the members/tokens appear in those Markdown files.
- `src/editor/render/prepareContent.ts` `prepareResolvedContent({doc,csv,rowIndex,
  engine,ctx})` — async pre-pass returning an **override map** keyed by resolved
  node id (only csv/template sources; static omitted). `Date.now()` is read
  **once per pass**. Per-node try/catch degrades to the `fallback`; never throws.
- `resolve()` stays **sync + DOM-free** and consumes `ResolveContext.overrides`.
  Do not make it async.

## Template engine (W3)

- `src/templates/engine.ts` `TemplateEngine.evaluate(source, ctx)`; `Value`,
  `TemplateError` kinds `timeout|syntax|runtime|context|worker`.
- `src/templates/worker.ts` — Vite module worker
  (`new Worker(new URL('./worker.ts', import.meta.url), {type:'module'})`).
  Source is a **strict-mode function body** compiled as
  `new Function('ctx', '"use strict";\n' + code)` and awaited (no `${code}`
  wrapper, so no brace breakout). Compile errors → `syntax`; run errors → `runtime`.
- `src/templates/jsEngine.ts` — **ready handshake** (module-worker startup is not
  charged against the 250 ms timer), **250 ms per-request timeout** → terminate +
  lazy reset, `dispose()` flag, serial-use contract (one in-flight `evaluate`).
  Uncloneable ctx → `context`.
- `src/templates/freeze.ts` — throwing-Proxy ctx: set/delete/defineProperty/
  setPrototypeOf throw; `getOwnPropertyDescriptor` wraps values. **Realm-prototype
  pollution is NOT blocked** (`Object.getPrototypeOf(ctx.row).x = 1`) — accepted
  under the trusted-code model (decision 3); CSP is the real egress control. Do
  not "fix" this with a divergent prototype identity (breaks `instanceof`).

## Trust gate (W4, decision 32)

- IDB `trust` store (DB **v2**, additive `runUpgrade`), `src/data/trustRepo.ts`.
  Absent = `'ask'`. `src/core/trust.ts` holds the pure `createTrustGate` +
  `docHasTemplateSources` and the shared `TrustDecision` normalizer.
- Policy: **`never` is absolute** (a session Allow cannot re-enable). `always`/
  `never` **persist only** (and clear a stale session entry); `allowOnce`/
  `denyOnce` write the **session overlay** only. `resolve` = persisted ∪ overlay,
  `never` first.
- `src/store/trustGate.ts` `trustGateFor(repo)` — **one gate/overlay per repo**,
  shared by the editor and Settings, so a Settings revoke lifts a session Allow.
- `promptTemplateTrust({docId, docName})` → `'allowOnce'|'always'|'denyOnce'|'never'|'none'`
  (P6). Four buttons via the **`promptChoice`** service kind (`dialogService.ts`
  `kind:'choice'` → `ChoiceDialog` rendered by `DialogHost`), deduped per doc id.
  Escape/backdrop/X resolve the dialog's explicit `cancelValue` = `'denyOnce'`
  (session deny, fail-closed); a **displaced** request resolves `null` → `'none'`
  (no write; stays `ask`); a **rejected** prompt is caught and likewise treated as
  `'none'`. Keep dismissal and displacement distinct: the service's own
  `resolvePending()` (no argument) is the only path that yields `null`.
- **Persistent branches are wired (P6)**: `gate.always` / `gate.never` now have
  production callers (editor sample-row pass + print job). Each is awaited with a
  `.catch` fallback to the matching *session* decision, so a failed IDB write
  neither crashes the pass nor silently un-gates it (`never` still blocks).
- **Editor is fail-closed**: templates execute ONLY when the effective decision is
  `always`. `ask` / no gate ⇒ render fallbacks + `needsApproval`; `never` ⇒
  fallbacks + `blocked`. A doc with no template sources is never gated.

## Globals (W5)

- **`GlobalSpec` is a discriminated union (P6)** — `{kind:'remote', name, url,
  extract, expiresAt}` | `{kind:'static', name, value: string}`. `kind` is required
  in the type; persisted legacy specs omit it and `validate.ts` hydrates them to
  `'remote'` (unknown `kind` ⇒ remote; `static` with a missing/non-string `value`
  ⇒ `''`, not an error). Static specs resolve **inside the cache**: no fetch, no
  timeout, no expiry, cached always-valid, value deep-frozen like a remote one.
- `src/templates/globals.ts` `prefetchGlobals` + `createGlobalsCache()` (**one
  per job**). Cache key = `JSON.stringify` of the union identity tuple
  (`[name, kind, value]` / `[name, kind, url, extract, expiresAt]`) — **not** a
  `\u0000` join (spec strings may contain NUL; that join was ambiguous);
  valid while `expiresAt*1000 > now` (**strict**; `===` is expired). Concurrency
  cap, per-spec timeout/abort, in-flight dedupe. `extract` is a dotted path +
  `|`-literal fallback read via **own data descriptors only** (no getters, no
  arbitrary code). A leading `.` / `$` / `$.` is stripped (P6) so `.rate` and
  `$.rate` both work; `a.b.0.c` (dot-numeric index) is the only index form — no
  brackets, no jq. Values are cloned + deep-frozen per spec; an uncloneable value
  is a per-spec `invalid` warning, never a job rejection.
- `expiresAt` is epoch **seconds**. The Global-data UI seeds a **future** default
  (`now + 300`); `expiresAt: 0` means "never cached".

## Sample-row preview (W6)

- `src/components/editor/useSampleRow.ts` — the async override pass. Keyed on
  `resolveKeyOf(doc)` (doc id, sample row, per-node content sources, csv ref,
  globals, label dims) — **not** the whole doc — so transient geometry edits don't
  re-run the engine; single-flighted (the worker is serial-use). Also selects
  `trustRevision` so a Settings revoke re-resolves.
- `PreviewStage` renders a **synchronous** `resolve(doc, {overrides})` every
  render, so drag/resize/hide/lock/group repaint immediately. `overrides` come
  from the async pass. Do not go back to rendering the pass's resolved snapshot —
  that regressed live editing once.
- `trustRevision` (store) is bumped by `TrustSection` after revoke/reset so the
  editor's rendered output can't outlive a trust change.
- **Refresh tick (P6)** — a 1 s `setInterval` bumps a `tick` counter that is in the
  resolve-pass effect deps, so passes ride the **same** single-flight queue and
  superseded ones bail by `runId`. Gated by
  `doc !== null && !promptPending && (hasTemplates ? resolvedTrustRef.current === 'always' : hasRemoteGlobals(doc))`:
  a template-bearing doc ticks only once trust is resolved `always`; remote globals
  arm the tick only for docs with **no** template sources; static-only globals never
  tick. `resolvedTrustRef` (a ref, reset on doc change) carries the *synchronously*
  resolved trust because `state.trust` lags until the pass commits — gating on the
  lagging state let a tick slip into the window after a Settings revoke and
  re-prompt. `promptPending` is the "a prompt is in flight" guard; a rejected
  prompt is caught as `'none'` (fail-closed) so the pass still commits the real
  trust and cannot loop.

## Tests / gotchas

- Aliases: the bare `bwip-js` build has no `toCanvas`; import `bwip-js/browser`.
- Headed verification: `ab upload` needs a **Windows UNC** path
  (`\\wsl.localhost\Ubuntu\tmp\...`), not a WSL path — a WSL path attaches 0 bytes.
  `ab`'s network log may miss fetches; use in-page
  `performance.getEntriesByType('resource')`.
- The suite is ~23 s; `vitest.config.ts` still pins `testTimeout: 15000` from P5
  and could likely return to the default now.
