# P4 action plan — head-locked screentone

- Parent plan: [`plan.md`](plan.md) §P4. Status: **DONE** (2026-10-20) — reviewed, committed.
- Design source: [`memory/screenstyle-quantization.md`](../memory/screenstyle-quantization.md) §4 + §4a
  (read; do not re-derive). Algorithm: projected grey → tone chain (P1) → `K`-level index → one
  precomputed **clustered-dot rank** table indexed by lattice cell coordinates. A stateless point op,
  O(1)/px, no error buffer, **cheaper than Floyd–Steinberg**, and immune to the cross-policy seam
  problem (D-05) like `threshold`.

## Settled open questions (parent plan §Open questions 1 + 8)

1. **Defaults:** `levels = 4`, `pitch = 0.5 mm`, `angle = 45°` (basis `(1,1)`).
   Defaults live in `core/render/policy.ts` beside `DEFAULT_GAMMA_BY_STRATEGY` (compile-enforced
   map), never in the engine (engine stays neutral, like gamma).
2. **No default for symbol/text types.** `DEFAULT_POLICY_BY_TYPE` is untouched; screentone is
   opt-in per object (or a per-type setting the owner sets explicitly). R10.
3. **`strength` is inert** — hide it for this id in the inspector and in Rendering; never accept a
   dead knob silently. `gamma` stays (a tone curve before the level index is meaningful; default 1).
4. **Tone-stability median filter: deferred** (revisit after the owner's first screentone test print).
5. **`dpi` becomes a quantizer input.** The pitch can only be snapped at the raster dpi, and the
   render path already knows it. Add `QuantizeOptions.dpi` (threaded by `buildQuantizeOptions` from
   the effective render dpi), **required for screentone** — missing/non-finite ⇒ a clear
   `RangeError` (head-locked or nothing; never silently un-head-locked).

## Algorithm (exact, deterministic)

**Params** (`QuantizeOptions`, flat names, document-visible):
`screentoneLevels` (int 2..8), `screentonePitchMm` (number, clamp 0.3..2.0), `screentoneAngle`
(`0 | 14 | 27 | 45`).

**Angle → integer lattice basis** (`|basis| = √(a²+b²)`, no trigonometry, exact periodicity):
| angle | basis `(a,b)` | |basis| | note |
|---|---|---|---|
| 0° | (1,0) | 1 | axis-aligned |
| 14° | (4,1) | √17 ≈ 4.123 | classic 15° screen |
| 27° | (2,1) | √5 ≈ 2.236 | 26.565° |
| 45° | (1,1) | √2 ≈ 1.414 | classic 45° |

**Pitch snapping (physical, per render dpi):** `dotsPerMm = dpi / 25.4`;
`step = max(1, round(pitchMm * dotsPerMm / |basis|))`; actual period `P = step * |basis|` **dots**,
actual `pitchMm = P * 25.4 / dpi`. Snap **up** to the first step that keeps `pitchMm ≥ 0.4` (the
advisory floor) — never below it. Expose both numbers in the UI: `"0.51 mm — 6 dots @ 300 dpi"`
(`dots` is `round(P)`; for rotated bases show one decimal, e.g. `8.5 dots`). Verified table
(§4a): 300 dpi → 5/6/8/12 dots = 0.423/0.508/0.677/1.016 mm; 203 dpi → 4/6/8 =
0.500/0.751/1.001 mm. These must come out of the snap function for the 0° basis exactly (pin as a
test).

**Cell coordinates:** for pixel `(x, y)`, with `S = step * (a² + b²)`,
`u = (a*x + b*y) / S`, `v = (-b*x + a*y) / S`; take `cu = frac(u)`, `cv = frac(v)`.
All integer numerators — exact, no accumulated float drift across the raster.

**Rank table:** one precomputed `Uint8Array(R*R)` (`R = 64`), indexed by
`(round(cv*R) % R) * R + (round(cu*R) % R)`, constructed deterministically at module load:
Euclidean distance from the cell centre (wrap-aware), normalised to `[0,1)`, bucketed into
`0 .. K-2` where the bucket edges come from the **maximum K** (8) so the same table serves every
`levels` value: `rank = min(K-2, floor(dNorm * (MAX_LEVELS-1)))`. Per pixel:
`ink = rank < level`, `level = round((1 - grey/255) * (levels - 1))` (0 = paper, `levels-1` = solid
ink). `grey` is the **preprocessed** plane from P1 (`projectGrey` + `preprocessGrey`), so the tone
curve applies.
> Deviation to record: the design note says `rank[(u,v) mod P]` (pixel-space table). The lattice
> form is the same clustered-dot idea and is the only form that stays exact for rotated bases; pin
> it with a golden plane instead of a pixel-space table.

**Contract:** same `Quantizer` shape `(rgba, opts) => rgba`, in-place, pure, deterministic; ignores
`threshold`, `strength`, `serpentine`; writes exact `0`/`255`; preserves alpha.

## Wiring (names corrected to the code — the plan's list)

- `core/render/quantize.ts`: `QuantizeOptions` (+ `screentoneLevels`, `screentonePitchMm`,
  `screentoneAngle`, `dpi`), `QuantizerId` (+ `'screentone'`), `QuantizerDefaultParams` (the three
  knobs), `QUANTIZERS`.
- New `core/render/screentone.ts` (engine + table + snap helper) — keeps `quantize.ts` from growing
  and makes the table unit-testable. Export `screentoneSnap(pitchMm, angle, dpi) → { dots, pitchMm,
  step, basis }` for the UI readout.
- `core/render/policy.ts`: `DEFAULT_SCREENTONE` (levels/pitch/angle), `DEFAULT_GAMMA_BY_STRATEGY`
  (+ `screentone: 1`), `PolicyParams`/`ResolvedPolicyParams` (+ the three), `resolveQuantizerParams`
  (+ node → strategy setting → `DEFAULT_SCREENTONE`), `policyKeyOf` (**+ all three**, angle by the
  basis id, pitch by `2dp` mm).
- `editor/render/renderLabelPage.ts`: `buildQuantizeOptions` sets `dpi` (the effective render dpi)
  on the global base; `buildPolicyMask`'s explicit per-policy options block carries levels/pitch/
  angle **explicitly** (P13 omission trap) — `dpi` is a render-level constant inherited from the
  base.
- `store/preferenceValidation.ts`: clamp the three knobs in `quantizerDefaults` (levels int 2..8,
  pitch 0.3..2.0 at 2dp, angle must be one of the four).
- Visibility: a new `'screentone'` class in `editor/inspectorModel.ts` (`quantizerParamVisibility`)
  and a matching exclusion in `components/settings/RenderingSection.tsx` (its `DIFFUSERS` filter
  must stop treating every non-`threshold` id as a diffuser). Compile-enforced label maps:
  `ObjectTab.tsx` `QUANTIZER_LABEL_KEYS`, `RenderingSection.tsx` `STRATEGY_LABEL_KEYS` +
  `QUANTIZER_OPTION_KEYS`.
- `ObjectTab.tsx`: `screentoneLevels` (number 2..8 step 1), `screentonePitchMm` (number 0.3..2.0
  step 0.01, with a live snapped readout at the **resolved print dpi** — read `usePrinterDpi` +
  `printerStatus` from the store), `screentoneAngle` (select of the four, label 26.6° for 27).
  Visibility: only when the effective id is `screentone`; `threshold`/`strength`/`serpentine` hidden;
  `gamma` still shown.
- `RenderingSection.tsx`: per-strategy screentone block (levels/pitch/angle + gamma; no strength/
  serpentine); the pitch description explains the snap and that it is applied at the effective print
  dpi.
- i18n: `editor.mfp.quantizerOptions.screentone`, field labels + pitch readout template, angle
  option labels, settings labels/descriptions. **One `en.json` writer per wave.**

## Print-time honesty (R10 / no silent aliasing)

- The print dialog warns when a document uses screentone **and** a head dpi is known **and** the
  resolved print dpi ≠ that head dpi (only reachable with `usePrinterDpi` off): the screen is then
  snapped at a non-head dpi, so it is not dot-grid-locked. One new warning kind, produced next to
  the existing print warnings; no second warning path. `docUsesScreentone(doc, defaultQuantizerByType)`
  is a pure helper (resolve per node, no render).
- Non-head paths are **accepted approximations**: queue thumbnails (100 dpi) and the live preview's
  budget fallback snap at their own dpi; comments say so; the inspector readout always names the
  dpi it used.

## Tests (W4 owns the pinning; W1/W2 add unit coverage)

- Determinism: the rank table is a fixed table (no `Math.random`), golden 1-bit planes **pinned at
  `dpi: 300`**.
- Pitch snap: 300 dpi 0° ⇒ 5/6/8/12 dots = 0.423/0.508/0.677/1.016 mm; 203 dpi ⇒ 4/6/8 =
  0.500/0.751/1.001; never below 0.4 mm; rotated bases snap by lattice steps.
- Lattice periodicity: translating the raster by one lattice vector reproduces the plane.
- `K`-level tone ramp: a uniform grey plane at `levels: 4` shows 4 distinct ink densities, monotone.
- No aliasing at a legal pitch: the 0° screen at 6 dots is exactly periodic (period 6 px).
- `strength` inert (0 vs 4 identical), gamma applies, missing `dpi` throws.
- Policy: each knob changes `policyKeyOf` (D-57(b)); the palette measurement (D-64) — a mask with
  >8 distinct screentone policies counts overflow.
- `DEFAULT_POLICY_BY_TYPE` unchanged (screentone never a default for symbol/text types).

## Waves

1. **W1 (`general`)** — engine + policy/params + dpi threading + unit/golden tests.
2. **W2 (`general`)** — inspector + settings + i18n + print warning (single `en.json` writer).
3. **W3 (`tester`)** — the pinning suite above + the D-64 measurement; report numbers.
4. Review (`review`) → fixes (≤2) → commit `feat(quantize): head-locked screentone halftone`.
5. Memory: `dithering.md` §10, `screenstyle-quantization.md` status, `tech-debt.md` D-64 measured,
   `state.md`.

## Outcome (2026-10-20)

- Shipped: `core/render/screentone.ts` (lattice screen + deterministic cell-space rank table + the
  physical snap `screentoneSnap`), registry/policy/resolver/key wiring, `QuantizeOptions.dpi`
  (required by screentone, threaded from the effective render dpi), doc-data plumbing + inspector
  (three fields, only for an effective screentone, with a live snap readout at the resolved print
  dpi), a settings block with no dead knobs, persisted-setting clamps, and the single
  `print-screentone-unlocked` warning for a non-head-dpi print with `docUsesScreentone` (hidden nodes
  excluded).
- **Semantics correction during the wave:** the literal `ink = rank < level` against a max-K table is
  not solid at `levels-1` for K < 8; the table value is rescaled into the current K domain before the
  compare (pinned by the goldens: black solid, mid-grey partial, white blank).
- **Review round 1 (`review`, CHANGES NEEDED)**: the live-preview trigger omitted the three new knobs
  (no re-plan on an edit); hidden screentone nodes still raised the print warning. Fixed;
  `review-fast` → **APPROVE** (one nit accepted: an unreachable orphan node with a malformed
  `parentId` can cause a conservative false-positive warning — informational only).
- **D-64 measured:** 9 distinct screentone policies ⇒ 8 slots + `overflowCount 1`, the 9th fully
  global.
- Verification: full suite **2361 passed / 173 files**, `tsc --noEmit` clean.
- Memory: `dithering.md` §10, `screenstyle-quantization.md` status, `tech-debt.md` D-64,
  `memory.md` index.
