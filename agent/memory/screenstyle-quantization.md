# ScreenStyle (`references/ScreenStyle/`) — can it be a quantizer?

> **ScreenStyle/ScreenVAE integration: still NOT planned (owner, 2026-10-17).** This file is kept as
> **design rationale**; §4's procedural **screentone SHIPPED in P4 of the 2026-10-19 run**
> ([`dithering.md`](dithering.md) §10) — the blockers below apply to the *model*, not to that engine.
> See [`dithering.md`](dithering.md) §2.3, §8 and §10.
>
> **2026-10-19 — owner re-asked for a feasibility assessment.** Settled in P4: pitch default 0.5 mm
> (snapped at the print dpi), K = 4 (selectable 2–8), angles 0/14/27/45, per-node params **and**
> per-strategy settings, and the `doc dpi ≠ head dpi` case surfaced as a print warning. The
> tone-stability median filter is deferred.

**Verdict: the model cannot be ported as a quantizer (3 hard blockers). The *idea* can —
ship classical screentone as a procedural quantizer instead. ScreenStyle is the design
rationale for that, not the implementation.**

Analysis date: 2026-10-16. Reference is inference-only PyTorch (MIT, academic + commercial).

---

## 1. What ScreenStyle actually is (from the code, not the paper)

`ScreenVAE` (`ScreenVAE/models/screenvae.py`) = encoder/decoder pair mapping
`(screentone image, line mask) → 4-channel intermediate → 1-channel screentone image`.

| Part | Config | Res |
|---|---|---|
| Encoder | `define_C(inc+1=2, outc*2=8, ngf=24, netC='resnet_6blocks')` | full res (3× down + up in `ResnetGenerator`, `networks.py:307-336`) |
| Latent split | `scr, logvar = split(inter, (4,4))` — `screenvae.py:73` | full res, 4ch |
| Decoder | `define_G(4, 1, ngf=48, netG='unet_128_G')` → `G_Unet_add_input_G(num_downs=7, max_nchn=8)` | full res, 384-ch bottleneck ×3 |

So the intermediate domain is a **full-resolution, per-pixel, 4-channel continuous**
representation — roughly 10.8M params in the decoder, ~0.3M in the encoder.

Key properties that matter for us:

- **Continuous, not quantized.** A Gaussian posterior (mean + logvar). The paper's stated
  goal is an *entropy-expanding, interpolative* intermediate domain. Quantization is the
  opposite direction. There is no codebook, no rounding, no discrete tone levels anywhere
  in the repo. Its output is 1-bit only because the manga target is bilevel.
- **Pitch is baked into the weights.** Screentone is a *physical* property of the printed
  dot grid; the model learns a particular dot pitch in pixels at training resolution and
  cannot change it at inference.
- **Inference-only.** No `train*.py`, no loss module, no options file for ScreenVAE. The
  dataset dir holds 21 sample val images. `GaborWavelet` — the procedural alternative the
  authors were clearly reaching for — is called at `screenvae.py:50` but **is defined
  nowhere in the repo** (dead reference).
- GPU-only: `torch.cuda.set_device(0)` + `.cuda()` hardcoded in `visual.py`/`edit.py`,
  `map_location=lambda s,l: s.cuda()` in `load_networks`.

## 2. Why the model fails our `Quantizer` contract

Our contract (`src/core/render/quantize.ts`):

```ts
type Quantizer = (rgba: RgbaBuffer, opts?: QuantizeOptions) => RgbaBuffer;  // sync, pure, in-place, main thread
```

`renderLabelPage` awaits only `prepareResolvedAssets`; quantization itself is a
synchronous main-thread pass, re-run for **every preview keystroke** and **every print**
(`PrintPagePreview.tsx:192`, `printLabel.ts:215`).

### Blocker 1 — shape + cost

A 4"×6" label at 300 dpi = 1200×1800 = 2.16 Mpx. Encoder (7×7 conv at full res, 3
stride-2 convs, 6 ResNet blocks at 1/8) + decoder (UNet, 384-ch bottleneck) ≈ **200
GFLOPs per page**.

- WASM/SIMD (~1–5 GFLOPS effective): **40–200 s per page**. Unusable.
- WebGPU: ~20–80 ms per page. Breaks keystroke-driven preview.
- Cost side: ONNX export (not in repo, needs PyTorch), ~42 MB fp32 / ~11 MB int8 download,
  off-main-thread execution + a new cache-invalidation surface to preserve invariant 7
  (preview ≡ print). That is a large architectural change for unknown gain.

### Blocker 2 — it cannot honour print physics

Our raster dpi is the printer's (`core/doc/types.ts:295`, clamped 100–1200 by `normalizeDpi`,
`validate.ts:94`).
The same learned dot pitch is the wrong physical lpi on a 30 mm sticker and on a 300 mm
label. Fixing that means retraining per dpi/pitch — and the repo has no training code.
Even *with* checkpoints in hand, this blocker stands.

### Blocker 3 — it is not a quantizer

See §1: continuous generative intermediate, no discrete levels. There is nothing to
"quantize to".

**And the goal is inverted.** ScreenStyle *generates* screentone from a color comic with
learned style transfer. We need a fast, deterministic, physically-pitched binarizer for a
thermal head.

## 3. What IS worth taking (three procedural ideas)

ScreenStyle is valuable as **design rationale** for three things we can implement in ~60
lines of table-driven JS:

1. **Tone quantization.** Manga fills use a handful of discrete screentone sheets
   (10 / 25 / 40 / 60 / 70 / 85 / 100%), not continuous gray. → quantize projected gray
   to `K` levels through a non-linear tone ramp. This is the generalization of the Bayer
   matrix we conceptually already have, from 2 levels to K.
2. **Tone stability / region flatness.** README: the intermediate is *"plain within the
   region with same screentone"* — neighbouring greys collapse to one tone, so no texture
   noise. Procedurally: quantize to the tone index, then run a small median/box filter on
   the **tone-index map** (not on gray). Smooth gradients become clean tone bands, which
   is exactly what a manga artist draws. **This is the single biggest quality lever and
   it is trivial.**
3. **Line/fill separation.** ScreenVAE is conditioned on a line mask and gates the
   reconstruction: `recons = (recons+1)*(line+1)/2-1` (`screenvae.py:82`). Our crude
   version is `DEFAULT_POLICY_BY_TYPE` (text/qr/barcode → `threshold`). The reference
   **corroborates fix (A)** for known debt D-05: the policy mask claims a symbol's whole
   rect rather than its ink, so a screentone policy on a logo with transparency smears
   its cell pattern across the transparent area.

**Point ops are immune to the cross-policy seam problem (D-05).** Confirmed against the current
code, not the earlier analysis: `applyPolicy` (`policy.ts:238-285`) quantizes a **fresh copy of the
whole frame** per policy and scatters only that policy's masked pixels, so a stateless point op
(this screentone, `threshold`) carries nothing across a region edge. D-05's seam drift is a property
of the *diffusers* (`floydSteinberg`, `atkinson`, `ostromoukhov`), listed in the register.

## 4. Design if we ship it

Add `screentone` (and possibly `lineScreen`) to `src/core/render/quantize.ts`:

```
projected gray --toneLUT--> tone index k ∈ [0,K)
k vs rank[(u,v) mod P]     --> ink
```

- **Tone matrix** `rank: Uint8Array(P*P)`, values `0..K-1` — a clustered-dot
  multi-level ordered dither. `ink = k < rank[...]`. O(1)/pixel, one precomputed table,
  no `Float32Array` diffusion buffer → **cheaper than `floydSteinberg`**.
- **Rotation: use an integer lattice basis, not float rotation.** Cell coords
  `(u,v)` from primitive integer vectors `(a,b)` and `(-b,a)` — perpendicular, equal
  length, exact periodicity, tiles perfectly, zero floating point. Classic screen angles
  from `(a,b)`: `(1,0)`→0°, `(4,1)`→14°, `(2,1)`→26.6°, `(1,1)`→45°.
- **Hard precondition: lock the cell pitch to the printer's dot grid.** A thermal head is
  8 dots/mm (203 dpi) or 12 dots/mm (300 dpi). Pitch **must** be an integer number of
  head dots, and ≥ ~0.4–0.5 mm physical. A generic screentone library picks its own pitch
  and would be *worse than FS* on our hardware — moiré/banding, because FS is aperiodic
  and cannot alias. If pitch is not head-locked, do not ship the feature.
- **Tone-stability filter** on the index map (idea 2 above) — `median3` on `k`, then
  re-threshold. ~20 lines, biggest visual win.
- **Extend `QuantizeOptions`** with `levels`, `pitch`, `angle`, `toneGamma`; extend
  `QuantizerId` + `QUANTIZERS`; extend `policyKeyOf`
  (`core/render/policy.ts:151`, now `id:threshold:strength:serpentine:gamma` — it will
  collide two distinct screentone policies that share those params); add
  `quantizerParams` fields in the Object tab; add `en.json` keys; golden-pixel tests per
  variant in `quantize.test.ts`.
- **Never the default for `qr` / `barcode` / `text`.** A screentoned QR does not scan.
  Keep `DEFAULT_POLICY_BY_TYPE` (`policy.ts:24-30`) as-is; screentone is opt-in per node,
  or a global choice for `image` content.
- **Dither `strength` is meaningless** for this quantizer — ignore it, and consider
  reusing the field or documenting it as N/A in the inspector.

### 4a. Head-locked pitch — what the pipeline actually gives us (verified recon, 2026-10-19)

- **The blocker: no head-dpi concept anywhere in the render path.** The raster dpi is
  `doc.label.dpi` (`core/doc/types.ts:295`; clamped 100–1200, `validate.ts:83-97`) and
  `renderLabelPage.ts:570` (`opts.dpi ?? opts.assets?.dpi ?? doc.label.dpi`). The printhead's dot
  resolution is never an input to rendering. So the precondition above collapses to: pitch must be
  an **integer raster px *and* `doc dpi == head dpi`** — outside that equality there is no
  "integer number of head dots" to express.
- **Nothing resamples.** The raster is encoded 1:1 in printer dots (`printLabel.ts:235`
  `ImageEncoder.encodeCanvas`, no scale step). A document whose dpi differs from the head's is
  therefore both **physically mis-scaled** (a 203-dpi page on a ~300-dpi head prints at ≈0.68×) and
  **off the physical dot grid**. The only existing signal is the **non-blocking, advisory**
  `rollDpiMismatch` warning (`components/print/printDialogModel.ts:62-81`, gated at
  `PrintDialog.tsx:189`): it compares the *printer-tag-reported* dpi against `doc.label.dpi` and
  neither blocks nor changes the render dpi. A `dpi` override path exists and is honoured
  (`print/printLabel.ts:122-137` `renderOptionsOf`) — but the dialog never sets it. Registered as
  debt **D-69** ([`tech-debt.md`](tech-debt.md)).
- **Not observable in-repo:** whether the printer firmware internally rescales a raster whose width
  is not the head's dot count. Unknown — do not speculate.
- **Legal pitch table** (pitch = an integer number of head dots; ≥0.2 mm advisory floor, ≥0.5 mm
  preferred; dot pitch = `headDpi/25.4` dots/mm — B1_PRO 567 dots ≈ 48.006 mm ⇒ 300 dpi ⇒ 11.811
  dots/mm):
  - 300 dpi head: 3 dots = 0.254 mm · 5 = 0.423 · 6 = 0.508 · 8 = 0.677 · 10 = 0.847 · 12 = 1.016
  - 203 dpi head: 2 dots = 0.250 mm · 4 = 0.500 · 5 = 0.626 · 6 = 0.751 · 8 = 1.001
  - 600 dpi head: 5 dots = 0.212 mm
- **The dpi of each render path** — a head-locked screen reproduces only at the head dpi and looks
  different on the others: print = **document dpi**; single-page print preview = document dpi; the
  live quantized preview = document dpi when it fits its 1 M px budget (`tech-debt.md` D-60), else
  lower; **gallery/queue thumbnails = 100 dpi** (`components/print/usePrintThumbnails.ts:45`).
- **The reference's own ordered dither is dpi-blind** — `references/niimblue/src/utils/post_process.ts:117-165`
  (`BAYER_MATRICES {2,4,8}`, indexed by integer px `% patternSize`) makes no attempt at physical
  pitch alignment. That is the naive approach; ours must be head-aware.

## 5. Honest cost/benefit

Screentone is **not** a fidelity win over FS for grayscale reproduction — it is a
*stylistic* + *perceptual-stability* win, plus (with head-locked pitch) a controlled
alternative to FS's worm/clump artifacts in shadows. On a thermal head with no halftone
control from the printer, all of it happens in our raster, which is where it belongs.

Order of work if picked up: tone matrix + `levels` (30 lines, no rotation, proves the
look) → head-locked pitch → integer-lattice rotation → tone-stability filter → policy-key
/ inspector / i18n wiring. Each step is independently shippable and independently
testable, which satisfies decision 42's isolation rule.

## 6. If someone insists on the model anyway

Sequence: ONNX export (needs PyTorch + the checkpoint) → int8 → WebGPU → run *before*
`quantizeRgba` as a "screentone synthesis" pre-pass producing a bilevel raster that the
existing `threshold` then passes through. That keeps `Quantizer` pure and preview≡print
by construction. Budget it as a separate phase, not an increment — and re-check Blocker 2
(physical pitch) first, because it is the one that does not go away.