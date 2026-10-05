# Phase 7 Action Plan — Preview + batch print (M7)

**Run:** `agent/2026-09-29_label-editor-v1` · **Written:** 2026-10-06 · **Owner:** Coordinator
**Plan:** `plan.md` P7 row (line 314) · Print pipeline (246–259) · Rendering (226–235) · decisions
7, 14, 18, 35, 42 · **Handoff:** `HANDOFF-p7.md` · **Prev:** `HANDOFF-p6.md` (P6 code-complete)
**UI spec:** `ui-spec.md` (P3; consult for shell/list patterns; no `ui-designer` — owner decides).

**Exit criteria (plan):** a 100-label CSV job prints reliably; mid-job cancel is clean.

---

## 0. Read first (subagents get an explicit slice; do not roam)

1. `plan.md` P7 row (314), Print pipeline (246–259), Rendering (226–235), decisions 7/14/18/35/42.
2. `HANDOFF-p7.md` §3 "what already exists" + §4 locked decisions.
3. Memory: `agent/memory/print-transport.md` (⚠ non-monotonic `page`), `csv-templates.md`,
   `objects-assets.md`, `dialogs.md`, `testing.md`, `tech-debt.md` (D-01…D-05, D-24, D-25).
4. Reference (gitignored): `references/niimblue/src/components/PrintPreview.svelte`
   (`$times` expand, `updatePreview` invert/mirror/offset, head-size warning, progress math).

## 1. Locked decisions to honour (do NOT relitigate)

- **Preview ≡ print (invariant 7):** one render entry point (`renderLabelPage`). Thumbnails,
  dialog preview and the print raster all go through it. No second render path.
- **Sequence is lazy async (invariant 9):** never materialize all pages/raster for a big CSV.
  `totalPages` (a cheap Σ of integers, no rendering) is computed upfront — the library needs it.
- **Backpressure + one job at a time.** Cancel = abort → `printEnd()` in the transport's `finally`.
  Do **not** call `printEnd` anywhere else.
- **Printer-reported values never gate printing** (dec 18). Roll/dpi mismatch and printhead
  overflow are non-blocking warnings.
- **`$times`:** per-row copy count, default 1, floor, clamp non-positive to 0 (row skipped),
  matching `PrintPreview.svelte:372-389`. Multiplied by the dialog's global `copies` field.
- **Differentiator isolation (dec 42):** plain CSV→preview→print must not depend on the template
  engine or trust gate. `src/print/*` receives a per-row **content-prep callback** from the caller;
  it never imports `src/templates` or trust.
- Integer `hm`; `src/core/` stays React/Konva/DOM-free (headless guard). i18n for every product
  string. Global `keydown`/`paste`/`drop` bail on `dialog[open]`.
- Reviewer routing: `review` + `experimental-review`; `review-fast` for narrow re-reviews.
  **Commit per area; ask the owner before each.**

## 2. Owner decisions (2026-10-06) — resolved

| # | Question | Resolution |
| - | -------- | ---------- |
| O1 | Thumbnail source | **Rasterize at ~50 dpi** via the shared path (`renderLabelPage` gains a `dpi` option). |
| O2 | LRU / concurrency | **Keep ~32 pages / 2 concurrent** (tunable constants). |
| O3 | Override scope | **Expose every override applicable to B1_PRO, disable/gate the rest** on reported capabilities. |
| O4 | `printDirection` right/bottom | **Pre-rotate the raster** — the printer cares about pixels; the encoder stays 2-valued. |
| O5 | P6 hardware smoke | **Fold into P7's print-UI smoke** (clears D-24; one owner smoke covers P6+P7). |

**Spike result (scout, 2026-10-06) — capabilities of `D110M_V4` (B1_PRO):**
`printTasksCapabilities.D110M_V4 = [SupportDoubleColor, SupportTubePrinting]`. Honored options:
`labelType`, `density` (**1–5, default 3** for B1_PRO), `speed` (**0|1**), `pageColor`
(Single|Double), `totalPages`, `cutType`/`cutHeight`, optional tube. `printDirection` is **model
metadata** (`B1_PRO → "top"`) passed to `ImageEncoder.encodeCanvas`, not a task option.
B1_PRO paper types: `WithGaps | Black | Transparent`. Lib does **no runtime density validation** —
bounds come from model metadata (`densityMin/Max/Default`) + our UI.

## 3. Frozen interfaces

### 3.1 Printer capabilities (W0) — additive to the frozen contract

`src/print/transport.ts`:
```ts
export interface PrinterCapabilities {
  model?: string;            // e.g. 'B1_PRO'
  taskType?: string;         // e.g. 'D110M_V4'
  printheadPixels?: number;  // 567 for B1_PRO
  densityMin?: number;       // 1
  densityMax?: number;       // 5
  densityDefault?: number;   // 3
  paperTypes?: LabelType[];  // niimbluelib LabelType values (copied per status emit)
  doubleColor?: boolean;
  tubePrinting?: boolean;
  supportsSpeed?: boolean;   // true only for D110M_V4 (reference gates the speed control)
}
// PrinterStatus gains: capabilities?: PrinterCapabilities;
```
- `niimbotAdapter` populates it on `connect` from `getModelMetadata()` + `printTasksCapabilities`
  (via `client.getPrintTaskType()`); absent model metadata → `undefined` (no gating, no crash).
- `MockTransport` reports a **B1_PRO-like** capability set by default (overridable) so the dev
  harness and UI tests exercise the gated path.
- MockTransport may also seed `rollWidthHm/rollHeightHm` (optional) for the mismatch warning.

### 3.2 Sequence generator (W1) — pure, no DOM/React/Konva

`src/print/sequence.ts`:
```ts
export type PrintOrder = 'grouped' | 'interleaved';
export interface SequenceOptions {
  order: PrintOrder;
  /** Dialog global copies multiplier. Positive integer, default 1. */
  copies: number;
  /** Warn when interleaved physical pages exceed this. Default 50. */
  interleaveWarnAt?: number;
}
export interface PagePlan { rowIndex: number; quantity: number; }
export interface SequenceWarning { kind: 'interleaved-pages'; pages: number; cap: number; }
export interface SequencePlan {
  totalPages: number;                 // Σ quantity (cheap ints; no rendering)
  rows: number;                       // CSV row count (records)
  warning?: SequenceWarning;
  pages: AsyncIterable<PagePlan>;     // lazy
}
export const MAX_TOTAL_PAGES = 1_000_000;   // RangeError above this (invariant 9)
export function planSequence(rows: number, timesFor: (rowIndex: number) => number,
  opts: SequenceOptions): SequencePlan;
```
- `timesFor` reads the `$times` cell (default 1, floor, clamp <0 → 0). Records with
  `times × copies === 0` are skipped.
- **grouped:** one `PagePlan { rowIndex, quantity: times_i * copies }` per record.
- **interleaved:** `times_i * copies` plans `{ rowIndex, quantity: 1 }`.
- Warning when interleaved total pages > `interleaveWarnAt`.
- `timesFor` **MUST be pure and stable across calls** (invoked once in the Σ pass and once per
  page by the generator; a non-deterministic callback makes `totalPages ≠ Σ quantity`).
- `CsvRecord` has `columns: string[]` / `rows: string[][]`; the caller builds `timesFor`.
  (Do not import `CsvRecord` if it pulls IDB — a `(rowIndex) => number` callback keeps it pure.)

### 3.3 Render overrides (W2) — shared by preview + print (invariant 7)

`RenderLabelPageOptions` gains (all optional, defaults = today's behaviour):
```ts
dpi?: number;                                  // default doc.label.dpi; ~50 for thumbnails
invert?: boolean;                              // post-quantize: 255 - channel
mirror?: boolean;                              // post-quantize: horizontal flip
offset?: { x: number; y: number; type: 'inner' | 'outer' };  // device px at `dpi`
```
New `src/editor/render/printOrientation.ts` (keep it out of `src/core` if it touches canvas):
```ts
// Map the doc's 4-way direction onto (pre-rotation, encoder direction).
export interface OrientedRaster { canvas: HTMLCanvasElement; direction: 'top' | 'left'; }
export const orientForPrint = (page: RenderedLabelPage, direction: LabelDoc['label']['printDirection']): OrientedRaster;
// single public orientation entry; pure helpers exported for tests:
export const preRotationDegrees = (direction: …): 0 | 180;
export const encoderDirection = (direction: …): 'top' | 'left';
```
- `top` → 0°, encode `'top'`; `left` → 0°, encode `'left'` (encoder rotates 90° **CW** itself);
  `bottom` → pre-rotate 180°, encode `'top'`; `right` → pre-rotate 180°, encode `'left'`.
  Pre-rotation is baked on a **fresh** canvas (never mutate `page.canvas`). Verified: niimbluelib
  `image_encoder.js:38,47-50` — `'left'` = 90° CW.
- Override order in `renderLabelPage`: `quantize → invert → mirror → post-clip → offset`, so
  invert/mirror cannot leak ink outside the region union; `dpi` is validated **before** `resolve`,
  and the effective dpi is threaded into `prepareResolvedAssets` (`AssetDeps.dpi`).
- Offset: `offset.x/y` must be finite integers (device px at the effective dpi); the `outer`
  expansion is `MAX_RASTER_PIXELS`-capped; `{x:0,y:0}` is a no-op returning the base canvas.
- **Printhead overflow only** (dec 18, owner 2026-10-06): helper
  `printheadOverflow(widthPx, heightPx, direction, printheadPixels)` → boolean, shown as a
  **prominent** non-blocking warning when the label exceeds the printhead dots. A label *narrower*
  than the bar is **not** a failure — the printer centres the content; no underfill signal. The
  separate roll-size/dpi mismatch (RFID-reported vs configured) is the existing dec-18 warning.
  (Left/right swap the axis.)
- **Mirror-clip notice (owner 2026-10-06):** the clip after `mirror` is correct, but silently
  discarding mirrored ink is not. When `mirror` is set and the post-clip removes ink, return
  `RenderedLabelPage.notices = [{ kind: 'mirror-clipped-ink', lostPx }]` so the dialog can warn.
- Offset semantics match the reference: `inner` = same-size canvas, `putImageData` at (x,y);
  `outer` = canvas expanded by `|x|`/`|y|`, image placed at `max(x,0)`,`max(y,0)`.

### 3.4 CSV print job + job runner (W3)

`src/print/printLabel.ts` — add:
```ts
export interface CsvPrintJobOptions {
  order: PrintOrder; copies: number; overrides?: PrintOverrides;
}
export interface PrintOverrides {
  density?: number; speed?: 0 | 1; labelType?: LabelType; pageColor?: PageColorType;
  invert?: boolean; mirror?: boolean; offset?: { x: number; y: number; type: 'inner' | 'outer' };
}
export interface CsvPrintJobDeps {
  assets?: AssetDeps;
  /** Per-row async content prep (csv/template). Absent = static/fallback only. */
  prepareRow?: (rowIndex: number) => Promise<ResolveContext>;
  render?: (doc: LabelDoc, ctx: ResolveContext, opts: RenderLabelPageOptions) => Promise<RenderedLabelPage>;
}
export function buildCsvPrintJob(doc, csv: CsvRecord | null, opts, deps): PrintJob;
```
- `PrintJob.pages` is **re-iterable** (`{ [Symbol.asyncIterator]: () => pages() }`, re-deriving the plan per pass) so a retry/Print-again does not reuse a drained generator.
- `$times` is **snapshotted** at build time (`Int32Array`) so the generator and `totalPages` cannot desync.
- Guards: **both** over-send and under-send (`sent !== plan.totalPages` → throw); `pageColor: DoubleColor` rejected (v1 is single-plane Mono).
- `renderOptionsOf(overrides)` is exported so W4's thumbnail split is identical to the job's (invariant 7); a fresh options object is passed per page.
- `CsvPrintJobDeps.timesFor` is an additive test/advanced injection seam.
- Cancel latency ≈ one page render (the frozen `PrintJob.signal` is checked at page boundaries).
- `transport.ts` adds `PrintAbortedError { pagesPrinted }` (thrown by both transports on abort — `AbortError` name kept); `PrintProgress.page` is documented as a **1-based physical copy index** (needs hardware confirmation for grouped `quantity > 1`).

- Uses `planSequence`; `totalPages = plan.totalPages`; `pages` is an **async generator** that for
  each `PagePlan` runs `prepareRow`, renders via `renderLabelPage(doc, ctx, {assets, ...overrides})`,
  orients ({@link orientForPrint}), encodes via `ImageEncoder.encodeCanvas`, yields
  `{ data, quantity }`.
- **D-01 guard:** assert Σ quantity never exceeds `totalPages` (throw a clear error).
- `pageColor`/`density`/`speed`/`labelType` forwarded to the `PrintJob` (only defined keys).

`src/print/jobRunner.ts`:
```ts
export interface JobProgress {
  page: number;            // 1-based, monotonic
  pagesTotal: number;
  percent: number;         // 0..100, never decreases
  phase: 'sending' | 'printing';
}
export interface JobRunResult { pagesPrinted: number; cancelled: boolean; }
export interface JobRunner {
  isBusy(): boolean;
  run(job: PrintJob, opts?: { onProgress?: (p: JobProgress) => void }): Promise<JobRunResult>;
  cancel(): void;
}
export function createJobRunner(transport: PrinterTransport): JobRunner;
```
- One active job; `run` rejects/returns busy if already running. `cancel()` aborts; the transport's
  `finally` runs `printEnd`. An `AbortError` resolves to `{ cancelled: true, pagesPrinted }`
  (not an error).
- Progress is **monotonic** — the D110M_V4 `page` field is 1→0→1 (print-transport memory). Derive
  percent from `(pagePrintProgress + pageFeedProgress)`, clamp ≥ previous. `phase: 'sending'` until
  the first progress event.
- Owns the `AbortController`; unsubscribes listeners in `finally`.

### 3.5 Thumbnail queue (W4)

`src/print/thumbnails.ts` (no React): `createThumbnailCache({ render, capacity: 32, concurrency: 2 })`
→ `{ get(key, rowIndex): Promise<string /* dataURL */>; clear(); dispose(); }`. LRU-32, newest-first
prefetch around the visible window, concurrency-capped, superseded requests dropped. React hook
`usePrintThumbnails` wraps it.

## 4. Workstreams

| WS | Area | Files | Status |
| -- | ---- | ----- | ------ |
| W0 | Printer capabilities on the contract + mock + adapter | `src/print/{transport,niimbotAdapter,mockTransport}.ts` (+tests) | pending |
| W1 | Sequence generator (grouped/interleaved, `$times`, lazy, warning) | `src/print/sequence.ts` (new, +test) | pending |
| W2 | Render overrides (`dpi`/invert/mirror/offset) + print orientation + overflow | `renderLabelPage.ts`, `src/editor/render/printOrientation.ts` (new, +tests) | pending |
| W3 | CSV print job + job runner (progress, cancel, one-job guard, D-01) | `src/print/printLabel.ts`, `src/print/jobRunner.ts` (new, +tests) | pending |
| W4 | Print dialog: virtualized LRU thumbnails + override panel + gating | `src/components/print/*` (new, +tests) | pending |
| W5 | App wiring: shared transport + status→store + Print action + dialog mount | `App`/`Header`/`FileMenu`/`ConnectionChip`/store | pending |

**Sequencing:** O1–O5 → **W0 + W1 + W2 in parallel** (disjoint files) → review → **W3 + W4**
(W3 needs W1+W2; W4 needs W0/W2/W3 interfaces) → review → **W5** wiring → gate → headed Mock
(100-label job + cancel) → owner hardware smoke → commit per area.

### W0 — capabilities (small)
Extend `PrinterStatus` (additive). Adapter populates from model metadata + `printTasksCapabilities`.
Mock defaults to a B1_PRO-like set. Tests: adapter maps metadata → capabilities; absent metadata →
`undefined`; mock exposes the default + override.

### W1 — sequence (pure)
`planSequence` per §3.2. Tests: grouped vs interleaved quantities/order; `$times` default/floor/
clamp/skip; `copies` multiplier; totalPages; >50 interleaved warning boundary; laziness (generator
not fully drained when consumer stops).

### W2 — render overrides + orientation
Add options to `renderLabelPage` (§3.3), `printOrientation.ts`, `printheadOverflow`. Tests:
`dpi` override changes `widthPx/heightPx` (`rasterDimensions`); invert flips black/white; mirror
flips a known asymmetric raster; offset inner/outer canvas geometry; orientation mapping
`top/left/bottom/right` → (rotated?, encoder dir) with an asymmetric-pixel assertion; overflow
true/false across the printhead dots; **invariant 7**: dialog-facing raster path ≡ print job's
page bytes for the same doc+overrides.

### W3 — CSV job + job runner
`buildCsvPrintJob` + `createJobRunner` per §3.4. Tests (MockTransport, real canvas where needed):
lazy per-row rendering (render called once per page, not upfront); grouped quantities / interleaved
quantity-1 pages; `totalPages` consistency + D-01 over-total guard; progress monotonic under a
1→0→1 `page` sequence; cancel mid-job → `{cancelled:true}`, transport back to `connected`, no
second job; one-job guard rejects a concurrent run; `printEnd` observed exactly once (Mock counter).

### W4 — print dialog UI
`src/components/print/`:
- `PrintDialog.tsx` — `Modal`-based (see `dialogs.md`: flex only when open, `[&:not([open])]:hidden`,
  definite width; **needs a real browser pass**). Sections: (a) virtualized page list with LRU-32
  thumbnails (concurrency 2, ~50 dpi, windowed like `CsvPreviewTable`); (b) overrides panel
  (copies, density slider min/max from capabilities, speed 0|1, labelType from `paperTypes`,
  pageColor, invert/mirror, offset x/y + inner/outer); (c) grouped/interleaved toggle + the >50
  interleaved warning; (d) non-blocking warnings: roll-size/dpi mismatch, **prominent**
  printhead-overflow (label wider than the bar), and the `mirror-clipped-ink` notice;
  (e) progress bar (phase + monotonic %), Print / Cancel.
- Gate controls on `printerStatus.capabilities`; **disable unsupported** (e.g. speed only for
  `D110M_V4`; paper types not in `paperTypes` marked, not blocked — dec 18).
- Plain-CSV path must not import `src/templates`/trust (dec 42). i18n keys for every string.
- Tests (jsdom + a stub thumbnail renderer): listing/virtualization window math, LRU eviction,
  concurrency cap, gating disables, warning rendering, cancel wiring.

### W5 — wiring
- A single app transport (`src/print/appTransport.ts` lazy singleton: `?mock=1` → `MockTransport`,
  else `NiimbotTransport({transport:'bluetooth'})`), subscribed once; push `PrinterStatus` to the
  store (replace `ConnectionChip`'s private MockTransport). Provide the runner + row-prep to the
  dialog.
- `prepareRow` built from `prepareResolvedContent` + the same trust gate/session engine the editor
  uses (`runResolvePass` pattern); plain CSV needs no engine. Reuse `csvRepo`.
- **Print action:** File menu → "Print…" (+ `Ctrl/Cmd+P`), disabled off-editor / when no doc.
  Opens `PrintDialog` for `currentDoc`. Not mounted in gallery.
- Row-nav/status-bar hooks unchanged; record D-24/D-25 resolution.

## 5. Review routing

| Area | Reviewer(s) |
| ---- | ----------- |
| W0 (contract) | `review` |
| W1 (pure sequence) | `review-fast` (logic), escalate to `review` if anything subtle |
| W2 (render/orientation) | `review` + `experimental-review` (invariant-7 sensitive) |
| W3 (job runner/abort) | `review` + `experimental-review` |
| W4 (dialog UI) | `review` |
| W5 (wiring) | `review-fast` |
| fixes | narrow `review-fast` re-review |

Fix rounds ≤2 per area; deadlock → escalate to the owner.

## 6. Gate (P7)

1. `bun run test:run` green · `node_modules/.bin/tsc.exe --noEmit` clean · `bun run build` green.
2. Exit criteria demonstrated: **100-label CSV job prints reliably** (headed Mock + owner
   hardware); **mid-job cancel is clean** (`printEnd` ran once, transport back to `connected`, no
   orphaned job).
3. Review per area; fix ≤2; re-review APPROVE.
4. Update `state.md` + this file; escalate lessons to `agent/memory/*`.
5. Semantic commit(s) per area (ask the owner first). Owner hardware smoke recorded (covers D-24).

## 7. Commands / rules

- Tests: `bun run test:run`; typecheck
  `node_modules/.bin/tsc.exe --noEmit`; build `…/bun.exe run build`. **Never `bunx`/`npx`/`bun test`.**
- Real-canvas tests via `src/test/canvasHarness.ts`; browser-only checks headed with
  `ab` (`bun run dev`, `?print=1`, `?mock=1`).
- Subagents must **not delegate** (depth 1). Missing info → terminal
  `needs-info. q: … . hint: … . next: … .`
- Owner runs all **hardware smoke**.

## 8. Status / records

_(updated as phases land)_
