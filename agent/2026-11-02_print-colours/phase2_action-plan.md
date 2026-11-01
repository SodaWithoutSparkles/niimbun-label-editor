# P2 — latent red bugs + pigment-safe helpers

Run: [`plan.md`](plan.md) §2 P2. Coordinator drives; `general` implements; `review` gates.
Prerequisite for any colour body text/images. Small and surgical.

## Goal

Make the post-quantize helpers safe once pixels are no longer R=G=B: red must count
as ink, invert must not turn red into cyan, and `SingleColorAlt` must fail loudly.

## In scope (files + exact changes)

1. **`src/editor/render/renderLabelPage.ts`**
   - `countInkPx` (`:659-666`): count a pixel as ink when it is **not paper-white**,
     i.e. `r !== 255 || g !== 255 || b !== 255` (alpha ignored). Rationale in the doc
     comment: after quantization every pixel is an exact palette colour — black,
     a grey ramp level, or `#ff0000` — and all of those deposit pigment, so the
     red-channel test was a mono-only artifact. Update the comment; **export** the
     helper (`export const countInkPx`) so the golden tests can call it.
   - `invertRgb` (`:623-635`): replace the per-channel `255 - v` with a
     **luminance inversion that preserves hue**:
     ```
     L = monoLuminance(r, g, b)          // import from core/render
     L === 0 → (255, 255, 255)
     else    → channel * ((255 - L) / L), written into the Uint8ClampedArray (auto-clamp/round)
     ```
     For neutral pixels this is exactly `255 - v` (existing mono goldens unchanged).
     For palette colours it is safe by construction: `#ff0000` (L ≈ 76) stays red
     (the scale pushes R past 255 and clamps), never cyan; black/white swap.
     Export it (`export const invertRgb`) for tests.
     Doc comment must state: (a) existing 1-bit behaviour is byte-identical, (b) the
     input domain is post-quantize palette colours, (c) why hue-preserving beats
     per-channel (cyan is not a printable ink), (d) the 16-level ramp property —
     inverting the band centre `255-17k` yields `17k`, which the encoder maps back to
     level `15-k`, so a grayscale negative is exact.
   - Update the pipeline doc block at the top (`:50-52`) if it says "flip every RGB
     channel".

2. **`src/print/printLabel.ts`**
   - Add an explicit guard next to the DoubleColor one (`:184-188`) rejecting
     `PageColorType.SingleColorAlt` with a `RangeError` whose message says it is
     **not implemented** (never silent mono-encode / late library throw). Keep the
     existing DoubleColor guard and message unchanged.
   - Update the two doc comments that describe invert as "flip every RGB channel"
     (`PrintOverrides.invert` at `:54`, and anywhere else in the file) to the
     luminance/hue-preserving wording.

3. **New `src/editor/render/renderLabelPage.pigment.test.ts`** (`@vitest-environment
   happy-dom`, same imports/shims style as `renderLabelPage.gamma.test.ts`) — the
   goldens below. Import `ImageEncoder` from `@mmote/niimbluelib` and
   `grayLevelColor` from `../../core/render`.

## Out of scope (do not touch)

- No wiring of grayscale/red modes (P3/P5), no dialog, no capability surface, no
  palette diffuser changes, no doc model, no i18n.
- Do not change quantize/policy/render dispatch; no new render options.
- Do not "improve" the DoubleColor guard — P5 owns allowing it.

## Tests (P2 exit criteria)

`renderLabelPage.pigment.test.ts`:

1. `countInkPx` counts black `(0,0,0)`, red `(255,0,0)`, a grey ramp level
   (`grayLevelColor(1)`), and ignores white `(255,255,255)` — build plain
   `RgbaBuffer`s.
2. `countInkPx` ignores alpha: a red pixel with alpha 0 still counts as ink, a white
   pixel with alpha 255 does not.
3. `invertRgb`: black → white, white → black, `128` grey → `127`, alpha bytes
   untouched.
4. `invertRgb`: `(255,0,0)` stays `(255,0,0)` and is **never** cyan
   `(0,255,255)`; a dark red `(128,0,0)` also stays in the red family (R = 255,
   G = B = 0).
5. **Grayscale ramp golden:** for every level `k = 0..15`, invert
   `grayLevelColor(k)` and feed the result to
   `ImageEncoder.colorToGrayLevel(v<<16 | v<<8 | v)`; expect exactly `15 - k`.
6. `invertRgb` is idempotent? **No** — do not test that (the scale is not an
   involution on clamped pixels). Skip.

`src/print/printLabel.test.ts` (extend):

7. `buildCsvPrintJob(..., { overrides: { pageColor: PageColorType.SingleColorAlt } })`
   throws `RangeError` mentioning "not implemented".
8. The existing DoubleColor rejection test still passes unchanged.

Also run the full render + print suites to prove the mono goldens are byte-identical
(the existing invert test at `renderLabelPage.test.ts:1174` is the regression proof).

## Verification commands

- `bun run test -- src/editor/render src/print` (or the repo-local equivalent in
  `state.md`).
- full `bun run test`; `tsc`.

## Exit criteria

- Helpers fixed + exported, guard added, goldens green, full suite green.
- Reviewer verdict from `review` (helper semantics are logic).
