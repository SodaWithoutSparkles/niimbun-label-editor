# P6 — shared page-colour selector + parity + batch

Run: [`plan.md`](plan.md) §2 P6. One wave (`general`); `review` gates.
P3/P5 wired the modes; P6 finishes the shared control, the copy, and the
cross-page/invariant tests.

## Goal

One page-colour `Select` (Mono / Grayscale / Red-black) in the print dialog:
unsupported options show **disabled + explained**, the selected mode drives
preview/thumbnails/job, red ink is counted in the mirror notice, and a
multi-page grayscale (and red/black) job keeps its mode on every page.

## In scope

### 1. `src/components/print/PrintDialog.tsx`

- Replace the ad-hoc option labels with the `labelTypeUnsupported` pattern:
  a disabled option's label is `t('print.pageColorUnsupported', { name })`
  (`"{{name}} (unsupported)"`).
- Add a `description` to the page-colour `SettingRow`, chosen by state:
  - selected `DoubleColor` → `t('print.pageColorDoubleHint')` — the honest
    limitation from the P5 review: images dither, but per-object dither
    strength/gamma are **not** applied in red/black (page-level settings only).
  - no mode supported → `t('print.pageColorUnsupportedHint')`.
  - grayscale unsupported → `t('print.pageColorGrayscaleUnsupportedHint')`.
  - red/black unsupported → `t('print.pageColorDoubleUnsupportedHint')`.
  - all supported and mono/grayscale selected → no description.
- Keep the existing value mapping and capability gates. Do **not** hide
  unsupported options (disabled + labelled).
- Confirm (no code change expected) that `previewOptionsKey` and the thumbnail
  override key already carry the mode — P3/P5 added them.

### 2. `src/core/render/palette.ts` (comment only)

- Update the stale **D-05** note in `diffuseToPalette`: it still says
  per-object policies "stay 1-bit". In red/black the same policies now choose
  flat vs diffuse **inside** the palette pass; the seam drift still exists
  between two diffusing objects (and between flat and diffuse neighbours), so
  the debt stays — only the wording changes.

### 3. i18n (`src/i18n/locales/en.json`, one writer)

- `print.pageColorUnsupported`: `"{{name}} (unsupported)"`.
- `print.pageColorDoubleHint`: `"Images are dithered; per-object dither strength and gamma do not apply in red & black."`
- `print.pageColorUnsupportedHint`: `"This printer supports mono pages only."`
- `print.pageColorGrayscaleUnsupportedHint`: `"This printer does not support 16-level grayscale pages."`
- `print.pageColorDoubleUnsupportedHint`: `"This printer does not support two-colour (red & black) pages."`

### 4. Tests

`src/components/print/PrintDialog.test.tsx`
1. Unsupported combinations: each mode's option is disabled **and** its label
   carries the `(unsupported)` suffix; the description matches the combination
   (mono-only / no grayscale / no double).
2. Selecting red/black shows `pageColorDoubleHint`; switching back to Mono
   removes it.
3. Existing P3/P5 assertions (job gets the enum, render options get the mode)
   still pass unchanged.

`src/print/printLabel.test.ts` / `src/print/batchJob.test.ts`
4. **Multi-page grayscale:** a CSV with 3 rows + `overrides.pageColor = Grayscale`
   yields 3 encoded pages, each with `data.pageColor === Grayscale`, and the
   render seam receives `pageColor: 'grayscale'` on **every** page (no per-row
   leakage).
5. **Multi-page red/black:** same with `DoubleColor` / `'redBlack'`; every page's
   planes are split (red plane present) and the mode never falls back to Mono.
6. **Preview ≡ print:** for one doc + overrides (grayscale and red/black), the
   job's encoded page bytes equal
   `ImageEncoder.encodeCanvas(rendered.canvas, pageColor, oriented.direction)`
   from the same render options — pin the invariant, not just the option
   threading.

`src/editor/render/renderLabelPage.redBlack.test.ts`
7. **Red ink counted in the mirror notice:** an asymmetric printable union with a
   red rect that the mirror pushes outside reports `mirror-clipped-ink` with
   `lostPx > 0` (P2's `countInkPx` fix, now exercised on real red pixels).

## Out of scope

- No paper-type colourspace hints, no RFID logic, no seeded paper types.
- No new render modes, no per-ink screentone.
- No hardware work (P7); no docs/memory promotion (P7).
- No change to capability detection (P3/P5 own it).

## Exit criteria

- One selector, unsupported options disabled + explained, red/black limitation
  visible, D-05 wording current.
- Multi-page jobs keep the mode; preview ≡ print bytes pinned; red notices count.
- `tsc` clean; full suite green; `review` PASS.
