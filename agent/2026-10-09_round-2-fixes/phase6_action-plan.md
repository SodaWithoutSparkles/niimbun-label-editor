# Phase 6 action plan — Templates, globals & trust

- Plan: [`plan.md`](plan.md) §P6 · Handoff: [`handoff-p6.md`](handoff-p6.md) · State: [`state.md`](state.md)
- Base HEAD: `47d87cd`. Branch `main`. Full suite at start: 120 files / 1522 tests green, `tsc` clean.
- Owner: commit per phase (semantic). **No `en.json` edits this phase** — agents report missing keys (single
  pass at the end of the round, plan.md #8). No `ui-designer`. No `git stash`. Depth-1 subagents.

## Deliverables (5 items)

1. **Static globals** — a global you define locally (no URL).
2. **Extract normalization** — `.rate` / `$.rate` accepted.
3. **Contract surface** — written docs + `ctx.seeds.docSeed`.
4. **Trust prompt** — four choices; `gate.always` / `gate.never` become reachable.
5. **Refresh tick** — 1 s tick through the single-flight queue.

## Locked decisions (do not re-litigate; implement exactly)

### D1 — `GlobalSpec` becomes a discriminated union (`src/core/doc/types.ts:163-168`)
```ts
export interface GlobalSpecBase { name: string }
export interface RemoteGlobalSpec extends GlobalSpecBase { kind: 'remote'; url: string; extract: string; expiresAt: number }
export interface StaticGlobalSpec extends GlobalSpecBase { kind: 'static'; value: string }
export type GlobalSpec = RemoteGlobalSpec | StaticGlobalSpec;
```
- `kind` is **required** in the type; the **persisted/wire** form may omit it (legacy) — validation hydrates
  it (`validate.ts` `isGlobalSpec` → `parseGlobalSpec`, `:618-630`).
- `kind` absent or `'remote'` → remote branch (unchanged checks: url/extract strings, finite `expiresAt`,
  `Math.floor`). `kind === 'static'` → require `name`; `value` must be a string (`value` missing/non-string
  → `''`, not an error). Any other `kind` value → treat as `'remote'` (legacy tolerance), do not repair-fail.
- Keep the existing reject-the-doc-on-invalid-spec behaviour (`validate.ts:878` passes no `repairs`).
- Static value is a **plain string** (no JSON parsing). Templates read it as `ctx.globals.<name>`.

### D2 — Static values resolve inside the globals cache (`src/templates/globals.ts`)
- `cacheKey` (`:279-280`) includes the union: `name \0 kind \0 (value | url \0 extract \0 expiresAt)`.
- Static specs: **no fetch, no timeout, no expiry**; `values[name] = spec.value`; cached as always-valid.
  Reuse the existing `dedupeByName` / `values` / `warnings` plumbing so `runResolvePass` needs no change.
- Remote specs: byte-for-byte unchanged behaviour.
- `createExtract` (`:125-148`) normalization: trim; strip a leading `$.`, `$`, or a single leading `.`
  before splitting on `.`. `|` stays the fallback separator (unchanged). `''` → whole body (unchanged).
  `a.b.0.c` keeps working (dot-numeric only; no brackets, no jq).

### D3 — `ctx.seeds.docSeed` (`src/templates/engine.ts` + `rowContext.ts` + `prepareContent.ts`)
```ts
export interface TemplateSeeds { docSeed: string }
// TemplateContext: seeds: TemplateSeeds   (required)
// TemplateContextInput: seeds?: TemplateSeeds
```
- `createTemplateContext` (`engine.ts:107-116`) defaults `seeds: input.seeds ?? { docSeed: '' }`.
- `BuildRowContextInput.seeds?`; `buildRowContext` (`rowContext.ts:80-89`) emits `seeds: input.seeds ?? { docSeed: '' }`.
- `prepareContent.ts` supplies `seeds: { docSeed: doc.meta.id }` in the `buildRowContext` call (`:107-115`).
- **`docSeed = doc.meta.id`** — no new persisted field. `meta.id` is required, stable across saves, unique
  per document, and already survives round-trip + keys `resolveKeyOf`. `freeze.ts` / `jsEngine.ts:232`
  need no change (structurally cloned + generic proxy).

### D4 — Trust prompt: four choices (new dialog-service kind, NOT `confirm`)
`src/components/common/dialogs/dialogService.ts`:
```ts
export interface ChoiceAction { value: string; label: string; variant?: 'primary' | 'default' | 'danger' }
export interface ChoiceOptions { title?: string; message: string; actions: ReadonlyArray<ChoiceAction>; cancelValue?: string }
// PendingDialog gains: { id; kind: 'choice'; options; resolve: (value: string | null) => void }
export function promptChoice(options: ChoiceOptions): Promise<string | null>
```
- `resolvePending(value)`: for `choice`, `current.resolve(typeof value === 'string' ? value : null)`.
- New `src/components/common/dialogs/ChoiceDialog.tsx` (built on `Modal`, which already accepts an arbitrary
  `footer` node — `Modal.tsx:218-222`). Each action → `resolvePending(action.value)`; the dialog's
  close/cancel path → `resolvePending(options.cancelValue ?? null)`.
- `DialogHost.tsx` gains a `case 'choice'` arm; export `ChoiceDialog` from the dialogs barrel.
- Dismissal (Escape/backdrop/X) therefore resolves the **explicit** `cancelValue`, while a *displaced*
  request (service `resolvePending()` with no arg) resolves `null` — this preserves today's
  displacement semantics without the `getPending()?.id` trick.

`src/editor/trustPrompt.ts`:
- **Delete the stale comment `:7-10`** and rewrite the doc block to describe the four choices.
- `TemplateTrustSessionDecision` → `'allowOnce' | 'always' | 'denyOnce' | 'never' | 'none'` (rename to
  `TemplateTrustDecision`; keep the export name stable if anything imports it — check).
- Call `promptChoice({ title/message (existing `trust.prompt.*`), actions: [allowOnce, always, denyOnce, never],
  cancelValue: 'denyOnce' })`. `null` → `'none'` (stays `ask`, re-prompt). Keep the per-doc `inFlight` dedupe.
- Callers (`useSampleRow.ts:307-320`, `usePrintJob.ts:176-184`):
  `allowOnce/denyOnce` → session overlay; `always/never` → `await gate.always(id)` / `gate.never(id)` with a
  `.catch` fallback to the matching session decision (never crash the pass; `never` failing still blocks);
  `none` → no write. Then `trust = await gate.resolve(id)` as today.

### D5 — Refresh tick (`src/components/editor/useSampleRow.ts`)
- `tickEnabled = doc !== null && (docHasTemplateSources(doc) || hasRemoteGlobals(doc))`
  (`hasRemoteGlobals` = any `kind === 'remote'` spec). No interval otherwise.
- `useEffect` on `[tickEnabled]`: `setInterval(() => setTick(t => t + 1), 1000)` + `clearInterval` cleanup
  (StrictMode-safe). Add `tick` to the resolve-pass effect deps (`:370`).
- The pass **must** stay on the existing single-flight queue + `runId` bail — no parallel enqueue path.
  A 1 s re-render while a doc with templates is open is owner-accepted.

### D6 — Docs (item 3) — plain Markdown, no docs site (this round)
- `docs/user-guide/templates.md` — non-technical: what a field can bind to; the extract grammar a user types
  (`a.b.0.c`, `|fallback`); what "forbidden operations" means in practice; what happens when a field is missing.
- `docs/developer-guide/template-context.md` — the real contract: `TemplateContext` members
  (`index`, `total`, `rowCount`, `row`, `now`, `label`, `globals`, `fmt`, `seeds.docSeed`), `row`/`globals`
  shapes, `fmt`, `docSeed` semantics (stable per document, `= meta.id`), trust model (when JS runs, fail-closed).
- Contract test `src/templates/contextContract.test.ts`: a `readonly (keyof TemplateContext)[]` list of the
  documented members (compile-time pinned), asserting every required member is documented in the developer doc
  text. The test is the point — prose must match the type.

## i18n keys missing (report only — DO NOT edit `en.json`)
`editor.mfp.globalKind`, `editor.mfp.globalKindRemote`, `editor.mfp.globalKindStatic`, `editor.mfp.globalValue`,
`editor.mfp.globalValueHint`, `trust.prompt.allowOnce`, `trust.prompt.always`, `trust.prompt.denyOnce`,
`trust.prompt.never`. (Implementers: use `t('<key>')` anyway; missing keys render as the key until the batch pass.)

## Fan-out (one writer per file per wave)

**Wave 1 — parallel**
- **A1 `general`** — Static globals, end to end (model + engine + UI + extract normalization + tests).
  Files: `src/core/doc/types.ts`, `src/core/doc/validate.ts`, `src/templates/globals.ts`,
  `src/templates/globals.test.ts`, `src/core/doc/validate.test.ts`,
  `src/components/editor/GlobalDataTab.tsx`, `src/components/editor/GlobalDataTab.test.tsx`.
  Covers D1, D2 **and** the `GlobalDataTab` variant (the `GlobalSpec` union is a compile break for the tab —
  the same agent must keep the repo typechecking). Pin the extract grammar in tests (dotted, dot-numeric
  indices, `|fallback`, `.rate`, `$.rate`, no getters, no code execution).
- **A2 `general`** — Four-choice trust prompt + wiring.
  Files: `src/components/common/dialogs/dialogService.ts`, new `ChoiceDialog.tsx`, `DialogHost.tsx`,
  `src/components/common/dialogs/index.ts` (barrel), `src/editor/trustPrompt.ts`, `src/editor/trustPrompt.test.ts`,
  `src/components/editor/useSampleRow.ts` (only the trust/prompt block), `src/components/print/usePrintJob.ts`.
  Covers D4. `useSampleRow.ts` is single-writer per wave — A2 owns it in wave 1.

**Wave 2 (after A1/A2 land)**
- **B1 `general`** — `ctx.seeds.docSeed` + refresh tick + fake-timer tests.
  Files: `src/templates/engine.ts`, `src/core/doc/rowContext.ts`, `src/editor/render/prepareContent.ts`,
  `src/components/editor/useSampleRow.ts` (tick — **must not** clobber A2's prompt block; rebase on it),
  `src/components/editor/useSampleRow.test.tsx`, `src/core/doc/rowContext.test.ts`.
  Covers D3, D5.

**Wave 3**
- **C1 `general`** — docs + contract test. Files: `docs/user-guide/templates.md`,
  `docs/developer-guide/template-context.md`, `src/templates/contextContract.test.ts`. Covers D6.
  Runs after B1 freezes `TemplateContext` (incl. `seeds`).

## Verification
- Per agent: `bun run test:run <touched test files>` and
  `node node_modules/typescript/bin/tsc --noEmit`.
- Coordinator, after all waves: full `bun run test:run` + `tsc --noEmit`.
- Review (`review` primary; `review-alt` fallback; `review-fast` for narrow re-reviews) → fix (max 2 rounds)
  → semantic commit: `feat(templates): static globals, extract normalization, contract docs, 4-choice trust
  prompt, refresh tick (#P6)`.

## Risks / watch
- **R4 (tick):** must ride the single-flight queue, bail by run id, be StrictMode-idempotent, and stay silent
  with no templates/live globals. No infinite prompt loop (allow/deny settle the session decision on the first choice).
- **R — trust wiring:** `always`/`never` now write IDB from the editor path — handle reject without breaking the pass.
- **R — `useSampleRow.ts` collision** between A2 (wave 1) and B1 (wave 2): serialize, rebase.
- **Legacy docs:** a globals spec without `kind` must still load as `remote` (round-trip test).
- **en.json untouched** — no per-phase i18n edits (batch at round end).
