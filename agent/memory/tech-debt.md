# Technical debt register

Known, deliberate debt carried across phases. One line per item with the phase it
was found, its impact, and when it should be addressed. This is a *register*, not
a spec — details live in the phase handoffs (`agent/2026-09-29_label-editor-v1/`)
and the area files it links. When an item is fixed, delete it here.

**"Address by" legend:** P7/P8 = before that phase ships; post-v1 = parking lot;
chore = do opportunistically, not phase-blocking.

| ID | Area | Debt | Impact | Address by |
| -- | ---- | ---- | ------ | ---------- |
| D-01 | print | `niimbotAdapter` has no Σquantity > totalPages guard (the mock does) — relies on nimbluelib's `validatePage` | a bad quantity sum throws late, mid-job | P7 (job runner owns quantities) |
| D-02 | print | pre-abort runs `printEnd()` without `printInit()`; unconfirmed on-device whether harmless | possible protocol no-op / unexpected cut on early cancel | P7 (mid-job cancel work) |
| D-03 | print | no reconnect-after-disconnect adapter test | untested recovery path | P7 |
| D-04 | print | `printDirection` `right`/`bottom` encode unrotated like `top` (encoder is 2-valued); no warning | wrong output for those directions | **decide before P8** (pre-rotate 180° vs reject at validate) |
| D-05 | print | `applyPolicy` = one full-frame pass per distinct policy (bounded 4) | per-label cost, not size-correctness | P7 (before large batches) |
| D-06 | render | `regionUnionBounds` has no production consumer (clip uses `regionUnionPath`) | dead-ish API surface | post-v1 / P8 cleanup |
| D-07 | render | `LabelSummary` does not denormalize union bounds; card silhouette still a generated placeholder | gallery art is approximate | post-v1 |
| D-08 | data | `labelRepo.get()` re-copies the gzip view offset per read (`serialize.ts` `gzipPayload`) | negligible at v1 sizes | chore |
| D-09 | editor | `PreviewStage` drag adds a world delta to a parent-local transform — wrong inside a scaled/rotated group | misplacement when editing inside transformed groups | post-v1 (group scale/rotate is parked) |
| D-10 | editor | group Transformer resize discards scale (group scale is post-v1); should skip transform for groups | confusing no-op resize UI on groups | post-v1 |
| D-11 | editor | align control writes a junk `align` key onto shape/image nodes | stray field in the doc | chore |
| D-12 | editor | image import writes **two** undo entries (`addImageRef` + `addNode`) | one undo doesn't fully revert an image add | chore (batch when convenient) |
| D-13 | assets | remote images need **CORS** to render/print; a non-CORS URL import fails with a localised error | UX + potential print failure | P8 (proxy/fetch policy note) |
| D-14 | assets | imported-font badge headed check never done (unit-tested only) | unverified browser path | P7/P8 headed pass |
| D-15 | assets | `prepareAssets` min-module floor 0.25 mm is conservative; small boxes render at scale 1 with a `too-small` warning | conservative warnings | post-v1 tuning |
| D-16 | assets | `bwip-js` is large (~250–280 KB gzip) and serves QR + barcodes | bundle size | P8 (code-split if needed) |
| D-17 | CSV | orphan `CsvRecord` sweep deferred — the P6 write path no longer deletes (it must not, since `csvs` isn't undoable) | unreferenced tables accumulate in IDB | P7/P8 (cleanup pass) |
| D-18 | CSV | `ParsedCsv.rowCount` = **retained** count, not total; total only in the `rows-capped` warning | a consumer reading it as "total" would be wrong | documented; keep an eye |
| D-19 | trust | `TrustSection` standalone fallback opens its own IDB adapter when no `repo` is injected (in-app always injects the store repo, so fallback is tests-only) | a second connection in the fallback path | chore |
| D-20 | preview | status-bar `rowCount === 0` conflates "no CSV" / "loading" / "empty table" | cosmetic | chore |
| D-21 | preview | `useSampleRow` `resolveKeyOf` runs one `JSON.stringify` per node per pointermove tick | negligible garbage on drag | chore (revisit if profiling) |
| D-22 | preview | `GlobalDataTab` draft-reseed effect keys on the spec object identity, so it re-runs on every doc commit (`structuredClone`) | wasteful but values match (React bails) | chore |
| D-23 | test-infra | `vitest.config.ts` keeps `testTimeout: 15000` for all tests; without it the real-canvas `renderLabelPage`/`rasterize` suites flake to 22–28 s under parallel load | slower failure feedback globally | chore (per-file scoping needs ≥2 files; keep until canvas tests are lighter) |
| D-24 | workflow | P6 has no print UI, so P6 hardware smoke was skipped; `?print=1` renders a fixed sample, not a CSV-bound editor doc | P6 not hardware-verified end-to-end | P7 (fold into the print-UI smoke) |
| D-25 | editor | `?print=1` / `?hardware=1` dev harnesses remain the only print entry points | no user-facing print path yet | P7 |
| D-26 | doc-format | export writes `inline`/`remote`/`local`/`external` provenance policy undecided (P5 chose `local`/`remote` for import) | export portability unknown | P8 |

## Escalation rule

Anything project-relevant found during a phase that is not fixed in that phase
goes **here** (or into the matching area file if it needs more than a line), not
only into `state.md` (gitignored) or the phase handoff. Keep entries short; link
out for detail. `agent/memory/csv-templates.md` and `objects-assets.md` hold the
deeper "how it works / gotchas" that these items assume.
