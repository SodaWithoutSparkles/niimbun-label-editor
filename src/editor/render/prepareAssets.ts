import { HM_PER_INCH } from '../../core/render';
import type { ImageRef, LabelDoc } from '../../core/doc/types';
import type { AssetDeps, AssetWarning, PreparedAsset } from './assets';
import { capImageAsset, loadImageRef } from './imageAssets';
import { renderQr } from './qrImage';
import { renderBarcode } from './barcodeImage';
import type { ResolvedNode } from './resolve';

/**
 * Async asset-preparation step of the render path (P5 §2.2).
 *
 * `resolve` stays synchronous and DOM-free; this module turns each image / QR /
 * barcode leaf into a decoded raster the Konva layer can draw. It is keyed by
 * resolved node id and is entirely best-effort: a missing resource, an invalid
 * payload, or a provider failure simply yields **no entry** plus a
 * {@link AssetWarning} — callers draw nothing for that leaf — and the function
 * never throws.
 *
 * `imageScale` is device px per hm. It defaults to the effective render dpi
 * (`deps.dpi ?? doc.label.dpi`, the print requirement); the editor can pass a
 * smaller value so previews cap decoded images to the on-screen size. A
 * thumbnail render sets `deps.dpi` (~50) so assets are not decoded at full dpi.
 *
 * Decoded **full-size** assets are cached per provider (bounded, FIFO) keyed by
 * a stable identity so repeated prepare calls for the same image decode/fetch
 * once; the per-leaf `capImageAsset` is still applied on every call. The
 * in-flight promise is cached so concurrent calls dedupe, and a failure is
 * evicted so a later call can retry.
 */

/** Required device px for a leaf box. */
const requiredPx = (w: number, h: number, imageScale: number): { w: number; h: number } => ({
    w: Math.max(1, Math.round(w * imageScale)),
    h: Math.max(1, Math.round(h * imageScale)),
});

/** Minimum scannable module width for a generated symbol, in millimetres. */
export const MIN_MODULE_MM = 0.25;

/**
 * Device px a generated symbol's module must reach to stay scannable at the
 * render resolution. `imageScale` is device px per hm (1 hm = 0.01 mm), so
 * `MIN_MODULE_MM` converts to `MIN_MODULE_MM * 100` hm and then to px.
 */
export const minModulePxFor = (imageScale: number): number =>
    Math.max(1, Math.ceil(MIN_MODULE_MM * imageScale * 100));

/** Maximum decoded full-size assets retained per provider scope. */
const ASSET_CACHE_LIMIT = 32;

/** Maximum image decodes in flight at once across one `prepareResolvedAssets`. */
const IMAGE_CONCURRENCY = 6;

/** Scope key used when a document provides neither `resolveImage` nor `images`. */
const SENTINEL = {};

type AssetPromise = Promise<PreparedAsset | null>;
type AssetCache = Map<string, AssetPromise>;

/**
 * One cache per decoder/provider. A `WeakMap` keyed by the provider object means
 * two different providers never share a raster for the same `resourceId`, and a
 * dropped provider releases its cache.
 */
const assetCaches = new WeakMap<object, AssetCache>();
/**
 * Registry of every scope's `WeakRef` so `clearAssetCache` can clear all live
 * scopes. Holding `WeakRef`s (not the maps) lets a dropped provider's cache be
 * collected; the finalizer drops the dead ref from the registry.
 */
const allCaches = new Set<WeakRef<AssetCache>>();
const cacheFinalizer = new FinalizationRegistry<WeakRef<AssetCache>>((ref) => {
    allCaches.delete(ref);
});

const cacheScope = (deps: AssetDeps): AssetCache => {
    const key: object = deps.resolveImage ?? deps.images ?? SENTINEL;
    let cache = assetCaches.get(key);
    if (!cache) {
        cache = new Map();
        assetCaches.set(key, cache);
        const ref = new WeakRef(cache);
        allCaches.add(ref);
        cacheFinalizer.register(cache, ref);
    }
    return cache;
};

/** Stable identity of an `ImageRef`'s bytes (never includes the cap/scale). */
const cacheKeyFor = (ref: ImageRef): string => {
    const source = ref.source;
    switch (source.kind) {
        case 'local':
            return `local:${source.resourceId}:${source.fingerprint ?? ''}`;
        case 'remote':
            return `remote:${source.url}`;
        case 'inline':
            // Key by the full data URL: `length + prefix` collides for two
            // different payloads of the same size/prefix.
            return `inline:${source.dataUrl}`;
        case 'external':
            return `external:${ref.imageId}:${source.filename}`;
    }
};

/** Drop every cached decode. Exported for tests that need a clean slate. */
export const clearAssetCache = (): void => {
    for (const ref of allCaches) {
        const cache = ref.deref();
        if (cache) cache.clear();
        else allCaches.delete(ref);
    }
};

/**
 * Resolve (and cache) the uncapped asset for `ref` in the provider's scope.
 * Concurrent calls share one in-flight promise; a `null`/rejected result is
 * evicted so a later call retries.
 */
const resolveCached = (ref: ImageRef, deps: AssetDeps): AssetPromise => {
    const cache = cacheScope(deps);
    const key = cacheKeyFor(ref);
    const existing = cache.get(key);
    if (existing) return existing;

    const promise: AssetPromise = Promise.resolve()
        .then(() => (deps.resolveImage ? deps.resolveImage(ref) : loadImageRef(ref, deps)))
        .then((asset) => asset ?? null)
        .catch(() => null);
    cache.set(key, promise);

    // FIFO bound: Map iteration order is insertion order.
    while (cache.size > ASSET_CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
    }
    void promise.then((asset) => {
        // A failure must not be cached forever: allow retry on a later call.
        if (asset === null && cache.get(key) === promise) cache.delete(key);
    });
    return promise;
};

/** Run `fn` over `items` with at most `limit` promises in flight. */
const runLimited = async <T>(
    items: readonly T[],
    limit: number,
    fn: (item: T) => Promise<void>,
): Promise<void> => {
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const item = items[next++];
            if (item === undefined) continue;
            await fn(item);
        }
    });
    await Promise.all(workers);
};

/** The assets a render consumes plus the per-leaf problems it found. */
export interface PreparedAssetsResult {
    assets: ReadonlyMap<string, PreparedAsset>;
    warnings: ReadonlyMap<string, AssetWarning>;
}

/**
 * Prepare assets for the resolved tree.
 *
 * - image → look up the `ImageRef` by `imageId`, decode it (provider-scoped
 *   cache by asset identity, capped to the node's required px per call).
 * - qr / barcode → generate at the node's required px (integer scale, never
 *   upscaled/resampled).
 * - missing/invalid/too-small → no asset entry plus a warning.
 *
 * Image leaves are loaded with bounded concurrency; QR/barcode generation is
 * synchronous.
 */
export const prepareResolvedAssets = async (
    nodes: readonly ResolvedNode[],
    doc: LabelDoc,
    deps: AssetDeps = {},
): Promise<PreparedAssetsResult> => {
    const assets = new Map<string, PreparedAsset>();
    const warnings = new Map<string, AssetWarning>();
    // The effective dpi may be overridden by the caller (e.g. a ~50 dpi
    // thumbnail) so assets are never decoded at the full document dpi; an
    // explicit `imageScale` still wins.
    const effectiveDpi =
        deps.dpi !== undefined && Number.isFinite(deps.dpi) && deps.dpi > 0
            ? deps.dpi
            : doc.label.dpi;
    const imageScale =
        deps.imageScale !== undefined && Number.isFinite(deps.imageScale)
            ? deps.imageScale
            : effectiveDpi / HM_PER_INCH;
    const minModulePx = minModulePxFor(imageScale);

    const imageRefs = new Map((doc.resources.images ?? []).map((ref) => [ref.imageId, ref] as const));

    const prepareLeaf = async (node: ResolvedNode): Promise<void> => {
        switch (node.type) {
            case 'image': {
                const ref = imageRefs.get(node.imageId);
                if (!ref) {
                    warnings.set(node.id, 'missing');
                    return;
                }
                const asset = await resolveCached(ref, deps);
                if (!asset) {
                    warnings.set(node.id, 'missing');
                    return;
                }
                const { w, h } = requiredPx(node.w, node.h, imageScale);
                assets.set(node.id, capImageAsset(asset, w, h));
                return;
            }
            case 'qr': {
                if (node.placeholder) return;
                const { w, h } = requiredPx(node.w, node.h, imageScale);
                const generated = renderQr(node.text, node.errorCorrection, w, h, minModulePx);
                if (!generated) {
                    warnings.set(node.id, 'invalid');
                    return;
                }
                assets.set(node.id, {
                    image: generated.canvas,
                    widthPx: generated.canvas.width,
                    heightPx: generated.canvas.height,
                });
                if (generated.belowMinModule) warnings.set(node.id, 'too-small');
                return;
            }
            case 'barcode': {
                if (node.placeholder) return;
                const { w, h } = requiredPx(node.w, node.h, imageScale);
                const generated = renderBarcode(node.text, node.symbology, w, h, minModulePx);
                if (!generated) {
                    warnings.set(node.id, 'invalid');
                    return;
                }
                assets.set(node.id, {
                    image: generated.canvas,
                    widthPx: generated.canvas.width,
                    heightPx: generated.canvas.height,
                });
                if (generated.belowMinModule) warnings.set(node.id, 'too-small');
                return;
            }
            default:
                return;
        }
    };

    // Flatten pre-order, then load leaves with bounded concurrency so several
    // remote images no longer add their latencies serially.
    const leaves: ResolvedNode[] = [];
    const collect = (list: readonly ResolvedNode[]): void => {
        for (const node of list) {
            if (node.type === 'group') collect(node.children);
            else leaves.push(node);
        }
    };
    collect(nodes);

    await runLimited(leaves, IMAGE_CONCURRENCY, async (node) => {
        try {
            await prepareLeaf(node);
        } catch {
            // A hostile provider/payload must never break the render.
        }
    });
    return { assets, warnings };
};
