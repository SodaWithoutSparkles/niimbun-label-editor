# Print transport & comms (`src/print`, `src/core`)

Foundation for talking to NIIMBOT printers. Added in P1 (commit `380be10`).

## Files

- `src/core/hm.ts` — integer hundredths-of-a-millimeter (`hm`) math: `mmToHm`/`hmToMm`/`hmToPx`/`pxToHm`/`roundHm`, `MM_PER_INCH`. `src/core/` is the headless engine: **zero React imports**, enforced by `src/core/headless.test.ts` (raw-source glob scan).
- `src/print/transport.ts` — the **frozen app↔printer contract**. `PrinterTransport { connect, disconnect, print(job), onStatus, onProgress }`; `PrintJob.pages` is an `AsyncIterable` (lazy, invariant 9); abort semantics documented on `PrintJob.signal` (page boundaries only; pre-aborted rejects before `printInit`).
- `src/print/mockTransport.ts` — offline/dev transport + reference impl. No runtime import of `@mmote/niimbluelib` (type-only). Validates quantities/over-total, reports the **actual** printed count, records quantities not payloads.
- `src/print/niimbotAdapter.ts` — `NiimbotTransport implements PrinterTransport`, wraps `@mmote/niimbluelib`. Injectable `createClient` for tests.

## Verified print flow (niimbluelib 0.47.1)

**2026-10-25: bumped 0.47.0 → 0.47.1** (upstream survey). 0.47.1 adds the
`findPrintTask` protocol-4 fallback (our adapter previously threw "printer model
not identified" on protocol ≥ 4) and unsigned U16/U8 packet parsing. It also
stops subtracting the gap from `paperHeight` except model 785 — that changes only
our advisory `rollHeightHm`, never a print packet.

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

### ⚠ Progress `page` is inconsistent on D110M_V4 (handled in P7; hardware check still owed)

Observed event order on a 1-page job:
```
progress {"page":1,"pagesTotal":1,...}   // niimbluelib's initial emit (1-based)
progress {"page":0,"pagesTotal":1,...}   // status-poll path reports 0-based
progress {"page":1,"pagesTotal":1,100}   // final (1-based)
```
`page` goes **1 → 0 → 1**: the status-poll path (`waitUntilPrintFinishedByStatusPoll`) reports a **0-based** `page` while the library's own first/last emit is 1-based. `pagesTotal` is stable. Do NOT build a monotonic progress bar directly on `page` — clamp it monotonic, or derive progress from `(pagePrintProgress + pageFeedProgress)` as niim.blue does. Also `pageFeedProgress` stays 0 throughout on this model. The guard **shipped in P7**: `src/print/jobRunner.ts:120-132` clamps `page` monotonic (`Math.max(1, page, rawPage)`) and derives the percentage from `max(clampPercent(pagePrintProgress), clampPercent(pageFeedProgress))` — but whether the contract is right at the printer is still **unverified on hardware** — carried as **D-27** — and it is also unverified whether `page` is non-monotonic across multi-page jobs.

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

`references/niimblue/` (gitignored) — the niim.blue Svelte app. Key files for our pipeline: `src/components/PrintPreview.svelte` (print flow + options + progress math), `src/utils/canvas_preprocess.ts`, `src/utils/canvas_utils.ts`, `src/utils/post_process.ts`, `src/utils/dither.ts`, `src/fabric-object/custom_canvas.ts`. **These are the sources our pipeline was ported from** — P4 (render seam + encoder) and P5 (objects/assets) shipped 2026-10-04, so read them to trace *why* a behaviour is what it is, not as pending work.

## EncodedImage gotchas (bit-plane encoding, P4)

`ImageEncoder.encodeCanvas(canvas, pageColor, printDirection)` (from the lib) is the real encoder. If hand-building `rowsData`:
- `cols` must be padded: `ceil(width/8)*8`. `rows` = height (swapped when `printDirection === 'left'`).
- `dataType`: `'void'` for all-white rows (emitted as `printEmptyRow`, fast), `'pixels'` otherwise, `'check'` **only every 200 rows and only if `enableCheckLine` is set** — otherwise check rows are silently dropped (a hand-made leading check row makes a page look blank / stall).
- `rowDataBlack` bit order: MSB first, `1 << (7 - colBit)`.
- Collapse identical consecutive rows into `repeat` (the lib's encoder does this).
- B1_PRO printhead = 567 dots @ 300 dpi ≈ 48 mm.


## Render pipeline (P4; P5 objects/assets seam → [`objects-assets.md`](objects-assets.md))

- **The one path:** `src/core/render/` (pure: `dimensions`, `colorSpace` seam, `quantize` — `threshold`/FS/Stucki/Atkinson/`ostromoukhov`, plus the per-strategy `gamma` tone curve since P14; `policy` masks) → `src/editor/render/{rasterize,clip,renderLabelPage,unionPath}` → `ImageEncoder`. `renderLabelPage` is the shared preview≡print entry point (`src/print/printLabel.ts` encodes via `ImageEncoder.encodeCanvas`, never hand-build `rowsData`); since P13b/P14 it also backs the gallery thumbnails and the editor's live quantized preview, whose staleness key is the shared `editor/render/previewKeys.ts`. Dev harness: `?print=1`.
- **Clip is `union(regions)` = "inside any region" = nonzero winding, never `evenodd`** (plan §187). `regionUnionPath` normalizes polygon signed-area winding; keep-out/count predicates must use the drawable-union predicate (`isDrawableRegion`), kept in sync between `src/editor/render/regionOverlay.ts` and `src/core/doc/derive.ts` (duplicated — `src/core` can't import `src/editor`).
- **Konva offscreen gotchas (both cost a must-fix in the P4 gate):**
  - `stage.destroy()` **frees its canvases** (`Konva.releaseCanvasOnDestroy` default true) → read pixels *before* destroying, and build the encoder canvas fresh from the final `ImageData`; never return a canvas you destroyed.
  - Konva's layer canvas uses `Konva.pixelRatio` (device DPR). Force `Konva.pixelRatio = 1` inside a `try/finally` around the offscreen create/draw/read, or HiDPI overscales/truncates the read.
  - `Konva.Text` renders real glyphs under the `@napi-rs/canvas` test shim (system Arial resolves) — text golden tests are possible headlessly.
- **Per-object quantizer policy masks:** no hint anywhere ⇒ no mask, exactly one global pass (guardrail). Painting every rendered leaf (globals = mask 0) in the same tree order as the raster gives topmost-wins.
- **Testing:** real canvas in Vitest via `src/test/canvasHarness.ts` (`installCanvasShim()`, `@napi-rs/canvas` dev dep). Guard `src/test/canvasHarness.guard.test.ts` forbids product imports.

## Print dpi resolution — device-driven (P2 of the 2026-10-19 run; closes D-69)

- **The chain:** `resolvePrintDpi({usePrinterDpi, printerDpi, docDpi}) → {dpi, source}` in
  `src/print/resolvedDpi.ts` (pure). Printer is used only when the **persisted** setting
  `usePrinterDpi` (default **on**, edited in the print dialog's Overrides panel) is on *and*
  `PrinterStatus.dpi` is present, finite and `> 0`; otherwise the **document dpi hint**
  (`doc.label.dpi`, UI label "DPI hint"; the stored key is unchanged, no migration).
- **`doc.label.dpi` is no longer the raster dpi** — it is the hint/fallback. `renderLabelPage`'s
  chain is `opts.dpi ?? opts.assets?.dpi ?? doc.label.dpi`; the dialog now always sets
  `overrides.dpi` to the resolved value (`printLabel.ts`'s `renderOptionsOf` already honoured it),
  which is what makes the **print job, the single-page preview, the D-31 ink check and
  `printheadOverflow`/`orientedWidthPx` agree** (invariant 7).
- **The raster is encoded 1:1 in printer dots** (`ImageEncoder.encodeCanvas`, no resample) — that is
  why the render dpi must equal the head dpi: a doc hint ≠ head dpi used to print at the wrong
  physical scale (203 on a ~300 head ≈ 0.68×). The previous behaviour is now behind the setting.
- **Provenance (R8):** the reported `dpi` is **device status** (`PrinterInfo.resolutionClass` →
  `dpiOf`); `printheadPixels` is **model metadata**; roll/paper dims are **NFC-tag advice**. Do not
  conflate the three.
- **Deliberately NOT at the effective dpi:** the gallery and print-queue thumbnails (fixed 100 dpi)
  and the live quantized preview's 1 M px **budget fallback** (it *seeds* from the resolved dpi and
  only drops when the raster would not fit). Treat all three as accepted approximations — a
  head-locked halftone pitch (P4) must not be claimed for them.
- **Offsets are device px at the effective dpi** (`renderLabelPage`'s offset stage) and are
  dialog-local (not persisted) — the dialog now shows the effective dpi in the offset row. The
  offset-expanded raster (`outer` → `widthPx+|x|` × `heightPx+|y|`) counts against
  `MAX_RASTER_PIXELS`: the dialog blocks Print when the **resolved dpi** *or* an outer offset would
  exceed the cap (`offsetRasterDimensions`, shared with the render path's own pre-flight).
- **One mismatch warning, not two:** `rollDpiMismatch` carries `resolvedDpi` + `printerDpiInUse`, and
  the `print-mismatch` message says which dpi the print will use (dialog + Warnings tab).

Printing a **25 mm** label on the **567-dot (~48 mm)** printhead left-aligns content at the origin of the padded bit plane, so on the owner's **50×30 mm** test roll the box printed ~15.5 mm from the left edge (blank head columns), and the printer trimmed 78−30 mm at the tag boundary (IR sensor). This is transport behavior, **not** a clip/render bug (invariant 6: raster stays the backing rect). **Status:** the fix shipped in P7 — feed/label offset + centring knobs (`PrintDialog.tsx:118-120` state → `:211` `{x, y, type: offsetType}` on the print task, ported from `PrintPreview.svelte`'s `offset.{x,y,offsetType}`) plus the `printheadOverflow` warning (`:183`). **Hardware re-check 2026-10-19 (owner, B1_PRO):** content **narrower** than the loaded roll (`30×20` on a `50×30` roll) prints at `(10,0)–(40,20)` — centred horizontally, top-aligned, remaining areas empty, no unwanted underfill. Content **wider** than the loaded roll (`50×30` on a `40×30` roll) prints only the centre `40×30` and is clipped **symmetrically and silently** (5 mm lost per side, x 0–5 and x 45–50 gone). The narrow case matches `P7-SMOKE.md` §B's prediction (printer centres, no underfill warning); the wide case exposes a new gap — **D-68** (roll-width clipping, no warning).

### ⚠ Device-reported roll/paper data is NFC-tag **advice, not source-of-truth** (owner, 2026-10-19)

`rollWidthHm`/`rollHeightHm`, `rfid.consumablesType` and `usedPaper`/`allPaper` come from the **NFC label tag**, which may be **user-written** or **harvested from a genuine roll**. The printer has **no sensors, camera or calibration** to verify it — owner, verbatim: *"The printer's reported value is just an advice, not source-of-truth."* Anything derived (roll width, paper dims, consumables type, usage counters) is a **hint, never a measurement**.

**Decision — no automatic offset.** Asked whether content narrower than the loaded roll (printer centres X, top-aligns Y) should auto-default an offset, the owner said **no**: that would trust an advisory value (*"the printer has no way to tell. It aint got cameras or calibrated rulers"*). Narrower-than-roll content stays **fully manual** — the existing Offset X/Y knobs.

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
- **Progress:** two independent channels since P15. **Print** (`onProgress`): `pageFeedProgress` is **always 0** on D110M_V4, so the runner uses `max(pagePrintProgress, pageFeedProgress)`, clamps monotonic and forces a terminal 100% on resolve. `PrintProgress.page` is documented as a 1-based **physical copy index** — inferred, **verify on hardware for grouped `quantity > 1`** (D-27).
  **Send** (`onSendProgress`, optional on `PrinterTransport`): fed by niimbluelib's `printpacketprogress` (per `printPage`, restarts at 0 each page — **not** `pageFeedProgress`, which is a permanently dead feed value on this model). The event carries `{ page, copies, progress }`: the first physical copy the upload covers and how many copies it covers (`quantity`), because one `printPage` uploads one bitmap that the printer repeats. The runner projects it job-wide with `floor(((page - 1) + copies * progress / 100) / pagesTotal * 100)` and clamps it **independently** of the print percent — weighting a grouped upload as one copy would stall the bar across the group and then leap. `JobProgress.send` stays **absent** until a transport reports, so a transport with no upload signal hides the send bar instead of showing a dead 0 %. A transport that has no signal omits `onSendProgress` entirely; MockTransport emits a synthetic 0→50→100 curve per physical copy (`copies: 1`).
  **Owner observation 2026-10-19 (resolved in P15):** the dialog used to show a single (print) progress bar; the owner wanted the reference's send *and* print distinction. Now two bars ("Sending page n / N", "Printing page n / N"); the print bar is primary, the send bar is the sibling. This smoke did not test grouped `quantity > 1`, so **D-27 stays open**.
- **Orientation:** the encoder's `'left'` is 90° **CW** (verified `image_encoder.js:38`); `orientForPrint` pre-rotates 180° for `bottom`/`right` (D-04 resolved). The printable bytes are `encodeCanvas(orientForPrint(page))`. **Preview convention:** the dialog's thumbnails show the **logical/label** orientation (no transport pre-rotation), matching niim.blue's preview; only the encoded/print page applies `orientForPrint`. A `Print direction` control (D-30) sets `label.printDirection` (undoable).
- **Overrides order:** `quantize → invert → mirror → post-clip → offset`; a clip after `mirror` can discard ink → `RenderedLabelPage.notices: [{ kind:'mirror-clipped-ink', lostPx }]` surfaces it.
- **Overflow warning (D-31):** `printheadOverflow` is the cheap size trigger; the dialog only shows the warning when `hasInkBeyondPrinthead` finds ink past the head (samples the first active row — a later narrower row can over-warn, never miss).
- **Label type seeds from the roll (P19):** `effectiveLabelType = labelType ?? printerStatus.labelType ?? WithGaps` — the user's pick wins for the dialog session and the existing open-reset re-seeds each open. `labelTypeMismatch` (`printDialogModel.ts`) is advisory only (never disables Print, silent when nothing is reported); `printOverrides.labelType` is still sent only when `capabilities !== undefined`.
- **React gotchas that cost a real bug (caught only headed):**
  - **StrictMode `mountedRef` latch** — an effect whose cleanup sets `mountedRef.current = false` must also set it `true` in setup; StrictMode's replay otherwise leaves it `false` forever and every async result is silently dropped (thumbnails stuck on "Rendering…").
  - **Cache identity** — a rebuild effect must key on **content** (doc/csv/override *values*), not on function/object identities; unstable `prepareRow`/`overrides` recreate the cache every render and starve it.
  - Stubbed unit tests cannot see either class — the `?printcsv=1` headed check found it.

## Printer surface + connect method (P7 commit B, `9d4058b`)

- **`PrinterStatus` is wider than the 5 connect-time fields:** `deviceName`, `dpi`, `batteryPercent`,
  `rollWidthHm`/`rollHeightHm`, `capabilities`, plus `hardwareVersion`, `softwareVersion` and
  `rfid?: { tagPresent, usedPaper?, allPaper?, consumablesType? }` plus
  `labelType?` (the roll type the printer reports: tag `consumablesType` first,
  then `paperInfo.paperType`; `Invalid`/unknown ⇒ absent — **not** a capability).
  `rfid` comes from `CombinedRfidInfo.labelRfidInfo` (NOT `ribbonRfidInfo`), is
  `undefined` when absent, and is **kept fresh** (P18): the adapter subscribes
  `rfidinfofetched` + `printerinfofetched` and rebuilds `lastConnected` through
  `buildConnectedStatus` from `getPrinterInfo()`/`getRfidInfo()`, emitting only
  when `connected` and not `printing` (the job's settle publishes mid-print
  updates; connect()'s negotiation events only update the cache). The library
  re-reads RFID on a lid/paper-RFID heartbeat change and after every print, so
  roll swaps are seen without the manual Refresh. `rfidinfofetched` is
  authoritative for the roll fields (`rollWidthHm`/`rollHeightHm`/`rfid`/
  `labelType`) **only when the read produced data** (`paperInfo` or
  `labelRfidInfo` present): the library catches every sub-read and emits the
  event regardless, so an empty payload is a failed read and keeps the previous
  roll. A produced paper-only read still **clears** `rfid`/`labelType`, so a
  swapped roll's tag data cannot describe a roll that is gone.
  `printerinfofetched` (and a read that produced nothing) keeps the previous
  value for a field the payload omits; `refreshInfo()` applies the same
  produced-data rule. `refreshInfo?()` is now the explicit one-shot read
  (`EditorShell` calls it once per print-dialog open, fire-and-forget) — **do
  not add a poll**; the event subscriptions are the live path. **⚠ Advisory only**
  (tag-derived, possibly user-written or harvested) — never treat as a measurement
  (see the narrow-roll note above).
- **Paper dims are NOT duplicated:** the RFID dimensions cell renders `hmToMm(rollWidthHm) ×
  hmToMm(rollHeightHm)`. **There is no firmware field in the lib** — the reference's `HW | sw | FW`
  strip is 4 cells where "FW" is a trailing *tag*, not a value.
- **Battery is polled, not latched:** `setHeartbeatInterval(15_000)` + `startHeartbeat()` after a
  successful connect (lib default is 2000 ms). `stopHeartbeat()` on `disconnect()` **and** on the
  `connect()` error path. A heartbeat updates **only** `batteryPercent` and never changes `state`
  (must not downgrade `'printing'`); `heartbeatfailed` must NOT set `state:'error'` — the link is up.
  `lastConnected` must be kept fresh: `print()` re-emits it when a job settles, so a stale copy would
  clobber a newer reading.
- **⚠ Lib quirk:** `isHeartbeatStarted()` returns `heartbeatTimer === undefined` — **inverted** (true
  when *stopped*). Do not gate on it; assert the `startHeartbeat`/`stopHeartbeat` calls instead.
- **Swapping transports needs all four caches reset** (a bare config change silently keeps talking to a
  dead instance): the `appTransport` **module memo**, the **runner memo** (`getAppJobRunner` captures
  the transport), the **React** chip (`useMemo(..., [])` pinned it), and `EditorShell`'s
  `useMemo(() => getAppJobRunner(), [])`. `setAppTransportKind(kind)` disconnects the live transport,
  drops both singletons, and is **serialized** through a promise chain (overlapping swaps must not
  orphan a live transport). `resetAppTransport()` is the test seam only — it does not disconnect.
- **Connect method** is the persisted `connectMethod` (`'bluetooth' | 'serial'`, default `bluetooth`)
  — the `gridSpacingHm` precedence, 6 files. `refreshInfo` during a print re-emits with the state
  preserved rather than being a no-op.
- **Non-modal popovers must be native `<dialog open>`**, because every global shortcut guard in the app
  bails on `document.querySelector('dialog[open]')`; a `<div role="dialog">` leaks Ctrl+Z/arrows into
  the editor. A non-modal dialog must therefore be excluded from **modal-only** logic with an attribute
  (`[data-popover]`, e.g. `NotificationCenter`'s toast re-insert/swallow paths) — `:modal` is not
  reliable in happy-dom.
- UA dialog styles must be reset explicitly: `m-0` (kills `margin:auto`) and **`left-auto`** (the spec
  `inset-inline-start:0` + author `right-0` + a fixed width over-constrains and pins the box left).

## Conventions

- Deps are added with `bun add` in the phase that needs them (`@mmote/niimbluelib` was P1; now pinned at 0.47.1). Never npm.
- Transport status is the P3 connection chip's source; a mid-job `disconnect` must not be overwritten by a bogus `connected`.
