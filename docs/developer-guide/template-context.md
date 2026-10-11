# Template context contract

The authoritative reference for what a JavaScript template sees and how it is
executed (P6). Non-technical overview: [`docs/user-guide/templates.md`](../user-guide/templates.md).
Background on the subsystem: `agent/memory/csv-templates.md`.

Source of truth is the code — this document must match it. A contract test
(`src/templates/contextContract.test.ts`) fails if a `TemplateContext` member or
an extract-grammar token below drifts out of these docs.

## `ContentSource` — what a field binds to

A text node holds its source in `text`; a QR/barcode node holds its in `data`
(`contentSourceOf`, `src/editor/contentSource.ts`). The source is a
discriminated union (`src/core/doc/types.ts`):

```ts
export type ContentSource =
    | { kind: 'static';   value: string }
    | { kind: 'csv';      column: string; fallback: string }
    | { kind: 'template'; code: string;   fallback: string };
```

- `static` — a literal; `resolve` handles it synchronously, the pre-pass omits it.
- `csv` — binds by **column name** on the current row.
- `template` — `code` is a **JavaScript function body** (not a `{{ }}`
  placeholder). It must `return` the value to print.

## `TemplateContext` — every member

Defined in `src/templates/engine.ts`; built by
`createTemplateContext(input)` there and by `buildRowContext(input)`
(`src/core/doc/rowContext.ts`). Built with defaults, the shape is:

```ts
export interface TemplateContext {
    index: number;                 // zero-based row index within the job
    total: number;                 // total rows in the job
    row: Record<string, string>;   // current CSV row, keyed by column name
    rowCount: number;              // rows in the job (alias of `total`)
    now: number;                   // epoch MILLISECONDS at resolve time, host-supplied
    label: TemplateLabel;          // label metadata
    globals: Record<string, unknown>; // prefetched globals keyed by spec name
    fmt?: TemplateFormat;          // formatting settings; omitted when not supplied
    seeds: TemplateSeeds;          // { docSeed: string }
}
```

Semantics and per-member defaults from `createTemplateContext` / `buildRowContext`:

| Member | Type | Default | Semantics |
| ------ | ---- | ------- | --------- |
| `index` | `number` | required | Zero-based row index within the job. Reported truthfully even when out of range. |
| `total` | `number` | required | Total rows in the job (`rows.length`). |
| `row` | `Record<string, string>` | required | The current CSV row keyed by column name (see *Row shape*). |
| `rowCount` | `number` | `total` | Rows in the job. A template-ergonomics alias of `total`. |
| `now` | `number` | required | Epoch **milliseconds** at resolve time. The **host** reads the clock once per pass; the worker never reads the clock. Never stored (document `meta` timestamps stay epoch seconds; the two clocks are independent by design). |
| `label` | `TemplateLabel` | `{}` | Label metadata: `{ name?, width?, height?, dpi?, printDirection?, [key: string]: unknown }`. |
| `globals` | `Record<string, unknown>` | `{}` | Prefetched globals keyed by `GlobalSpec.name` (see *Globals shape*). |
| `fmt` | `TemplateFormat` | *omitted* | `Record<string, unknown>` formatting **settings** (locale, currency, patterns), not callables — the context is structured-cloned to the worker, so functions cannot cross. Omitted entirely when not supplied. |
| `seeds` | `TemplateSeeds` | `{ docSeed: '' }` | Host seeds; only `docSeed` today. |

`row` is always present (an empty object when there is no row). `globals` is
always present. `fmt` is the one optional member, so `'fmt' in ctx` is the test
for "formatting was supplied".

### Row shape

`buildRowContext` (and, through it, the real resolve path) produces `row` as:

- a **null-prototype** object with entries defined as own data properties, so
  columns literally named `__proto__`, `constructor`, or `toString` are ordinary
  readable cells (never prototype traffic);
- **blank column names are skipped** (cannot be bound by name);
- **duplicate column names are first-wins**, matching the `columns.indexOf`
  lookup used by direct CSV binding;
- a column with no cell in a short row maps to `''`;
- an **out-of-range or non-integer `index` yields an empty `row`** (never a
  clamped last row) so the binding falls back instead of silently showing the
  wrong row.

In the resolve pre-pass the columns/rows come from the attached CSV
(`csv?.columns ?? []`, `csv?.rows ?? []`).

### Globals shape

`globals` maps `GlobalSpec.name` → resolved value, produced once per pass by
`prefetchGlobals` / a job-scoped `createGlobalsCache` (`src/templates/globals.ts`).

- **Remote** spec (`{ kind: 'remote'; url; extract; expiresAt }`): fetched once
  per job, run through the extract grammar, then cloned and **deep-frozen**.
  `expiresAt` is epoch **seconds**; a cached entry is valid only while
  `expiresAt * 1000 > nowMs` (**strict** — equality is expired). `0` means "never
  cached".
- **Static** spec (`{ kind: 'static'; value }`): a plain string, no fetch, no
  timeout, no expiry — cached as always-valid for the job.
- **Duplicate names are first-wins**; the dropped duplicate becomes an
  `{ kind: 'invalid' }` warning. A spec that fails (timeout/fetch/extract/invalid)
  contributes **no key** and a warning — it never rejects the job.
- Values are read-only: deep-frozen before they land in `globals`, and the ctx
  proxy additionally blocks mutation.

## Extract grammar and fallback

`GlobalSpec.extract` is a **string**, never executed. Grammar
(`createExtract`, `src/templates/globals.ts`):

```
path
path | fallback
```

- The path is trimmed, then a leading `$.`, `$`, or a **single** leading `.` is
  stripped, so `.rate`, `$.rate`, `$rate`, and `rate` all address the same key.
- Segments are split on `.`. Each segment is a property key or a non-negative
  integer array index: `items.0.name`, or `a.b.0.c`. Keys containing `.` or `|`
  cannot be addressed.
- **No brackets and no jq.** `a.b[0].c` is not supported (use `a.b.0.c`), and
  there is no jq-style `|` chaining. The split is at the **first** `|`
  (`indexOf`), so `|` is exclusively the **fallback separator**.
- Only **own data properties** are read (via `getOwnPropertyDescriptor`); an
  accessor (getter/setter) is treated as path-absent, so no body-supplied code
  ever runs during extraction.
- The **fallback** is literal text. It is parsed as JSON when valid
  (`{...}`, `[1,2]`, `42`, `true`, `null`, `"x"`), otherwise it is the raw
  string. An empty fallback yields `undefined`.
- An **empty path** (e.g. `|fallback` or `$`) means the whole body.
- Missing path with no fallback → an `extract` warning and no
  `globals.<name>`. A remote spec with an empty `extract` → an `invalid` warning.
- The extracted value must be **structured-cloneable**; anything else → an
  `invalid` warning.

## `seeds.docSeed` — stable per document

```ts
export interface TemplateSeeds { docSeed: string }
```

`docSeed` is **stable per document** and currently equal to **`doc.meta.id`**.
No new persisted field is introduced: `meta.id` is required, unique, stable
across saves, and survives round-trip, so the same document + same data always
generates the same label. This is what makes repeatable pseudo-random values
(task ids, asset-tag UUIDs) safe.

The resolve pre-pass supplies it explicitly (`prepareContent.ts`):
`seeds: { docSeed: doc.meta.id }`. When a host builds a context without supplying
seeds, both `createTemplateContext` and `buildRowContext` default to
`{ docSeed: '' }` — an empty seed is valid but not document-specific.

## Trust model

Trust is local state, never document data (`src/core/trust.ts`,
`src/data/trustRepo.ts`). The effective `TrustDecision` is `'ask' | 'always' |
'never'`; absent means `'ask'`.

**Templates execute if and only if the effective decision is `always`.** The
editor is fail-closed:

- `always` → templates run.
- `ask` (or no gate) → templates do **not** run: fields render their fallbacks
  and the UI reports `needsApproval`.
- `never` → templates do **not** run: fields render their fallbacks and the UI
  reports `blocked`.

A document with **no** template sources is never gated (`docHasTemplateSources`,
decision 42) — callers must not prompt.

### Persisted vs session, and the four choices

The prompt (`promptTemplateTrust`, `src/editor/trustPrompt.ts`) offers four
choices; a **displaced** dialog (a second prompt replacing the first) resolves
`'none'`, and an explicit dismissal (Escape/backdrop/close) resolves the
prompt's `cancelValue`, `'denyOnce'`.

| Choice | Effect |
| ------ | ------ |
| `allowOnce` | Session overlay `always` (until reload); not persisted. |
| `always` | Persisted `always` via `gate.always(id)`; clears any stale session entry. |
| `denyOnce` | Session overlay `never`; not persisted. |
| `never` | Persisted `never` via `gate.never(id)`; clears any stale session entry. |
| `none` | No write; the document stays `ask` and re-prompts later. |

`resolve` = persisted ∪ session overlay, with **`never` checked first and
absolute**: a session Allow can never re-enable a persisted `never` (only
Settings can). The editor path tolerates a failed persistence write: `always`
falls back to a session `allowOnce`, and `never` falls back to a session
`denyOnce` (so `never` failing still blocks).

## Execution model

- **Strict-mode function body.** The worker compiles the source directly as
  `new Function('ctx', '"use strict";\n' + code)` and awaits the result. `code`
  is the **body** of a function over `ctx`; there is no `${code}` wrapper, so a
  stray `}` is a syntax error rather than a wrapper escape. A source with no
  `return` resolves to `undefined`. Strict mode means `with` is a syntax error
  and assigning to an undeclared name throws rather than creating a global.
- **Module worker.** `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`.
  A dedicated worker has no `document`, so no DOM is reachable.
- **Ready handshake.** The host waits (bounded, `READY_TIMEOUT_MS = 5000`) for
  `{ type: 'ready' }` before it posts a request, so worker startup is not charged
  against the execution budget.
- **250 ms per-request timeout** (`TIMEOUT_MS = 250`). A timeout rejects *that*
  request as `timeout`, then terminates and lazily resets the worker (any other
  in-flight request fails as `worker`).
- **Serial single-use engine.** At most one in-flight `evaluate`; concurrent
  calls share one worker, and a timeout resets it. Call `dispose()` when the job
  ends; `evaluate` after `dispose()` rejects.
- **Throwing-Proxy ctx** (`src/templates/freeze.ts`): `set`, `delete`,
  `defineProperty`, and `setPrototypeOf` throw a `TypeError`; reads pass through
  unchanged, including prototype identity (`x instanceof Object` still works).
  This is a mutation guard, **not** a sandbox: realm-prototype pollution
  (`Object.getPrototypeOf(ctx.row).x = 1`) is intentionally **not** blocked
  (trusted-user-code model). The real egress control is CSP, not this Proxy.
- **Best-effort egress removal.** The worker deletes/shadows `fetch`,
  `XMLHttpRequest`, `WebSocket`, `EventSource`, and `importScripts`. This is
  **cosmetic, not a sandbox** — `(function(){}).constructor('return fetch')()` and
  dynamic `import()` can recover egress; CSP (`worker-src` / `connect-src`) is the
  control.
- **Error kinds** (`TemplateErrorKind`): `timeout` (budget exceeded),
  `syntax` (compile failure), `runtime` (compiled code threw), `context` (the
  host context could not be structured-cloned to the worker), `worker` (worker
  creation/crash/protocol/reset). An uncloneable template **result** is reported
  as `runtime` ("could not be serialized").
- **Formatting helpers.** `fmt` carries data only. Functions cannot cross the
  `postMessage` boundary, so callable helpers belong in the worker module, not in
  `ctx`.

## Where templates execute in the pipeline

Both entry points share one function, `runResolvePass`
(`src/components/editor/useSampleRow.ts`):

- the **sample-row preview** (`useSampleRow`), and
- the **print resolve pass** (`src/components/print/usePrintJob.ts`).

`runResolvePass`:

1. If `trust !== 'always'`, it never passes an engine, so nothing executes.
2. When executable, it prefetches `doc.data.globals` through a job-scoped
   `GlobalsCache` and spreads `values` into `ctx.globals`.
3. It calls `prepareResolvedContent` (`src/editor/render/prepareContent.ts`),
   which reads `Date.now()` **once per pass**, builds **one** `row` context, and
   evaluates every `csv`/`template` node. `static` sources are omitted (the sync
   `resolve` handles them). A per-node `try/catch` degrades to the source
   `fallback`; the pass **never throws**.
4. The sync, DOM-free `resolve(doc, { overrides })` consumes the override map,
   keyed by resolved node id. `resolve` stays synchronous — do not make it async.

A value that resolves to an empty string (or a non-primitive: object, array,
`null`, `undefined`, function, symbol) degrades to the `fallback`; if the
fallback is also empty, the field shows the `{empty}` placeholder.
