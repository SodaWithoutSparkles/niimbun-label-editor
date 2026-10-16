# Dithering / quantization engine — capabilities, gaps, and how to extend it

Recon 2026-10-16 (owner question: are Ostromoukhov / serpentine / Atkinson / dampening /
S-curve + gamma-1.8 LUT applicable, and what label-file fields would they need?).
Owner decision 2026-10-16: **record only, no code** at the time — **partly superseded by P13 the
same day, which landed the configurable per-strategy defaults, the per-node `serpentine` and the
`policyKeyOf` fix. Read §7 first.**
Companion file: [`screenstyle-quantization.md`](screenstyle-quantization.md) (procedural
screentone design, K-level tone ramp). Read both before touching `src/core/render/quantize.ts`.

## 1. What ships today

`src/core/render/quantize.ts` (170 LOC) — one diffusion engine, four quantizers.

| thing | anchor | detail |
|---|---|---|
| `Quantizer` | `quantize.ts:32` | `(rgba: RgbaBuffer, opts?: QuantizeOptions) => RgbaBuffer` — sync, pure, **in-place**, main thread |
| `QuantizeOptions` | `:20-29` | `threshold` (def 128) · `strength` (def 1) · `serpentine` (def **true**) · `colorSpace` |
| `QuantizerId` | `:35` | `'threshold' \| 'floydSteinberg' \| 'stucki' \| 'atkinson'` |
| `QUANTIZERS` | `:165-170` | registry — `validate.ts:72` derives `QUANTIZER_IDS` from `Object.keys(QUANTIZERS)`, so **a new id needs no validator edit** |
| `createDiffuser(denom, grid, {normalize})` | `:51-124` | the whole engine; one **static** kernel per call; `Float32Array(W*H)` grey plane; `reversedKernel` for serpentine; `error * (w * strength)` per tap (`:115`) |
| `threshold` | `:127-135` | point op; **ignores** `strength` + `serpentine` |
| `floydSteinberg` | `:138-141` | `16, [[0,0,7],[3,5,1]]` |
| `stucki` | `:144-148` | `42, [[0,0,0,8,4],[2,4,8,4,2],[1,2,4,2,1]]` |
| `atkinson` | `:150-162` | `8, 6 taps @⅛, {normalize:false}` → 2/8 discarded |

**So: serpentine is already implemented and already the default; Atkinson already ships;
"dampened diffusion / error retention" is already `strength` (it multiplies every tap weight).**

## 2. What is missing

1. **Ostromoukhov 2001 variable-coefficient ED.** Same cost class as FS (≈1 table lookup +
   3 taps/px — cheaper than Stucki). **Not expressible in `createDiffuser`** (one static kernel)
   → needs a new `variableDiffuser` path selecting coefficients by the input grey level.
   **⚠ Blocked: the coefficient table is unobtained.** Paper: V. Ostromoukhov, *A Simple and
   Efficient Error-Diffusion Algorithm*, SIGGRAPH 2001, DOI `10.1145/383259.383326`;
   PDF `https://perso.liris.cnrs.fr/victor.ostromoukhov/publications/pdf/SIGGRAPH01_varcoeffED.pdf`
   (all mirrors botwalled on 2026-10-16). Verified second-hand only: coefficients vary per input
   grey level, 3 taps (right, down-left, down), serpentine intrinsic, "faster than FS,
   nearly artifact-free, blue-noise-like" (Wikipedia §Ostromoukhov's Variable Error Diffusion).
   **Table size / range / values are unverified — do not invent them.** Not off-the-shelf in any
   JS lib checked (`image-q`, `ditherjs`, `didder`, `imagequant`).
2. **Pre-dither tone curve (S-curve and/or gamma LUT).** Absent from `src/` entirely — the only
   gamma code in the repo is `references/ScreenStyle/tmp-screentone-demo/index.html:88-89`.
   Cheap: a 256-entry LUT applied to the projected grey inside the diffuser's per-pixel loop.
   - **Two different things, easy to conflate.** (a) *Gamma correction* = sRGB→linear
     (piecewise ≈2.4) so error averaging is physically correct — the Go `dither` lib is unusual
     in doing this. (b) *Shaping* (S-curve, γ) = a perceptual/dot-gain curve. **γ 1.8 is the
     historical Mac display gamma, not a thermal standard** — nothing prescribes it for bilevel
     thermal output. `Error diffusion` (Wikipedia, printer considerations) is the only citable
     rationale for a *shaping* curve: printers overlap dots, so tone-scale linearisation may be
     applied to the source.
3. **Ordered / Bayer + screentone.** Bayer 2/4/8 exists only in the vendored reference
   (`references/niimblue/src/utils/post_process.ts:117-165`) — not shipped. Screentone design is
   in [`screenstyle-quantization.md`](screenstyle-quantization.md). Both are **point ops**: no
   diffusion, so no error buffer and **immune to the cross-policy seam problem below**.

## 3. Architecture constraints any new method must respect

- **Each policy runs as a full-frame pass, then its owned pixels are scattered** —
  `applyPolicy` (`policy.ts:92-140`), mask built by `buildPolicyMask` (`renderLabelPage.ts:213-394`).
  So every diffuser already sees whole-frame grey (any global tone curve folds in for free), and
  a region's diffused error that lands outside the region is **silently discarded** →
  cross-policy seam drift, i.e. **D-05**. This applies to FS, Stucki, Atkinson, damped, and
  Ostromoukhov alike; serpentine does not change it. Point ops are immune.
- **Ostromoukhov's blue-noise quality is a whole-raster property** — no source guarantees it
  survives the clip/scatter pipeline. Unverified; measure at region edges.
- **8-slot mask palette** — `KEY_COLORS` (`renderLabelPage.ts:134`), cap check `:271`; overflow
  makes a node fall back to the global pass (`policyOverflowCount`). More distinct per-node
  parameter combos ⇒ more overflow. A **document-level** tone curve avoids that; per-node does not.
- **`policyKeyOf`** now lives in `core/render/policy.ts` and keys the **effective** `serpentine`
  as well (`id:threshold:strength:serpentine`) — fixed in **P13** (§7). Before that it keyed only
  `id:threshold:strength` (the D-57(b) trap): two nodes differing only in a new knob shared one mask
  entry and the first node's params silently won for both. **Any further persisted param must extend
  this key.**
- **The global base options are merged *under* each policy's own options** — `applyPolicy` does
  `{ ...opts, ...entry.options }`. So a knob a policy **omits** silently inherits the global value:
  a node whose effective `serpentine` was `true` under a `false` global base scanned wrongly until
  P13 set every pixel-changing knob explicitly. Any new per-policy knob must be set explicitly too.
- **Diffusion is inherently sequential** (no parallel/GPU win); ordering matters, so the
  preview reruns (per doc change while the print dialog is open) are the real latency budget.
  The **editor Konva canvas is never quantized** — cost lands on `PrintPagePreview` + print only.
- `MAX_RASTER_PIXELS = 16_000_000` (`renderLabelPage.ts:128`); a full-frame `Uint8ClampedArray`
  copy per policy (`policy.ts:99,125`) + one `Float32Array` per quantizer call (`quantize.ts:89`).

## 4. Label-file fields (if any of this is implemented)

Stored today (`core/doc/types.ts`): `quantizerHint?: QuantizerId` (`:77`),
`quantizerParams?: { threshold?: number; strength?: number; serpentine?: boolean }` (`:79`;
`serpentine` added in P13). Repaired-with-drop in
`validate.ts` (`toQuantizerHint` `:333-338`; params `:401-429`: threshold round+clamp `[0,255]`,
strength round 2dp + clamp `[0,4]`, empty object deleted) and re-clamped in `factory.ts:98-118`.
An unknown id already in a file is dropped → forward/backward compatible at v0 alpha.

| new knob | field to add | notes |
|---|---|---|
| new ids (`ostromoukhov`, `bayer2/4/8`) | none | registry only; validate auto-accepts |
| serpentine per node | — | **implemented (P13)**: `quantizerParams.serpentine?: boolean` with a new `toOptionalBoolean` validate guard; the effective value is node → per-strategy setting → engine default `true`, so an unset value never means `true` |
| damping / retention | **reuse `strength`** | 0.90–0.94 fits its `[0,4]` clamp; add a separate `retention` only if `strength > 1` must keep meaning *amplify* |
| tone curve | `toneCurve?: 'none'\|'gamma'\|'sCurve'` + `gamma?: number` (clamp ≈0.1–4, 2dp) | enum → `toOptionalEnum`; a parametric S-curve would add `pivot`/`contrast` |

UI cost per new param: `RESERVED_FIELDS` (`inspectorModel.ts:198-207`), `ObjectTab`'s
`numberValue`/`numberRange`/`setNumber` (`:174-175`, `:262-265`, `:512-529` — note defaults are
deleted rather than stored), `QUANTIZER_LABEL_KEYS`/`optionLabel` (`:116-122`, `:154-158`),
`en.json` `editor.mfp.quantizerOptions.*` / field labels. The old wart — `strength` rendered for
`threshold`, where it is a silent no-op — is **fixed (P13)**: inspector visibility is per strategy
(`threshold` shows Threshold only; diffusers show "Error diffusion" + "Serpentine scan").

## 5. Unverified — must be measured on hardware, not assumed

1. The Ostromoukhov coefficient table (source above) and its exact 3-tap kernel.
2. Best retention factor in 0.90–0.94 — **no published value found**; `didder --strength 80%`,
   sharp `dither 0..1`, niimblue `strength 0..1.5` are the only real-world anchors.
3. Thermal dot-gain curve / any correct γ — derive from a printed step wedge; do not assume 1.8.
4. Whether S-curve + damping together clip/blow out highlights (both trim extremes).
5. Whether Ostromoukhov's blue-noise character survives region clipping/scatter.
6. Cross-policy seam drift per diffuser (two abutting objects, different policies → print).
7. Per-pixel-variable kernel latency vs static grid, on the preview path.

## 6. Composition verdict (owner's recipe, 2026-10-16)

"Dampened serpentine Ostromoukhov + 90–94% error retention + pre-dither S-curve + γ1.8 LUT" is
**composable**: serpentine ✅ ships, dampening = `strength` ✅ ships, the tone curve is ~60 lines,
Ostromoukhov is a bounded new diffuser **pending the paper's table**. Every *number* in the recipe
is unverified — that part is a hardware-tuning exercise, not a port.

## 7. Landed in P13 (2026-10-16) — what is now configurable

Owner request: "quantizer defaults are not changeable" + "use the correct terminology per strategy".

- **Two persisted settings** (both default `{}` = behaviour unchanged until set; `ui_settings`):
  - `quantizerDefaults: Partial<Record<QuantizerId, { threshold?; strength?; serpentine? }>>` —
    per **strategy**.
  - `defaultQuantizerByType: Partial<Record<NodeType, QuantizerId>>` — per **object type**, layered
    above the module constant `DEFAULT_POLICY_BY_TYPE` (`core/render/policy.ts`), which stays the
    fallback. Keys offered: text / image / qr / barcode / code. **Shapes deliberately have no entry**
    (a solid fill cannot be dithered meaningfully, and granting shapes policies would let them consume
    the 8 mask-palette slots → silent global-pass fallback).
- **Precedence contract:** node `quantizerParams` → per-strategy setting → engine default. The
  inspector's `''` = "auto" resolves to the *setting*, never to the literal `true`.
- **Pure helpers live in `core/render/policy.ts`** (core stays store-free): `resolveQuantizer(node,
  byType)`, `resolveQuantizerParams(...)`, `policyKeyOf` (keys effective serpentine),
  `quantizerSettingsKey(defaults, byType)` — an **order-independent** serialization used by the two
  preview/thumbnail cache keys (`PrintPagePreview.previewOptionsKey`,
  `usePrintThumbnails.overridesContentKey`); `JSON.stringify` alone was key-order sensitive and
  rebuilt the thumbnail cache needlessly.
- **Settings are threaded, never imported**: `RenderLabelPageOptions` carries both maps and the
  store-aware callers (`PrintDialog`, `PrintPagePreview`, `usePrintThumbnails`, `printLabel`) supply
  them. `core/` and `print/` must not import `store/`.
- **UI:** a new **Rendering** settings section (per strategy: Threshold, or "Error diffusion" +
  "Serpentine scan"; plus the per-type default selects) and a **per-strategy inspector** — `threshold`
  shows Threshold only, diffusers show Error diffusion + Serpentine.
- **D-57 is closed**: (a) serpentine is persisted + settable, (b) `policyKeyOf` keys it, (c) the
  generic "Dither strength" label and the `threshold`-shows-`strength` wart are gone.
- **Still NOT implemented** from §4: `toneCurve`/`gamma` (the S-curve/gamma-1.8 LUT) and any new
  algorithm (Ostromoukhov, Bayer/ordered). The §1 algorithm list is otherwise unchanged.
