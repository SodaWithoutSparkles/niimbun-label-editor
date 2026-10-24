# P11 — Screentone boldness knob

Owner unblocked 2026-10-25 ("add back the Screentone contrast/boldness knob").
The 2026-10-17 drop was about a **parametric contrast/S-curve**; this is the
narrow, non-overlapping part: a dot-gain **boldness** bias.

## Semantics (decided)

The screentone quantizer maps grey to a screen level and inks the cell where
`rank < level`:

```
tone  = 1 - grey/255            // 0 = white, 1 = black
level = round(tone * maxLevel)  // maxLevel = levels - 1
```

Add a bias **in screen levels**:

```
level = clamp(round(tone * maxLevel + boldness), 0, maxLevel)
```

- `boldness` ∈ **[-1, 1]**, default **0**. Positive = fatter dots (bolder),
  negative = thinner. It is expressed in *levels*, so `+1` is "one screen step
  bolder" at every `levels` value (the visual size of a step differs, by design).
- `boldness = 0` must be **byte-identical** to today (`round(x + 0) === round(x)`).
- At the extremes (`±1`) a 2-level screen saturates to solid black/white; that is
  an explicit user choice, not a bug. Document it.
- It is **not** the upstream px/float-angle algorithm and **not** a contrast
  band: a band would overlap `gamma` and change the meaning of `levels`.

## Deliverables

### 1. `src/core/render/quantize.ts`

- `QuantizeOptions.screentoneBoldness?: number` (JSDoc: screen-level bias,
  clamped to [-1, 1], ignored by every other quantizer).
- Add `'screentoneBoldness'` to the `QuantizerDefaultParams` `Pick<…>`.

### 2. `src/core/render/screentone.ts`

- `export const SCREENTONE_BOLDNESS_MIN = -1;`
  `export const SCREENTONE_BOLDNESS_MAX = 1;`
- `clampBoldness(value)` — absent/non-finite ⇒ 0, otherwise clamp to the range
  (do **not** round: 0.05 steps are meaningful).
- Use it in `screentone()`; update the header JSDoc (the "ignored knobs" list and
  the algorithm line).
- Add `boldness` to the neutral fallbacks note (`0`).

### 3. `src/core/render/policy.ts`

- `DEFAULT_SCREENTONE` gains `boldness: 0`.
- `PolicyParams` and `ResolvedPolicyParams` gain `screentoneBoldness: number`.
- `resolveQuantizerParams`: `node → settings default → DEFAULT_SCREENTONE.boldness`.
- **`policyKeyOf` must include it** (pixel-changing): append
  `:${params.screentoneBoldness.toFixed(2)}` — a `toFixed(2)` key keeps the
  mask-palette identity stable against float noise.

### 4. `src/core/doc/validate.ts`

In the `quantizerParams` block, next to `screentonePitchMm`:
accept a finite number, clamp to `[-1, 1]`, record a repair when clamped; drop
non-finite values. Do not round beyond 2 decimals (store the clamped value).

### 5. `src/store/preferenceValidation.ts`

Normalize `screentoneBoldness` in `quantizerDefaults` the same way (finite,
clamped to `[-1, 1]`, non-finite dropped).

### 6. Inspector

- `src/editor/inspectorModel.ts`: `{ key: 'screentoneBoldness', scope: 'reserved', kind: 'number', wired: true }`.
- `src/components/editor/ObjectTab.tsx`:
  - label key map → `editor.mfp.field.screentoneBoldness`;
  - visibility map → `'screentone'`;
  - default → `DEFAULT_SCREENTONE.boldness`;
  - clamp/step: `[-1, 1]`, step `0.1` (a `PopoverSlider` number field);
  - the write case (like `screentoneLevels`) so the value lands in
    `node.quantizerParams`.

### 7. Settings

`src/components/settings/RenderingSection.tsx`: add the knob to the screentone
strategy block (after Levels, before Pitch), `[-1, 1]`, step `0.1`, default 0,
with a description ("Fatter or thinner screen dots; 0 is neutral").

### 8. i18n (`en.json`)

- `editor.mfp.field.screentoneBoldness`: "Screen boldness"
- `settings.rendering.screentoneBoldness`: "Screen boldness"
- `settings.rendering.screentoneBoldnessDescription`: "Fatter (+) or thinner (−) dots. 0 is neutral."
- `settings.rendering.screentoneBoldnessAria`: `{{strategy}} screen boldness`
- Match the existing `_one/_other` convention only where a count is used (none here).

### 9. Tests

- `src/core/render/screentone.test.ts`:
  - `boldness = 0` and `undefined` produce **identical** buffers;
  - `+1` inks strictly more pixels than `0`, `-1` strictly fewer (use a mid-grey
    fixture, not pure black/white);
  - clamps out-of-range values (`-9 → -1`, `9 → 1`) — same output as the bound;
  - a 2-level screen at `+1` is solid black (documented saturation).
- `src/core/render/policy.test.ts`:
  - `policyKeyOf` differs when only `screentoneBoldness` changes;
  - `resolveQuantizerParams` falls back to 0.
- `src/core/doc/validate.test.ts`: valid value round-trips; out-of-range clamps
  with a repair; non-finite dropped.
- `src/store/preferenceValidation.test.ts`: clamp/drop cases.
- `src/components/editor/ObjectTab.test.tsx`: the knob is visible only for
  screentone and writes `quantizerParams.screentoneBoldness`.
- `src/components/settings/RenderingSection.test.tsx`: the knob writes the
  per-strategy default.

## Constraints

- Do not change `screentoneLevels`/`pitch`/`angle` semantics.
- Default 0 must not change any existing doc's output or any existing policy key
  **for docs that do not set the field** — note `policyKeyOf` will gain a
  `:0.00` segment; that is a key-shape change, not an output change. Update the
  key tests accordingly.
- No new dependencies. 4-space indent, single quotes.

## Done when

- `bun run test -- src/core/render/screentone.test.ts src/core/render/policy.test.ts src/core/doc/validate.test.ts src/store/preferenceValidation.test.ts src/components/editor/ObjectTab.test.tsx src/components/settings/RenderingSection.test.tsx` passes.
- `node node_modules/typescript/bin/tsc --noEmit` clean.
