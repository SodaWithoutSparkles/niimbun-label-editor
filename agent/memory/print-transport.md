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


## Render pipeline (P4; P5 objects/assets seam → [`objects-assets.md`](objects-assets.md))

- **The one path:** `src/core/render/` (pure: `dimensions`, `colorSpace` seam, `quantize` — threshold/FS/Stucki/Atkinson, `policy` masks) → `src/editor/render/{rasterize,clip,renderLabelPage,unionPath}` → `ImageEncoder`. `renderLabelPage` is the shared preview≡print entry point; `src/print/printLabel.ts` encodes via `ImageEncoder.encodeCanvas` (never hand-build `rowsData`). Dev harness: `?print=1`.
- **Clip is `union(regions)` = "inside any region" = nonzero winding, never `evenodd`** (plan §187). `regionUnionPath` normalizes polygon signed-area winding; keep-out/count predicates must use the drawable-union predicate (`isDrawableRegion`), kept in sync between `src/editor/render/regionOverlay.ts` and `src/core/doc/derive.ts` (duplicated — `src/core` can't import `src/editor`).
- **Konva offscreen gotchas (both cost a must-fix in the P4 gate):**
  - `stage.destroy()` **frees its canvases** (`Konva.releaseCanvasOnDestroy` default true) → read pixels *before* destroying, and build the encoder canvas fresh from the final `ImageData`; never return a canvas you destroyed.
  - Konva's layer canvas uses `Konva.pixelRatio` (device DPR). Force `Konva.pixelRatio = 1` inside a `try/finally` around the offscreen create/draw/read, or HiDPI overscales/truncates the read.
  - `Konva.Text` renders real glyphs under the `@napi-rs/canvas` test shim (system Arial resolves) — text golden tests are possible headlessly.
- **Per-object quantizer policy masks:** no hint anywhere ⇒ no mask, exactly one global pass (guardrail). Painting every rendered leaf (globals = mask 0) in the same tree order as the raster gives topmost-wins.
- **Testing:** real canvas in Vitest via `src/test/canvasHarness.ts` (`installCanvasShim()`, `@napi-rs/canvas` dev dep). Guard `src/test/canvasHarness.guard.test.ts` forbids product imports.

## Narrow-roll placement (P7 must fix — found by hardware smoke 2026-10-04)

Printing a **25 mm** label on the **567-dot (~48 mm)** printhead left-aligns content at the origin of the padded bit plane, so on the owner's **50×30 mm** test roll the box printed ~15.5 mm from the left edge (blank head columns), and the printer trimmed 78−30 mm at the tag boundary (IR sensor). This is transport behavior, **not** a clip/render bug (invariant 6: raster stays the backing rect). P7 owns the fix: feed/label offset + centering knobs (`PrintPreview.svelte` `offset.{x,y,offsetType}`) and the printhead-overflow warning.

## Gotchas (learned the hard way)

- **Pass only defined option keys to `newPrintTask`.** It spreads options over library defaults, so `{ pageColor: undefined }` *overwrites* the default and `validatePage` throws on the first real page. Build a `Partial<PrintOptions>` conditionally.
- **Bind the receiver when calling client methods.** `const fn = client.connect; fn()` throws `TypeError: ... undefined` — the lib's `connect` dereferences `this`. Use `.call(client, …)`.
- **B21L2B progress swap:** upstream `emitProgressEvent` builds `new PrintProgressEvent(totalPages, pagesPrinted, …)` but the ctor is `(page, pagesTotal, …)`. The adapter normalizes using `activeTotalPages`; pin with a test.
- `printEnd()` returns `Promise<boolean>`; `false` = refused. Surface it as status `error`, don't swallow.
- `@mmote/niimbluelib` is **CJS-only** but resolves cleanly under rolldown-vite (verified: full `bun run build` + a lib bundle). Adapter + lib ≈ 222 kB / 40 kB gzip (Capacitor deps tree-shaken down to a small chunk).

## P7 print UI (batch print) — gotchas

- **Entry points:** `src/print/appTransport.ts` (`getAppTransport`/`getAppJobRunner` singletons, `?mock=1` → MockTransport) · `src/components/print/PrintDialog.tsx` (+ `usePrintJob`, `usePrintThumbnails`, `PrintPageList`) · `FileMenu` **Print…** / `Ctrl/Cmd+P` (editor-only, `isPrintOpen` in the store) · dev harness `?printcsv=1` (`PrintCsvSmoke.tsx`, with `window.__printCsvSmoke`).
- **`buildCsvPrintJob`** (`printLabel.ts`): `$times` is snapshotted (`printTimes.ts`, `Float64Array`) so the generator and `totalPages` can't desync; `pages` is **re-iterable**; over/under-send guarded; `renderOptionsOf` is the shared override split (invariant 7). `PrintOverrides.pageColor: DoubleColor` throws (v1 is single-plane Mono).
- **Abort/cancel:** transports throw `PrintAbortedError { pagesPrinted }` (name stays `AbortError`); the runner resolves `{ cancelled: true, pagesPrinted }`. `printEnd()` stays in the transport `finally` — never call it elsewhere.
- **Progress:** `pageFeedProgress` is **always 0** on D110M_V4, so the runner uses `max(pagePrintProgress, pageFeedProgress)` and forces a terminal 100% on resolve. `PrintProgress.page` is documented as a 1-based **physical copy index** — inferred, **verify on hardware for grouped `quantity > 1`** (D-27).
- **Orientation:** the encoder's `'left'` is 90° **CW** (verified `image_encoder.js:38`); `orientForPrint` pre-rotates 180° for `bottom`/`right` (D-04 resolved). The printable bytes are `encodeCanvas(orientForPrint(page))`. **Preview convention:** the dialog's thumbnails show the **logical/label** orientation (no transport pre-rotation), matching niim.blue's preview; only the encoded/print page applies `orientForPrint`. A `Print direction` control (D-30) sets `label.printDirection` (undoable).
- **Overrides order:** `quantize → invert → mirror → post-clip → offset`; a clip after `mirror` can discard ink → `RenderedLabelPage.notices: [{ kind:'mirror-clipped-ink', lostPx }]` surfaces it.
- **Overflow warning (D-31):** `printheadOverflow` is the cheap size trigger; the dialog only shows the warning when `hasInkBeyondPrinthead` finds ink past the head (samples the first active row — a later narrower row can over-warn, never miss).
- **React gotchas that cost a real bug (caught only headed):**
  - **StrictMode `mountedRef` latch** — an effect whose cleanup sets `mountedRef.current = false` must also set it `true` in setup; StrictMode's replay otherwise leaves it `false` forever and every async result is silently dropped (thumbnails stuck on "Rendering…").
  - **Cache identity** — a rebuild effect must key on **content** (doc/csv/override *values*), not on function/object identities; unstable `prepareRow`/`overrides` recreate the cache every render and starve it.
  - Stubbed unit tests cannot see either class — the `?printcsv=1` headed check found it.

## Conventions

- Deps are added with `bun add` in the phase that needs them (`@mmote/niimbluelib@0.47.0` was P1). Never npm.
- Transport status is the P3 connection chip's source; a mid-job `disconnect` must not be overwritten by a bogus `connected`.
