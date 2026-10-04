import { MonoColorSpace, type ColorSpace, type RgbaBuffer } from './colorspace';
import { applyPolicy, type PolicyMask, type QuantizerPolicies } from './policy';
import type { Quantizer, QuantizeOptions } from './quantize';

/**
 * Pipeline orchestration: colorspace projection → per-policy quantize → final
 * black/white RGBA. Pure and headless — no React, Konva or DOM.
 *
 * The selected `ColorSpace` projects each pixel; the quantizer (and its error
 * diffusion) operates on that projection and emits exact `0`/`255`, which is
 * what `ImageEncoder` keys on. `MonoColorSpace` is the default.
 */

export interface QuantizeRequest {
    /** Base quantizer for the whole frame; mask index `0` resolves to it. */
    globalQuantizer: Quantizer;
    /** Mask index (>= 1) → quantizer. Index `0` is reserved for the global. */
    policies?: QuantizerPolicies;
    /** Per-pixel policy index; absent → a single global pass. */
    mask?: PolicyMask;
    /** Per-pixel projection for every quantizer in this pass. Default Mono. */
    colorSpace?: ColorSpace;
}

/**
 * Quantize an RGBA buffer to 1-bit black/white.
 *
 * Mutates `rgba` in place and returns the same buffer (parity with the
 * reference dither impl; callers that need the source must clone first). With
 * no mask/hints this is exactly one global pass.
 */
export const quantizeRgba = (
    rgba: RgbaBuffer,
    request: QuantizeRequest,
    opts?: QuantizeOptions,
): RgbaBuffer => {
    const policiesById = new Map<number, Quantizer>([[0, request.globalQuantizer]]);
    for (const [index, quantizer] of request.policies ?? []) {
        policiesById.set(index, quantizer);
    }
    // An explicit request color space wins; otherwise the caller's opts (or the
    // quantizer's own default) applies. Never pass `undefined` through — that
    // would let an inner quantizer silently fall back to Mono.
    const effectiveOpts: QuantizeOptions = {
        ...opts,
        colorSpace: request.colorSpace ?? opts?.colorSpace ?? MonoColorSpace,
    };
    return applyPolicy(rgba, request.mask, policiesById, effectiveOpts);
};
