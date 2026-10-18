# P14 — Quantization round 2: action plan

- Phase source: [`plan.md`](plan.md) §P14 (owner items 2026-10-17). State: [`state.md`](state.md) §P14.
- Base: `main` @ `3daa273` (the P14 planning commit). Tree clean, unpushed.
- Baseline: `tsc` clean, **161 files / 2083 tests** green (at the P13b close).
- Reviewer routing: `review` primary, `review-alt` fallback, `review-fast` for docs/narrow re-reviews.
  ⚠ Reviewer shells have been denied all session — the coordinator runs their scoped test/tsc
  commands and records the result; reviews are **static** with runtime evidence from the implementer.
- One semantic commit per item, after its review pass. Depth-1 subagents. No `git stash`.

## Owner decisions (settled 2026-10-17, before coding)

1. **Tone-curve surface = gamma only.** One `gamma` value per strategy. No S-curve, no pivot/contrast,
   no per-node field, no per-paper store (owner: *"keep it simple, just per strat for now"*).
2. **Tone-curve default = non-neutral 1.3, but scoped:** diffusers (`floydSteinberg`, `stucki`,
   `atkinson`, `ostromoukhov`) default `1.3`; `threshold` stays neutral `1.0`.
   Rationale accepted by the owner: a gamma LUT before a point-op threshold only moves the
   binarisation cutoff (128 → ~105), and qr / barcode / code / text are all `threshold` by default,
   so a global 1.3 would silently change how symbols and text print.
3. **Live preview trigger = inspector knobs only** (canvas overlay). No inline preview in the
   Rendering settings section, no non-modal restructure.
4. **Ostromoukhov table = obtained** (see below). No invented coefficients.
5. **Dropped, per owner:** Bayer/ordered dithering, screentone, ScreenStyle/ScreenVAE integration —
   a documentation/register item only; keep the analysis.

## Recon facts (verified 2026-10-17; do not re-verify)

### Engine (`src/core/render/quantize.ts`, 185 LOC)
- `QuantizeOptions` `:20-29` (`threshold`/`strength`/`serpentine`/`colorSpace`); `QuantizerId` `:35`;
  `QuantizerDefaultParams` `:42` = `Pick<QuantizeOptions,'threshold'|'strength'|'serpentine'>`;
  `QuantizerDefaults` `:50`.
- `createDiffuser(denom, grid, {normalize})` `:66-139`. Grey plane built once at `:104-107`
  (`buffer[p] = colorSpace.toGray(r,g,b)`), then the scan loop `:111-135` projects + diffuses.
  Serpentine = `reversedKernel` swap at `:116`. `threshold` point-op at `:142-150` (projection +
  compare inline at `:147`). Registry `QUANTIZERS` `:180-185`.
- **No `DEFAULT_PARAMS` constant here** — engine defaults are inline (`128`/`1`/`true`).
- `toGray` returns a **float**; only `toGrayBuffer` (`colorspace.ts:55-62`) rounds to 8-bit.
- No tone/gamma/level code exists anywhere in `src/` — the seam is unclaimed, no duplication risk.

### Policy (`src/core/render/policy.ts`)
- `DEFAULT_POLICY_BY_TYPE` `:23` (text/qr/barcode/code → `threshold`, image → `floydSteinberg`).
- Engine defaults `:72-74` (`DEFAULT_THRESHOLD` 128 / `DEFAULT_STRENGTH` 1 / `DEFAULT_SERPENTINE` true).
- `resolveQuantizerParams` `:100-115` — chain **node → settings → render fallback → engine default**.
- `policyKeyOf` `:123-124` — **explicit** string `` `${id}:${threshold}:${strength}:${serpentine}` ``.
- `quantizerSettingsKey` `:139-161` — serializes **all** keys of each strategy's params object
  (`Object.keys(params).sort()`), so a new param is included **for free**.
- 8-slot mask palette is **not** here: `KEY_COLORS` (`renderLabelPage.ts:155-164`), cap check
  `:321`, `policyOverflowCount` `:116`/`:649`.
- ⚠ P13 trap (still live): `applyPolicy` merges the global base options **under** each policy's own
  options (`{...opts, ...entry.options}`), so a pixel-changing knob a policy **omits** silently
  inherits the *global* value. Every knob must be set **explicitly** per policy.

### Plumbing
- Store: `quantizerDefaults` / `defaultQuantizerByType` (`storeTypes.ts:163/170`), defaults `{}`
  (`storeDefaults.ts:46/52`), slice setters `settingsSlice.ts:88-94`, persist `useStore.ts:39-40,
  158-159`.
- `preferenceValidation.ts`: `normalizeQuantizerDefaultParams` `:204`, `normalizeQuantizerDefaults`
  `:229`, `normalizeDefaultQuantizerByType` `:244`, wired `:285-289` / `:319-322`.
- Render path: `RenderLabelPageOptions.quantizerDefaults`/`.defaultQuantizerByType`
  (`editor/render/renderLabelPage.ts:70/77`) → `buildPolicyMask` `:589-595`, `buildQuantizeOptions`
  `:475-486`. Callers supply them from the store (`PrintDialog`, `PrintPagePreview`,
  `usePrintThumbnails`, `print/printLabel.ts`).
- Inspector: `RESERVED_FIELDS` (`inspectorModel.ts:220-233`), `quantizerParamVisibility` `:204`;
  rendered by `ObjectTab.tsx` (visibility map `:156-159`, commits `:582-651`).
- Settings UI: `RenderingSection.tsx` (`DIFFUSERS` `:43`, `ThresholdSettings` `:235`,
  `DiffuserSettings` `:171`, `TypeDefaultSelect` `:220`), mounted in a **native modal `<dialog>`**
  (`Modal.tsx:145` `showModal()`) — the canvas is not visible behind it.
- Precedents for the live overlay: `TextEditorOverlay.tsx` (DOM overlay: absolute + `rotate()scale()`,
  mounted as a sibling of `<Stage>` at `PreviewStage.tsx:1841`); `Overlays.tsx` (a react-konva layer
  carrying `layerAttrs` = the viewport transform); `PrintPagePreview.tsx:203` (`renderLabelPage` →
  `canvas.toDataURL`, `previewOptionsKey` incl. `quantizerSettingsKey`, `RangeError` → `too-large`).
- `MAX_RASTER_PIXELS = 16_000_000` (`renderLabelPage.ts:149`), throws `RangeError` beyond.

### Ostromoukhov — the blocker is CLEARED
- **Source obtained:** the author's own reference implementation, on disk in the (gitignored)
  `references/Ostromoukhov/varcoeffED/varcoeffED.c` — `t_three_coefs var_coefs_tab[256]` at
  **lines 182-438**, four ints per row: `i_r` (right/forward), `i_dl` (down-left), `i_d` (down),
  `i_sum`. Table downloaded from the author's page (`iro.umontreal.ca/~ostrom/varcoeffED/`).
- **Indexed 0..255 by the raw *input* level** (uncorrected source byte). Fully expanded — no key-level
  interpolation needed at runtime. Verified invariant: `i_sum === i_r + i_dl + i_d` in every row, and
  the table is antisymmetric (`tab[i] === tab[255-i]`).
- **Kernel (verbatim, `distribute_error` `:443-455`):** three taps, always:
  `term_r = i_r*diff/i_sum` → `(x+dir, y)`; `term_dl = i_dl*diff/i_sum` → `(x-dir, y+1)`;
  `term_d = diff - (term_r + term_dl)` (**remainder**, so the error is conserved exactly) → `(x, y+1)`.
  `diff = corrected - intensity`, `intensity = corrected <= threshold ? BLACK : WHITE`, `threshold = 127.5`.
- **Serpentine is intrinsic** (`make_output` `:502-509`): `dir = +1` on even rows, `-1` on odd rows.
  Only the tap *positions* flip; the coefficient row is chosen by the input level.
- **Reference quirk to replicate (`:522-524`):** the output stage forces BLACK when
  `input == BLACK` (source level exactly 0) *or* `intensity == BLACK`. Cheap, keeps solid black
  solid; pin it with a test.
- **Cross-check:** Observable notebook `@jobleonard/variable-coefficient-dithering`
  (`coefficients_ostromoukhov`) matches the author's table byte-for-byte. It indexes by a
  **linearized** grey and makes serpentine optional — we follow the **paper/C** instead
  (index by the tone-mapped projected level, serpentine intrinsic).
- **Licence:** neither the reference C nor the notebook states one. Transcribe the **numeric fact
  table** and the algorithm; do **not** copy code. Cite the paper in the header comment.
- ⛔ **`references/Ostromoukhov/chat.md` is an LLM-generated summary with a WRONG table**
  (e.g. it gives index 23 = `481,314,185` where the reference says `459,304,161`). **Never use it.**
  Only `varcoeffED.c` is authoritative.

## Waves

Sequential (they share `quantize.ts` / `policy.ts` / `en.json`). One commit per wave.

### W1 — Tone curve / gamma LUT per strategy (item 1)

**Semantics.** `gamma` = a 256-entry tone LUT applied to the **projected source** value, before the
threshold/diffusion pass: `lut[i] = round(255 * (i/255) ** (1/gamma))`, identity at `gamma === 1`.
`gamma > 1` **lightens** midtones (dot-gain compensation); `gamma < 1` darkens. Clamp `[0.1, 4]`.

- **Index** by the rounded+clamped projected value (`Math.round`, clamp 0..255) — the LUT is 256-wide
  by definition and this matches the reference's byte semantics. Factor it into one small exported
  helper (e.g. `buildToneLut(gamma)` in `quantize.ts`) so both quantizer paths share it.
- **Apply once when the grey plane is built** (`quantize.ts:104-107`), **not** inside the scan loop —
  the curve maps the *source*, never the error-adjusted value. `threshold` (`:147`) applies the same
  LUT to its per-pixel projection (it has no plane).
- **Engine default stays neutral** (`gamma ?? 1`) so every existing golden-plane test keeps passing
  byte-identically; the **1.3 default lives in the policy layer**.

**Plumbing (all of it):**
1. `QuantizeOptions.gamma?: number`; `QuantizerDefaultParams` gains `'gamma'`.
2. `policy.ts`: add `gamma` to `PolicyParams` + `ResolvedPolicyParams`; a per-strategy engine default
   map (e.g. `DEFAULT_GAMMA_BY_STRATEGY: Record<QuantizerId, number>` = 1 for `threshold`, 1.3 for the
   diffusers; `ostromoukhov` lands in W2) and use it as the last fallback in `resolveQuantizerParams`.
3. **`policyKeyOf` must key gamma** (explicit string — the D-57(b) trap). `quantizerSettingsKey` is
   automatic (it enumerates all param keys) but **assert that in a test**, since preview/thumbnail
   staleness (R13-c) depends on it.
4. **`buildQuantizeOptions` / `buildPolicyMask` (`renderLabelPage.ts:475-486`, `:589-595`) must set
   gamma explicitly for the global pass *and* for every per-policy entry** — the P13 trap: an omitted
   knob inherits the global value, and gamma differs *per strategy*, so an omission silently applies
   the wrong curve.
5. `preferenceValidation.ts`: clamp gamma (0.1–4, 2dp) in `normalizeQuantizerDefaultParams`; keep the
   existing "drop unknown strategy" behaviour.
6. `RenderingSection.tsx`: a gamma number field in **both** `ThresholdSettings` and `DiffuserSettings`
   (threshold's default is 1). Reuse the existing number-field commit/step conventions.
7. `en.json`: `settings.rendering.*` label + description for gamma. No inspector field, no new node
   field, no `RESERVED_FIELDS` change, no doc migration.

**Tests:** `quantize.test.ts` — LUT identity at 1 / monotonic / lightening direction / clamping;
`gamma: 1` reproduces the existing golden planes byte-for-byte; threshold cutoff shift is measured and
pinned. `policy.test.ts` — resolve chain precedence for gamma, per-strategy defaults (threshold 1 vs
diffusers 1.3), `policyKeyOf` differs when only gamma differs, `quantizerSettingsKey` moves when gamma
moves. `preferenceValidation.test.ts` — clamps. `RenderingSection.test.tsx` — commit/clamp.
`renderLabelPage.test.ts` — a per-policy gamma actually reaches the pass (no global inheritance).

### W2 — Ostromoukhov (item 3)

1. **Transcribe the table** from `references/Ostromoukhov/varcoeffED/varcoeffED.c:182-438` into a new
   `src/core/render/ostromoukhovTable.ts`: `Uint16Array` of 1024 entries, row-major
   `[i_r, i_dl, i_d, i_sum]` × 256, with the citation + "source of truth is the .c file" comment.
   **Anti-transcription-error step (required):** run a throwaway script with the local `bun` binary
   that parses the `.c` table and diffs it against the TS table; report **mismatch count 0** in the
   receipt. Do **not** commit the script, do **not** read `chat.md`.
2. **New `variableDiffuser` path** beside `createDiffuser` (`quantize.ts:66`). It needs the
   *uncorrected* source level per pixel: keep the working plane (`Float32Array`, error-accumulating)
   **and** a `Uint8Array` source level plane. Scan order and serpentine mirror the existing engine
   (default `true`); `serpentine: false` is a documented deviation from the paper (which is always
   serpentine).
   - classification: `corrected = working[i]`, `value = corrected < threshold ? 0 : 255` (our existing
     `<` convention, default 128 — the reference uses `<= 127.5`; identical for practical values,
     document the difference).
   - `diff = (corrected - value) * strength` **before** the split, so the remainder term still
     conserves the (scaled) error; `strength 0` degenerates to the point threshold.
   - replicate the reference's `source === 0 → BLACK` quirk (`:522-524`), commented with the source line.
   - bound-check all three taps exactly like the static path (`:129`).
   - the coefficient row is indexed by the **tone-mapped** source level (W1's LUT), i.e. the same value
     the diffuser sees as input.
3. Register: `QuantizerId` + `QUANTIZERS` (`validate.ts` derives `QUANTIZER_IDS` automatically, the
   inspector select and the settings `DIFFUSERS` list are derived too). Leave
   `DEFAULT_POLICY_BY_TYPE` **alone**.
   i18n: `editor.mfp.quantizerOptions.ostromoukhov` (+ the settings-section label if it does not reuse
   that key).
4. **Print/typecheck cleanliness:** keep `core/` store-free; no new doc field, no migration.

**Tests:** table invariants (1024 entries, `i_sum === i_r+i_dl+i_d`, antisymmetry `tab[i] === tab[255-i]`,
the spot values scout checked: 0, 11, 23, 24, 25, 37, 64, 73, 76, 86, 108, 127, 128, 191, 255);
a deterministic golden plane; **a hand-derived small case** using a coefficient row with small ratios
(index 22 = `3,2,1,6`, 64 = `1,1,0,2`, 77 = `4,1,1,6`) so the expected output is computed by hand
rather than by the implementation; error conservation; `strength 0` ≡ threshold; serpentine on/off
differ; composition with the W1 LUT; the `source === 0` quirk.

### W3 — Live quantized preview (item 4)

- **Trigger:** the selected node's quantization-relevant state changes from the **inspector**
  (`quantizerHint` / `quantizerParams.threshold|strength|serpentine`). No trigger from the Rendering
  settings modal (canvas hidden).
- **Render:** `renderLabelPage` with the editor's already-prepared assets, **capped dpi**, guarded by
  `MAX_RASTER_PIXELS` (`RangeError` → silently skip). Reuse the P13 cache-key work
  (`quantizerSettingsKey` / `previewOptionsKey`) so a stale result cannot be shown.
- **Display:** overlay the label area only, `pointer-events: none`, aligned to the viewport transform
  (pan/zoom/rotation). A react-konva layer carrying `layerAttrs` (the `Overlays.tsx` precedent) is the
  recommended shape — an image of the page at the scene origin needs no DOM placement math. A small
  "quantized preview" affordance (i18n'd) must accompany it so the black-and-white canvas is not
  mistaken for a broken document.
- **Lifecycle:** debounce (target <100 ms), auto-revert after ~1.5 s idle, cancel pending renders
  (per-generation token, the P13b pattern), revoke/release the bitmap, StrictMode-idempotent, revert on
  unmount / doc switch / tool change.
- **Hard constraints:** never mutate the doc, never push an undo entry, never touch the print path's
  cache.
- **Tests:** fake-timer hook tests (debounce, revert, cancellation, no-op when a non-quantization field
  changes, no-op with no selection) + an overlay render test (pointer-events none, gone after the
  timeout) + an assertion that no store mutation/undo occurs.

### W4 — Dropped methods + register (item 2, docs only)

- `memory/dithering.md`: mark ordered/Bayer, screentone, ScreenStyle/ScreenVAE **dropped by the owner
  (2026-10-17)** — keep the analysis, change the "missing/pending" wording to "dropped"; update §2.1
  (Ostromoukhov now implemented, table sourced from the author's reference impl), §2.2 (tone curve
  implemented as gamma-only per strategy), §4 (the tone-curve *doc field* row is now moot — gamma is a
  setting, not doc data), §7 (the "still NOT implemented" list).
- `memory/screenstyle-quantization.md`: header banner — dropped by owner, kept as design rationale.
- `tech-debt.md`: new rows for the P14 residuals (see Risks) + note that D-05 now also applies to
  Ostromoukhov. Keep D-05 itself open.
- No `objects-assets.md` change (no node/doc field is added this phase).

## Review routing & commits

| Wave | Reviewer | Commit |
|---|---|---|
| W1 | `review` | `feat(quantize): gamma tone-curve LUT per strategy` |
| W2 | `review` (+ `review-fast` re-review of fixes) | `feat(quantize): Ostromoukhov variable-coefficient dither` |
| W3 | `review` | `feat(editor): live quantized preview while tuning` |
| W4 | `review-fast` | `docs(p14): record the quantization round-2 outcome` |

Max 2 fix rounds per wave, then escalate to the owner.

## Risks

- **R14-a — the P13 trap repeats with gamma.** Any policy that omits gamma inherits the global value.
  Explicitly set it everywhere; test it.
- **R14-b — mask-palette overflow (R13-a).** Gamma is another key dimension → more distinct policy
  keys for the same 8 slots. Watch `policyOverflowCount`; report, don't fix here.
- **R14-c — transcription.** A single wrong coefficient row is invisible. Mandatory script diff + the
  pinned spot values + the hand-derived case.
- **R14-d — preview cost.** A full `renderLabelPage` per keystroke. Debounce, cap dpi, cancel by token,
  and never render when nothing quantization-relevant changed.
- **R14-e — preview fidelity.** A capped-dpi render does not reproduce the print raster 1:1; the dot
  pattern is a function of dpi. Document it in the code and (minimally) in the UI affordance.
- **R14-f — `atkinson` + gamma.** Atkinson discards 2/8 of the error by design; a lightening curve on
  top trims the top end further. Just note it; no tuning without hardware.
- **R14-g — `threshold` + gamma.** Now possible by choice; it only moves the cutoff. Document, don't
  forbid.

## Residuals to record in W4 (draft)

- gamma is a per-strategy setting only → a *per-paper* or per-node curve is not expressible (owner's
  deliberate simplification; revisit if paper-dependent tuning is ever wanted).
- the live preview is inspector-only, so tuning the per-strategy defaults in the settings modal is
  still blind.
- Ostromoukhov licences are unclear → the numeric table must be transcribed by hand, never vendored
  code.
