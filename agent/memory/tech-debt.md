# Technical debt register

Known, deliberate debt carried across phases. One line per item with the phase it
was found, its impact, and when it should be addressed. This is a *register*, not
a spec — details live in the phase handoffs (`agent/2026-09-29_label-editor-v1/`)
and the area files it links. When an item is fixed, delete it here.

**"Address by" legend:** P7/P8 = before that phase ships; post-v1 = parking lot;
chore = do opportunistically, not phase-blocking.

| ID | Area | Debt | Impact | Address by |
| -- | ---- | ---- | ------ | ---------- |
| D-02 | print | pre-abort runs `printEnd()` without `printInit()`; unconfirmed on-device whether harmless | possible protocol no-op / unexpected cut on early cancel | P7 (owner smoke: early cancel) |
| D-03 | print | no reconnect-after-disconnect adapter test | untested recovery path | P8 |
| D-05 | print | `applyPolicy` = one full-frame pass per distinct policy (bounded 4) | per-label cost, not size-correctness | chore (revisit if profiling demands) |
| D-06 | render | `regionUnionBounds` has no production consumer (clip uses `regionUnionPath`) | dead-ish API surface | post-v1 / P8 cleanup |
| D-07 | render | `LabelSummary` does not denormalize union bounds; card silhouette still a generated placeholder | gallery art is approximate | post-v1 |
| D-08 | data | `labelRepo.get()` re-copies the gzip view offset per read (`serialize.ts` `gzipPayload`) | negligible at v1 sizes | chore |
| D-09 | editor | `PreviewStage` drag adds a world delta to a parent-local transform — wrong inside a scaled/rotated group | misplacement when editing inside transformed groups | post-v1 (group scale/rotate is parked) |
| D-10 | editor | group Transformer resize discards scale (group scale is post-v1); should skip transform for groups | confusing no-op resize UI on groups | post-v1 |
| D-11 | editor | align control writes a junk `align` key onto shape/image nodes | stray field in the doc | chore |
| D-12 | editor | image import writes **two** undo entries (`addImageRef` + `addNode`); the P2 replace path (`updateImageRef`) updates the ref in place (one entry, no orphan), so only the initial add is affected | one undo doesn't fully revert an image add | chore (batch when convenient) |
| D-13 | assets | remote images need **CORS** to render/print; a non-CORS URL import fails with a localised error | UX + potential print failure | P8 (proxy/fetch policy note) |
| D-14 | assets | imported-font badge headed check never done (unit-tested only) | unverified browser path | P7/P8 headed pass |
| D-15 | assets | `prepareAssets` min-module floor 0.25 mm is conservative; small boxes render at scale 1 with a `too-small` warning | conservative warnings | post-v1 tuning (P6 added per-kind text in the warning center, so the badge is no longer ambiguous) |
| D-16 | assets | `bwip-js` is large (~250–280 KB gzip) and serves QR + barcodes | bundle size | P8 (code-split if needed) |
| D-17 | CSV | orphan `CsvRecord` sweep deferred — the P6 write path no longer deletes (it must not, since `csvs` isn't undoable) | unreferenced tables accumulate in IDB | P7/P8 (cleanup pass) |
| D-18 | CSV | `ParsedCsv.rowCount` = **retained** count, not total; total only in the `rows-capped` warning | a consumer reading it as "total" would be wrong | documented; keep an eye |
| D-19 | trust | `TrustSection` standalone fallback opens its own IDB adapter when no `repo` is injected (in-app always injects the store repo, so fallback is tests-only) | a second connection in the fallback path | chore |
| D-20 | preview | status-bar `rowCount === 0` conflates "no CSV" / "loading" / "empty table" | cosmetic | chore |
| D-21 | preview | `useSampleRow` `resolveKeyOf` runs one `JSON.stringify` per node per pointermove tick | negligible garbage on drag | chore (revisit if profiling) |
| D-22 | preview | `GlobalDataTab` draft-reseed effect keys on the spec object identity, so it re-runs on every doc commit (`structuredClone`) | wasteful but values match (React bails) | chore |
| D-23 | test-infra | `vitest.config.ts` keeps `testTimeout: 15000` for all tests; without it the real-canvas `renderLabelPage`/`rasterize` suites flake to 22–28 s under parallel load | slower failure feedback globally | chore (per-file scoping needs ≥2 files; keep until canvas tests are lighter) |
| D-24 | workflow | P6 hardware smoke skipped; folded into P7's print-UI smoke | — | **CLOSED** (owner smoke 2026-10-06) |
| D-25 | editor | `?print=1` / `?hardware=1` dev harnesses were the only print entry points; W5 adds the user path | — | **CLOSED** (owner smoke 2026-10-06) |
| D-26 | doc-format | export writes `inline`/`remote`/`local`/`external` provenance policy undecided (P5 chose `local`/`remote` for import) | export portability unknown | P8 |
| D-27 | print | `PrintProgress.page` assumed to be a 1-based **physical copy index** for grouped `quantity > 1`; only inferred from the mock + single-copy smoke | progress/cancel count could be wrong on hardware with grouped copies | P7 owner smoke — UNCONFIRMED (not observed) |
| D-28 | print | `prepareAssets` decode cache (`resolveCached`) is dpi-unaware — a 50 dpi thumbnail pass still holds full-resolution decodes in the shared print-path cache | memory held above the thumbnail LRU's intent | P8 (dpi-aware cache or separate thumbnail cache) |
| D-29 | test-infra | suite wall-clock is bounded by the heavy real-canvas suites (`renderLabelPage.test.ts` ~25 s) and per-file worker startup (`Isolate 105 workers · ~1.2 s each`); the node-default/happy-dom-opt-in split removed the happy-dom cost (50%→35% of tracked) but not wall time | full-suite wall ~19–30 s, high variance on the 2-CPU box | chore (split/streamline the canvas suites; `pool: 'threads'` and `--no-isolate` are *slower* here) |
| D-32 | editor | polygon draw finishes on raw `event.evt.detail < 2`, which also drops a deliberate fast corner click (<500 ms, few px) and can commit a shape with a missing vertex | rare lost vertex on quick sharp corners | post-v1 (time+distance gate) |
| D-33 | editor | `Modal` captures the opener in a passive effect, so a nested dialog can't use `autoFocus` without breaking focus restore; the P7 `CalibrationDialog` leaves its slider un-autofocused | keyboard users must Tab to the slider | chore (rework Modal focus capture) |
| D-34 | render/test | P3 coverage-mask tests asserted colour presence, not threshold ink for light/low-alpha fills; P2 superseded the coverage mask with the **ink stencil** (`maskAssetSceneFunc`) and R8 added ink-aware coverage tests (`renderLabelPage.mask.test.ts`) asserting transparent pixels inherit the under-leaf policy (error-diffusion across policy boundaries stays D-05) | — | **CLOSED** (P2 ink mask + R8 tests) |
| D-35 | editor | warning center: the CSV inline amber list is component state (lost on tab switch) while the store group persists; print warnings clear when the print dialog closes | two views can briefly disagree | chore (source the inline list from the store group) |
| D-36 | editor | Current impl of panning with touchpad forces cardinal directions (x or y). But if the initial movement is small enough, arbitrary direction is allowed??? | UX: touchpad panning is not smooth | post-v1 (revisit UX) |
| D-37 | editor | Polygon tool preview is defaulted to the bottom layer. User cannot see what they are drawing. | UX: Polygon tool preview is not visible | post-v1 (revisit UX) |
| D-38 | editor | arrow keys move too quick; 0.1mm -> 0.5mm enough, and should make the user hold down in 0.1mm state for much longer to get 0.5mm | UX: arrow keys move too quick | post-v1 (revisit UX) |
| D-39 | editor | Missing warnings for empty objects (e.g. qr/barcode with no data, template with no js, text field with no text, etc.) | UX: user can create empty objects without warning | post-v1 (revisit UX) |
| D-40 | editor | P5 inline text editor overlay: placement applies a single `rotate(θ) scale(sx,sy)` from the node's absolute matrix. A node inside an ancestor group that is **both rotated and non-uniformly scaled** is shear, which `rotate+scale` cannot represent, so the `<textarea>` drifts from the Konva node only in that case (plain pan/zoom/rotate-90, own rotation, and axis-aligned uniform scale are exact) | overlay misplacement in a rare group configuration | post-v1 (match the full affine matrix via a canvas-projected overlay if group scale+rotate ever ships) |
| D-41 | editor | P5 inline editor caret is hardcoded cyan (`#0ea5e9`) + an opacity blink. It is invisible wherever something painted behind it is cyan-ish. **Keying off the text fill does not work**: `TextNode` has no fill, and what is behind the caret is the page plus whatever z-ordered nodes sit under it (shape/image fills, qr/barcode symbol fills) — a user *can* match text to background, so assume it happens | caret can vanish on some documents | post-v1 (sample 1x1 from the Konva backbuffer once per editing session — **not** per caret move, which re-reads per keystroke — or pulse through a contrasting colour so it can never disappear) |
| D-42 | editor | `TextWrap` modes `clip` and `shrink` are unimplemented in the P5 inline overlay, and `clip` is unimplemented in the **render path** too. **`shrink`**: the overlay never applies the downscale — `wrapStyle` (`TextEditorOverlay.tsx:105`) gives it `overflowWrap: break-word` and the textarea draws at full size, while preview/print downscale via `measureKonvaText` (`konvaFactory.ts:379`), so you edit wrapped full-size text and print a downscaled block. **`clip`**: the spec contradicts itself (`types.ts:86` "no wrap cut at the box" vs `objects.ts:52` "wraps at words but hides lines past the box height"); the overlay word-wraps it via `break-word` (not the expected no-wrap), the caret treats it as char-break (`wrappedLineStarts:173` honours only `wrap === 'word'`), and `konvaTextWrap` maps it to `'word'` — the comment at `konvaFactory.ts:109` claiming Konva "hides lines past the box height" is **false**: `Text._sceneFunc` never calls `clip()`, so every wrapped line is drawn and overflows the box | `clip` prints as plain `word` wrap with nothing clipped; `shrink` mis-edits; caret misplaced for `clip`/`shrink` | post-v1 — first settle one `clip` semantic (owner intent: **no wrap, overflow runs past the box and is hidden**, i.e. `types.ts:86`, which is the cheap one: `white-space: pre` + `overflow: hidden` in the overlay, a clipping `Group` in the render path). Then fix `shrink` (apply the measure factor to the overlay font size). Overlay CSS and `wrappedLineStarts` must move **together** or the caret drifts from the rendered breaks |

| D-43 | templates | P6 refresh tick: after a `trustRevision` bump (Settings revoke) the tick gate still reads the **previous** resolved trust (`resolvedTrustRef`) until the new async `gate.resolve` returns, so if that lookup exceeds the 1 s interval a tick can enqueue a pass that supersedes the in-flight one and delay the trust prompt. It cannot retry an already-open prompt (a prompt in flight pins `promptPending`), and the pass still commits the real decision | at worst a delayed prompt, never a loop or a wrong decision | post-v1 (gate ticking on an explicit "a pass is in flight" flag) |
| D-44 | editor | Preview asset cache: fonts are part of the **raster** content key (`usePreparedAssets`), so importing/editing a font is a signature change and serves one `EMPTY` frame — a one-frame image/QR/barcode flash. Only `ensureFonts` needs to run on a font change; QR/barcode rasters do not depend on fonts | a font import/edit flashes the raster leaves once | post-v1 (split font registration into its own effect so it does not invalidate the raster key) |
| D-45 | editor | `PreviewStage`'s recenter bail-out (`setViewport` functional update returning the current state when `x/y/zoom/rotation` are equal) has no regression test — its only observable is whether React re-renders, which would need render-count scaffolding. The value-equality logic is exercised indirectly by the passing P4 recenter tests | a silent regression would restore the per-frame value-equal `setViewport` write (drag lag, no visual flash) | post-v1 (assert on a render counter, or expose the guard for a unit test) |

**Owner UI-test round (2026-10-06):** `agent/known-issues/2026-10-06_round-1.md` (14 items) was
**fully addressed by the ui-sweep P1–P7** (2026-10-08): #1/#9/#10/#12/#14 (P1), #2/#13 (P2),
#8 (P3), #7 (P4), #3 (P5), #5/#6 (P6), #11 (P7); #4 was the excluded D-31 (ink-aware overflow).
Every phase passed `experimental-review`; P4/P5/P6/P7 went through fix rounds. The remaining
owner step is the manual browser verification of P4/P5/P6/P7.

## Escalation rule

Anything project-relevant found during a phase that is not fixed in that phase
goes **here** (or into the matching area file if it needs more than a line), not
only into `state.md` (gitignored) or the phase handoff. Keep entries short; link
out for detail. `agent/memory/csv-templates.md` and `objects-assets.md` hold the
deeper "how it works / gotchas" that these items assume.
