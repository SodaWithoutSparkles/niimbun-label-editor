import { MonoColorSpace, type ColorSpace, type RgbaBuffer } from './colorspace';

/**
 * Quantizers: RGBA(A) → exact black/white 1-bit pixels. Pure and headless — no
 * React, Konva or DOM, no document state. Each quantizer mutates its input
 * buffer in place and returns it (parity with the reference dither impl).
 *
 * Control flow: the selected `ColorSpace` projects each pixel to a scalar, then
 * the quantizer (with optional error diffusion) emits exact `0`/`255`. Diffusion
 * operates on the projected values, never on the raw channels. `MonoColorSpace`
 * is the default; pass `opts.colorSpace` to swap the projection.
 *
 * The three diffusers are ported from `references/niimblue/src/utils/dither.ts`
 * (`createDiffuser`): error diffusion over a 2D weight grid + `denom`, with an
 * optional `normalize` (default `true`) and `serpentine` scanning (default
 * `true`). `atkinson` opts out of normalization so 2/8 of the error is
 * discarded — that is the characteristic look, not a bug.
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
    /** Per-pixel projection. Defaults to `MonoColorSpace`. */
    colorSpace?: ColorSpace;
}

/** A quantizer writes final pixels as exact `0`/`255` and returns its buffer. */
export type Quantizer = (rgba: RgbaBuffer, opts?: QuantizeOptions) => RgbaBuffer;

/** Registry keys. Extend here (and `QUANTIZERS`) when adding policies. */
export type QuantizerId = 'threshold' | 'floydSteinberg' | 'stucki' | 'atkinson';

/**
 * Per-strategy default parameters — the knobs a quantizer uses when neither a
 * node nor the render call supplies a value. `colorSpace` is deliberately
 * excluded: it is a per-render projection choice, not a per-strategy default.
 */
export type QuantizerDefaultParams = Pick<
    QuantizeOptions,
    'threshold' | 'strength' | 'serpentine' | 'gamma'
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

/** Tone-curve gamma clamp, shared by the engine, the validator and the UI. */
export const GAMMA_MIN = 0.1;
export const GAMMA_MAX = 4;

/**
 * Normalise a caller-supplied gamma into the tone curve's domain: any
 * non-finite value (`NaN`, `±Infinity`) collapses to the neutral `1`, and a
 * finite value is clamped to `[GAMMA_MIN, GAMMA_MAX]`. Shared by `buildToneLut`
 * and `toneLutFor` so a stray render-level fallback can never reach the LUT as
 * `NaN` (which would zero every entry and raster a black page).
 */
export const normalizeGamma = (gamma: number): number =>
    Number.isFinite(gamma) ? Math.min(GAMMA_MAX, Math.max(GAMMA_MIN, gamma)) : 1;

/** Round + clamp a projected grey to the tone LUT's index domain (`0..255`). */
const toByte = (value: number): number => Math.min(255, Math.max(0, Math.round(value)));

/**
 * Build the 256-entry tone-curve LUT for `gamma` (`normalizeGamma`d to
 * `[0.1, 4]`): `lut[i] = round(255 * (i / 255) ** (1 / gamma))`. Identity at
 * `gamma === 1`; `> 1` lightens midtones (dot-gain compensation), `< 1`
 * darkens. Index it with the rounded + clamped projected value (`0..255`).
 * Shared by both quantizer paths so the curve can never drift between them.
 */
export const buildToneLut = (gamma: number): Uint8Array => {
    const exponent = 1 / normalizeGamma(gamma);
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
        lut[i] = Math.round(255 * (i / 255) ** exponent);
    }
    return lut;
};

/**
 * The tone LUT for `gamma`, or `undefined` for the neutral value. The neutral
 * path must **not** round the projection, so a `normalizeGamma`d `1` stays
 * byte-identical to the output from before the tone curve existed.
 */
const toneLutFor = (gamma: number): Uint8Array | undefined => {
    const normalized = normalizeGamma(gamma);
    return normalized === 1 ? undefined : buildToneLut(normalized);
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
        const colorSpace = options.colorSpace ?? MonoColorSpace;
        const { data, width, height } = rgba;

        const buffer = new Float32Array(width * height);
        // The tone curve maps the **source**, so it is baked into the grey plane
        // once here — never applied to the error-adjusted value in the scan loop.
        const toneLut = toneLutFor(gamma);
        for (let p = 0, i = 0; i < data.length; p++, i += 4) {
            const gray = colorSpace.toGray(data[i], data[i + 1], data[i + 2]);
            buffer[p] = toneLut === undefined ? gray : toneLut[toByte(gray)];
        }

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

/** Simple projection threshold, no diffusion. `projected < threshold ? 0 : 255`. */
export const threshold: Quantizer = (rgba: RgbaBuffer, options: QuantizeOptions = {}): RgbaBuffer => {
    const { threshold: cutoff = 128, gamma = 1 } = options;
    const colorSpace = options.colorSpace ?? MonoColorSpace;
    const { data } = rgba;
    // No grey plane here, so the same tone curve is applied per pixel. It maps
    // the source, so only the binarisation cutoff moves.
    const toneLut = toneLutFor(gamma);
    for (let i = 0; i < data.length; i += 4) {
        const gray = colorSpace.toGray(data[i], data[i + 1], data[i + 2]);
        const projected = toneLut === undefined ? gray : toneLut[toByte(gray)];
        writePixel(data, i, projected < cutoff ? 0 : 255);
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

/** Extensible registry keyed by `QuantizerId`. */
export const QUANTIZERS: Record<QuantizerId, Quantizer> = {
    threshold,
    floydSteinberg,
    stucki,
    atkinson,
};
