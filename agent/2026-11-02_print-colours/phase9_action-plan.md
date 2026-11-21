# P9 — photo-quality fix: scalar grayscale + duotone red/black

## Status (2026-11-09)

- **Wave A shipped** — `fix(print): diffuse grayscale pages on a scalar luminance plane`.
- **Wave B shipped** — `feat(print): separate red/black photos into clustered red and black inks`.
- **Wave C shipped, split in two** — C1 sliders:
  `feat(print): expose red/black tuning sliders`; C2 harness + docs:
  `feat(dev): add red/black cluster and tone calibration patterns`, then this
  docs/memory promotion (what shipped is recorded in
  [`../memory/print-colours.md`](../memory/print-colours.md)).
- **Deliberate deviation from the first model:** black generation is **BT.601
  darkness − red ink darkness** (`RED_INK_LUMA 0.30`), not the OKLab `L` + soft
  curve. The OKLab attempt printed neutrals ~30 % too light on the real photo
  and was rejected after measurement.
- **Owner hardware verification pending:** the constants are a starting profile;
  the P9 addendum in [`P7-VERIFY.md`](P7-VERIFY.md) decides them.

Follow-up to P1–P8 after the owner rendered a real photo (red crab, dark bokeh)
through both non-mono modes. Both modes are broken for photos; the diagnosis is
reproduced offline and the fix designs are owner-approved (2026-11-08).

Repro: source `references/tmp/crabrave.png` (450×270), raster 591×354
(50×30 mm @ 300 dpi). Scratch harness (gitignored): `references/tmp/repro.mjs`,
outputs `repro-current-*.png` / `repro-scalar-*.png`.

## Diagnosis (do not re-derive)

**Grayscale.** The page runs Floyd–Steinberg on three **RGB** error planes, but
the 16-level palette chooses by **luminance only** (`grayscaleRampPalette.nearest`).
Chroma error has no sink: for every saturated red pixel the residual is
`(+R, −G, −B)`, the three planes clip against 0/255 and luminance collapses to
~76 → level 10. The crab and the rock become one flat dark blob. Measured source
histogram: 55 % of pixels sit in levels 10–13, so colour loss is compounded by a
palette with no room.
Non-goal: this is not a tone-curve problem. Diffusing **one scalar luminance
plane** fixes it with the same palette and the same encoder contract.

**Red/black.** Two independent defects:
1. The 3-entry palette uses unweighted squared RGB distance, so a light-pink
   highlight is closer to white than red — red identity is tied to darkness.
2. RGB-vector diffusion over a mutually exclusive 3-colour palette produces dense
   red+black+white speckle, and red has no minimum-coverage rule despite the
   measured ~50 % development floor (D-78).

## Decisions

- **Grayscale:** scalar-luminance FS. BT.601 weights (matches the encoder's
  `colorToGrayLevel`), no auto-levels, no new UI. Global gamma stays the tone knob
  via `quantizerDefaults`.
- **Red/black:** replace the palette quantizer for photos with a **two-plane
  duotone separation**:
  - red ink = hue-selective spot separation, **clustered** so local coverage
    never falls below the physical floor;
  - black ink = tonal separation diffused on the free dots;
  - red wins; black fills the remaining dots; masks are exclusive by construction;
  - authored flat art keeps today's `classifyFlatRedBlack` point op (no dither).
- **Two page-level sliders:** *Red intensity* (0–150 %, default 100 %) and
  *Black depth* (0–100 %, default 50 %). Persisted global settings (same pattern
  as `quantizerDefaults`), shown in the print dialog only for Red & black, and
  threaded to preview, thumbnails and job (invariant 7). They act on the
  separation **targets before quantisation**, so they can never break the red
  floor (`ρ = 0` stays 0, black only takes from red).
- Defaults below are a **starting profile**, not calibrated truth. The owner runs
  one calibration print (wave C) before any constant is "final".

## Separation model (start values)

Per pixel, sRGB → OKLab (input is sRGB; alpha already composited by rasterize):

- `L` = OKLab lightness; `a,b` = OKLab chroma axes; `C = hypot(a,b)`.
- **Redness gate** (continuous, no atan2): project `(a,b)` on the red axis at
  29°: `along = a·cos29 + b·sin29`, `across = |−a·sin29 + b·cos29|`,
  `hueRatio = across / max(along, 1e-6)`; `gate = along ≤ 0 ? 0 :
  1 − smoothstep(tan15°, tan34°, hueRatio)`.
- `chromaGate = smoothstep(0.015, 0.060, C)`; `redTone = smoothstep(0.015, 0.180, C)`.
- `ρ = clamp01(redGain · gate · chromaGate) · redTone-ish` — exact composition:
  `ρ = clamp01(redGain * hueGate * chromaGate * redTone)` (multiply both chroma
  curves; they are not redundant: one gates near-neutrals, one maps saturation).
  - `chromaGate = smoothstep(0.015, 0.060, C)` (near-neutral guard);
  - `redTone = smoothstep(0.015, 0.180, C)`;
  - `ρ = clamp01(redGain · hueGate · chromaGate · redTone)`.
- `redGain = 2^(2·(redIntensity − 1))`, clamped so `0 → 0`, `1.5 → ×2`.
- **Black is a BT.601 darkness separation, consistent with mono/grayscale**
  (the first attempt used OKLab `L` + a soft curve and printed neutrals ~30 %
  too light on the real photo — rejected after measurement):
  - `Y = monoLuminance(r,g,b) / 255`;
  - `darkness = clamp01((1 − Y − 0.04) / 0.96)` (white-speckle clip);
  - red ink already supplies darkness, so
    `k = clamp01(darkness − RED_INK_DARKNESS · ρ)` with
    `RED_INK_DARKNESS = 1 − RED_INK_LUMA`, `RED_INK_LUMA = 0.30`
    (printed red's BT.601 luma — calibrate after a print);
  - black slider: `k = clamp01(k · blackGain)`,
    `blackGain = 2^(2·(blackDepth − 0.5))` (0.5 → ×1, 0 → ×0.5, 1 → ×2).
- Separation (redIntensity 1, blackDepth 0.5):
  - bright red (200,40,30): `ρ=1, k=0` → solid red.
  - pink (230,150,140): `ρ=0.508, k=0` → 50 % red clusters.
  - dark red (90,20,15): `ρ=0.546, k=0.453` → red + black.
  - green (40,60,30): `ρ=0, k=0.793` → black only.
  - brown (140,110,80): `ρ=0` (hue ≈ 66°), `k=0.528` → mid-grey (mono-consistent).
  - paper (250,250,240): `0/0` → white.
  - orange (255,140,0): `ρ=0.191, k=0.219` → dark orange (partial red).

### Red halftone (clustered, floor-safe)

- Cell = **3×3 dots** (0.254 mm @ 300 dpi); cell grid anchored at the raster
  origin (the later D-77 head crop is left-aligned and runs after this pass — only
  the far edge can clip a cell; do not reorder the pipeline).
- Allowed cell levels: `0, 5/9, 6/9, 7/9, 8/9, 9/9` — **no non-zero level below
  5/9**.
- Dots are selected by **connected growth**, not a fixed prefix: start from the
  centre-most available dot, then repeatedly add the highest-priority available
  dot orthogonally adjacent to an already-selected dot. Target count
  `min(n, max(4, ceil(n/2), round(level·n)))` where `n` = in-bounds, non-flat dots.
  A cell that cannot reach **4 connected dots is suppressed entirely** — one or
  two isolated dots do not develop (D-78) and flat art must not be bridged.
  On full cells this still yields the centre plus-shape then the four corners.
- Serpentine FS **at cell resolution** on the cell-mean red demand: choose the
  nearest allowed level, then diffuse the **realized** residual
  (`raw = mean + error; level = nearest(clamp01(raw)); realized = inked / n;
  error = raw − realized`) to neighbouring cells. Covered cells whose 4-dot
  floor over-inks therefore pay the excess back instead of banking it. Only a
  cell that inks its target diffuses; a cell that grows ≥4 but stalls short of
  its target keeps the ink and drops the residual (the missing dots are not
  there to receive error later). Cells with fewer than 4 available dots, and
  cells whose available dots contain no connected cluster of 4 (growth stalls
  below 4), are suppressed and drop their residual entirely (intentional
  edge/flat-art drop: forwarding their demand would paint red into unrelated
  flat areas or a stripe along the raster edge). Low average red → fewer
  activated cells, never sparse dots.
- Partial/flat-perforated cells use the same connected growth, so an activated
  cluster is always connected whatever the available dots.

### Black halftone

- Dot-level serpentine FS on the black demand.
- Red dots are forbidden: error is renormalised onto available forward neighbours
  (weights rescaled to sum 1); if none exist, drop the residual.
- Per cell, rescale demand by `1 / (1 − realisedRedFraction)` so free dots carry
  the tone (e.g. 5 red + 4 free, demand 0.42 → 0.94 on free dots).
- Residuals are computed from the **unclamped** accumulated value
  (`raw = demand + error; bit = clamp01(raw) ≥ 0.5; error = raw − bit`) so
  diffusion conserves tone at cluster seams.
- Demands are stored as one byte per pixel (`Uint8ClampedArray`, 1/255
  resolution) instead of Float32: with masks and the Float32 black error plane
  that keeps the engine at ~8 bytes/px, below the removed palette engine.

### Output contract

- Red dot → exact `#ff0000`; black dot → `#000000`; free → `#ffffff`.
- Assert `red ∧ black = 0` at the end of every pass.
- The encoder split (`#ff0000` → red plane, non-white → black plane) is unchanged;
  internal fuzz would print black, so no intermediate greys are allowed.

## Wave A — grayscale scalar fix (`core/render`)

1. Add `diffuseRamp(rgba, palette, { gamma, strength, serpentine })` in
   `src/core/render/palette.ts` (or a new `ramp.ts` if it keeps the file clean):
   - copy BT.601 luminance into one `Float32Array`; gamma LUT applied to the
     scalar (`L' = lut[toByte(L)]`); serpentine FS in the scalar plane; write the
     chosen entry's exact bytes; `strength 0` = nearest.
   - reuse `grayscaleRampPalette` entries + its `nearest`; the level is chosen
     from the accumulated scalar (no channel clamping, no chroma sink).
2. `renderLabelPage` grayscale branch calls `diffuseRamp` instead of
   `diffuseToPalette`.
3. Keep `diffuseToPalette` **only if** wave B leaves it unused; otherwise delete
   it and its tests (no dead engine).
4. Regression tests:
   - a 96×48 saturated-red field `(200,40,30)`: every interior pixel is the same
     level `round((1 − L/255)·15)` — the old path drifted/clipped;
   - red block beside a green block: both interiors keep their own level, no
     boundary darkening;
   - all existing grayscale visibility/encoder tests still pass unchanged.
5. Repro check: rerun `references/tmp/repro.mjs`'s scalar variant against the real
   renderer output at 591×354 and eyeball `references/tmp/repro-scalar-bt601.png`.

## Wave B — duotone red/black engine (`core/render/duotone.ts`)

1. New pure module exporting `separateRedBlack(rgba, options): RgbaBuffer`
   (in place, like the other engines) with the model above, `oklab()` +
   `redness()` internal, no DOM.
2. `renderLabelPage` red/black branch: build the policy mask exactly as today,
   then one `separateRedBlack` pass with `flat` + `classifyFlatRedBlack`;
   drop the `flatBySlot`/`diffuseToPalette` path. `policyOverflowCount` stays.
3. Determinism: no `Math.random`; fixed corner order; corner order may be
   coordinate-hashed but must be a pure function of `(x, y)`.
4. Perf guard: direct OKLab math is fine at normal label sizes (< 2 M px). If a
   render exceeds `MAX_RASTER_PIXELS` budget times out, add a cached 33³ RGB LUT
   (do not pre-build it now).
5. Tests (`duotone.test.ts` + rewritten `renderLabelPage.redBlack.test.ts`):
   - separation table: the six sample colours land in the expected demand bands;
   - hue gates: green/brown/blue sweeps produce **zero** red; orange is partial;
   - cluster invariant: every activated 3×3 cell has ≥ 5 red dots and every red
     dot has an orthogonal red neighbour (no isolated dot);
   - exclusivity: `red ∧ black = 0` for a photo-like fixture;
   - sliders: red 0 → no red; red 1.5 monotonic vs 1.0; black 0 → no black;
   - flat mask: authored red text stays solid exact red, black text exact black;
   - output bytes: only the three exact colours; encoder split pinned packets
     still pass;
   - determinism: two runs byte-identical.
6. Old palette-engine red/black tests are replaced (do not keep a dead path).

## Wave C — knobs, harness, docs

1. Store: `redBlackSettings: { redIntensity, blackDepth }` in the preference
   slice (defaults `1`, `0.5`), `setRedBlackSettings`, validation clamps
   (`redIntensity 0..1.5`, `blackDepth 0..1`, non-finite → default), persisted and
   picked by `pickPersistedKeys`. Never document data.
2. Render plumbing: `RenderLabelPageOptions.redBlack?: { redIntensity,
   blackDepth }`; `PrintOverrides.redBlack`; `renderOptionsOf` forwards it only
   when defined **and** the page is red/black; `previewOptionsKey` appends it;
   `PrintThumbnailOverrides` forwards it + content key.
3. Print dialog: two `SettingRow` sliders/range inputs under the page-colour row,
   rendered **only** when `pageColor === DoubleColor` and the capability is
   supported. Labels `print.redIntensity` / `print.blackDepth`, descriptions
   `print.redIntensityHint` / `print.blackDepthHint`, defaults shown. Wire into
   `printOverrides`, `thumbnailOverrides`, `previewRenderOptions`; deps updated.
4. i18n `src/i18n/locales/en.json` (one writer).
5. Harness `?printcolours` + `printColoursPatterns.ts`:
   - red cluster/coverage ladder: 25/40/50/55.6/66.7/77.8/88.9/100 % at 2×2,
     3×3, 4×4, 6×6 footprints;
   - hue/chroma ladder from the six sample colours + red→brown and pink→white
     ramps;
   - highlight pinks at L 0.6–0.95;
   - black ramp + mixed red/black cells + fine lines/text/QR/barcode.
   Pattern tests pin the generated docs (like the existing harness tests).
6. Docs/memory: `print-colours.md` (engine replaced, new knobs, calibration
   pending), `dithering.md` §11, `grayscale.md` pointer, `tech-debt.md` (D-78
   clustering rationale, D-75 still open), `P7-VERIFY.md` new rows/checklist.
7. Owner verification: one calibration print, then tune the start constants
   (hue width, chroma curves, cell size, level set, black curve). Record the
   density/result in `P7-VERIFY.md`. Only after that are these numbers "calibrated".

## Invariants

- Mono path byte-identical; grayscale preview ≡ print (neutral band-centre greys);
  red/black output exactly `#ffffff/#000000/#ff0000`; preview/thumbnail/job use
  the same options (invariant 7); authored flat art unchanged.
- No new dependency. Core stays DOM-free; `print/` never imports `store/`.
- Layer contract unchanged; new pure modules in `src/core/render/`.

## Verification (this WSL checkout)

`node_modules` holds Windows natives, so Linux node cannot run rolldown/napi:

```
node.exe node_modules/typescript/bin/tsc
node.exe node_modules/vitest/vitest.mjs run <paths>
```

Never `bunx`/`npx`; never `git stash`. Physical output is the only proof for the
separation constants — do not tune from the preview.

## Out of scope

- Grayscale dynamic-range mapping (D-75) and any grayscale UI.
- Angled/blue-noise red screens, per-ink screentone (the old palette-weight hook was
  removed with the palette engine).
- Library Mixed-row fix (D-77 stays clamped) and paper RFID hints.
- Batch/CSV changes beyond option threading.
