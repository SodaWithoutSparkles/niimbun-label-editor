# Dithering / quantization engine — capabilities, gaps, and how to extend it

Recon 2026-10-16 (owner question: are Ostromoukhov / serpentine / Atkinson / dampening /
S-curve + gamma-1.8 LUT applicable, and what label-file fields would they need?).
Owner decision 2026-10-16: **record only, no code** at the time — **superseded by P13 and P14.**
P13 landed the configurable per-strategy defaults, the per-node `serpentine` and the `policyKeyOf`
fix (§7). P14 landed the gamma tone curve and the `ostromoukhov` strategy, and the owner **dropped**
ordered/Bayer, screentone and ScreenStyle/ScreenVAE (2026-10-17). **P1 of the 2026-10-19 run landed
§9** (the named grey preprocess stage + per-object gamma; **D-58 retired**); **P4 of that run landed
§10** (head-locked screentone; D-64 measured). **Read §7–§10 first.**
Companion file: [`screenstyle-quantization.md`](screenstyle-quantization.md) (procedural
screentone design, K-level tone ramp). Read both before touching `src/core/render/quantize.ts`.

## 1. What ships today

`src/core/render/quantize.ts` — one static-kernel diffusion engine (`createDiffuser`),
one variable-coefficient path (`createVariableDiffuser`, `ostromoukhov` only), the point-op
`threshold`, and (since P4) `screentone` from `src/core/render/screentone.ts` — six quantizers.

| thing | anchor | detail |
|---|---|---|
| `Quantizer` | `quantize.ts:48` | `(rgba: RgbaBuffer, opts?: QuantizeOptions) => RgbaBuffer` — sync, pure, **in-place**, main thread |
| `QuantizeOptions` | `:25` | `threshold` (def 128) · `strength` (def 1) · `serpentine` (def **true**) · `gamma` (def 1, neutral) · `colorSpace` |
| `QuantizerId` | `:51` | `'threshold' \| 'floydSteinberg' \| 'stucki' \| 'atkinson' \| 'ostromoukhov'` |
| `QUANTIZERS` | `:384` | registry — `validate.ts` derives `QUANTIZER_IDS` from `Object.keys(QUANTIZERS)`, so **a new id needs no validator edit** |
| `normalizeGamma` / `buildToneLut` | `:89` / `:102` | 256-entry `lut[i] = round(255*(i/255)**(1/gamma))`; clamp `[0.1, 4]`, non-finite → 1; the neutral path does **not** round, so `gamma: 1` is byte-identical to pre-P14 |
| `createDiffuser(denom, grid, {normalize})` | `:128` | the static engine; one **static** kernel per call; `Float32Array(W*H)` grey plane; `reversedKernel` for serpentine; `error * (w * strength)` per tap |
| `createVariableDiffuser()` | `:242` | 3 taps chosen per pixel from the **uncorrected** tone-mapped source level; divisor `i_sum`; `i_d` is the remainder, so the error is conserved exactly |
| `threshold` | `:335` | point op; **ignores** `strength` + `serpentine` |
| `floydSteinberg` | `:351` | `16, [[0,0,7],[3,5,1]]` |
| `stucki` | `:357` | `42, [[0,0,0,8,4],[2,4,8,4,2],[1,2,4,2,1]]` |
| `atkinson` | `:367` | `8, 6 taps @⅛, {normalize:false}` → 2/8 discarded |
| `ostromoukhov` | `:381` + `ostromoukhovTable.ts` | variable-coefficient ED; see §2.1 and §8 |

**So: serpentine is already implemented and already the default; Atkinson already ships;
"dampened diffusion / error retention" is already `strength` (it multiplies every tap weight);
the tone curve ships as a per-strategy `gamma` setting; Ostromoukhov ships.**

## 2. What is missing — status updated for P14 (read §8)

1. **Ostromoukhov 2001 variable-coefficient ED — IMPLEMENTED (P14, `f2d3bc9`).** Same cost
   class as FS (≈1 table lookup + 3 taps/px — cheaper than Stucki). **Not expressible in
   `createDiffuser`** (one static kernel), so it ships as a second path, `createVariableDiffuser`.
   Paper: V. Ostromoukhov, *A Simple and Efficient Error-Diffusion Algorithm*, SIGGRAPH 2001,
   DOI `10.1145/383259.383326`. **The coefficient table is obtained and shipped as data, not code**
   (`src/core/render/ostromoukhovTable.ts`, `Uint16Array`, 256 rows × `[i_r, i_dl, i_d, i_sum]`):
   transcribed from the author's own reference implementation `varcoeffED.c` v1 (Aug 2001) and
   verified by an independent parse-and-diff of that file (**0/1024 mismatches**). It is the
   author's table **fully expanded** — every input level has a row, so no key-level interpolation is
   needed. (The paper PDF was never obtainable; the table is authoritative instead.)
   ⛔ `references/Ostromoukhov/chat.md` is an LLM-generated summary with a **wrong** table — never use
   it. Only `varcoeffED.c` is authoritative, and neither carries a licence (§8, `D-66`).
2. **Pre-dither tone curve — IMPLEMENTED as gamma-only.** A 256-entry LUT applied to the
   **projected source** by the named grey preprocess stage (**P1, 2026-10-19, §9**; before that:
   baked once into the diffuser's grey plane and per pixel in the point-op `threshold`), never to the
   error-adjusted value. Gamma is a **per-strategy setting**
   (`quantizerDefaults[strategy].gamma`, engine default per strategy `DEFAULT_GAMMA_BY_STRATEGY`,
   `policy.ts:85`) **and, since P1, also per-object document data** (`quantizerParams.gamma`;
   D-58 retired). **Dropped by the owner (2026-10-17):** the
   `toneCurve` enum (`'none'|'gamma'|'sCurve'`), the parametric S-curve (`pivot`/`contrast`), and any
   per-node or per-paper curve. See §8 for the defaults and the rationale.
   - **Two different things, easy to conflate.** (a) *Gamma correction* = sRGB→linear
     (piecewise ≈2.4) so error averaging is physically correct — the Go `dither` lib is unusual
     in doing this. (b) *Shaping* (S-curve, γ) = a perceptual/dot-gain curve. **γ 1.8 is the
     historical Mac display gamma, not a thermal standard** — nothing prescribes it for bilevel
     thermal output, and P14 did **not** adopt it (default 1.3 for diffusers). `Error diffusion`
     (Wikipedia, printer considerations) is the only citable rationale for a *shaping* curve:
     printers overlap dots, so tone-scale linearisation may be applied to the source.
3. **Ordered / Bayer — still dropped (owner 2026-10-17). Screentone SHIPPED in P4 (§10).** Bayer
   2/4/8 exists only in the vendored reference (`references/niimblue/src/utils/post_process.ts:117-165`)
   — never shipped, and it is **dpi-blind**; the shipped screentone is head-locked instead. Both are
   **point ops**: no diffusion, so no error buffer and **immune to the cross-policy seam problem below**.

## 3. Architecture constraints any new method must respect

- **Each policy runs as a full-frame pass, then its owned pixels are scattered** —
  `applyPolicy` (`policy.ts:238`), mask built by `buildPolicyMask`
  (`renderLabelPage.ts:254`).
  So every diffuser already sees whole-frame grey (any global tone curve folds in for free), and
  a region's diffused error that lands outside the region is **silently discarded** →
  cross-policy seam drift, i.e. **D-05**. This applies to FS, Stucki, Atkinson, damped, and
  Ostromoukhov alike (P14 added Ostromoukhov to the list; **D-05 stays open**); serpentine does not
  change it. Point ops are immune.
- **Ostromoukhov's blue-noise quality is a whole-raster property** — no source guarantees it
  survives the clip/scatter pipeline, and this is now **unverified against shipped code**: measure
  at region edges (**D-67**; §5.5).
- **8-slot mask palette** — `KEY_COLORS` (`renderLabelPage.ts:163`, 8 entries), cap check `:336`; overflow
  makes a node fall back to the global pass (`policyOverflowCount`). More distinct per-node
  parameter combos ⇒ more overflow. A **document-level** tone curve avoids that; per-node does not.
  **P14 made this worse (R14-b):** gamma is another key dimension and there is now a fifth strategy,
  so more distinct keys compete for the same 8 slots. `policyOverflowCount` was **not measured** —
  registered as **D-64**.
- **`policyKeyOf`** now lives in `core/render/policy.ts:151` and keys the **effective** `serpentine`
  *and* the normalized `gamma` (`id:threshold:strength:serpentine:gamma`). Serpentine was fixed in
  **P13** (§7), gamma added in **P14** (§8). Before P13 it keyed only
  `id:threshold:strength` (the D-57(b) trap): two nodes differing only in a new knob shared one mask
  entry and the first node's params silently won for both. **Any further persisted param must extend
  this key.**
- **The global base options are merged *under* each policy's own options** — `applyPolicy` does
  `{ ...opts, ...entry.options }`. So a knob a policy **omits** silently inherits the global value:
  a node whose effective `serpentine` was `true` under a `false` global base scanned wrongly until
  P13 set every pixel-changing knob explicitly. P14 made this sharper — **gamma differs per
  strategy**, so an omission applies the wrong curve. `buildQuantizeOptions` always emits gamma and
  every masked policy carries it explicitly. Any new per-policy knob must be set explicitly too.
- **Diffusion is inherently sequential** (no parallel/GPU win); ordering matters, so the
  preview reruns are the real latency budget. Since **P14** the editor *does* paint a quantized
  overlay, but only as a budget-only approximation: document dpi when the raster fits the 1 M px
  budget, otherwise a lower dpi that fits (~0.17–0.25 s worst case at its 1 M px budget on the
  shared 2-core box; `D-60`/`D-61`) on an inspector-only trigger — the Konva
  canvas itself is still never quantized, and the print path's cost is unchanged.
- `MAX_RASTER_PIXELS = 16_000_000` (`renderLabelPage.ts:157`); a full-frame `Uint8ClampedArray`
  copy per policy + one `Float32Array` per quantizer call.

## 4. Label-file fields (if any of this is implemented)

Stored today (`core/doc/types.ts`): `quantizerHint?: QuantizerId` (`:77`),
`quantizerParams?: { threshold?: number; strength?: number; serpentine?: boolean }` (`:83`;
`serpentine` added in P13). **`gamma` is NOT here — it is a setting, not doc data (P14).**
Repaired-with-drop in `validate.ts` (`toQuantizerHint` `:336`; params `:421-453`: threshold
round+clamp `[0,255]`, strength round 2dp + clamp `[0,4]`, empty object deleted) and re-clamped in
`factory.ts:104-122`. An unknown id already in a file is dropped → forward/backward compatible at
v0 alpha.

| new knob | field to add | notes |
|---|---|---|
| new ids (`ostromoukhov`, `bayer2/4/8`) | none | registry only; validate auto-accepts — **`ostromoukhov` shipped this way in P14** |
| serpentine per node | — | **implemented (P13)**: `quantizerParams.serpentine?: boolean` with a new `toOptionalBoolean` validate guard; the effective value is node → per-strategy setting → engine default `true`, so an unset value never means `true` |
| damping / retention | **reuse `strength`** | 0.90–0.94 fits its `[0,4]` clamp; add a separate `retention` only if `strength > 1` must keep meaning *amplify* |
| per-object tone curve | **`quantizerParams.gamma`** | **implemented (P1, 2026-10-19)**: soundness 2 dp, clamp `[0.1,4]`, non-finite dropped; precedence node → per-strategy setting → engine default. The per-strategy setting (`quantizerDefaults[strategy].gamma`) stays as the layer below; the `toneCurve` enum and the parametric S-curve remain **dropped** (owner, 2026-10-17) |

UI cost per new param: `RESERVED_FIELDS` (`editor/inspectorModel.ts:220`, moved out of
`components/`), `ObjectTab`'s
`numberValue`/`numberRange`/`setNumber` (`:218`, `:304`, `:580` — note defaults are
deleted rather than stored), `QUANTIZER_LABEL_KEYS`/`optionLabel` (`:121`, `:205`),
`en.json` `editor.mfp.quantizerOptions.*` / field labels. The old wart — `strength` rendered for
`threshold`, where it is a silent no-op — is **fixed (P13)**: inspector visibility is per strategy
(`threshold` shows Threshold only; diffusers show "Error diffusion" + "Serpentine scan").
`gamma` follows the same split: the settings section has a field in *both* strategy blocks (default
1 for `threshold`), and there is deliberately **no inspector field** (owner decision, §8).

## 5. Unverified — must be measured on hardware, not assumed

1. ~~The Ostromoukhov coefficient table and its exact 3-tap kernel.~~ **RESOLVED (P14):** the table
   is transcribed from the author's reference implementation and verified 0/1024; the kernel is
   pinned by hand-derived tests. The *printed* character is still unmeasured (item 5).
2. Best retention factor in 0.90–0.94 — **no published value found**; `didder --strength 80%`,
   sharp `dither 0..1`, niimblue `strength 0..1.5` are the only real-world anchors.
3. Thermal dot-gain curve / any correct γ — derive from a printed step wedge; do not assume 1.8.
   **P14 shipped 1.3 by default without that wedge** — see item 8 and `D-63`.
4. Whether S-curve + damping together clip/blow out highlights (both trim extremes).
5. Whether Ostromoukhov's blue-noise character survives region clipping/scatter — **now unverified
   against shipped code** (`D-67`).
6. Cross-policy seam drift per diffuser (two abutting objects, different policies → print).
7. Per-pixel-variable kernel latency vs static grid, on the preview path.
8. **Every pre-existing document's error-diffusion output changed at the default gamma 1.3** with no
   printer/step-wedge verification (`D-63`). `atkinson` + a lightening curve trims the top end
   further (it already discards 2/8 of the error) — noted, not tuned (R14-f).

## 6. Composition verdict (owner's recipe, 2026-10-16)

"Dampened serpentine Ostromoukhov + 90–94% error retention + pre-dither S-curve + γ1.8 LUT" is
**composable**: serpentine ✅ ships, dampening = `strength` ✅ ships, the tone curve ✅ **ships as
gamma-only** (P14 — no S-curve; default 1.3, not 1.8), Ostromoukhov ✅ **ships** (P14). Every
*number* in the recipe is still unverified — that is a hardware-tuning exercise, not a port.

## 7. Landed in P13 (2026-10-16) — what is now configurable

Owner request: "quantizer defaults are not changeable" + "use the correct terminology per strategy".

- **Two persisted settings** (both default `{}` = behaviour unchanged until set; `ui_settings`):
  - `quantizerDefaults: Partial<Record<QuantizerId, { threshold?; strength?; serpentine? }>>` —
    per **strategy**. **P14 adds `gamma?`** (§8).
  - `defaultQuantizerByType: Partial<Record<NodeType, QuantizerId>>` — per **object type**, layered
    above the module constant `DEFAULT_POLICY_BY_TYPE` (`core/render/policy.ts`), which stays the
    fallback. Keys offered: text / image / qr / barcode / code. **Shapes deliberately have no entry**
    (a solid fill cannot be dithered meaningfully, and granting shapes policies would let them consume
    the 8 mask-palette slots → silent global-pass fallback).
- **Precedence contract:** node `quantizerParams` → per-strategy setting → engine default. The
  inspector's `''` = "auto" resolves to the *setting*, never to the literal `true`.
- **Pure helpers live in `core/render/policy.ts`** (core stays store-free): `resolveQuantizer(node,
  byType)`, `resolveQuantizerParams(...)`, `policyKeyOf` (keys effective serpentine — and, since
  P14, gamma),
  `quantizerSettingsKey(defaults, byType)` — an **order-independent** serialization used by the two
  preview/thumbnail cache keys (`editor/render/previewKeys.ts`'s `previewOptionsKey`, used by the
  print page preview and the editor's live quantized preview; `usePrintThumbnails.overridesContentKey`);
  `JSON.stringify` alone was key-order sensitive and rebuilt the thumbnail cache needlessly.
- **Settings are threaded, never imported**: `RenderLabelPageOptions` carries both maps and the
  store-aware callers (`PrintDialog`, `PrintPagePreview`, `usePrintThumbnails`, `printLabel`) supply
  them. `core/` and `print/` must not import `store/`.
- **UI:** a new **Rendering** settings section (per strategy: Threshold, or "Error diffusion" +
  "Serpentine scan"; plus the per-type default selects) and a **per-strategy inspector** — `threshold`
  shows Threshold only, diffusers show Error diffusion + Serpentine.
- **D-57 is closed**: (a) serpentine is persisted + settable, (b) `policyKeyOf` keys it, (c) the
  generic "Dither strength" label and the `threshold`-shows-`strength` wart are gone.
- **Not implemented — dropped by the owner (2026-10-17)** from §4: the `toneCurve` enum, the
  S-curve, and Bayer/ordered dithering. Superseded by **§8**, where P14 landed `gamma` and
  Ostromoukhov.

## 8. Landed in P14 (2026-10-18) — gamma + Ostromoukhov, and the owner's drops

Commits `2b0f70a` (W1 gamma), `f2d3bc9` (W2 Ostromoukhov), `8468b54` (W3 live preview).

- **Tone curve = a `gamma` setting, per strategy** (W1). 256-entry LUT applied to the **projected
  source**; `QuantizeOptions.gamma` + `QuantizerDefaultParams`; resolve chain node → settings →
  render fallback → **per-strategy engine default** `DEFAULT_GAMMA_BY_STRATEGY` (`policy.ts:85`):
  **1.3** for the four diffusers (`floydSteinberg`, `stucki`, `atkinson`, `ostromoukhov`), **1
  (neutral)** for `threshold`. `quantize.ts` itself stays neutral, so every pre-existing golden
  plane is byte-identical. `normalizeGamma` (`quantize.ts:89`) collapses non-finite input to 1 and
  clamps to `[0.1, 4]` — without it a stray render-level fallback could zero the LUT and raster a
  black page.
  - **Why `threshold` stays 1:** a curve before a point op only moves the binarisation cutoff
    (128 → ~104), and qr / barcode / code / text are all `threshold` by default — a global 1.3
    would silently change how symbols and text print.
  - `policyKeyOf` now keys the **normalized** gamma (D-57(b) trap) and `quantizerSettingsKey` moves
    with it; `buildQuantizeOptions` always emits gamma and every masked policy carries it explicitly
    (the P13 omission trap — critical because gamma differs *per strategy*).
  - No doc field, no `RESERVED_FIELDS` change, no migration: **gamma is settings data**. A
    per-paper or per-node curve is therefore not expressible — the owner's deliberate simplification
    (`D-58`).
- **`ostromoukhov` ships** (W2). Table in `src/core/render/ostromoukhovTable.ts` (`Uint16Array`,
  256 rows × `[i_r, i_dl, i_d, i_sum]`, row-major); `createVariableDiffuser()` (`quantize.ts:242`);
  `ostromoukhov` (`:381`). Two documented deviations:
  - our engine-wide `corrected < cutoff` (default `128`) instead of the reference's `<= 127.5` —
    they differ only in the half-open band `(127.5, 128)`; kept so one cutoff semantic covers every
    strategy and `strength: 0` is identical to `threshold` (`D-65`);
  - `serpentine: false`, which the paper does not have (the reference is always serpentine).
  - `strength` scales `diff` before the split, so the remainder term still conserves the scaled
    error. `DEFAULT_POLICY_BY_TYPE` is untouched — no type defaults to it.
  - ⚠ **No clean licence** on the reference C or the Observable notebook: only the **numeric** table
    was transcribed. Do **not** vendor the reference C or the notebook code (`D-66`).
- **Live quantized preview** (W3): inspector-only trigger, 60 ms debounce, 1.5 s idle revert,
  document dpi when the raster fits the 1 M px budget (the exact print raster, 1:1) else a dpi
  that fits the budget, `pointer-events: none` react-konva overlay, never mutates the doc.
  Pure policy in `editor/quantizedPreview.ts`; lifecycle in
  `components/editor/useQuantizedPreview.ts`; layer in
  `components/editor/QuantizedPreviewLayer.tsx`. `previewOptionsKey` moved to the pure
  `editor/render/previewKeys.ts` (shared by the print page preview and this one). The editor's
  Konva canvas is still never quantized — this is an overlay, not a second render path.
- **Dropped by the owner (2026-10-17)** — analysis kept, status only: ordered/`Bayer` dithering,
  screentone, and the ScreenStyle/ScreenVAE integration; together with the `toneCurve` enum, the
  S-curve and any per-node/per-paper curve.
- **Residuals are registered** in [`tech-debt.md`](tech-debt.md) as **D-58…D-67**: per-strategy-only
  gamma, the inspector-only trigger, the budget-only pixel approximation, the synchronous render
  cost, the mid-edit hide, the unverified hardware behaviour change at gamma 1.3, mask-palette
  pressure (R14-b), the cutoff-band deviation, the licence, and the blue-noise-under-clipping
  question.

## 9. Landed in P1 of the 2026-10-19 run — grey preprocess stage + per-object gamma

- **New pure module `src/core/render/preprocess.ts`**: `GreyPlane`, `projectGrey` (RGBA → one float
  per pixel), `GreyOp`/`applyGreyChain`/`preprocessGrey`, `buildPreprocessChain`. The moved
  `GAMMA_MIN/MAX`, `normalizeGamma`, `buildToneLut`, `toByte` live there and are **re-exported from
  `quantize.ts`**, so `core/render/index.ts` and every existing import are unchanged. v1 chain
  membership is the **tone curve only** — `invert`/`mirror` stay post-quantize print overrides.
- **All three engines route through it** (`createDiffuser`, `createVariableDiffuser`, `threshold`):
  project → preprocess → scan, so the "same three sites" duplication is now one implementation.
  Neutral params build an **empty** chain, so the neutral path still does not round the projection
  and `gamma: 1` stays byte-identical (all pre-existing golden planes pass unchanged).
- **Projection was *not* hoisted** into `applyPolicy` (the plan left it open): `Quantizer` stays
  `(rgba, opts) => rgba` — public, sync, pure, in-place — and the win would have been one projection
  pass per frame only. Revisit if projection ever profiles hot.
- **Per-object gamma (retires D-58).** `quantizerParams.gamma` is document data
  (`types.ts` → `validate.ts` 2 dp + clamp `[0.1,4]` + non-finite drop → `factory.roundNode`), and
  the inspector exposes it for **every** visible strategy (it moves a `threshold` cutoff too); it is
  hidden only when no quantizer resolves. Precedence is unchanged and already correct:
  node → per-strategy setting → engine default (`resolveQuantizerParams`; `policyKeyOf` was already
  keying the normalized gamma).
- **Inspector semantics worth remembering:** the field displays and deletes against the
  **inherited** value (strategy setting → engine default), never the engine default alone —
  otherwise a node cannot select a curve that differs from its setting. Deleting keeps "auto"
  implicit; an override equal to the inherited value is stored only when it is genuinely different.
- **Tests:** `preprocess.test.ts` (neutral no-op, LUT parity, projection parity, ordering),
  `renderLabelPage.gamma.test.ts` (distinct mask slots, per-object beats the setting, neutral
  byte-identity, `parseDoc` round-trip), plus the extended `validate`/`ObjectTab`/`inspectorModel`
  suites. Full suite 2228 green; `tsc --noEmit` clean.

## 10. Landed in P4 of the 2026-10-19 run — head-locked screentone (closes the §2 gap; D-64 measured)

- **New engine `src/core/render/screentone.ts`** (pure, no store): projected grey → P1 tone chain →
  `K`-level index → one precomputed **clustered-dot rank table**. `ink = rank < level`,
  `level = round((1 - grey/255) * (levels-1))`, `0` = paper, `levels-1` = **solid ink**. A stateless
  point op: O(1)/px, no error buffer, **cheaper than Floyd–Steinberg**, and immune to the cross-policy
  seam (D-05) like `threshold`. Ignores `threshold`/`strength`/`serpentine`; `gamma` applies.
- **Rotation is an integer lattice**, not float rotation: bases `(1,0)/(4,1)/(2,1)/(1,1)` =
  0°/14°/26.565°/45°, lattice coords `u=(a*x+b*y)/S`, `v=(-b*x+a*y)/S`, `S = step*(a²+b²)` — exact
  periodicity, no trig, no drift. The rank table is one deterministic `Uint8Array(64*64)` in **cell
  space** (wrap-aware Euclidean distance from the cell centre, `MAX_LEVELS = 8`), and its value is
  **rescaled into the current `levels` domain** before the compare
  (`min(levels-2, floor(raw*(levels-1)/7))`) — without that, `level = levels-1` is not solid for K < 8.
- **Pitch is physical, never raw px.** `dpi` is a **required** `QuantizeOptions` input (missing ⇒
  `RangeError`: head-locked or nothing) because the raster is encoded 1:1 in printer dots.
  `step = max(1, round(pitchMm * dpi/25.4 / |basis|))`, snapped **up** while the period is < 0.2 mm;
  `dots = step*|basis|`, `pitchMm = dots*25.4/dpi`. Verified: 300 dpi 0° → 5/6/8/12 dots =
  0.423/0.508/0.677/1.016 mm; 203 dpi → 4/6/8 = 0.500/0.751/1.001 mm.
- **Params + precedence:** `screentoneLevels` (2–8), `screentonePitchMm` (0.2–2.0), `screentoneAngle`
  (0|14|27|45), `screentoneBoldness` (−1…1, level bias, 2026-10-25) — document data
  (`quantizerParams`) with node → per-strategy setting → `DEFAULT_SCREENTONE` (4 / 0.5 mm / 45° /
  0; gamma 1). `policyKeyOf` keys all four (pitch + boldness 2 dp); every knob is set explicitly in
  the per-policy options (P13 trap). The inspector exposes them only for an effective screentone and
  shows the live snap readout (`0.51 mm — 6 dots @ 300 dpi`) at the **resolved print dpi**;
  `strength`/`serpentine` are hidden for it rather than silently dead.
- **Boldness semantics:** `level = clamp(round(tone·maxLevel + boldness), 0, maxLevel)` — positive
  = fatter dots. It is expressed in *screen levels*, not a contrast band: a band would overlap
  `gamma` and shift `levels` semantics. Default `0` is byte-identical to the pre-knob engine.
- **Never a default for symbol/text types** — `DEFAULT_POLICY_BY_TYPE` is untouched; screentone is
  opt-in per node (or an explicit per-type setting). A screentoned QR does not scan (R10).
- **Non-head dpi paths are accepted approximations:** queue thumbnails (fixed 100 dpi) and the live
  preview's 1 M px budget fallback snap at their own effective dpi and are **not** dot-grid-locked.
  If the print's resolved dpi ≠ the printer-reported head dpi (only with `usePrinterDpi` off), the
  print dialog raises **one** `print-screentone-unlocked` warning. `docUsesScreentone` ignores hidden
  nodes (including ancestor-hidden groups); it scans conservatively if a malformed orphan exists
  (false-positive warning only).
- **D-64 measured (palette pressure):** 9 distinct screentone policies ⇒ **8 held, `overflowCount 1`**;
  the 9th node falls back fully to the global pass. The existing `print-policy-overflow` warning
  surfaces it.
- **Tone-stability median filter: deferred** (revisit after the owner's first screentone test print).
- **Tests:** engine unit/golden suite (`screentone.test.ts`, pinned 8×8 planes at 300 dpi, K ramp,
  periodicity, strength-inert, missing-dpi throw), `renderLabelPage.screentone.test.ts` (distinct
  slots per knob, the D-64 measurement, 6 px @300 vs 4 px @203 period, strength-inert end-to-end,
  never a default), doc round-trip + UI + print-warning suites. Full suite 2361 green; `tsc` clean.

### Dithered-view mode (P5 follow-up, 2026-10-20)

- `renderMode: 'normal' | 'quantized'` is **session state** (view slice, not persisted). The editor
  status bar has a toggle chip (`data-testid="render-mode-toggle"`, `aria-pressed`) next to zoom/DPI.
- In `quantized` mode the live preview becomes **persistent**: it renders without an inspector
  trigger, re-renders on any doc/context/base-dpi change (60 ms debounce), has **no** idle revert,
  and is not dismissed by a tool change. Normal mode keeps the P14 behaviour (trigger = inspector
  knobs, 1.5 s idle revert, tool-change dismiss). The 1 M px budget fallback + `approximate` flag
  still apply.
- **Shortcut:** `keyboardShortcuts.quantizedView` (default `q`, editable in Settings → Shortcuts →
  View). Tap = toggle; **hold ≥300 ms = dithered while held**, release restores the mode that was
  active at press (a status-bar click during the hold wins). Bare key only, ignored while typing /
  a dialog is open / on auto-repeat. It is matched **before** the configurable tool shortcuts, so it
  beats a tool mapped to the same key.
- The rectangle tool default moved `q` → `r`; persisted settings are migrated in
  `normalizeKeyboardShortcuts` (see `settings-store.md`).
