# P1 action plan — grey preprocess stage + per-object gamma

- Parent plan: [`plan.md`](plan.md) §P1. Status: **in progress** (2026-10-19).
- Goal: one named grey-domain preprocess stage (gamma as its first member) used by every quantizer,
  and `quantizerParams.gamma` as document data with node → per-strategy setting → engine default
  precedence. **Retires D-58.**

## Decision: no projection hoist — extract the stage instead

The parent plan leaves this open. Decision: **keep the `Quantizer` contract
`(rgba, opts) => rgba`** and extract the projection + tone curve into a new pure module
`src/core/render/preprocess.ts`, called by all three engines at their existing plane-build site.

Why not hoist the projection out into `applyPolicy`:

- `Quantizer` is public, exercised directly by `quantize.test.ts` / `policy.test.ts` and by the
  pipeline. A hoist either breaks that contract or adds a clever dual-form function object —
  neither changes output.
- The win would be one projection pass per frame instead of (policies + 1); projection is cheap
  compared with the diffusion scans, and the per-policy copy still exists today anyway.
- What P4 needs is the **seam** (a named grey chain applied after projection, before the point
  op), not projection sharing. The extracted module gives exactly that.

Rejected alternative kept on record: `copy → project (once) → preprocess(per policy) → quantize →
scatter` inside `applyPolicy`. Revisit only if projection cost shows up in a profile.

## Work items

### W1 — `preprocess.ts` + quantizer refactor (owner: `general`)

New `src/core/render/preprocess.ts`:

- `GreyPlane { data: Float32Array; width; height }` (one float per pixel, 0..255).
- `projectGrey(rgba, colorSpace = MonoColorSpace): GreyPlane` — the existing projection loop.
- `GreyOp = (plane: GreyPlane) => void`; pure grey op, in place.
- `PreprocessParams { gamma?: number }` — v1 chain membership is **tone only**; `invert`/`mirror`
  stay post-quantize print overrides (moving them would change output).
- `buildPreprocessChain(params): GreyOp[]` — ordered; neutral params → `[]`.
- `preprocessGrey(plane, params): void` — applies the chain in order.
- Move `GAMMA_MIN`/`GAMMA_MAX`/`normalizeGamma`/`buildToneLut`/`toneLutFor` here; keep them
  re-exported from `quantize.ts` (and `core/render/index.ts`) so the public surface is unchanged.

`quantize.ts`:

- `createDiffuser`: `projectGrey` → `preprocessGrey` → scan the returned plane.
- `createVariableDiffuser`: same, then derive `source[p] = toByte(plane.data[p])` (unchanged maths).
- `threshold`: project → preprocess → point op over the plane (no per-pixel LUT lookup duplication).
- **Neutral byte-identity is the hard constraint**: gamma 1 must not round the projection.
- `Quantizer` stays `(rgba, opts) => rgba`, sync, pure, in-place.

Tests (`src/core/render/preprocess.test.ts` + existing suites):

- neutral chain is a no-op; `preprocessGrey` on a neutral param leaves the plane byte-identical;
- gamma op matches `buildToneLut` entry for entry; LUT clamps/normalises as before;
- `projectGrey` equals per-pixel `colorSpace.toGray`;
- every existing golden plane / gamma test still passes byte-for-byte.

### W2 — document data: `quantizerParams.gamma` (owner: `small-coder`)

- `src/core/doc/types.ts:83` — add `gamma?: number`.
- `src/core/doc/validate.ts` — import `GAMMA_MIN`/`GAMMA_MAX`; round to 2 dp, clamp `[0.1,4]`,
  drop non-finite with a repair message; same pattern as `strength`. Unknown keys stay dropped.
- `src/core/doc/factory.ts` — `roundNode` rounds/clamps gamma 2 dp like `strength`; drop the whole
  object when it rounds to empty.
- Tests: validate repairs (2 dp, clamp, non-finite drop), factory round-trip, `{}` still deleted.

### W3 — inspector + i18n (owner: `small-coder`)

- `src/editor/inspectorModel.ts` — add `{ key: 'quantizerGamma', scope: 'reserved', kind:
  'number', wired: true }` to `RESERVED_FIELDS`.
- `src/components/editor/ObjectTab.tsx`:
  - `FIELD_LABEL_KEYS.quantizerGamma = 'editor.mfp.field.quantizerGamma'`;
  - `numberValue`: `node.quantizerParams?.gamma ?? <engine default for the effective strategy>`
    (use `resolveQuantizer(first, defaultQuantizerByType)` + `DEFAULT_GAMMA_BY_STRATEGY`; this
    mirrors the existing "show the effective default" convention of Threshold/Error diffusion);
  - `numberRange`: `{ min: 0.1, max: 4, step: 0.05 }`;
  - `setNumber`: clamp `[0.1,4]`, round 2 dp, merge into `quantizerParams`; delete the field when
    it equals the effective strategy's **engine default** (same convention as threshold 128 /
    strength 1);
  - visibility: gamma applies to **every** visible strategy (it moves a point cutoff too), hidden
    only when `quantizerParamVisibility === 'hidden'`. Do this with a small `quantizerGamma`
    special case in `renderField`, not by widening the `threshold`/`diffusion` classes.
- `src/i18n/locales/en.json` — `editor.mfp.field.quantizerGamma`: "Tone curve (gamma)".
  **This agent is the only `en.json` writer this wave.**
- Tests: gamma field renders for threshold and image nodes, hidden for an unquantized shape;
  editing writes 2 dp; clearing-at-default drops the key.

### W4 — integration tests (owner: `tester`, after W1–W3)

- Per-object gamma beats the per-strategy setting at render level (small canvas fixture; keep it
  cheap), and two nodes differing only in gamma take **distinct** mask indices (D-57(b) trap).
- A neutral (`gamma: 1`) doc is byte-identical to no per-node gamma.
- Doc round-trip: `parseDoc` keeps a valid `quantizerParams.gamma`.

## Verification (coordinator runs)

- `bun.exe run test:run src/core/render src/core/doc src/components/editor/ObjectTab.test.tsx`
- `node node_modules/typescript/bin/tsc --noEmit`
- Then `bun.exe run test:run` (full) before the commit.

## Review + commit

- Reviewer: `review` (logic-heavy: engine refactor + doc/UI plumbing).
- Fix rounds: max 2, narrow re-review with `review-fast`.
- Commit: `feat(quantize): grey preprocess stage + per-object gamma`
  (implementation + tests + docs/memory updates only; the pending plan/tech-debt doc edits are
  committed separately before implementation starts).
- After commit: update `agent/memory/tech-debt.md` (D-58 retired) and `agent/memory/dithering.md`
  §9, phase receipt, ask the owner before P2.
