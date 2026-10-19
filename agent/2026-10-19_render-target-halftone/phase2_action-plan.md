# P2 action plan — device-driven print dpi ("DPI hint") + D-28

- Parent plan: [`plan.md`](plan.md) §P2. Status: **DONE** (2026-10-19) — reviewed, committed.
- Goal: the print raster renders at the **printer's** dpi when the new setting is on and the printer
  reports one; otherwise at the document's **dpi hint**. Closes **D-69**, pays **D-28**.
- Verified recon (this phase): full `doc.label.dpi` / `opts.dpi` census + the asset-cache scope map —
  see §Fact base below. Facts marked ✔ are verified with `file:line`.

## Decisions (open questions 5–7 from the parent plan, settled)

1. **Number box semantics (off mode): write-back to the doc's DPI hint.** The document stays the
   single source of truth; no session override state. Editing the box patches `doc.label.dpi`
   (reuse the same doc-label patch action `PrintDialog` already uses for `printDirection`).
2. **Live quantized preview: seed from the resolved dpi.** Keeps D-60's "the preview is the print
   raster 1:1" property; the 1 M px budget fallback stays. `approximate` must compare against the
   **base** dpi actually used, not the hint.
3. **Rename scope: keep the stored key `doc.label.dpi`; rename UI + i18n + comments only.** No data
   migration. The field's *meaning* is now "DPI hint" (used when the setting is off or the printer
   reports nothing).
4. **Setting:** one global persisted boolean, default **ON**, edited in the print dialog's Overrides
   panel (next to invert/mirror/offset — the only place print raster options live today ✔).
5. **`rollDpiMismatch` is the single carrier of "the print will use a different dpi than the hint".**
   Extend it with the resolved dpi; do not add a second warning.

## Fact base

- Resolution chain today: `renderLabelPage.ts:570` `opts.dpi ?? opts.assets?.dpi ?? doc.label.dpi`; ✔
  the print path never sets `opts.dpi` (production `printOverrides` has no `dpi`,
  `PrintDialog.tsx:285-311` ✔), though `renderOptionsOf` honours an `overrides.dpi`
  (`printLabel.ts:127`) — the hook the job path already has.
- The raster is encoded 1:1 in printer dots (no resample) ⇒ render dpi **must** equal the head dpi.
- Reported `dpi` = `PrinterInfo.resolutionClass` via `dpiOf` (`niimbotAdapter.ts:473-481`) ✔ — device
  status. `printheadPixels` = model metadata ✔. Roll dims = tag advice. Never conflate (R8).
- Consumers that must move to the resolved dpi: `PrintDialog.tsx:174-188` (dims → `printheadOverflow`
  trigger + `orientedWidthPx`), `:231-238` (`previewRenderOptions.dpi`), `:285-311`
  (`printOverrides`, which the print job **and** the D-31 ink check both consume via
  `renderOptionsOf`), `PrintPagePreview.tsx:292` (the too-large message names `doc.label.dpi` ✔).
- Offsets are **device px at the effective dpi** (`printLabel.ts:55`, `renderLabelPage.ts:677-681`) ✔
  and are dialog-local (not persisted, reset on open ✔) — nothing to convert; the *unit* must be
  visible now that the dpi can differ from the hint.
- `MAX_RASTER_PIXELS = 16_000_000` and the print path has **no degradation** — at a resolved dpi a
  large label throws. Must be surfaced before the owner hits it (R12).
- Fixed-100-dpi paths: gallery `docThumbnail` (`GALLERY_THUMBNAIL_DPI`) and print-queue
  `usePrintThumbnails` (`THUMBNAIL_DPI`) ✔ — they stay 100 dpi and are **accepted approximations**
  (P4 will snap a screentone pitch at their own effective dpi).
- Non-head-dpi paths by construction: the print-queue thumbnails (100) and the live preview's budget
  fallback — classify as approximations, never claim head-lock there (P4 needs this recorded).
- **D-28:** the decode cache is one `Map<string, Promise>` per *provider object identity*
  (`prepareAssets.ts:66-88`), keyed by asset bytes identity only (`:91-105`), storing the **uncapped**
  decode, FIFO-bounded at 32 (`:134`), re-capped per call (`:221`). The print dialog shares **one**
  scope across the 100-dpi queue thumbnails, the page preview and the print job (`usePrintJob.ts:95`)
  ✔; QR/barcode/code are never cached ✔.

## Work items — wave 1

### W1 — resolved dpi end to end (owner: `general`)

**a. New pure module `src/print/resolvedDpi.ts`** (headless, no store):

```ts
export interface PrintDpiInput { usePrinterDpi: boolean; printerDpi?: number; docDpi: number }
export interface ResolvedPrintDpi { dpi: number; source: 'printer' | 'hint' }
export const resolvePrintDpi = (input: PrintDpiInput): ResolvedPrintDpi
```

Rules: setting off ⇒ hint; setting on but `printerDpi` absent/non-finite/≤0 ⇒ hint; else printer.
`source` is `'printer'` only in the last case. Unit tests for all four cases + a non-finite/0 printer
dpi.

**b. Persisted setting `usePrinterDpi` (default `true`)** — follow the `autoSave` pattern end to end
(`storeDefaults.ts`, `storeTypes.ts`, `settingsSlice.ts` seed + `setUsePrinterDpi` + `resetSettings`,
`preferenceValidation.ts` pick/normalize/repair, `useStore.ts` persistedDefaults + `partialize` +
`pickPersistedKeys`). The toggle lives in the **print dialog's Overrides panel**, persisted (not
`useState` like invert/mirror).

**c. `PrintDialog.tsx` wiring:**

- read `usePrinterDpi` + `setUsePrinterDpi` from the store; compute
  `resolved = resolvePrintDpi({ usePrinterDpi, printerDpi: printerStatus.dpi, docDpi: doc.label.dpi })`;
- `dims` (and therefore `printheadOverflow`/`orientedWidthPx`) at `resolved.dpi`;
- `previewRenderOptions.dpi = resolved.dpi`;
- `printOverrides.dpi = resolved.dpi` (always set — in off mode it equals the hint, so today's output
  is unchanged; setting it explicitly makes the job path deterministic);
- new DPI row in the Overrides panel:
  - **auto (setting on)**: a disabled number field showing `resolved.dpi` plus the "detected from
    printer" affordance; when the printer reports nothing, it shows the hint with a note that the
    fallback is in use;
  - **off**: an editable number box seeded from `doc.label.dpi`; committing patches the **document**
    (clamped by `normalizeDpi` semantics — reuse the existing doc-label patch action used for
    `printDirection`), which round-trips through validate;
- the offset rows must state their unit now that it is not always the hint: a description carrying
  the effective dpi ("device px at {{dpi}} dpi").
- **R12 guard:** compute `rasterDimensions(backing, resolved.dpi)`; if
  `widthPx * heightPx > MAX_RASTER_PIXELS` show a clear, blocking message in the dialog (and disable
  Print) — the render will otherwise throw mid-job. Reuse the existing too-large copy style.

**d. `PrintPagePreview.tsx:292`** — the too-large message must name the **effective** dpi
(`renderOptions.dpi ?? doc.label.dpi`), not the hint.

**e. `rollDpiMismatch` extension** — add the resolved dpi (+ whether the printer value is in use) to
`RollMismatch` (`printDialogModel.ts:49-81`) and to the `print-mismatch` warning payload
(`editor/warnings.ts:21`), and update **all three** sites (the dialog's push at `:386`, its message at
`:762-766`, and `WarningsTab.tsx:54`) so the text says which dpi the print will use. Keep it one
warning: with the setting on and a mismatch it explains the change; with the setting off it states
that the hint will be used.

**f. D-28 — give the queue thumbnails their own provider scope.** The dialog currently passes the
print job's `assets` to `usePrintThumbnails`, so 100-dpi thumbnail browsing and the print/preview
renders share one decode cache (one FIFO of 32 **uncapped** decodes, so browsing evicts the print
pass's decodes and vice versa). Mint a **separate** provider object for the thumbnail hook
(`createResourceAssetProviders(resourceRepo)` — memoized; use the same repo so the *providers* are
shared, the *scope* is not ✔) and pass that as the thumbnails' `assets`. Keep the print-job scope for
the page preview, the ink check and the job itself.
Note in the D-28 register entry: this pays the debt by **isolation** (thumbnail entries can no longer
occupy/evict the print scope's 32 entries); it is not a memory reduction — a cap-keyed cache of
*scaled* assets was rejected because the cached value is a scale-independent raw decode and keying by
cap would re-decode on every editor zoom step. Record that follow-up honestly.

**Tests (W1)** — `src/print/resolvedDpi.test.ts`; `src/components/print/PrintDialog.test.tsx`
(resolution order: off / on / on-with-no-printer-dpi; preview and print agree on the resolved dpi;
`printheadOverflow` uses the resolved dims; the raster-cap guard fires at the resolved dpi;
off-mode box writes back to `doc.label.dpi`); `assets.test.ts` or a focused new test for the scope
split (two scopes ⇒ each decodes independently; sharing would decode once).

## Work items — wave 2 (after W1 commits the file)

### W2 — "DPI hint" rename sweep (owner: `small-coder`)

- `en.json` + every UI string that names the document dpi in the **old** sense: the create-label
  field, any settings/inspector label, the new dialog DPI row, warning text. Keep the stored key
  `doc.label.dpi`; no migration.
- Update the code comments that describe the field as the raster dpi: `core/doc/types.ts:295`
  ("printer-reported" is wrong — it is a hint), `core/doc/validate.ts` DPI_* comments,
  `CreateLabelDialog.tsx:15`, and any `renderLabelPage` doc comment still implying "the doc dpi is
  the raster dpi".
- Do **not** rename code identifiers (`dpi`, `normalizeDpi`, `DPI_DEFAULT`) — the label carries the
  meaning; a key rename buys nothing (decision 3).

### W3 — live preview seeding (owner: `small-coder`)

`useQuantizedPreview`/`quantizedPreview.ts`: seed the base dpi with the resolved print dpi
(`store.usePrinterDpi` + `store.printerStatus.dpi` + `doc.label.dpi`), keeping the 1 M px budget
fallback and `approximate` comparing against the **base used**. Classify in a comment that this is an
approximation below head dpi when the budget forces it.

## Verification (coordinator runs)

- `bun.exe run test:run src/print src/components/print src/store src/editor` then the full suite.
- `node node_modules/typescript/bin/tsc --noEmit`.

## Review + commit

- Reviewer: `review` (logic-heavy, cross-cutting: render path, store, warnings, assets).
- Max 2 fix rounds; narrow re-review with `review-fast`.
- Commit: `feat(print): device-driven raster dpi (DPI hint)`.
- Memory after commit: `print-transport.md` (resolution chain + the non-head-dpi paths),
  `tech-debt.md` (**D-69 closed**, **D-28 paid by isolation** + the honest follow-up note),
  `objects-assets.md` (the provider-scope map), `state.md`.
- Then ask the owner before P3 (or P4 — P3 is independent and reorderable).

## Outcome (2026-10-19)

- Shipped: `src/print/resolvedDpi.ts` (pure) + persisted `usePrinterDpi` (default on) + a DPI row in
  the print dialog (disabled detected value / editable hint write-back), the resolved dpi threaded
  into the preview, the job (`overrides.dpi`), the ink check, `printheadOverflow` and the raster-cap
  guard (`offsetRasterDimensions` shared with the render path), the extended single mismatch warning,
  and the D-28 thumbnail-scope split. Live preview seeds from the resolved dpi.
- **Review round 1 (`review`, CHANGES NEEDED)**: the cap guard ignored outer offsets; the DPI box
  truncated decimals via `parseInt`; a missing write-back seam left the box showing an uncommitted
  value; DPI controls stayed editable during a job; the D-28 test didn't cover the dialog wiring; the
  live preview did not invalidate on a base change and floored the base. All fixed; `review-fast`
  re-review: **APPROVE**.
- Verification: full suite **2266 passed / 169 files**, `tsc --noEmit` clean.
- Memory: **D-69 closed**, **D-28 paid by isolation** (honest note + follow-up), `print-transport.md`
  §Print dpi resolution, `objects-assets.md` cache/scope bullet.
