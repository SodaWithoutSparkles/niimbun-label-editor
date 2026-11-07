# P1 — palette diffusion engine (core)

Run: [`plan.md`](plan.md) §2 P1. Coordinator drives; `general` implements; `review` gates.
Owner call §0.1: **full 16-level diffusion in this run**, one engine shared with red/black.
This phase is **additive only** — no wiring, no render/print/UI changes.

## Goal

A pure, headless, serpentine **vector error-diffusion** engine in
`src/core/render/palette.ts` that maps tone-mapped RGBA onto an N-entry palette
(each entry = exact output RGB + optional calibration distance), plus the two
palettes this run needs:

- `grayscaleRampPalette()` — 16 neutral greys whose values map **exactly** back to
  the library's `ImageEncoder.colorToGrayLevel` bands (0 = white … 15 = black).
- `redBlackPalette()` — `{white, black, red}`, constructed here so P5 only wires it.

Existing 1-bit strategies and goldens must stay **byte-identical** (regression proof).

## Why these exact numbers (do not "improve" them)

- Library (0.49, `dist/cjs/utils/image_encoder.js:59-66`):
  `level = clamp(round((1 - (0.299r + 0.587g + 0.114b)/255) * 15), 0, 15)`, 0 = white.
- A neutral grey `g` has luminance `g`, so `level = round(15*(1-g/255))`.
  The centre of level `k`'s band is therefore **`g = 255 - 17k`** (exact, no
  rounding slack). `grayLevelColor(k)` returns `255 - 17*k`.
- Nearest-entry for the grayscale palette must use **BT.601 luminance**, not RGB
  Euclidean distance: the squared-distance nearest grey is the channel *mean*
  (`(r+g+b)/3`), which disagrees with the encoder's luminance and would make
  preview ≠ print on coloured input.

## In scope (files + exact changes)

1. **New `src/core/render/palette.ts`** (pure; imports only from `colorspace` /
   `preprocess`; no DOM, no store).

   Public surface (names are a contract for P3/P5 — keep them):

   ```ts
   export interface PaletteEntry {
       readonly r: number;
       readonly g: number;
       readonly b: number;
       /** Calibration weight on the squared channel distance; default 1. */
       readonly weight?: number;
   }

   export interface Palette {
       readonly id: string;
       readonly entries: readonly PaletteEntry[];
       /** Closest entry for a (possibly float, possibly out-of-range) source
        *  pixel. Defaults to weighted squared RGB distance. */
       readonly nearest?: (r: number, g: number, b: number) => number;
   }

   export interface PaletteDiffuseOptions {
       /** 0 → nearest without diffusion; 1 → standard; >1 stronger. Default 1. */
       strength?: number;
       /** Serpentine scanning. Default true. */
       serpentine?: boolean;
       /** Tone curve on **luminance**, hue-preserving; neutral 1. Default 1. */
       gamma?: number;
   }

   export const grayLevelColor = (level: number): number;      // 255 - 17*level
   export const GRAYSCALE_LEVELS = 16;
   export const grayscaleRampPalette = (): Palette;
   export const redBlackPalette = (): Palette;
   export const nearestPaletteEntry = (palette: Palette, r: number, g: number, b: number): number;
   export const diffuseToPalette = (
       rgba: RgbaBuffer,
       palette: Palette,
       options?: PaletteDiffuseOptions,
   ): RgbaBuffer;   // mutates in place, returns the same buffer
   ```

   Behaviour contract:
   - **Tone map first** (when `gamma !== 1`): compute `L = monoLuminance(r,g,b)`,
     `L' = toneLut[toByte(L)]` (`buildToneLut` from `preprocess.ts`), scale all
     three channels by `L'/L` (clamp to `0..255`), leave `L === 0` black. Document
     why (hue preservation; endpoints 0 and 255 are fixed, so flat authored
     colours are untouched by the curve).
   - **Working planes are floats** (accumulated error may leave `0..255`); the
     nearest-entry test clamps the probe to `0..255` before measuring.
   - **Serpentine Floyd–Steinberg** (`7/16` current-row forward, `3/16`+`5/16`+`1/16`
     next row). Mirror the taps on reverse rows. Drop out-of-raster taps.
     `strength` scales the error **before** distribution (clamped `>= 0`); `0`
     degenerates to a pure nearest-colour point op.
   - **Error is a full RGB vector** `source - entry`; distribute it to all three
     channel planes. This is the "one error channel" CTO call in the plan — do not
     split into two scalar diffusions.
   - **Write the chosen entry's exact integers** to RGB; **preserve alpha**.
   - Grayscale palette `nearest`: `clamp(round((1 - L/255)*15), 0, 15)` — the
     library formula, mirrored; index == level (entries ordered 0=white → 15=black).
   - Red/black palette entries ordered `[white, black, red]`; default weighted
     squared RGB distance. Doc comment: thermal red is **heat-selected, not
     pigment**, so a red dot is not as dark as a black dot — these distances are
     **calibration values**, verified by the P7 test pattern. Add the `weight` field
     as the calibration hook; default `1` everywhere (no hand-tuned constants).
   - **D-05 note** (plan §4): a doc comment must state that cross-policy seam drift
     now also applies to colour palettes; do **not** fix it here.
   - Memory: three `Float32Array(width*height)` working planes. Add a doc note that
     this is ~12 bytes/px on top of the RGBA buffer (16 M px cap ⇒ heavy; the
     buffer/long-label risk is already tracked by the run).

2. **`src/core/render/index.ts`** — re-export the new surface (types + functions
   above). Alphabetical within the existing style.

3. **New `src/core/render/palette.test.ts`** — tests below. Import
   `ImageEncoder` from `@mmote/niimbluelib` for the band-parity test only.

## Explicitly out of scope (do not touch)

- `quantize.ts`, `pipeline.ts`, `policy.ts`, `screentone.ts` — no changes at all.
- `renderLabelPage.ts`, `pipeline` wiring, `printLabel.ts`, `niimbotAdapter.ts`,
  `PrintDialog.tsx`, doc model, i18n — later phases.
- No new quantizer id in `QUANTIZERS`; no `QuantizerId` widening; no settings.
- No per-object policy integration (P3/P5).
- No tuning constants ("make red darker") — calibration happens on hardware in P7.

## Tests (P1 exit criteria)

`src/core/render/palette.test.ts`:

1. **Band parity**: for `k = 0..15`, `ImageEncoder.colorToGrayLevel(c<<16|c<<8|c)` with
   `c = grayLevelColor(k)` returns exactly `k` (pins 0=white / 15=black and the
   `255-17k` centres).
2. **Ramp shape**: 16 neutral entries `r===g===b`, strictly descending, white at 0,
   black at 15.
3. **Point op (`strength: 0`)**: a 4-px canvas holding exact palette colours
   (white, black, red) under `redBlackPalette()` is unchanged, alpha preserved.
4. **Grayscale flat greys**: a uniform patch of a band-centre grey prints as that
   single level everywhere (no dither noise on an exact palette value).
5. **Tone conservation**: a uniform mid grey (`128`) diffuses into **both** adjacent
   levels and the mean luminance of the output is within ±2 of the input mean
   (error diffusion conserves tone; pins the kernel normalisation).
6. **No out-of-palette pixels**: every output pixel of any test equals one of the
   palette entry RGBs exactly.
7. **Red/black mix**: a dark red patch (e.g. `128,0,0` area) or a red→black gradient
   contains **both** black and red output pixels (proves vector mixing, not a
   threshold classifier).
8. **Flat red exact**: solid `255,0,0` under `redBlackPalette()` stays all red
   (no black speckle) — the P5 flat-text path depends on this.
9. **Serpentine**: same input, `serpentine: true` vs `false` produce different
   rasters; each is deterministic (render twice ⇒ identical bytes).
10. **Gamma**: at `gamma > 1` an output's mean luminance increases versus gamma 1
    (tone curve applied on luminance), and flat `0`/`255` endpoints are unchanged.
11. **Alpha preserved**: alpha bytes are untouched by the pass.

## Verification commands

- `tsc` (repo root, bare).
- `bun run test -- src/core/render` then the full `bun run test` (goldens must stay
  green — this phase touched no existing engine file, so any failure is a bug).

## Exit criteria

- New module + tests land; `tsc` clean; full suite green.
- No existing file modified except `src/core/render/index.ts`.
- Reviewer verdict `review` (logic-heavy core).
