import type { RgbaBuffer } from './colorspace';
import { normalizeGamma } from './quantize';
import type {
    Quantizer,
    QuantizerDefaultParams,
    QuantizerDefaults,
    QuantizerId,
    QuantizeOptions,
} from './quantize';

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
    code: 'threshold',
    image: 'floydSteinberg',
};

/**
 * A per-object-type default-quantizer override map (the user setting). Kept
 * structural (`string` keys) so this module does not depend on the document
 * types module; the store's `NodeType`-keyed map is assignable to this shape.
 * Types absent here fall back to `DEFAULT_POLICY_BY_TYPE` (see
 * `resolveQuantizer`).
 */
export type QuantizerByType = Readonly<Partial<Record<string, QuantizerId>>>;

/**
 * The slice of a node the policy needs. Kept structural so this module does not
 * depend on the document types module (the `quantizerHint` field lands in a
 * parallel workstream); a full `BaseNode` satisfies it once typed.
 */
export interface PolicyNode {
    type?: string;
    quantizerHint?: QuantizerId;
    quantizerParams?: QuantizeOptions;
}

/**
 * Explicit hint wins; else the supplied per-type override map; else the module
 * constant; else the global pass. The override map only *replaces* the types it
 * names — a type it omits still resolves through `DEFAULT_POLICY_BY_TYPE`, so an
 * empty (default) map is behaviourally identical to before the setting existed.
 */
export const resolveQuantizer = (
    node: PolicyNode,
    defaultByType: QuantizerByType = DEFAULT_POLICY_BY_TYPE,
): QuantizerId | undefined => {
    if (node.quantizerHint !== undefined) return node.quantizerHint;
    const { type } = node;
    if (type === undefined) return undefined;
    // `hasOwn` (not a bare index) so a hostile `type` like 'toString' cannot
    // return an inherited `Object.prototype` member.
    if (Object.hasOwn(defaultByType, type)) return defaultByType[type];
    if (Object.hasOwn(DEFAULT_POLICY_BY_TYPE, type)) return DEFAULT_POLICY_BY_TYPE[type];
    return undefined;
};

/** Engine defaults for the per-strategy knobs, matching `quantize.ts`. */
const DEFAULT_THRESHOLD = 128;
const DEFAULT_STRENGTH = 1;
const DEFAULT_SERPENTINE = true;

/**
 * Per-strategy tone-curve gamma default — the **policy-layer** engine default
 * (`quantize.ts` itself stays neutral). Diffusers default to a mild dot-gain
 * compensation (1.3); `threshold` stays neutral (1) because a curve before a
 * point threshold only moves the binarisation cutoff, silently changing how
 * symbols and text binarise. A new `QuantizerId` must be added here: the
 * `Record` type makes that a compile error.
 */
export const DEFAULT_GAMMA_BY_STRATEGY: Record<QuantizerId, number> = {
    threshold: 1,
    floydSteinberg: 1.3,
    stucki: 1.3,
    atkinson: 1.3,
};

/** A node's explicit quantizer params (structural, mirrors `Node['quantizerParams']`). */
export interface PolicyParams {
    threshold?: number;
    strength?: number;
    serpentine?: boolean;
    gamma?: number;
}

/** A policy's fully-resolved params: every knob has a value. */
export interface ResolvedPolicyParams {
    threshold: number;
    strength: number;
    serpentine: boolean;
    gamma: number;
}

/**
 * Resolve a policy's effective params. Most specific wins:
 *
 *   node param → per-strategy settings default → render-level fallback → engine default
 *
 * An absent per-node value must **not** override the setting (R13-e), so the
 * settings default is consulted before the render-level fallback. `serpentine`
 * resolves through the same chain: a node with no `serpentine` inherits the
 * strategy's settings default rather than pinning `true`. `gamma`'s engine
 * default is per strategy (`DEFAULT_GAMMA_BY_STRATEGY`).
 */
export const resolveQuantizerParams = (
    nodeParams: PolicyParams | undefined,
    id: QuantizerId,
    defaults?: QuantizerDefaults,
    fallback?: PolicyParams,
): ResolvedPolicyParams => {
    const strategy = defaults?.[id];
    return {
        threshold:
            nodeParams?.threshold ?? strategy?.threshold ?? fallback?.threshold ?? DEFAULT_THRESHOLD,
        strength:
            nodeParams?.strength ?? strategy?.strength ?? fallback?.strength ?? DEFAULT_STRENGTH,
        serpentine:
            nodeParams?.serpentine ?? strategy?.serpentine ?? fallback?.serpentine ?? DEFAULT_SERPENTINE,
        gamma:
            nodeParams?.gamma ??
            strategy?.gamma ??
            fallback?.gamma ??
            DEFAULT_GAMMA_BY_STRATEGY[id],
    };
};

/**
 * Stable key for a per-node quantizer policy slot. It names **every** knob that
 * changes pixels — notably `serpentine` (D-57(b)) and `gamma`: two nodes
 * differing only in their *effective* gamma must not share one mask slot, or the
 * first node's params would silently win for both. `gamma` is keyed by its
 * `normalizeGamma`d value, so raw inputs that render identically (e.g.
 * `Infinity` vs `1`, or an out-of-range `10` vs the clamped `4`) share one slot
 * instead of over-splitting the 8-entry palette.
 */
export const policyKeyOf = (id: QuantizerId, params: ResolvedPolicyParams): string =>
    `${id}:${params.threshold}:${params.strength}:${params.serpentine}:${normalizeGamma(params.gamma)}`;

/**
 * Deterministic content key for the dither settings maps. Pure and headless,
 * like the rest of this module.
 *
 * The print page preview (`previewOptionsKey`) and the thumbnail cache
 * (`overridesContentKey`) both key pixels on these maps, but a plain
 * `JSON.stringify` preserves **insertion order**: two equal maps written with
 * different key order would produce different keys and needlessly rebuild the
 * thumbnail cache / re-render the preview. Serializing with **sorted** strategy
 * ids and sorted param keys removes that order dependence, so only a real value
 * change moves the key. Absent/empty inputs both serialize to the same empty
 * form, matching the previous `?? null` behaviour.
 */
export const quantizerSettingsKey = (
    defaults?: QuantizerDefaults,
    byType?: QuantizerByType,
): string => {
    const defaultsById: QuantizerDefaults = defaults ?? {};
    const defaultsPart = Object.keys(defaultsById)
        .sort()
        .map((id) => {
            const params = defaultsById[id as QuantizerId] ?? {};
            const paramsPart = Object.keys(params)
                .sort()
                .map((key) => `${key}=${String(params[key as keyof QuantizerDefaultParams])}`)
                .join(',');
            return `${id}:${paramsPart}`;
        })
        .join(';');
    const byTypeMap: QuantizerByType = byType ?? {};
    const byTypePart = Object.keys(byTypeMap)
        .sort()
        .map((type) => `${type}=${String(byTypeMap[type])}`)
        .join(';');
    return `d[${defaultsPart}]t[${byTypePart}]`;
};

/** Per-pixel policy index. `0` is reserved for the global/default quantizer. */
export interface PolicyMask {
    data: Uint8Array;
    width: number;
    height: number;
}

/** Policy index (>= 1) → quantizer. `0` is the global quantizer. */
export interface QuantizerPolicy {
    quantizer: Quantizer;
    options?: QuantizeOptions;
}

export type QuantizerPolicies = ReadonlyMap<number, Quantizer | QuantizerPolicy>;

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
    const globalEntry = policiesById.get(0);
    const global = typeof globalEntry === 'function' ? globalEntry : globalEntry?.quantizer;

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
            const entry = policiesById.get(index);
            if (!entry) continue;
            const quantizer = typeof entry === 'function' ? entry : entry.quantizer;
            const options = typeof entry === 'function' ? opts : { ...opts, ...entry.options };
            const work = copyFrom(source, width, height);
            quantizer(work, options);
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
