import type { ColorSpace, RgbaBuffer } from './colorspace';
import { OSTROMOUKHOV_COEFFICIENTS } from './ostromoukhovTable';
import { preprocessGrey, projectGrey, toByte } from './preprocess';
import { screentone, type ScreentoneAngle } from './screentone';

export { GAMMA_MAX, GAMMA_MIN, buildToneLut, normalizeGamma } from './preprocess';

/**
 * Quantizers: RGBA(A) → exact black/white 1-bit pixels. Pure and headless — no
 * React, Konva or DOM, no document state. Each quantizer mutates its input
 * buffer in place and returns it (parity with the reference dither impl).
 *
 * Control flow: `preprocess.ts` projects each pixel through the selected
 * `ColorSpace` onto a grey plane and applies the tone curve, then the quantizer
 * (with optional error diffusion) emits exact `0`/`255` from that plane.
 * Diffusion operates on the projected values, never on the raw channels.
 * `MonoColorSpace` is the default; pass `opts.colorSpace` to swap the
 * projection. `invert`/`mirror` are post-quantize print overrides and are not
 * part of preprocessing.
 *
 * The three diffusers are ported from `references/niimblue/src/utils/dither.ts`
 * (`createDiffuser`): error diffusion over a 2D weight grid + `denom`, with an
 * optional `normalize` (default `true`) and `serpentine` scanning (default
 * `true`). `atkinson` opts out of normalization so 2/8 of the error is
 * discarded — that is the characteristic look, not a bug.
 *
 * `ostromoukhov` (`createVariableDiffuser`) is a different animal: the diffusion
 * weights vary per pixel, selected by that pixel's own source level, so it is
 * not expressible as a weight grid. See its own doc comment below.
 */

export interface QuantizeOptions {
    /** Binary threshold: `projected < threshold ? black : white`. Default 128. */
    threshold?: number;
    /** Diffusion strength: 0 → none, 1 → standard, > 1 → stronger. Default 1. */
    strength?: number;
    /** Bidirectional (serpentine) scanning. Default true. */
    serpentine?: boolean;
    /**
     * Tone-curve gamma applied to the **projected source** before the
     * threshold/diffusion pass, clamped to `[0.1, 4]`; a non-finite value
     * (`NaN`, `±Infinity`) normalizes to the neutral `1` (i.e. no curve),
     * matching `normalizeGamma`. `> 1` lightens midtones
     * (dot-gain compensation), `< 1` darkens. Default 1 (neutral). The
     * non-neutral per-strategy default lives in the policy layer
     * (`core/render/policy.ts`), never here, so the engine's own output stays
     * byte-identical to before this option existed.
     */
    gamma?: number;
    /**
     * Screentone tone levels, clamped to `[2, 8]` as an integer. Ignored by
     * every other quantizer. The render default (`4`) lives in the policy layer
     * (`core/render/policy.ts`), never here.
     */
    screentoneLevels?: number;
    /**
     * Screentone cell pitch in mm, clamped to `[0.3, 2.0]` and then snapped to
     * an integer lattice step at `dpi` (see `screentoneSnap`). Ignored by every
     * other quantizer.
     */
    screentonePitchMm?: number;
    /** Screentone screen angle (`0 | 14 | 27 | 45`). Ignored by every other quantizer. */
    screentoneAngle?: ScreentoneAngle;
    /**
     * Screentone dot-gain bias in **screen levels**, clamped to `[-1, 1]`.
     * Positive inks fatter dots (`+1` = one step bolder at every `levels`
     * value), negative thinner; `0` is neutral. Ignored by every other
     * quantizer. The render default (`0`) lives in the policy layer
     * (`core/render/policy.ts`), never here.
     */
    screentoneBoldness?: number;
    /**
     * Effective raster dpi for this pass. **Required by `screentone`** (the
     * pitch can only be snapped to the printer's dot grid at a known
     * resolution); ignored by every other quantizer. Deliberately **not** a
     * policy knob: it is a render-level constant, so it never enters
     * `QuantizerDefaultParams` or a policy key.
     */
    dpi?: number;
    /** Per-pixel projection. Defaults to `MonoColorSpace`. */
    colorSpace?: ColorSpace;
}

/** A quantizer writes final pixels as exact `0`/`255` and returns its buffer. */
export type Quantizer = (rgba: RgbaBuffer, opts?: QuantizeOptions) => RgbaBuffer;

/** Registry keys. Extend here (and `QUANTIZERS`) when adding policies. */
export type QuantizerId =
    | 'threshold'
    | 'floydSteinberg'
    | 'stucki'
    | 'atkinson'
    | 'ostromoukhov'
    | 'screentone';

/**
 * Per-strategy default parameters — the knobs a quantizer uses when neither a
 * node nor the render call supplies a value. `colorSpace` and `dpi` are
 * deliberately excluded: they are render-level choices, not per-strategy
 * defaults.
 */
export type QuantizerDefaultParams = Pick<
    QuantizeOptions,
    | 'threshold'
    | 'strength'
    | 'serpentine'
    | 'gamma'
    | 'screentoneLevels'
    | 'screentonePitchMm'
    | 'screentoneAngle'
    | 'screentoneBoldness'
>;

/**
 * Per-strategy defaults keyed by registry id (see `QUANTIZERS`). A missing id,
 * or a missing param, falls back to the engine defaults (128 / 1 / true). This
 * is user preference data (the store's `quantizerDefaults`), never document
 * data; `core/` never imports the store.
 */
export type QuantizerDefaults = Partial<Record<QuantizerId, QuantizerDefaultParams>>;

/** Write a black/white value to RGB at `offset`, preserving alpha. */
const writePixel = (data: Uint8ClampedArray, offset: number, value: number): void => {
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
};

/**
 * Build an error-diffusion quantizer from a 2D weight grid.
 *
 * - `normalize`: divide kernel weights by their sum so total error is
 *   conserved. Default `true`. Set `false` for kernels (e.g. Atkinson) that
 *   intentionally discard part of the error.
 */
export const createDiffuser = (
    denom: number,
    grid: readonly (readonly number[])[],
    opts?: { normalize?: boolean },
): Quantizer => {
    const normalize = opts?.normalize ?? true;

    if (!grid.length || !grid[0]?.length) {
        throw new Error('createDiffuser: grid must have at least one row and one column');
    }
    if (denom <= 0) {
        throw new Error('createDiffuser: denom must be > 0');
    }

    const rows = grid.length;
    const cols = grid[0].length;
    const originCol = Math.floor(cols / 2);

    const entries: Array<[number, number, number]> = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (r === 0 && c === originCol) continue;
            const w = grid[r][c] ?? 0;
            if (w === 0) continue;
            entries.push([c - originCol, r, w / denom]);
        }
    }

    const sum = entries.reduce((acc, [, , wf]) => acc + wf, 0);
    const kernel: Array<[number, number, number]> =
        normalize && sum !== 0 ? entries.map(([dx, dy, wf]) => [dx, dy, wf / sum]) : entries;
    const reversedKernel = kernel.map(([dx, dy, wf]) => [-dx, dy, wf] as [number, number, number]);

    return (rgba: RgbaBuffer, options: QuantizeOptions = {}): RgbaBuffer => {
        const { threshold = 128, strength = 1, serpentine = true, gamma = 1 } = options;
        const colorSpace = options.colorSpace;
        const { data, width, height } = rgba;

        // Project + tone-curve once into the grey plane; diffusion then works on
        // its floats and never touches the raw channels.
        const plane = projectGrey(rgba, colorSpace);
        preprocessGrey(plane, { gamma });
        const buffer = plane.data;

        const diffusionStrength = Math.max(0, strength);

        for (let y = 0; y < height; y++) {
            const reverse = serpentine && (y & 1) !== 0;
            const start = reverse ? width - 1 : 0;
            const end = reverse ? -1 : width;
            const step = reverse ? -1 : 1;
            const active = reverse ? reversedKernel : kernel;

            for (let x = start; x !== end; x += step) {
                const index = y * width + x;
                const old = buffer[index];
                const value = old < threshold ? 0 : 255;
                const error = old - value;
                writePixel(data, index * 4, value);

                if (diffusionStrength > 0 && error !== 0) {
                    for (const [dx, dy, wf] of active) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            buffer[ny * width + nx] += error * (wf * diffusionStrength);
                        }
                    }
                }
            }
        }

        return rgba;
    };
};

/**
 * Ostromoukhov's variable-coefficient error diffusion.
 *
 * Reference: Ostromoukhov, V. "A Simple and Efficient Error-Diffusion
 * Algorithm." Proc. SIGGRAPH 2001, pp. 567-572. DOI 10.1145/383259.383326.
 * Ported from the author's `varcoeffED.c` (`make_output:502-530`,
 * `distribute_error:443-455`); the coefficient table lives in
 * `ostromoukhovTable.ts`.
 *
 * What makes it different from `createDiffuser`: the diffusion weights are not
 * a fixed kernel — they vary per pixel, chosen from a 256-entry table by that
 * pixel's **uncorrected** source level (`var_coefs_tab[input]`, *not* the
 * error-corrected value). That is why this path keeps two planes: a byte
 * `source` plane that survives the scan untouched, and the float working plane
 * that accumulates error.
 *
 * Kernel — three taps, always: `term_r = i_r*diff/i_sum` → `(x+dir, y)`,
 * `term_dl = i_dl*diff/i_sum` → `(x-dir, y+1)`, `term_d = diff - (term_r +
 * term_dl)` → `(x, y+1)`. `term_d` is the **remainder**, which is what makes the
 * error exactly conserved (`i_sum === i_r + i_dl + i_d` in every row makes the
 * paper's `i_d*diff/i_sum` mathematically identical; the remainder only avoids
 * float drift).
 *
 * Differences from the reference, both deliberate and behaviourally documented:
 *   - the classification is `corrected < threshold` with the engine's default
 *     `128`, where the C uses `corrected_level <= 127.5` with a fixed `127.5`.
 *     The two reproduce each other exactly for every integral corrected value
 *     and differ only in the half-open band `(127.5, 128)` at the default
 *     cutoff; the deviation is deliberate and pinned by a test — see the
 *     classification site.
 *   - `serpentine` is exposed and defaults to `true`. The reference is *always*
 *     serpentine (`dir` flips with the scan direction); `false` scans
 *     left-to-right on every row, which is a deviation from the paper kept for
 *     consistency with the other strategies.
 */
export const createVariableDiffuser = (): Quantizer => {
    return (rgba: RgbaBuffer, options: QuantizeOptions = {}): RgbaBuffer => {
        const { threshold: cutoff = 128, strength = 1, serpentine = true, gamma = 1 } = options;
        const colorSpace = options.colorSpace;
        const { data, width, height } = rgba;

        // Project + tone-curve once into the grey plane. `source` is the rounded
        // byte the coefficient row is indexed by (the C reads a raw source
        // byte); `buffer` keeps the unrounded projection so the neutral `gamma`
        // path stays byte-identical to `createDiffuser`.
        const plane = projectGrey(rgba, colorSpace);
        preprocessGrey(plane, { gamma });
        const buffer = plane.data;
        const source = new Uint8Array(width * height);
        for (let p = 0; p < buffer.length; p++) {
            source[p] = toByte(buffer[p]);
        }

        const diffusionStrength = Math.max(0, strength);

        for (let y = 0; y < height; y++) {
            const reverse = serpentine && (y & 1) !== 0;
            const start = reverse ? width - 1 : 0;
            const end = reverse ? -1 : width;
            const step = reverse ? -1 : 1;
            // Only the tap *positions* flip with the scan direction; the
            // coefficient row never does (`dir` in the reference's make_output).
            const dir = reverse ? -1 : 1;

            for (let x = start; x !== end; x += step) {
                const index = y * width + x;
                const level = source[index];
                const old = buffer[index];
                // Cutoff, deliberately not the reference's: the C declares
                // `threshold = 127.5` as a `double` (`varcoeffED.c:32`) and
                // classifies with `corrected_level <= threshold` (`:516`),
                // whereas this is the engine-wide `corrected < cutoff` with a
                // default `cutoff` of 128. The two reproduce each other exactly
                // for every integral corrected value and differ only in the
                // half-open band `(127.5, 128)` at the default cutoff, where this
                // engine emits BLACK and the reference emits WHITE. The deviation
                // is deliberate — one cutoff semantic shared by every strategy,
                // which keeps `strength: 0` identical to the `threshold`
                // quantizer — and is pinned by a test.
                const intensity = old < cutoff ? 0 : 255;
                // Scale *before* the split, so the remainder tap conserves the
                // scaled error too; `strength: 0` therefore degenerates to a
                // pure point threshold for any positive cutoff. At a non-positive
                // cutoff the output quirk below still forces a source-0 pixel
                // black where that quantizer emits white (pinned by a test).
                const diff = (old - intensity) * diffusionStrength;

                if (diff !== 0) {
                    const coef = level * 4;
                    const i_r = OSTROMOUKHOV_COEFFICIENTS[coef];
                    const i_dl = OSTROMOUKHOV_COEFFICIENTS[coef + 1];
                    // `i_sum` is >= 2 for every level (pinned by a test), so this
                    // can never divide by zero.
                    const i_sum = OSTROMOUKHOV_COEFFICIENTS[coef + 3];
                    const term_r = (i_r * diff) / i_sum;
                    const term_dl = (i_dl * diff) / i_sum;
                    const term_d = diff - (term_r + term_dl);

                    // Bound-check each tap exactly like the static path: what
                    // falls outside the raster is silently dropped.
                    const nx = x + dir;
                    if (nx >= 0 && nx < width) buffer[y * width + nx] += term_r;
                    const ny = y + 1;
                    if (ny < height) {
                        const nxl = x - dir;
                        if (nxl >= 0 && nxl < width) buffer[ny * width + nxl] += term_dl;
                        buffer[ny * width + x] += term_d;
                    }
                }

                // Output stage quirk, replicated from the reference
                // (`make_output:522-524`): the written pixel is BLACK when the
                // **source** level is 0 *or* the quantized level is BLACK, while
                // `diff` above is still computed from the un-forced `intensity`.
                // It keeps solid black solid. `level === 0` is the *tone-mapped*
                // level, matching the C's raw input byte.
                writePixel(data, index * 4, level === 0 || intensity === 0 ? 0 : 255);
            }
        }

        return rgba;
    };
};

/** Simple projection threshold, no diffusion. `projected < threshold ? 0 : 255`. */
export const threshold: Quantizer = (rgba: RgbaBuffer, options: QuantizeOptions = {}): RgbaBuffer => {
    const { threshold: cutoff = 128, gamma = 1 } = options;
    const colorSpace = options.colorSpace;
    const { data } = rgba;

    // One projection + one preprocess pass, then a point op over the plane; no
    // per-pixel tone-LUT lookup of its own.
    const plane = projectGrey(rgba, colorSpace);
    preprocessGrey(plane, { gamma });
    const { data: buffer } = plane;
    for (let p = 0, i = 0; p < buffer.length; p++, i += 4) {
        writePixel(data, i, buffer[p] < cutoff ? 0 : 255);
    }
    return rgba;
};

/** Floyd–Steinberg, 4 neighbours (denom 16). */
export const floydSteinberg: Quantizer = createDiffuser(16, [
    [0, 0, 7],
    [3, 5, 1],
]);

/** Stucki, 12 neighbours (denom 42). */
export const stucki: Quantizer = createDiffuser(42, [
    [0, 0, 0, 8, 4],
    [2, 4, 8, 4, 2],
    [1, 2, 4, 2, 1],
]);

/**
 * Atkinson, 6 neighbours at 1/8 each. Normalization is disabled so only 6/8 of
 * the error is diffused; the other 2/8 is discarded.
 */
export const atkinson: Quantizer = createDiffuser(
    8,
    [
        [0, 0, 0, 1, 1],
        [0, 1, 1, 1, 0],
        [0, 0, 1, 0, 0],
    ],
    { normalize: false },
);

/**
 * Ostromoukhov variable-coefficient diffusion. Its weights vary per pixel, so it
 * is a standalone path rather than a `createDiffuser` grid.
 */
export const ostromoukhov: Quantizer = createVariableDiffuser();

/**
 * Head-locked clustered-dot screentone (P4). Unlike every other quantizer it
 * **requires** `opts.dpi`; see `screentone.ts`.
 */
export { screentone };

/** Extensible registry keyed by `QuantizerId`. */
export const QUANTIZERS: Record<QuantizerId, Quantizer> = {
    threshold,
    floydSteinberg,
    stucki,
    atkinson,
    ostromoukhov,
    screentone,
};
