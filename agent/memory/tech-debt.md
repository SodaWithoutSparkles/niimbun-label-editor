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
