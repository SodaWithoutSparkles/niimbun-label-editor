# Verification report — known-issues round 2

- Date: 2026-10-09
- Target: [`agent/known-issues/2026-10-06_round-2.md`](../known-issues/2026-10-06_round-2.md)
- Method: 9 parallel read-only `explore` agents (coordinator dispatch), one per
  issue cluster. Each re-read every cited `file:line` at HEAD (after `214aef2`,
  `5c756e8`) and returned VERIFIED / REFUTED / STALE per claim.
- No code changed.

## Verdict summary

| Issue | Doc verdict | Verification |
| --- | --- | --- |
| Text resize "wide putin" | fixed | ✅ correct + fixed at HEAD; QR side-handle gap **still open** |
| Rectangle resize overshoot | fixed | ✅ correct + fixed at HEAD |
| Globals only allow online | — | ✅ verified |
| Unclear `.rate` extraction | — | ✅ verified (+ array-index answer below) |
| Missing template/globals API contract | — | ✅ verified |
| Trusting unclear | — | ✅ verified, **scope broader** (see C1) |
| Template does not refresh | — | ✅ verified |
| MFP UI not user friendly | — | ✅ verified (7/7 claims; 2 wording nuances) |
| Printer icon → info panel | — | ✅ verified (icon inert; button toggles) |
| Duplicated printer icon | — | ⚠️ **finding partly WRONG** (see F1) |
| Top header home button | — | ✅ verified |
| Paper management broken | — | ✅ verified |
| Template in main UI confusing | — | ✅ verified |
| CSV data source broken | — | ✅ verified |
| Media management tab | — | ✅ verified |
| Text line-wrap options | — | ✅ verified |
| Mixed selection alignment | — | ✅ verified |
| Duplicate + bulk-select drag | — | ✅ finding verified; **issue text wrong** (see H2) |
| Grid line spacing setting | — | ✅ verified |
| Zoom real-size desync | — | ✅ verified |
| Touchpad gesture zooming | — | ✅ verified |
| Arrow keys don't move | — | ✅ verified |
| Leftover status-bar artifacts | — | ✅ verified |
| Incorrect branding | — | ✅ verified |
| Grid duplication (feature) | — | ✅ verified absent |

**Net: 24 of 25 findings accurate. 1 finding wrong (F1); 2 issue descriptions
themselves wrong; several citations stale by line drift.**

## Corrections (must-fix before relying on the doc)

### F1 — Duplicated printer icon: the finding is wrong about the editor bar
- **REFUTED:** the doc claims `EditorStatusBar.tsx` "has no printer chip".
  Live: `src/components/editor/EditorStatusBar.tsx:182` renders `<ConnectionChip />`,
  which draws a real `<Printer>` icon (`src/components/common/ConnectionChip.tsx:79`)
  at the editor status bar's **bottom-right**.
- The gallery `BottomBar.tsx` duplicate is bottom-**left** and is only a dot+text
  indicator (`BottomBar.tsx:124` comment confirms).
- **Consequence:** the issue's "bottom right" wording actually matches the
  *editor* duplicate. Fixing only `BottomBar` would leave the header↔editor
  duplicate in place. Decide which surface is redundant before implementing.

### H2 — Duplicate/selection: the *issue description* is wrong, the finding is right
- The issue says "deselect source + select duplicates works, but drag doesn't".
  **No such selection swap exists at HEAD.** `cloneNode`
  (`src/store/slices/editorSlice.ts:628-642`) never touches `selectedNodeIds`,
  and both callers ignore its return (`Header.tsx:58`,
  `EditorKeyboardShortcuts.tsx:56`). After Ctrl+D the source stays selected and
  clones are never selected.
- The reported drag symptom is fully explained by click-collapse
  (`PreviewStage.tsx:526-534`): a plain click on a member of a multi-selection
  collapses to `[hitId]`, so drag moves only the clicked node.
- So the fix is two independent items: (1) select clones after duplicate
  (not a regression — it was never implemented); (2) preserve a multi-selection
  when pointer-down lands on an already-selected node.

### C1 — Trust: persistent choices are unreachable anywhere, not just at the prompt
- `gate.always` / `gate.never` (`src/core/trust.ts:52-54`) have **no production
  caller** (tests only). Settings `TrustSection` can revoke/reset/list but
  cannot create `always`/`never`.
- `src/editor/trustPrompt.ts:7-10` comment claims persistent decisions are
  "surfaced in the editor's trust control" — **STALE / false**; no editor trust
  control exists (only read-only badges at `JsTab.tsx:207-211`).
- Fix direction in the doc is still correct (widen prompt → wire `always`/`never`),
  but the gap is wider than "prompt is allow/deny-only".

## Still-open item flagged by the doc, confirmed open

- **QR side-handle aspect:** `commitPreservesAspect` returns `false` for any
  non-corner anchor (`src/editor/transformGesture.ts:211-220`) and Konva applies
  `keepRatio`/`keepProportion` only to corner anchors. A QR side-handle drag
  commits a non-uniform box even after the stale-scale fix. Text is intentionally
  free-resize. **Not fixed by `214aef2`/`5c756e8`.**

## Owner question answered

- **Extract grammar array indexing:** `a.b[0].c` → **NO**. jq-style
  `a.b[0].c | .[] | select(...)` → **NO** (the `|` is the fallback separator).
  Only **dot-numeric** indices work: `a.b.0.c`
  (`src/templates/globals.ts:126-144`, test `globals.test.ts:30`).

## Line-drift / staleness notes (semantics hold)

- Resize citations in the doc are stale: aspect-lock predicate is now
  `PreviewStage.tsx:385-389` + `geometry.ts:50-53`; live-scale read is
  `PreviewStage.tsx:913-914`; commit `:943-959`; `keepRatio` now conditional at
  `:1094`; the scale reset landed at `:925`.
- `scaleStroke` is **gone** from `src` (only a test comment remains) — stroke
  width no longer scales on resize; matches the doc's fix direction.
- Grid constant `GRID_STEP_HM` has **5** call sites in `PreviewStage` (4 snap +
  1 overlay), not 2; the two-*consumer* framing (view + snap) is what matters.

## New bug found during owner testing — QR "too small" verdict (2× unit error)

Owner-verified at HEAD on a 300 dpi printer; root-caused via bwip-js measurement. Recorded in
[`known-issues/2026-10-06_round-2.md`](../known-issues/2026-10-06_round-2.md).

- `https://example.com` @ EC M = QR **v2 = 25×25 modules**. Owner minimum: **600 hm (6 mm) = 0.24 mm/module**; **500 hm (5 mm) = 0.20 mm/module** still scans but marginal and visibly eats ECC (a white module printed as a non-square rectangle, height < width). `MIN_MODULE_MM = 0.25` sits between them → **keep the constant**.
- **Bug:** `qrImage.ts:68` compares the bwip `scale` (units) to `minModulePx` (device px), but bwip renders `qrcode` at **2 px per unit** (verified across v1/v2/v3/v7 and all EC levels: `baseW = 2 × moduleCount`, always even). So the verdict requires `scale ≥ 3` (300 dpi) → keeps warning until ~**12.7 mm**, not the ~**6.25 mm** implied by 0.25 mm. 1D barcodes are unaffected (`scaleX` really is px/narrow-module).
- **Fix (decided):** `moduleCount = baseW / 2`; `belowMinModule = Math.min(targetW, targetH) / moduleCount < minModulePx` (effective module after the `contain` fit).

### Triangle / non-square module artifact — full research

**Symptom (owner, 300 dpi, `https://example.com` EC M):** 6 mm → a module prints as a triangle/not-square-ish; 5 mm → scans but marginal; one white module printed as a rectangle with height < width.

**Cause — two scale steps between the crisp module and the printed dot, the second is the bug:**
1. **Generation** picks an integer module pitch ≤ the box: `renderQr` measures `baseW = 2·moduleCount`, `scale = floor(min(boxPx)/baseW)`, canvas `= baseW·scale ≤ box` (`qrImage.ts:57-68`). Never resampled *inside* the generator.
2. **Placement upscales it:** `konvaFactory.ts:198` forces `fit:'contain'`; `fitImageAttrs` (`:163-167`) draws at `boxPx` from a `rasterPx` source → **fractional** factor `boxPx/rasterPx ≥ 1`, smoothing on by default → antialiased edges.
3. **Print thresholds to 1 bit:** QR policy = `threshold`, cutoff 128 (`core/render/policy.ts:19`, `core/render/quantize.ts:127`). Antialiased corner greys straddle 128 → triangle/notch; fractional pitch rounds per row/column/axis → non-square module (owner's eroded rectangle).

**Upscale factor is non-monotonic** (25-module payload, 300 dpi, `baseW=50`): 5 mm 59/50=**1.18×**, 6 mm 71/50=**1.42×**, 7 mm **1.66×**, 8 mm **1.88×**, 8.47 mm 100/100=**1.00×**, 12.7 mm **1.00×**. Worst just under a multiple of `baseW`; on a multiple there is no resample (crisp). Confirms the size-dependent symptom, independent of scannability.

**ECC link:** 5 mm = 0.20 mm module ≈ 2.36 px, already sub-floor; non-uniform printed grid drifts decoder samples → soft errors consume the RS budget (a fully inverted module counts as a hard error). "Eats the ECC budget."

**Fix options (separate pass).** Constraint: bwip `qrcode` = **2 px/module per integer `scale`**, so for 25 modules the only rasters are 50/100/150 px (4.23/8.47/12.70 mm @300 dpi) — an arbitrary box always resamples. **(A) REJECTED:** "never upscale / clamp factor to ≥1 → 1" *shrinks* the symbol (7 mm box=83 px, largest raster 50 px → prints ~4.2 mm). **(B) REJECTED:** snapping the box to a producible raster moves the label up to ±2.1 mm. **(C)** draw the module grid directly at the box's exact px (exact size, crisp; most code). **(D)** disable smoothing for the symbol draw (Konva proxies `Context.imageSmoothingEnabled` at `Context.js:70`; needs a small custom `sceneFunc`) — keeps the box size (7 mm stays 7 mm), modules become crisp nearest-neighbour squares with ≤1 device px (0.085 mm) width variation; **owner-accepted**, cheapest correct-size fix. **(E)** generate at the next integer scale and downscale once with smoothing (single resample; less certain). Validate through `renderLabelPage`, not only `PreviewStage`.

## Addenda worth carrying into implementation

- **Storage scope (CSV/media):** both `csvRepo` and `resourceRepo` are **global**
  object stores keyed by id; documents hold only refs. `list()` exists on both
  but has **no production caller**. The "orphan sweep" named in
  `DataSourceTab.tsx:169,204` comments **does not exist** — orphan detection is
  feasible (diff `list()` vs all doc refs) but unimplemented.
- **Printer panel data is ready:** `PrinterStatus` already carries
  `deviceName`/`dpi`/`batteryPercent`/`rollWidthHm`/`rollHeightHm`
  (`src/print/transport.ts:88-100`); only the surface is missing.
- **Printer gesture constraint:** Web Bluetooth connect must originate from a
  real user gesture (`ConnectionChip.tsx:15-18`); the chooser button satisfies it.
- **Template refresh enqueue point:** the single-flight queue in
  `useSampleRow.ts:293-298` is the right place for a 1 s tick; superseded passes
  already bail by run id.

## Second batch — new issues appended to round-2 (2026-10-09)

Two read-only `explore` investigations for the issues added at the end of the round-2 doc.

### Print preview too small (feature/UX) — mapped

- Current preview is a **thumbnail queue**: `PrintDialog.tsx:456` renders `PrintPageList` in a `md:grid-cols-2` half-column, `height={320}`, 64 px rows (`PrintPageList.tsx:36`). No view selector / page row / arrows.
- Thumbnails are hard-capped at `THUMBNAIL_DPI = 50` (`usePrintThumbnails.ts:38`, `:204`); LRU-32/concurrency-2, cache keyed by `rowIndex` (`thumbnails.ts:74,112-115`) → a document-dpi Page render needs its own hook/render.
- `order`/`copies` are local `PrintDialog` state (`:104`); `activeRecords` (`printDialogModel.ts:36`) and lazy `planSequence` (`sequence.ts:44-49`) drive enumeration; add `viewMode`+`selectedPage` state, reset in the open effect (`:120-135`).
- Reuse `Select`/`SettingRow` (`:439-440`), `ChevronLeft/Right`, `print.*` i18n; render Page at `doc.label.dpi`, guard `MAX_RASTER_PIXELS` (`renderLabelPage.ts:128`). Default+reset to `'page'`; test via `renderLabelPageMock` asserting `opts.dpi`.

### Stacking different quantizers (bug) — root-caused

- **Preview never quantizes/masks** → transparent bwip raster (no `backgroundcolor`) over the image shows through (`ResolvedShape.tsx:213-226`, `PreviewStage.tsx:1078-1090`, `warning-center.md:23`).
- **Print flattens onto an opaque white base** (`rasterize.ts:162-173`) → alpha gone.
- **Quantizers are RGB-only**, exact 0/255, alpha untouched (`quantize.ts:37-42,127-135`).
- **Decisive cause:** `buildPolicyMask` paints the barcode's **entire drawn rect** in its policy colour (`renderLabelPage.ts:312-334`); last-write-wins (`policy.ts:86-90`) means the barcode's `threshold` policy (`policy.ts:20`) **overwrites the image's `floydSteinberg`** across the overlap → the composite is hard-thresholded to pure black/white; the dither never runs inside the rect.
- **Owner-confirmed (2026-10-09):** with a grayscale image behind a barcode, the image *does* shine through (barcode raster is transparent) but prints **pure black** where the composite is mid/dark. So it is **not** a literal white background on the symbol (`applyInkDefaults` skips `Konva.Image`, `rasterize.ts:106`); it is purely the policy-mask over-claim.
- **Design follow-up (owner-proposed):** add a `fill` (background) option to `qr`/`barcode` — `transparent` default (image shows through; needs the ink-aware mask) vs `white`/colour (opaque bg; mask rightly claims the whole rect). Shape already has `fill?: string` (`types.ts:108`), reuse its format; set bwip `backgroundcolor` or draw a bg rect.
- **Proposal recorded (GPT, 2026-10-09): "policy-masked quantization of a shared composite"** — keep the unified RGBA; run each quantizer over the global image; recombine by **selection** (not alpha-blending) using **coverage masks that follow actual visible ink** (transparent barcode modules own nothing; an opaque bg owns the whole rect). ≈ fix (A) + the `fill` option, consistent with decision #1; v1 = full-frame quantize + select (already the case), diffusion-across-boundaries deferred (D-05). Full text + diagram in `known-issues/2026-10-06_round-2.md`.
- **Design history:** the mask architecture is **plan decision #1** (`agent/2026-09-29_label-editor-v1/plan.md:325`: "Unified RGBA intermediate; per-object quantizer policy hints as masks"), sourced from `docs/references/gpt-review.md §4` (`:199-307`) which **explicitly rejected** per-object rasterize→dither→composite: *"you're no longer dithering the actual final pixels"* (`:229`, overlap/alpha/antialias flaw). So the bug is a **coverage approximation** (mask claims the symbol's whole rect, not its ink), not the unified-pipeline choice.
- **Fix:** **(A) recommended — architecturally consistent:** stencil the asset's opaque pixels into the mask instead of a filled rect (`renderLabelPage.ts:312-334`), so transparent modules inherit the background leaf's policy. **(B)** per-leaf quantize + alpha composite (`renderLabelPage.ts:493-515`) — matches the issue's wording but **reverts decision #1**; only re-open/scope-limit. (C) alpha-aware quantizers (needed for B); (D) transparent base. Known-limitation debt: `policy.ts:81-84`, `renderLabelPage.ts:169-171`, D-05/D-34. Reference niim.blue has no per-object policy (`niimblue-reference.md:18,55`).
- **Refined (owner, 2026-10-09):** per policy → ink/alpha/layer-aware mask → quantize those regions masked onto the global RGBA → re-stack. `fill` must exist. **Quiet areas for qr/barcode**: currently disabled (`paddingwidth/height: 0`), so no quiet zone — a scannability risk; must feed the effective-module verdict and couple to `fill`.

## Not verifiable in this pass
- Exact per-commit diffs for `214aef2`/`5c756e8` (shell denied in the agent);
  attribution taken from the reflog messages, both of which mention scale reset
  and stroke width.
- The `template-webui` reference lives in a sibling repo
  (`template-webui`), outside label-editor.
