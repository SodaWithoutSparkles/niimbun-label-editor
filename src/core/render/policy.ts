import type { RgbaBuffer } from './colorspace';
import type { Quantizer, QuantizerId, QuantizeOptions } from './quantize';

/**
 * Per-object quantizer policy. Pure and headless — no React, Konva or DOM.
 *
 * A node carries an optional `quantizerHint`. When absent, its `type` selects a
 * default policy. The resolver output is a `QuantizerId`; the raster layer
 * turns node coverage into a `PolicyMask` (one byte per pixel, `0` = global).
 */

/**
 * Type → default policy. Types without an entry fall through to the global
 * pass (`undefined`). `text`/`qr`/`barcode` are line-like and threshold well;
 * photographic `image` content dithers.
 */
export const DEFAULT_POLICY_BY_TYPE: Readonly<Partial<Record<string, QuantizerId>>> = {
    text: 'threshold',
    qr: 'threshold',
    barcode: 'threshold',
    image: 'floydSteinberg',
};

/**
 * The slice of a node the policy needs. Kept structural so this module does not
 * depend on the document types module (the `quantizerHint` field lands in a
 * parallel workstream); a full `BaseNode` satisfies it once typed.
 */
export interface PolicyNode {
    type?: string;
    quantizerHint?: QuantizerId;
}

/** Explicit hint wins; else the per-type default; else the global pass. */
export const resolveQuantizer = (node: PolicyNode): QuantizerId | undefined => {
    if (node.quantizerHint !== undefined) return node.quantizerHint;
    const { type } = node;
    // `hasOwn` (not a bare index) so a hostile `type` like 'toString' cannot
    // return an inherited `Object.prototype` member.
    if (type === undefined || !Object.hasOwn(DEFAULT_POLICY_BY_TYPE, type)) return undefined;
    return DEFAULT_POLICY_BY_TYPE[type];
};

/** Per-pixel policy index. `0` is reserved for the global/default quantizer. */
export interface PolicyMask {
    data: Uint8Array;
    width: number;
    height: number;
}

/** Policy index (>= 1) → quantizer. `0` is the global quantizer. */
export type QuantizerPolicies = ReadonlyMap<number, Quantizer>;

/** A fresh RGBA copy of `source` to run one quantizer pass without side effects. */
const copyFrom = (source: Uint8ClampedArray, width: number, height: number): RgbaBuffer => ({
    data: new Uint8ClampedArray(source),
    width,
    height,
});

/**
 * Apply one quantizer per masked segment in a single pass over the final RGBA.
 *
 * `policiesById` must contain index `0` (the global quantizer); other indices
 * match `mask` bytes. Each present non-global quantizer runs over a copy of the
 * original buffer, and its pixels are scattered where `mask === index`. The
 * global result is the base, so a pixel whose index has no registered quantizer
 * (or a missing/mismatched mask) still ends up black/white. With no mask this
 * is exactly one global pass.
 *
 * Throws when `policiesById` has no index `0`: without a global pass the buffer
 * would be returned un-quantized, violating the exact-0/255 contract
 * `ImageEncoder` keys on.
 *
 * Mutates `rgba` in place and returns it (parity with the reference). The
 * approximation: a masked region's error diffuses across the whole frame, then
 * only the region's pixels are kept. Exact per-region error containment is a
 * post-v1 concern.
 *
 * **Mask contract (caller, W2 mask builder):** the mask is one byte per pixel,
 * so overlapping coverage must be resolved *when the mask is written* — last
 * write wins. `applyPolicy` reads the final byte and applies exactly that
 * policy, which is what makes "topmost node wins" hold. Do not expect this
 * function to arbitrate overlaps.
 */
export const applyPolicy = (
    rgba: RgbaBuffer,
    mask: PolicyMask | undefined,
    policiesById: QuantizerPolicies,
    opts?: QuantizeOptions,
): RgbaBuffer => {
    const { width, height, data } = rgba;
    const source = new Uint8ClampedArray(data);
    const out = new Uint8ClampedArray(source);
    const global = policiesById.get(0);

    if (!global) {
        throw new Error('applyPolicy: policiesById must contain index 0 (the global quantizer)');
    }

    const globalWork = copyFrom(source, width, height);
    global(globalWork, opts);
    out.set(globalWork.data);

    const hasMask = mask !== undefined && mask.width === width && mask.height === height;
    if (hasMask) {
        const indices = new Set<number>();
        for (let p = 0; p < mask.data.length; p++) {
            const index = mask.data[p];
            if (index !== 0) indices.add(index);
        }

        for (const index of indices) {
            const quantizer = policiesById.get(index);
            if (!quantizer) continue;
            const work = copyFrom(source, width, height);
            quantizer(work, opts);
            for (let p = 0; p < width * height; p++) {
                if (mask.data[p] !== index) continue;
                const i = p * 4;
                out[i] = work.data[i];
                out[i + 1] = work.data[i + 1];
                out[i + 2] = work.data[i + 2];
                out[i + 3] = work.data[i + 3];
            }
        }
    }

    data.set(out);
    return rgba;
};
