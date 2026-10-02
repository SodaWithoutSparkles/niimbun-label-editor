# Print transport & comms (`src/print`, `src/core`)

Foundation for talking to NIIMBOT printers. Added in P1 (commit `380be10`).

## Files

- `src/core/hm.ts` — integer hundredths-of-a-millimeter (`hm`) math: `mmToHm`/`hmToMm`/`hmToPx`/`pxToHm`/`roundHm`, `MM_PER_INCH`. `src/core/` is the headless engine: **zero React imports**, enforced by `src/core/headless.test.ts` (raw-source glob scan).
- `src/print/transport.ts` — the **frozen app↔printer contract**. `PrinterTransport { connect, disconnect, print(job), onStatus, onProgress }`; `PrintJob.pages` is an `AsyncIterable` (lazy, invariant 9); abort semantics documented on `PrintJob.signal` (page boundaries only; pre-aborted rejects before `printInit`).
- `src/print/mockTransport.ts` — offline/dev transport + reference impl. No runtime import of `@mmote/niimbluelib` (type-only). Validates quantities/over-total, reports the **actual** printed count, records quantities not payloads.
- `src/print/niimbotAdapter.ts` — `NiimbotTransport implements PrinterTransport`, wraps `@mmote/niimbluelib`. Injectable `createClient` for tests.

## Verified print flow (niimbluelib 0.47.0)

`client.protocol.newPrintTask(taskType, options)` → `printInit()` → loop `printPage(encoded, quantity)` + `waitForPageFinished()` → `waitForFinished()` → **`client.protocol.printEnd()` in `finally`** (resets state, cuts paper). `taskType` comes from `client.getPrintTaskType()`.

## Hardware smoke — PASSED 2026-10-03 (owner's B1_PRO)

Real device: **NIIMBOT B1 Pro** (`B1 Pro-(serial redacted)`), 300 dpi, printhead **567 dots**, roll **50 × 24 mm** gap labels, battery 80.

**"HELLO WORLD" printed, centred, unclipped, correct orientation** on a 50×24 mm label (owner-confirmed). 1 page × 1 copy, `printEnd` cut cleanly.

Observed on a real 3-page job (first run):
```
detected {"model":"B1_PRO","taskType":"D110M_V4","dpi":300,"printheadPixels":567}
progress {"page":1..3,"pagesTotal":3,...}
print done {"pagesPrinted":3}
```
- The library resolves `B1_PRO` → task `D110M_V4` automatically (`D110M_V4` is named after the first real-world model its author got working; `modelPrintTasks.D110M_V4` includes `B1_PRO`). Trust `getPrintTaskType()`; do not hardcode.
- `printPage` sends `printStatus` (oneWay) → `setPageSize13b` → bitmap rows → `pageEnd`. B1_PRO ≈ D110M_V4 hardware.
- The adapter must pass `pageColor` explicitly (`SingleColor`); the reference app does. Encoded pages are `SingleColor`.

### ⚠ Progress `page` is inconsistent on D110M_V4 (P7 must handle)

Observed event order on a 1-page job:
```
progress {"page":1,"pagesTotal":1,...}   // niimbluelib's initial emit (1-based)
progress {"page":0,"pagesTotal":1,...}   // status-poll path reports 0-based
progress {"page":1,"pagesTotal":1,100}   // final (1-based)
```
`page` goes **1 → 0 → 1**: the status-poll path (`waitUntilPrintFinishedByStatusPoll`) reports a **0-based** `page` while the library's own first/last emit is 1-based. `pagesTotal` is stable. Do NOT build a monotonic progress bar directly on `page` — clamp it monotonic, or derive progress from `(pagePrintProgress + pageFeedProgress)` as niim.blue does. Also `pageFeedProgress` stays 0 throughout on this model. Add a P7 test/guard; unverified whether `page` is also non-monotonic across multi-page jobs.

### First-run harness bugs (fixed; the adapter was always correct)

1. Fake `'check'` leading row → silently dropped (`enableCheckLine` off) → blank/stalled first page.
2. All rows sent as `'pixels'` → no `printEmptyRow` for blanks → slow, looked stuck.
3. Cols not padded to ×8, wrong bit order, wrong centering scale.

The working smoke page does it right: 5×7 font, auto-scale, centre, `cols` padded to ×8, MSB-first, fully-white rows → `'void'` (no row data), identical rows collapse into `repeat`. Encoded result: `cols=568 rows=384 rowsData=8 (void=2, pixels=6)`.


## Print options — reference (niim.blue `PrintPreview.svelte`)

```
{ totalPages: pagesTotal * quantity, density, speed, labelType,
  statusPollIntervalMs: 100, statusTimeoutMs: 8000,
  pageColor: PageColorType.SingleColor }
```
niim.blue passes `quantity` per `printPage` and `totalPages = pages * copies`; our adapter passes `totalPages` = Σ quantity and per-page quantities — both are accepted by `validatePage`.

## Reference clone

`references/niimblue/` (gitignored) — the niim.blue Svelte app. Key files for our pipeline: `src/components/PrintPreview.svelte` (print flow + options + progress math), `src/utils/canvas_preprocess.ts`, `src/utils/canvas_utils.ts`, `src/utils/post_process.ts`, `src/utils/dither.ts`, `src/fabric-object/custom_canvas.ts`. **P4/P5 should read these before building the render pipeline.**

## EncodedImage gotchas (bit-plane encoding, P4)

`ImageEncoder.encodeCanvas(canvas, pageColor, printDirection)` (from the lib) is the real encoder. If hand-building `rowsData`:
- `cols` must be padded: `ceil(width/8)*8`. `rows` = height (swapped when `printDirection === 'left'`).
- `dataType`: `'void'` for all-white rows (emitted as `printEmptyRow`, fast), `'pixels'` otherwise, `'check'` **only every 200 rows and only if `enableCheckLine` is set** — otherwise check rows are silently dropped (a hand-made leading check row makes a page look blank / stall).
- `rowDataBlack` bit order: MSB first, `1 << (7 - colBit)`.
- Collapse identical consecutive rows into `repeat` (the lib's encoder does this).
- B1_PRO printhead = 567 dots @ 300 dpi ≈ 48 mm.


## Gotchas (learned the hard way)

- **Pass only defined option keys to `newPrintTask`.** It spreads options over library defaults, so `{ pageColor: undefined }` *overwrites* the default and `validatePage` throws on the first real page. Build a `Partial<PrintOptions>` conditionally.
- **Bind the receiver when calling client methods.** `const fn = client.connect; fn()` throws `TypeError: ... undefined` — the lib's `connect` dereferences `this`. Use `.call(client, …)`.
- **B21L2B progress swap:** upstream `emitProgressEvent` builds `new PrintProgressEvent(totalPages, pagesPrinted, …)` but the ctor is `(page, pagesTotal, …)`. The adapter normalizes using `activeTotalPages`; pin with a test.
- `printEnd()` returns `Promise<boolean>`; `false` = refused. Surface it as status `error`, don't swallow.
- `@mmote/niimbluelib` is **CJS-only** but resolves cleanly under rolldown-vite (verified: full `bun run build` + a lib bundle). Adapter + lib ≈ 222 kB / 40 kB gzip (Capacitor deps tree-shaken down to a small chunk).

## Conventions

- Deps are added with `bun add` in the phase that needs them (`@mmote/niimbluelib@0.47.0` was P1). Never npm.
- Transport status is the P3 connection chip's source; a mid-job `disconnect` must not be overwritten by a bogus `connected`.
