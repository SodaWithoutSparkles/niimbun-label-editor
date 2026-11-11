# P10 — per-paper tone ranges + continuous long harness

## Goal

Make the printable tone ranges **adjustable per paper/density** instead of
hard-coded to the owner's first calibration, and make the long-page buffer test
print on the stock the owner actually has: **continuous** rolls, not a die-cut
50×160 label.

## What shipped

- **`grayscaleTone`** — `{ minLevel, maxLevel }`, persisted in the settings
  slice with clamps (0–15 integers, reversed band ties `min = max`, corrupt blobs
  normalised). The grayscale palette is `grayscaleRampPalette(min, max)`: **level
  0 (paper white) is always kept**, plus every level in the band. The renderer
  dithers between the allowed entries, so a tone below `min` spreads across the
  0→min gap rather than vanishing into invisible levels.
- **`redCoverageMin` / `redCoverageMax`** — the allowed clustered-cell levels
  (`redBlackCellLevels`), 0–100 integer percent, defaults 50/100. A non-zero
  cell still inks ≥4 of 9 dots, so the **effective floor is 4/9 (~44 %)** even
  when the slider asks for less.
- **Dialog + threading (invariant 7).** Range inputs under the page-colour row,
  gated on the selected **and supported** page colour, with readouts and hints
  (level 0 paper-white rule; the 4/9 cell floor). Persisted settings flow to the
  preview, dialog thumbnails and the print job: `renderOptionsOf` forwards
  `grayscaleTone` only for a grayscale page and `redBlack` only for a red/black
  page, so other option objects (and their bytes/keys) are unchanged.
  `previewOptionsKey` and the thumbnail rebuild key include the values; the
  `?printcolours` harness reads the same store values.
- **Continuous long harness pattern.** `printColoursPatterns.ts`'s `ColourPattern`
  gained an optional `labelType`; **"Grayscale — continuous 50×160"** sets
  `LabelType.Continuous`, keeps its 50×160 mm / 300 dpi geometry (the roll is
  continuous, the page length is not die-cut) and renames its label/doc name to
  say *continuous*. `PrintColoursSmoke` forwards that label type into
  `buildCsvPrintJob` overrides for the single print **and** the density sweep,
  and names it in the status line; every other pattern sends no label-type
  override.
- **Tests.** Pattern tests pin the continuous label type on the long pattern only
  (plus unchanged 50×160 geometry/dpi); `PrintColoursSmoke.test.tsx` pins that
  the override is forwarded only when the selected pattern carries it, for both
  the single print and the sweep.

## Defaults and why

| Setting | Default | Why |
| --- | --- | --- |
| `grayscaleTone` | **4/14** | Owner's density-3 print: 0–2 are paper white, 3 very faint, 15 merges into 14/13. Level 0 stays paper white (margins/highlights). |
| `redCoverageMin` / `Max` | **50/100** | Reproduces the P9 measured cluster set on the owner's red/black stock; a non-zero cell still inks ≥4/9. |
| `redIntensity` / `blackDepth` | **100 % / 50 %** | P9 starting profile; unchanged in P10. |

These are **per printer/paper/density** calibration values, not universal
constants. The sliders are the per-paper lever; code constants change only from
physical output.

## Debt parking

- **D-75 (grayscale dynamic range) — resolved in P10.** The usable band is a
  user control; the author limitation (hard-coded band) no longer exists. The
  shipped *default bounds* are still one stock's calibration.
- **D-78/D-79 — parked as calibration debt, not release blockers.** Red coverage
  floor and duotone constants are per printer/paper/density; defaults come from
  the owner's density-3 stock; retune from the `redBlackClusters*` /
  `redBlackHues` / step-bar prints.
- **D-73 (long grayscale buffer) — re-scoped, still open.** A 48×80 mm
  Floyd–Steinberg print stalled ≈0.5 s at the printer's buffer and **completed
  with no truncation**; `sixteenGrayMaxBuffer` is still unenforced upstream. The
  risk is flow-control stall, not corruption. Close only after a clean
  **50×160 continuous** print.

## Status

- Wave 1: `4144ec7` — `feat(print): make printable tone ranges adjustable per paper`.
- Wave 2 (uncommitted): harness continuous label type + debt/doc corrections
  (this plan, `tech-debt.md`, `print-colours.md`, `presets.md`, presets handoff,
  `P7-VERIFY.md`).
