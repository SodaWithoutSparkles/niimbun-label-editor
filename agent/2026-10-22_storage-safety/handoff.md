# Handoff — storage safety + wave 2 + P10/P11 + wave 3

- Date: 2026-10-29
- Run: `agent/2026-10-22_storage-safety/`
- Baseline: `main` @ `c5e08b8` (wave 2 end); wave 3 ends at `02b31bd`
- **Gate: green** — `bun run test` → **179 files / 2599 tests passed**;
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

## Wave 3 — shipped (2026-10-26 → 2026-10-29)

| Phase | Behaviour now | Commit |
| --- | --- | --- |
| P12 print CSV readiness | `usePrintJob` publishes `csvStatus` (`none`/`loading`/`ready`/`error`) + `csvRevision`; `ready` is the only state that exposes a table. Print is disabled and `buildCsvPrintJob` is unreachable while an **attached** CSV is loading/failed (an absent CSV still prints its single static page); the Pages section shows the status instead of the list; `PrintPagePreview` re-runs on the revision. | `51495c2` |
| P13 barcode fit | 1D barcodes draw **stretch** everywhere — raster, preview, policy mask, non-printable keep-out and the too-small verdict (which now scores `modulePx × targetW / canvasW`). No crop, no letterbox. 2D `code`/`qr` stay `contain`. | `06416ac` |
| P15 preview trigger | `quantizedPreviewTrigger` keys `gamma` and `screentoneBoldness` too (all eight per-node pixel-changing params). | `0996c0e` |
| P14 shrink text loss | Both renderers lay out at `height = node.h / shrink` **before** scaling (zero-shrink guarded), so no measured line is dropped. The inline editor lays out at the natural width with the natural font, allows `node.h / shrink` before scaling once, carries `letter-spacing`, and includes the shrink in caret rounding; `PreviewStage` divides the captured canvas scale by the shrink so it applies once. | `0a859d8` |
| P18 printer metadata refresh | The adapter subscribes `printerinfofetched` / `rfidinfofetched` and republishes `printerStatus` (guarded: no emit before connect completes or during a print). `PrinterStatus.labelType` is the reported roll type (`consumablesType`, else `paperInfo.paperType`). Opening the print dialog fires one `refreshInfo()`. No new timer — the library heartbeat already re-reads RFID on a lid/paper change and after each print. | `5a5276e` |
| P19 label type default | The dialog seeds the select from the reported roll type (user pick wins for the session, each open re-seeds) and shows an advisory reported-vs-selected line. | `62c8e04` |
| P16 dither invalidation | `useQuantizedPreview`'s both scheduling effects depend on `quantizerSettingsKey`; a raster planned/painted under older defaults is rejected/hidden. The peek trigger stays settings-free (D-59). | `c0fc192` |
| P17 `clip` + `cut` | `clip` keeps its shipped meaning (wrap at words, hide lines past the height) and is now documented that way. New `cut`: no wrap, one line per hard `\n`, cut at the box edge, drawn in a clipping group in both renderers (clip + child follow a live resize). | `02b31bd` |

## Wave 4 — owner requests (2026-10-29)

| Change | Behaviour now | Commit |
| --- | --- | --- |
| Export only referenced assets (P20) | `buildBundle` prunes the exported copy's `resources.images`/`.fonts` to what the nodes use (image `imageId`; text `fontId` **and** `fontFamily`), collapses duplicate ids last-wins, then inlines. `missing` counts only referenced unreadable refs, and the export warns (non-blocking) when it is non-zero. | `c183c8f` |
| Screentone pitch floor | `SCREENTONE_PITCH_MM_MIN` 0.3 → 0.2 mm and the advisory snap floor 0.4 → 0.2 mm (now derived from the clamp min): 2 dots / 0.250 mm at 203 dpi, 3 / 0.254 at 300, 5 / 0.212 at 600. Defaults, levels, boldness and the pinned planes unchanged. | `0209cb9` |

## Contracts — do not break

- **Destructive cleanup** requires `complete === true` and a fresh re-scan.
  Never call `labelRepo.list()` for an inventory (it drops errors).
- **Autosave**: append to the `autosaveWrites` chain; never replace the tail.
  `flushAutosave()` returns the chain in every branch.
- **Bundle**: import must mint fresh doc ids (trust is keyed by id) and must not
  trust the file (size → parse → per-doc validation). **Export prunes to node
  references** — never inline the raw `doc.resources.*` registry (it is
  append-only), and keep `fontFamily` refs, not just `fontId`.
- **Print offset** is hm in the doc, px only inside the dialog.
- **Screentone boldness** is a level bias, not a contrast band; it is
  pixel-changing and must stay in `policyKeyOf` and the explicit per-policy
  options.
- **Paper seeds**: never edit an existing seed's geometry. Add a new id and
  append it to `SEEDS_ADDED_IN_V2` (bump `PAPER_SEED_VERSION`).
- **Print CSV**: `ready` ⇒ a table; `loading`/`error` ⇒ Print disabled *and*
  the builder unreachable. `none` (nothing attached) is a legitimate 1-page job.
  `PrintPagePreview` must keep `contentRevision` in its effect deps.
- **Barcode fit**: 1D = `stretch` in raster, preview, mask, keep-out and verdict;
  2D `code`/`qr` = `contain`. Change one, change all five.
- **`shrink` text**: the layout box is `node.h / shrink` before the scale, and
  a zero measure falls back to `node.h`. `PreviewStage` divides the captured
  scale by the shrink; the overlay applies it exactly once.
- **Printer status**: an RFID read that **produced data** is authoritative
  (absent roll/type fields are cleared); an empty RFID payload merges (the
  library emits regardless of a failed sub-read); printer-info reads merge.
  Never emit metadata statuses before connect completes or mid-print.
- **`clip` vs `cut`**: `clip` = wrap + hide past the height; `cut` = no wrap +
  cut at the box (clip group). Do not "unify" them.

## Next work — wave 4 candidates (not started)

Wave 3 is done (see the table above). Remaining, ranked:

| Item | Issue / evidence | Effort | Why it matters |
| --- | --- | --- | --- |
| Text-loss warning for `cut`/`clip` | debt **D-72** | S/M | A `cut` label truncates at the box edge and a `clip` label hides every line past the height, silently. Add a per-node overflow warning producer (hidden glyphs/lines) to the warning centre. |
| PNG export | triage | S | Renderer + encoder exist; only a File-menu item + dpi choice. JSON export covers portability, so this is convenience. |
| PDF export / preset marketplace | triage | M / L | Defer. OS print-to-PDF already works; a marketplace needs hosting + trust. |
| `promptText()` | upstream survey | S | **Dead code** (no production caller) — delete it or adopt it; do not add `multiline` to it. |

## Known residuals / debt

- **D-70** (tech-debt): orphan re-scan and delete are not atomic across tabs.
  Single-tab is safe. Closing it needs `StorageAdapter.transaction`.
- **D-71**: `connect()` emits several status objects (the library's own `connect`
  event plus our built status, plus negotiation metadata). Harmless, redundant.
- **D-72**: `cut`/`clip` content loss has no warning producer.
- Heavy-canvas suites flake under parallel load (D-23/D-29); a full run may
  occasionally fail one canvas test and pass on rerun. Not caused by this work.
  (`src/print/batchJob.test.ts` "grouped: 100 records" is the usual suspect —
  it passes alone.)
- `resolve`/`renderPageBase` compose the raster so a node's CSS hex fill is not
  the exact grey the quantizer sees — don't write exact-ink assertions against a
  hex fixture; assert ordering.
- **Unverified on hardware**: screentone boldness; the reported label type /
  metadata refresh (P18/P19) and the `cut` edge behaviour all need one real
  print each. The label-type seeding in particular should be checked on a
  continuous roll.

## Environment / commands

- Repo: `niimbun-label-editor` (WSL on drvfs — the checkout path is machine-local and
  deliberately not written down; run everything from the repo root).
- Package manager: **bun** — `bun run test`, `bun run build`. (If `bun` is not on
  `PATH` in your shell, use the installed bun; never paste its absolute path into
  a doc.)
- Tests: `bun run test` (Vitest). Build: `bun run build`.
- Typecheck: `node node_modules/typescript/bin/tsc --noEmit`.
- Never `git stash`, never destructive git, no push.

## Resume pointer

Wave 3 is complete and committed (`51495c2` → `02b31bd`). Start wave 4 by
reading `plan.md` § "Wave 3" (the contract notes) plus `memory/tech-debt.md`
(D-71, D-72), then plan D-72 first: it is the only *silent* loss left.
