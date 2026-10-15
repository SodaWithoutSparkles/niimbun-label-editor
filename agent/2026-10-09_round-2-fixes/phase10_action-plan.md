# Phase 10 action plan — MFP panel + print preview rework

Reads with [`plan.md`](plan.md) §P10 (`:129-136`), [`state.md`](state.md), [`memory/ui-design-workflow.md`](../memory/ui-design-workflow.md)
(owner designs the UI; screenshot = spec; never redesign).

**Spec (owner, 2026-10-16) — `references/tmp/image1.png` (editor / MFP panel), `image2.png` (JS tab),
`image3.png` (print preview). `references/` is gitignored; screenshots are NOT tracked — do not copy them
into the repo.** Base: `main` at the P9 tip (`b9cb41b`).

## Verified recon (taken as fact — do not re-explore)

### MFP panel + shell
- `MfpPanel.tsx` — root `:31`, tabs `:21` (object/data/globals/js/warnings), **one-column stack**;
  tabpanel (scroll) `:71` = `overflow-y-auto` = the popover clipping ancestor.
- `EditorShell.tsx` — grid `:64-69`; `RIGHT_COLUMN_PX = 280` `:30`; row A col 3 = ViewControls cell
  (`:78-80`), row B MFP spans cols 1–2 (`:83-85`), Layers col 3 (`:86-88`). **The wide surface that the
  3-col Object layout fills is the bottom MFP panel (cols 1–2), not the 280 px cell.** No shell-grid change.
- `ViewControls.tsx` — root `:57`; "VIEW" heading `:58-60`; Row 1 `:61-78` (Grid, Snap, Rulers, Rotate),
  Row 2 `:79-100` (ZoomOut, ZoomIn, Fit, Real) = **8 general icons, 4 per row × 2**; `IconButton` `:22-36`.
  **No object-specific icons today.** Mounted at `EditorShell.tsx:78-80` in the 280 px cell.
- `ObjectTab.tsx` (root `:943-948`) — **no 3-block grouping exists**:
  - TRANSFORM `<section>` `:957-966` (inline `<section>`+`<h4>` wrapper, repeated 3×).
  - ALIGN `<section>` `:968-996` — 6 align + 2 tile **text buttons** (`:973-994`).
  - **Flat ungrouped field list** `:998-1000` = `model.fields.filter(f => f.scope !== 'transform').map(renderField)`
    — **text-specific, appearance and asset fields are all one list, no headings**.
  - ASSET `<section>` `:1002-1030`; fontError `:1032`; hidden file input `:1034-1045`; `ImageImportDialog` `:1046-1051`.
  - `renderField` `:675-898`; field widgets are `SettingRow`-wrapped, fixed widths (`w-40`/`w-36`/`w-32`).
- `GlobalDataTab.tsx` — **already card-style**: `GlobalRow` card `:151` `div…rounded border bg-gray-900 p-2`
  stacking 2–5 `SettingRow`s (`:152-237`), every control `w-36` → the wide label↔control gap is the waste.
- `DataSourceTab.tsx` — no sectioning; attach row `:234-261`, columns `:290-292`, sample row `:294-305`,
  **`CsvPreviewTable` `:307` (the wide element)**. Only fixed control = sample `Select w-40`.
- `JsTab.tsx` — root `:138-252`. Content kind `:140-151`; static `:153-162`; csv column `:166-190`;
  csv Fallback `:191-200`; **Trust row `:206-211` (separate row from Content)**; banners `:212-226`;
  template code `textarea w-40 rows=6` `:227-238`; template Fallback `:239-249`. **Never one row today.**
- `SettingRow` `src/components/common/forms/SettingRow.tsx:12-40` (`:29` = `flex justify-between gap-4 py-2`).
  **No shared `Section`/`Panel` wrapper** — the header style is copy-pasted 4×.

### Print
- `PrintDialog.tsx` — **no `viewMode`, no `selectedPage`** (`:93-105`); open effect resets 13 form fields only
  (`:109-124`); local `activeRecords` `:128-131`; `planSequence` `:133-140`; page list fed `activeRows`
  `:445-451`. **Plan's `:439-440` "View as Select" ref is STALE** = the Order options array.
- `printDialogModel.ts` — export is `activeRecords(rows, timesFor, copies)` `:36-46` (not `activeRows`).
  `plan.pages` lives in `src/print/sequence.ts` (`planSequence:115`, `pages: AsyncIterable:48`).
- `renderLabelPage.ts` — sig `:454-458`; `opts.dpi` `:80`; resolved `:462`; dims `:467-471`;
  `MAX_RASTER_PIXELS = 16_000_000` `:128`, guards `:479-484`/`:592-597` **throw `RangeError`** (no fallback).
- `usePrintThumbnails.ts` — `THUMBNAIL_DPI = 50` `:38`, render `:205`, cache key `:242`, keyed `rowIndex` only
  (`:79,245,277`); `thumbnails.ts` LRU 32 `:74`, concurrency 2 `:76`, cache `:112-121`. **Cannot share.**
- `PrintDialog.test.tsx` — `renderLabelPageMock` `:17-19`, module mock `:30-33`; **no `opts.dpi === doc.label.dpi`
  assertion**; ink check filters `dpi === undefined` `:261-264`.
- `en.json` `print` block `:701-771` — missing `view`/`viewAs`/`viewQueue`/`viewPage`, `page`/`pageOf`,
  `prev`/`next`.

## Decisions locked (owner Q&A 2026-10-16)

- **D1 — Object tab = adaptive 3-col blocks (O1 CONFIRMED).** 3 columns at wide → 2 → 1 when narrow. Grid wraps the blocks,
  not per-field. Requires splitting the flat field list (`:998-1000`) into named `<section>`s first.
  **Grouping proposed (owner to confirm/amend):** col1 `TRANSFORM`; col2 text-specific fields
  (`fontFamily, fontSize, fontWeight, fontStyle, wrap, letterSpacing, direction, contentSource`);
  col3 appearance/geometry (`stroke, fill, strokeWidth`, colours) + `ASSET`. `ALIGN` leaves the tab (D2).
  Implementer may let CSS columns auto-flow; block order must be TRANSFORM → text → appearance → asset.
- **D2 — top-right icon area: general block stays, object-specific block goes below it.**
  General VIEW icons unchanged (8, 4-per-row × 2 rows). New object-specific icon block directly **below**
  the general ones in the same 280 px cell (`ViewControls.tsx`): align 6 + tile 2 (icon-only, lucide), shown
  **only when a selection exists**; text-specific icons (text-align left/center/right/justify) shown **only
  when a text node is selected**. **The ALIGN `<section>` is removed from `ObjectTab`** (plan `:135`).
  Icons = **lucide-react** (already the only icon lib, `package.json:43`); **no mdi dependency**.
  Proposed mapping: align left `AlignHorizontalJustifyStart`/`AlignStartVertical`… implementer picks the
  closest lucide glyph and reports; text-align uses `AlignLeft/AlignCenter/AlignRight/AlignJustify`.
- **D3 — tabs other than Object are NOT 3-col.** Data source keeps (needs width for `CsvPreviewTable`);
  Global data becomes a **card grid** (1→2→3 cols adaptive) with a compact card header (name + type on one
  row, value/url/extract full-width) to stop wasting the label↔control gap; JS tab top row
  (Content kind + Trust + Fallback) is **one row at wide, collapsing to 2×2 or 3×1 when narrow**; the code
  textarea goes **full width** and **`spellCheck={false}`** (code ≠ English; highlight/autocomplete out of
  scope); Warnings tab **unchanged**.
- **D4 — popovers: portal + light text.** `PopoverSlider` and `ColorPicker` render via `createPortal` to
  `document.body` (escape `MfpPanel.tsx:71` scroll clip and the right-edge clip) and get a legible light
  text colour on their dark surface. Layout otherwise unchanged — owner could not spec it because it is
  currently clipped/illegible; re-spec after it is visible.
  - **[W3 correction]** real paths are `src/components/common/PopoverSlider.tsx` + `.../ColorPicker.tsx`
    (NOT `components/editor/`). W3 done: portal + `position: fixed` + viewport clamp + `Escape` close
    added + `text-gray-100` (body is `text-gray-900` — that was the near-black-on-black cause).
- **D5 — print: Queue|Page mode, default Page.** Add `viewMode: 'queue' | 'page'` (default `'page'`) +
  `selectedPage` local state; **reset both to Page/0 in the open effect** (`:109-124`). **Queue = current**
  (thumbnail list). **Page = one large preview** with a toolbar: zoom-out, page stepper `< [n/total] >`
  (prev/next chevrons), zoom-in, zoom-factor readout; higher-res **in both modes**. Page render uses its
  **own path at `dpi: doc.label.dpi`** — **never share** `usePrintThumbnails`' 50 dpi `rowIndex` cache.
  Catch the `MAX_RASTER_PIXELS` `RangeError` and degrade with a notice (no crash). Test asserts the Page
  render called with `opts.dpi === doc.label.dpi`.
- **D6 — v0 alpha**, breaking changes OK, no shims. `ui-designer` NOT used (owner instruction #4) —
  `general` implements from the screenshots.

## Open (owner) — RESOLVED 2026-10-16
- **O1 — CONFIRMED.** Object-tab 3-col grouping = the D1 proposal.
- **O2 — FOLD IN.** `D-47` (gallery previews broken for labels + paper types) is **in scope** for P10 → **W6**.

## Work items & waves

| Wave | Worker | Scope | Files |
| ---- | ------ | ----- | ----- |
| **W1** | `general` | Object tab: split flat list into named `<section>`s + adaptive 3-col block grid; extract a shared section-header wrapper | `ObjectTab.tsx`, `MfpPanel.tsx` |
| **W2** | `general` | Top-right object-specific icon block (align+tile icon-only; text-specific for text nodes, selection-gated); remove ALIGN section from ObjectTab | `ViewControls.tsx`, `EditorShell.tsx`, `ObjectTab.tsx` |
| **W3** | `small-coder` | Popover portal + light text | `PopoverSlider.tsx`, `ColorPicker.tsx` |
| **W4** | `general` | Global-data card grid; Data-source keeps wide; JS one-row adaptive + full-width non-spellchecked textarea | `GlobalDataTab.tsx`, `DataSourceTab.tsx`, `JsTab.tsx`, `en.json` |
| **W5** | `general` | Print Queue\|Page + Page preview (zoom, stepper, doc-dpi own path, RangeError guard) + i18n + test | `PrintDialog.tsx`, new `PrintPagePreview.tsx`, `en.json`, `PrintDialog.test.tsx` |
| **W6** | `general` | `D-47`: gallery previews broken (labels `LabelCard` art + paper types `PaperTypeCard`/`PaperTypePreview`) — **diagnose, then fix** | gallery cards + preview render |
| gate | `review` → fix (≤2) → narrow re-review → commit | | |

**Conflict note:** W1 and W2 both touch `ObjectTab.tsx` (W2 removes the ALIGN section) → **run W1 then W2
sequentially in one worker**, or W2 before W1. W3, W4, W5 are independent and may fan out in parallel.

**Commits:** A = MFP panel (W1+W2+W4), B = popovers (W3), C = print preview (W5) — or fewer if they cohere.
Implementer/coordinator call; report which.

## Risks
- **R10a — 3-col split is a redesign.** The grouping (D1) is proposed, not owner-specified. Get O1 confirmed
  before W1; do not invent panel placement beyond the screenshot.
- **R10b — align-icon mapping.** lucide has no exact `mdi:align-horizontal-distribute`; only align + tile
  exist (no distribute op). Icon-only buttons must keep `aria-label`/`title` from the current text labels
  (i18n keys `en.json:545-553`) so nothing loses an accessible name.
- **R10c — portal regressions.** `createPortal` on `PopoverSlider`/`ColorPicker`: StrictMode double-mount,
  outside-click/`Escape` close, scroll-anchoring, and the click-outside test. Mirror `Modal.tsx:226`.
- **R10d — print Page render cost.** Doc-dpi raster is large; the `MAX_RASTER_PIXELS` guard throws — must be
  caught, and the render must not run for every thumbnail row. Own path, own lifecycle/cancellation.
- **R10e — i18n.** One `en.json` writer per wave; typed `t()` keys make stale keys a `tsc` error.
- **R10f — no shell-grid change.** Keep `RIGHT_COLUMN_PX = 280`; the 3-col layout fills the bottom MFP panel.

## Tests
- Object tab: 3-col collapses at narrow widths; each block renders once. Extend the ObjectTab DOM harness.
- Icon block: align/tile buttons appear only with a selection; text-align only for a text node; each has an
  accessible name.
- Popover: portalled node is outside the scroll container; closes on outside click / `Escape`.
- Print: `viewMode` defaults + resets to `page`; Page render asserts `opts.dpi === doc.label.dpi`; stepper
  bounds; zoom clamps; `RangeError` → notice.
