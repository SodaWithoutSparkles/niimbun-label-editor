/**
 * Color-space seam for the render pipeline. Pure and headless — no React,
 * Konva or DOM.
 *
 * v1 ships a single colour space: **Mono** (luminance). RedBlack /
 * RedGrayscale are typed seams only; the `ColorSpaceId` union stays `'mono'`
 * until a multi-ink transport needs them. Do not import this module into
 * anything that needs the DOM `ImageData` type — `RgbaBuffer` is deliberately
 * a structural subset so tests can build plain objects.
 */

/** Minimal `ImageData`-shaped buffer. Structurally compatible with `ImageData`. */
export interface RgbaBuffer {
    data: Uint8ClampedArray;
    width: number;
    height: number;
}

/** Rec. 601 luma weights — the Mono projection. */
export const MONO_RED_WEIGHT = 0.299;
export const MONO_GREEN_WEIGHT = 0.587;
export const MONO_BLUE_WEIGHT = 0.114;

/** Single source of truth for the Mono luminance formula. */
export const monoLuminance = (r: number, g: number, b: number): number =>
    r * MONO_RED_WEIGHT + g * MONO_GREEN_WEIGHT + b * MONO_BLUE_WEIGHT;

/**
 * Only `'mono'` exists in v1. `'redBlack' | 'redGrayscale'` are the documented
 * post-v1 seams; widen this union (and `COLOR_SPACES`) then, not now.
 */
export type ColorSpaceId = 'mono';

/**
 * A color space is a **per-pixel projection**: RGBA channels → one scalar the
 * quantizers threshold and diffuse. The projection is injected (not hard-coded)
 * so the pipeline can run any space; `MonoColorSpace` is the default.
 */
export interface ColorSpace {
    readonly id: ColorSpaceId;
    /** Project one pixel's channels to the scalar the quantizer operates on. */
    toGray(r: number, g: number, b: number): number;
}

export const MonoColorSpace: ColorSpace = {
    id: 'mono',
    toGray: monoLuminance,
};

/**
 * Buffer-level projection convenience (one rounded 8-bit channel per pixel).
 * Quantizers call `ColorSpace.toGray` directly on the raw buffer; this helper is
 * for callers that want a standalone gray plane.
 */
export const toGrayBuffer = (colorSpace: ColorSpace, rgba: RgbaBuffer): Uint8Array => {
    const { data, width, height } = rgba;
    const gray = new Uint8Array(width * height);
    for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
        gray[p] = Math.round(colorSpace.toGray(data[i], data[i + 1], data[i + 2]));
    }
    return gray;
};

/** Extensible registry keyed by `ColorSpaceId` (only `mono` in v1). */
export const COLOR_SPACES: Record<ColorSpaceId, ColorSpace> = {
    mono: MonoColorSpace,
};
