# Handoff — storage safety + wave 2 + P10/P11

- Date: 2026-10-25
- Run: `agent/2026-10-22_storage-safety/`
- Baseline: `main` @ `c5e08b8`
- **Gate: green** — `bun run test` → **178 files / 2508 tests passed**;
  `bun run build` (tsc + vite) clean. Working tree clean.

## Read these first

1. `agent/memory.md` → `memory/storage-safety.md`, `memory/paper-types.md`,
   `memory/dithering.md` (§10), `memory/print-transport.md`.
2. `plan.md` in this run (wave tables + decisions).
3. This file.

## What shipped (all committed)

| Area | Behaviour now | Commit |
| --- | --- | --- |
| Orphan cleanup (#4/#5) | `src/data/referenceScan.ts` is the only reference inventory. `listDetailed()` + per-doc `get()` failures ⇒ `complete: false`; live docs (`currentDoc`, `docPast`, `docFuture`) are unioned in. Batch delete renders only when complete, re-scans after confirm, deletes only the still-orphan intersection. | `ab2ae20` |
| Single delete | CSV/media single delete scans first and picks *proven orphan* / *in use* / *could not verify* wording; the user can override. | `dc8ebec` |
| Label delete (#1) | `LabelCard` delete button + confirm; `deleteLabel` awaits the autosave promise chain before `remove`, navigates home only on success, and bumps `openRequestId` so a mid-read `openLabel` cannot commit a deleted doc. Autosave coalesces to the newest queued snapshot. | `84789e5` |
| niimbluelib | 0.47.1 (protocol-4 `findPrintTask` fallback, unsigned packet parsing). | `ba1da4c` |
| Numeric fields | `PopoverSlider` uses a text draft (`role="spinbutton"`); negative values typeable, clearing never writes 0, leading zero preserved, blur/Enter commits. | `a3dabbd` |
| Letter spacing | Wired end-to-end (resolver default 0, preview + print, `measureKonvaText`). | `58870e7` |
| Label transfer | `src/data/bundle.ts` + File ▸ Import / Export this label / Export all. Self-contained bundle, fresh doc ids (trust never carries), assets inlined→local, CSVs embedded→remapped, `.gz` accepted, 64 MB guard. | `0f65414`, `c0a12c5` |
| Print offset | `label.printOffset` in **hm** (±100 mm), dialog shows printer dots at the resolved dpi, committed once on unmount, doc-id guarded. | `da25d8d` |
| 48×30 paper seed | New `rounded48x30` (4800×3000 hm). Seed-set v2: existing catalogues receive it **once**; deleted seeds still stick. `rounded50x30` untouched. | `230f5c8` |
| Scrollbar gutters | `[scrollbar-gutter:stable]` on MFP, Layers, gallery, catalogue, nav, settings (nav + content), modal body. | `230f5c8` |
| Screentone boldness | `screentoneBoldness` ∈ [−1, 1], default 0. `level = clamp(round(tone·maxLevel + boldness), 0, maxLevel)`. Per-node + per-strategy; `policyKeyOf` keys it (2 dp); inspector + Settings; render plumbing per policy. Default 0 is byte-identical. | `faeda8d`, `c5e08b8` |
| Memory | storage-safety, paper-types (seed v2), dithering (boldness), print-transport (0.47.1), objects-assets (letterSpacing). | `eb49d54`, `b10368f` |

## Contracts — do not break

- **Destructive cleanup** requires `complete === true` and a fresh re-scan.
  Never call `labelRepo.list()` for an inventory (it drops errors).
- **Autosave**: append to the `autosaveWrites` chain; never replace the tail.
  `flushAutosave()` returns the chain in every branch.
- **Bundle**: import must mint fresh doc ids (trust is keyed by id) and must not
  trust the file (size → parse → per-doc validation).
- **Print offset** is hm in the doc, px only inside the dialog.
- **Screentone boldness** is a level bias, not a contrast band; it is
  pixel-changing and must stay in `policyKeyOf` and the explicit per-policy
  options.
- **Paper seeds**: never edit an existing seed's geometry. Add a new id and
  append it to `SEEDS_ADDED_IN_V2` (bump `PAPER_SEED_VERSION`).

## Next work — wave 3 backlog (not started)

Ranked from the original triage; all evidence is in the 2026-10-25 session notes
and the GitHub issues.

| Item | Issue / evidence | Effort | Why it matters |
| --- | --- | --- | --- |
| Print CSV readiness | GitHub #6/#7 | S/M | An attached-but-loading/failed CSV is treated as "no CSV": Print stays enabled and builds a 1-record fallback job; the Page preview never invalidates when the CSV arrives. Fix once in `usePrintJob` (status + revision), gate the button **and** job creation, add the revision to `PrintPagePreview`'s deps. |
| Barcode fit coherence | discovered 2026-10-25 | S/M | Raster draws barcodes `cover`; the verdict and policy mask still assume `contain` → quiet zone/end bars can be cropped and "too small" over-warns. Pick one fit (stretch is the low-risk no-crop option), align `drawnPitchBelowMinModule`, the mask and the tests. |
| `shrink` text loss | debt D-42 | M | Render builds `Konva.Text` with `height: node.h` before applying the shrink scale, so lines past the unscaled box are dropped; the inline overlay never downscales. Fix both, keep `wrappedLineStarts` in sync. |
| Gamma preview trigger | GitHub #3 | S | `quantizedPreviewTrigger` omits `gamma`; a gamma-only edit shows no preview. |
| Persistent dither invalidation | GitHub #2 | S | `useQuantizedPreview` omits `quantizerDefaults` / `defaultQuantizerByType`; wire `quantizerSettingsKey` into the effect deps (not the peek trigger — D-59). |
| `clip` semantics | debt D-42 | M | `clip` renders as word-wrap + truncation, not "no wrap, hard clip". Settle the `types.ts` vs `objects.ts` contradiction first. |
| PNG export | triage | S | Renderer + encoder exist; only a File-menu item + dpi choice. JSON export now covers portability, so this is convenience. |
| PDF export / preset marketplace | triage | M / L | Defer. OS print-to-PDF already works; a marketplace needs hosting + trust. |

Also from the upstream survey, still open: nothing critical. `promptText()` is
**dead code** (no production caller) — delete it or adopt it, don't add
`multiline` to it.

## Known residuals / debt

- **D-70** (tech-debt): orphan re-scan and delete are not atomic across tabs.
  Single-tab is safe. Closing it needs `StorageAdapter.transaction`.
- Heavy-canvas suites flake under parallel load (D-23/D-29); a full run may
  occasionally fail one canvas test and pass on rerun. Not caused by this work.
- `resolve`/`renderPageBase` compose the raster so a node's CSS hex fill is not
  the exact grey the quantizer sees — don't write exact-ink assertions against a
  hex fixture; assert ordering.
- Screentone boldness is unverified on hardware (no test print yet).

## Environment / commands

- Repo: `/mnt/c/Users/USER/code/niimbun-label-editor` (WSL on drvfs).
- bun is not on PATH: use `/mnt/c/Users/USER/.bun/bin/bun.exe run <script>`.
- Tests: `bun.exe run test` (Vitest). Build: `bun.exe run build`.
- Typecheck: `node node_modules/typescript/bin/tsc --noEmit`.
- Never `git stash`, never destructive git, no push.

## Resume pointer

Start by reading `plan.md`, then create a **wave 3** plan. Suggested order:
print CSV readiness → barcode fit → shrink → the two S preview fixes → clip.
Run each through implementation → review → commit, as in waves 1–2.
