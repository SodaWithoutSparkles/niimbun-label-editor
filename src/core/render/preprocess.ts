import { MonoColorSpace, type ColorSpace, type RgbaBuffer } from './colorspace';

/**
 * Grey-domain preprocess stage: RGBA(A) → one float per pixel, then an ordered
 * chain of pure plane operations before the quantizer binarises. Pure and
 * headless — no React, Konva, DOM, document or store state.
 *
 * The projection (the selected `ColorSpace`) and the tone curve (gamma LUT) live
 * here so every quantizer path — the weight-grid diffusers, Ostromoukhov's
 * variable diffuser and the point threshold — sees exactly the same source
 * plane. `invert`/`mirror` are deliberately **not** part of this chain: they are
 * post-quantize print overrides, and moving them would change output.
 *
 * v1 membership is the tone curve only. Neutral params build an **empty** chain:
 * the neutral path must not round the projection, so `gamma: 1` (and an absent
 * gamma) stays byte-identical to the output from before this stage existed.
 */

/** One float per pixel, row-major, in the projection's value domain. */
export interface GreyPlane {
    data: Float32Array;
    width: number;
    height: number;
}

/**
 * Project each RGBA pixel to a scalar grey via `colorSpace` (default
 * `MonoColorSpace`). One float per pixel; the value is **not** rounded.
 */
export const projectGrey = (rgba: RgbaBuffer, colorSpace: ColorSpace = MonoColorSpace): GreyPlane => {
    const { data, width, height } = rgba;
    const plane = new Float32Array(width * height);
    for (let p = 0, i = 0; i < data.length; p++, i += 4) {
        plane[p] = colorSpace.toGray(data[i], data[i + 1], data[i + 2]);
    }
    return { data: plane, width, height };
};

/** A pure in-place plane operation. Chain entries are applied in array order. */
export type GreyOp = (plane: GreyPlane) => void;

/** Preprocess knobs. v1: the tone curve only. */
export interface PreprocessParams {
    /**
     * Tone-curve gamma applied to the projected plane, clamped to
     * `[GAMMA_MIN, GAMMA_MAX]`; non-finite values normalize to the neutral `1`.
     * `> 1` lightens midtones, `< 1` darkens. Absent or `1` → no-op.
     */
    gamma?: number;
}

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
export const toByte = (value: number): number => Math.min(255, Math.max(0, Math.round(value)));

/**
 * Build the 256-entry tone-curve LUT for `gamma` (`normalizeGamma`d to
 * `[0.1, 4]`): `lut[i] = round(255 * (i / 255) ** (1 / gamma))`. Identity at
 * `gamma === 1`; `> 1` lightens midtones (dot-gain compensation), `< 1`
 * darkens. Index it with the rounded + clamped projected value (`0..255`).
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

/** Map every plane value through `lut`, preserving the float plane in place. */
const toneCurveOp = (lut: Uint8Array): GreyOp => {
    return (plane: GreyPlane): void => {
        const { data } = plane;
        for (let p = 0; p < data.length; p++) {
            data[p] = lut[toByte(data[p])];
        }
    };
};

/**
 * Build the ordered preprocess chain for `params`. Neutral params return an
 * empty array, so `preprocessGrey` is a true no-op (no rounding).
 */
export const buildPreprocessChain = (params: PreprocessParams): GreyOp[] => {
    const toneLut = toneLutFor(params.gamma ?? 1);
    return toneLut === undefined ? [] : [toneCurveOp(toneLut)];
};

/**
 * Apply `ops` to `plane` in array order. Exposed so the ordering guarantee is
 * directly testable without the tone op.
 */
export const applyGreyChain = (plane: GreyPlane, ops: readonly GreyOp[]): void => {
    for (const op of ops) op(plane);
};

/** Apply the preprocess chain for `params` to `plane`, mutating it in place. */
export const preprocessGrey = (plane: GreyPlane, params: PreprocessParams): void => {
    applyGreyChain(plane, buildPreprocessChain(params));
};
