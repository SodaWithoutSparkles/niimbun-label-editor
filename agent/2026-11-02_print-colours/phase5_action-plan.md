# P5 — red/black: colourspace + converter + dialog option

Run: [`plan.md`](plan.md) §2 P5. Two waves (`general` each); `review` gates.
Owner tape rule (§4): **one** hardware print in P7 — every pixel-path question is
settled here by goldens + preview ≡ print.

## Upstream check (done before planning, plan §4)

Verified against installed `@mmote/niimbluelib` 0.49.0
(`dist/cjs/packets/packet_generator.js`):

- `printBitmapRowWithColor` emits `[colorMode, 133, pos, repeats, data]`.
- `printBitmapRowDoubleColor` (command 138) emits
  `[BitmapColorMode.Mixed, pos, repeats, maskBytes…, colorBytes…]` and **still
  omits the 133 sub-command byte** — unchanged from 0.47.1.
- niim.blue 2026.9.0 ships dual-colour on this exact path (hardware mileage), so
  we **use it as-is** and pin the byte layout in our own test, so a future bump
  that changes it fails loudly. No local patching of the library.

## Converter model (decided here)

One engine (`diffuseToPalette`, P1) with a **per-pixel point-op mask** derived from
the existing per-object quantizer policies:

- Policies resolving to **`threshold`** (text / qr / barcode / code by default,
  shapes + uncovered pixels via the global slot) take the **flat** path:
  a per-pixel classifier straight to one exact palette entry, no error diffusion.
- Policies resolving to any **diffuser** (image → `floydSteinberg` by default)
  take the **vector diffusion** path through `redBlackPalette()`.
- `screentone` / `ostromoukhov` etc. are treated as diffusion in this mode
  (per-ink screentone is deferred; document it).
- No new policy vocabulary, no changes to `policyKeyOf`, no new per-type map:
  the existing type defaults already route flat art to `threshold` and images to
  diffusion, exactly as plan §1 requires.
- Diffuser knobs in red/black are the **page-level resolved options** (global
  `gamma`/`strength`/`serpentine`). Per-node knobs still select flat vs diffuse
  via the strategy, but their diffusion parameters are not applied in this mode
  (v1 simplification; recorded in state).

**Flat classifier** (`classifyFlatRedBlack(r, g, b, threshold, gamma)`):

1. **Red dominance first**: `r > g && r > b` → RED entry. This is colour-as-truth:
   any red-dominant authored pixel is red ink. (niim.blue's `thresholdRedBlack`
   classifier is this idea with a red threshold slider; ours has no slider —
   authored red is exact.)
2. Otherwise threshold **luminance** (gamma-curved): `L < threshold` → BLACK,
   else WHITE. This keeps black text crisp and mid-greys from becoming invisible
   (a plain nearest-RGB test maps mid-grey to white because white is closer than
   black in RGB — wrong).
3. Anti-aliased red glyph edges are red-dominant and stay red (crisp flat red).

The palette order is `[white, black, red]`; export the index constants and the
classifier from `core/render/palette.ts`.

## Wave A — engine flat mask + red/black render

### A1. `src/core/render/palette.ts` + `index.ts`

- `PaletteDiffuseOptions` gains:
  - `flat?: Uint8Array` — per-pixel flag (nonzero = point op). Length must equal
    `width * height`; otherwise `RangeError`.
  - `flatNearest?: (r, g, b) => number` — palette index for flat pixels; defaults
    to `nearestPaletteEntry`. Document that it receives the **source** RGB.
- In `diffuseToPalette`: for a flat pixel, classify from the **raw source bytes**
  (`data[p*4…]`, not yet written), write that entry, **do not** distribute error;
  any error a diffuse neighbour deposited on the working plane for that pixel is
  discarded (energy lost at the seam, consistent with clipping).
- Export `RED_BLACK_WHITE = 0`, `RED_BLACK_BLACK = 1`, `RED_BLACK_RED = 2`, and
  `classifyFlatRedBlack(r, g, b, threshold = 128, gamma = 1)` implementing the
  model above (gamma via `buildToneLut`/`toByte`; red dominance is
  gamma-independent).
- Doc comment: flat pixels exist for authored flat colour (text/symbols) while
  images diffuse; `policyKeyOf` is unchanged (colour is keyed via masks already).

### A2. `src/editor/render/renderLabelPage.ts`

- Replace the `'redBlack'` throw with the real branch:
  1. Build the policy mask exactly as mono does (`buildPolicyMask`).
  2. Build `flatBySlot: boolean[]` with index `0` = the global strategy
     (`(opts.quantizer ?? 'threshold') === 'threshold'`) and every policy slot =
     `policy.quantizer === QUANTIZERS.threshold`.
  3. Build `flat: Uint8Array(w*h)` from `policy.mask.data` (uncovered = slot 0).
  4. `diffuseToPalette(imageData, redBlackPalette(), { gamma/strength/serpentine
     from buildQuantizeOptions, flat, flatNearest: (r,g,b) =>
     classifyFlatRedBlack(r, g, b, resolvedThreshold, resolvedGamma) })`.
     `resolvedThreshold` = `buildQuantizeOptions(...).threshold ?? 128`.
  5. Keep `policyOverflowCount` in the result (the mask exists).
- Region clip → convert → invert → mirror → clip → offset order unchanged.
- Update the pipeline doc block and the `pageColor` option doc (no longer a
  placeholder).
- The output contains **exact** palette entries `#ffffff` / `#000000` / `#ff0000`
  — the encoder's DoubleColor split depends on exact `0xff0000`.

### A3. Tests (wave A)

New `src/editor/render/renderLabelPage.redBlack.test.ts`
(`@vitest-environment happy-dom`, `installCanvasShim`, small fixtures like the
grayscale suite):

1. **Flat red text**: a text node with `fill: '#ff0000'` renders only exact
   `(255,0,0)` glyph pixels + white background; **no black** pixels anywhere.
2. **Flat black text**: default text renders exact black/white only.
3. **Mid-grey flat text**: `fill: '#808080'` under `threshold` renders
   **white** (luminance 128 is not `< 128`), never dithered black/red.
4. **Image dithers**: a mid-grey image leaf (injected `resolveImage`) under the
   default image policy produces **both** black and white pixels (diffusion ran),
   and contains no red.
5. **Red-tinted image**: the same asset with `tint: '#ff0000'` produces **both
   red and white** pixels and **no black** (the P4 tint + P5 palette payoff).
6. **Flat red shape**: a rect `fill:'#ff0000'` (global slot, threshold) is solid
   red; a black rect is solid black.
7. **Exact channel contract**: every output pixel's RGB is exactly one of
   `#ffffff`, `#000000`, `#ff0000` (the encoder depends on it).
8. **Policy overflow**: >8 distinct policies still falls back to the global slot
   and reports `policyOverflowCount` (reuse the mask suite idiom; keep it cheap).
9. **Mono + grayscale unchanged**: same doc rendered mono is still 1-bit and
   grayscale still 16-level (smoke, one assertion each).

Extend `src/core/render/palette.test.ts`:
10. `classifyFlatRedBlack`: `#ff0000` → RED; `#800000` → RED; `#000000` → BLACK;
    `#ffffff` → WHITE; `#808080` → WHITE; `#7f7f7f` → BLACK; gamma > 1 can move a
    mid grey across the cutoff; red dominance wins even at high luminance
    (`#ff4040` → RED) and low luminance (`#400000` → RED).
11. Flat mask: a half-flat/half-diffuse buffer produces no dither in the flat
    half and dither in the diffuse half; error from the diffuse side does not
    move a flat pixel; flatNearest receives the raw source (not error-corrected);
    wrong-length `flat` throws.

## Wave B — print guard + dialog + packet golden

### B1. `src/print/printLabel.ts`

- Remove the `DoubleColor` rejection (keep `SingleColorAlt` rejected). Update the
  comment: DoubleColor is now implemented by the red/black render path; the
  library validates task capability and `pageColor === image.pageColor`.
- `pageColorModeOf` already maps `DoubleColor → 'redBlack'`; `renderOptionsOf`
  already forwards non-mono modes. No other change.

### B2. `src/components/print/PrintDialog.tsx` + `en.json`

- `redBlackSupported = capabilities?.doubleColor === true`.
- Add a third option to the page-colour `Select`:
  `{ value: 'double', label: t('print.pageColorDouble'), disabled: !redBlackSupported }`.
- `value` mapping: `DoubleColor → 'double'`, `Grayscale → 'grayscale'`, else `'mono'`;
  `onChange` maps back to `PageColorType`.
- `thumbnailOverrides` already carries `pageColorModeOf(pageColor)`; the state is
  already in `printOverrides`; nothing else to thread.
- i18n: `print.pageColorDouble` = `"Red & black"` (one writer).
- P6 owns the final explanatory copy / warning centre; keep this minimal.

### B3. Packet golden (new `src/print/printLabel.doubleColor.test.ts`)

- Pin the 0.49 encoder + packet contract we depend on:
  1. `ImageEncoder.encodeCanvas(canvas, PageColorType.DoubleColor, 'top')` on a
     canvas with white/black/red pixels: red pixels land in `rowDataRed`, black in
     `rowDataBlack`, white in neither; `pageColor` is `DoubleColor`.
  2. `PacketGenerator.printBitmapRowDoubleColor(black, red, pos, repeats, cols)`
     data is exactly `[BitmapColorMode.Mixed, pos lo, pos hi, repeats, mask…,
     colour…]` — **pin the absence of the 133 byte** with a comment saying this is
     the hardware-proven niim.blue path and that a dependency bump must re-check
     it.
  3. A built job (`overrides.pageColor = DoubleColor`, real render seam) yields
     `job.pageColor === page.data.pageColor === DoubleColor` and the encoded
     planes carry red.
- Existing DoubleColor rejection test must be **removed or inverted** to assert
  acceptance; SingleColorAlt rejection stays.

### B4. Dialog tests

- With `capabilities.doubleColor === true`, selecting "Red & black" puts
  `PageColorType.DoubleColor` in the job overrides and `pageColor: 'redBlack'` in
  the render options (preview/thumbnails).
- With `doubleColor: false`/absent the option is disabled and the value stays Mono.

## Out of scope

- No paper-type colourspace hints, RFID guesses, or seeded paper types.
- No per-ink screentone, no per-node diffusion params in red/black (page-level
  only; documented simplification).
- No shared-selector unification/explanations/warnings (P6).
- No calibration-strip UI (P7 builds the pattern); `classifyFlatRedBlack` is the
  exported flat path it can use.
- No hardware work.

## Exit criteria

- Red/black renders exact `#ffffff`/`#000000`/`#ff0000`, flat art crisp, images
  dithered; tinted greys become single-ink dots.
- DoubleColor job accepted and capability-gated in the dialog; packet layout
  pinned.
- `tsc` clean; full suite green; `review` PASS.
