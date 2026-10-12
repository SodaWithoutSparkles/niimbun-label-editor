import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import type { ImageRef, LabelDoc } from '../../core/doc/types';
import { HM_PER_INCH } from '../../core/render';
import type { AssetDeps, AssetWarning, BytesProvider, PreparedAsset } from '../../editor/render/assets';
import { createFontProvider } from '../../editor/render/fontAssets';
import { prepareResolvedAssets } from '../../editor/render/prepareAssets';
import type {
    ResolvedBarcode,
    ResolvedImage,
    ResolvedNode,
    ResolvedQr,
} from '../../editor/render/resolve';
import type { ResourceRepo } from '../../data/resourceRepo';

/**
 * Editor-side async asset preparation (P5 W6).
 *
 * `resolve` stays synchronous; this hook turns the resolved tree into decoded
 * rasters (image / qr / barcode) for the react-konva preview. It mirrors the
 * render/print seam so the preview shows exactly what the print path will.
 *
 * The resolution cap (`imageScale`) is the on-screen device px per hm:
 * `effectiveZoom * devicePixelRatio`, so a preview never decodes more pixels
 * than the viewport needs. Print uses the document dpi instead (the default).
 *
 * Cancellation: a change to the prepare's **content** inputs / deps abandons the
 * in-flight result; a stale prepare can never overwrite a newer one. The result
 * is keyed to a content signature (see {@link assetSignatureOf}), so a changed
 * document never briefly shows the previous document's assets, while a re-resolve
 * that produces identical content (the editor re-resolves synchronously on every
 * render) keeps the rasters instead of flashing a placeholder. Imported fonts are
 * registered before preparing.
 */

/** Empty result, stable identity so callers can compare cheaply. */
const EMPTY: PreparedAssets = { assets: new Map(), warnings: new Map() };

export interface PreparedAssets {
    assets: ReadonlyMap<string, PreparedAsset>;
    warnings: ReadonlyMap<string, AssetWarning>;
}

/** Device pixel ratio, guarded for non-browser hosts. */
const devicePixelRatioOf = (): number =>
    typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1;

/** Wrap a `ResourceRepo` as the render seam's bytes provider (never throws). */
export const bytesProviderFor = (repo: ResourceRepo): BytesProvider => ({
    async getBytes(resourceId: string): Promise<Uint8Array | null> {
        try {
            const record = await repo.get(resourceId);
            return record ? record.bytes : null;
        } catch {
            return null;
        }
    },
});

/**
 * Build the repo-backed providers (bytes + fonts) for the render/print seam.
 * The returned `images`/`fonts` identities are stable for a given `repo`, which
 * matters because `prepareResolvedAssets` keys its decode cache on the provider
 * object and `createFontProvider` remembers registered fontIds. Callers must
 * memoize this on the repo alone so a zoom change cannot rebuild the providers
 * (which would bypass the decode cache and re-register every `FontFace`).
 * With no repo the local-bytes providers are omitted (a `local` image then
 * prepares as `missing`, while inline/remote images and qr/barcode still work).
 */
export const createResourceAssetProviders = (repo: ResourceRepo | null): AssetDeps => {
    const deps: AssetDeps = {};
    if (repo) {
        const bytes = bytesProviderFor(repo);
        deps.images = bytes;
        deps.fonts = createFontProvider({ getBytes: bytes.getBytes });
    }
    return deps;
};

/**
 * The resolution cap is device px per hm. Only a finite, **positive** value is
 * forwarded: a `0` (e.g. the initial `effectiveZoom`) or a non-finite value must
 * fall back to the document-dpi print scale rather than produce a zero-size cap.
 */
const forwardableImageScale = (imageScale: number | undefined): number | undefined =>
    imageScale !== undefined && Number.isFinite(imageScale) && imageScale > 0
        ? imageScale
        : undefined;

/**
 * Build the `AssetDeps` the render/print seam consumes from a `ResourceRepo`.
 * Convenience wrapper over {@link createResourceAssetProviders}; `imageScale` is
 * only forwarded when finite and > 0, so print can leave it undefined and fall
 * back to the document dpi.
 */
export const createResourceAssetDeps = (
    repo: ResourceRepo | null,
    imageScale?: number,
): AssetDeps => {
    const deps = createResourceAssetProviders(repo);
    const scale = forwardableImageScale(imageScale);
    if (scale !== undefined) deps.imageScale = scale;
    return deps;
};

/** Sentinel never produced by {@link assetSignatureOf} (which always emits JSON). */
const UNPREPARED = '\u0000unprepared';

/**
 * Content key of an asset source (`ImageRef.source` / `FontRef.source`), cached
 * per source-object identity.
 *
 * The signature is rebuilt on every render — i.e. every drag frame — so an
 * `inline` source's multi-MB data URL must never be serialized per frame. The
 * `WeakMap` is keyed by the **source object**, so an unchanged source is an
 * O(1) lookup and a replaced source is keyed once.
 *
 * The cache value is a content key, not a bare monotonic token: the first
 * transient drag frame deep-clones the document (`editorSlice.updateNodeTransient`
 * → `cloneDoc` = `structuredClone`), minting new-but-equal source objects. A
 * monotonic token would change there and clear every raster for one frame — a
 * new flash at drag start — whereas equal content keeps the signature stable.
 * Like the old identity-based cache key, this detects **replacement** only, not
 * in-place mutation of a source object (the model replaces resources, it does
 * not mutate them).
 */
const sourceKeys = new WeakMap<object, string>();
const sourceKey = (source: object): string => {
    const cached = sourceKeys.get(source);
    if (cached !== undefined) return cached;
    const key = JSON.stringify(source);
    sourceKeys.set(source, key);
    return key;
};

/** One asset-bearing leaf's signature; mirrors what `prepareResolvedAssets` reads. */
const leafSignature = (
    node: ResolvedImage | ResolvedQr | ResolvedBarcode,
    imageRefs: ReadonlyMap<string, ImageRef>,
): unknown[] => {
    switch (node.type) {
        case 'image': {
            // `prepareAssets.image` looks the ref up by `imageId` and then reads
            // `ref.source` (both `loadImageRef` and the decode-cache key
            // `cacheKeyFor`), so the source is the bytes identity. Absent ref →
            // `null`, so a ref that appears/disappears changes the key.
            const ref = imageRefs.get(node.imageId);
            return [
                'image',
                node.id,
                node.w,
                node.h,
                node.imageId,
                ref ? sourceKey(ref.source) : null,
            ];
        }
        case 'qr':
            // `prepareAssets.qr` reads exactly these.
            return [
                'qr',
                node.id,
                node.w,
                node.h,
                node.placeholder,
                node.text,
                node.errorCorrection,
                node.quietModules,
                node.fill,
            ];
        case 'barcode':
            // `prepareAssets.barcode` reads exactly these.
            return [
                'barcode',
                node.id,
                node.w,
                node.h,
                node.placeholder,
                node.text,
                node.symbology,
                node.quietModules,
                node.fill,
            ];
    }
};

/**
 * Content signature of the inputs the asset prepare actually reads. Two
 * different `nodes`/`doc` identities with byte-identical content produce the
 * same key; a genuine edit produces a different one.
 *
 * The leaf fields mirror `prepareResolvedAssets` (`prepareAssets.ts:206-263`)
 * exactly — `id` (the asset/warning map keys), `w`/`h` (the required px), and,
 * per type, only the fields that case reads. The referenced `ImageRef.source` is
 * included so replacing an image's bytes re-prepares; sources (and the fonts'
 * `source`) go through {@link sourceKey} so the payload is keyed once per source
 * object, never serialized per render.
 *
 * `doc.meta.id` makes a real document switch clear (must-fix #6); `doc.label.dpi`
 * feeds the default decode scale; the fonts are the effect's other input
 * (`ensureFonts`), so a newly imported font still registers.
 */
export const assetSignatureOf = (
    nodes: readonly ResolvedNode[],
    doc: LabelDoc | null,
): { key: string; hasLeaves: boolean } => {
    if (!doc) return { key: JSON.stringify(['none']), hasLeaves: false };
    const imageRefs = new Map((doc.resources.images ?? []).map((ref) => [ref.imageId, ref] as const));
    const leaves: unknown[] = [];
    // Pre-order, matching `prepareResolvedAssets`'s own `collect`.
    const collect = (list: readonly ResolvedNode[]): void => {
        for (const node of list) {
            if (node.type === 'group') collect(node.children);
            else if (node.type === 'image' || node.type === 'qr' || node.type === 'barcode') {
                leaves.push(leafSignature(node, imageRefs));
            }
        }
    };
    collect(nodes);
    const fonts = doc.resources.fonts.map((ref) => [ref.fontId, ref.familyName, sourceKey(ref.source)]);
    return {
        key: JSON.stringify([doc.meta.id, doc.label.dpi, fonts, leaves]),
        hasLeaves: leaves.length > 0,
    };
};

/**
 * Asset faults a later retry could clear. A `too-small` symbol still produced a
 * raster (it is a warning, not a failure), so it must not arm the retry.
 */
const retryableFailure = (warning: AssetWarning): boolean =>
    warning === 'missing' || warning === 'invalid';

/**
 * Prepare the resolved tree's assets for the preview. Returns an empty result
 * while no document is open (or before the first prepare settles).
 */
export const usePreparedAssets = (
    nodes: readonly ResolvedNode[],
    doc: LabelDoc | null,
): PreparedAssets => {
    const resourceRepo = useStore((state) => state.resourceRepo);
    const effectiveZoom = useStore((state) => state.effectiveZoom);

    // Providers are memoized on the repo ALONE. If they were rebuilt on every
    // zoom tick, `deps.images` would change identity and bypass the per-provider
    // decode cache in `prepareResolvedAssets`, while `createFontProvider` would
    // be recreated and re-register every imported `FontFace` on each tick. The
    // resolution cap still lives in the deps object, so a zoom change re-runs the
    // prepare and re-caps — now cheap, because the decode is a cache hit.
    const providers = useMemo(() => createResourceAssetProviders(resourceRepo), [resourceRepo]);
    const deps = useMemo(() => {
        const scale = forwardableImageScale(effectiveZoom * devicePixelRatioOf());
        return scale === undefined
            ? providers
            : {
                  ...providers,
                  imageScale: scale,
                  symbolScale: doc?.label.dpi ? doc.label.dpi / HM_PER_INCH : undefined,
              };
    }, [providers, effectiveZoom, doc?.label.dpi]);

    // The content signature of the prepare inputs (NOT `nodes`/`doc` identity:
    // the editor mints a fresh `resolved` array every render and every 1 s tick,
    // even when the content is identical).
    const { key: signature, hasLeaves } = useMemo(() => assetSignatureOf(nodes, doc), [nodes, doc]);

    // The prepared result is only valid for the content signature it was built
    // from. Reusing it whenever the signature is unchanged — regardless of
    // `deps` — means an unchanged re-resolve reports the previous rasters
    // instead of an empty frame (the canvas flash), and a zoom keeps the
    // previous raster on screen for the one frame before the re-capped one
    // lands (pre-fix behaviour: a zoom does not change the resolved content).
    // A genuine content change still reports empty for one render, then commits
    // the async prepare, so a changed document never briefly shows the previous
    // document's rasters (must-fix #6). `deps` stays an effect dep (below), so a
    // zoom still re-caps and commits the new raster.
    const [state, setState] = useState<{
        signature: string;
        prepared: PreparedAssets;
    }>(() => ({ signature: UNPREPARED, prepared: EMPTY }));

    // The currently-valid result (empty until the first prepare for this
    // signature settles). Also the input to the self-heal retry below.
    const prepared = state.signature === signature ? state.prepared : EMPTY;
    // A failed asset (`missing`/`invalid`) is retried on the next online/focus;
    // a `too-small` symbol still produced a raster, so it is not a failure.
    const hasFailures = useMemo(
        () => [...prepared.warnings.values()].some(retryableFailure),
        [prepared],
    );
    // Bumped by the retry listeners to re-run the prepare effect. It is NOT part
    // of the signature, so it never changes what is displayed.
    const [retryToken, setRetryToken] = useState(0);

    useEffect(() => {
        const commit = (next: PreparedAssets): void => {
            setState((prev) =>
                prev.signature === signature && prev.prepared === next
                    ? prev
                    : { signature, prepared: next },
            );
        };
        if (!doc) {
            commit(EMPTY);
            return;
        }
        let cancelled = false;
        const run = async (): Promise<PreparedAssets> => {
            // Register imported fonts before preparing, so the preview uses the
            // same faces the print path registers (must-fix #3). Best-effort: a
            // font failure must never break the render (`ensureFonts` itself
            // never throws, but a hostile provider could).
            try {
                await deps.fonts?.ensureFonts(doc);
            } catch {
                // Fall back to the resolved `fontFamily`.
            }
            // A shapes/text-only document has nothing to rasterize: skip the
            // prepare entirely (its maps would be empty anyway).
            if (!hasLeaves) return EMPTY;
            return prepareResolvedAssets(nodes, doc, deps);
        };
        run()
            .then((next) => {
                if (!cancelled) commit(next);
            })
            .catch(() => {
                if (!cancelled) commit(EMPTY);
            });
        return () => {
            cancelled = true;
        };
        // Keyed on the content signature + the scale deps (+ a retry bump). A new
        // `nodes`/`doc` identity with unchanged content must NOT re-run the async
        // prepare (that is the flash and the per-frame work); a zoom (`deps`)
        // change must, so the re-capped raster is committed. `nodes`/`doc`/
        // `hasLeaves` are captured from the render that changed the signature or
        // deps, so they are current when it runs. (Their identities are
        // deliberately NOT deps — that was the bug.)
    }, [signature, deps, retryToken]);

    // Self-heal: the content signature removed the per-frame re-prepare that used
    // to retry a transient decode/fetch/IDB failure, so a blank leaf + `missing`
    // warning would otherwise persist until the user edited something. Arm a
    // bounded retry on the next `online`/`focus` (no polling): only a real
    // failure arms it, a failure-free commit disarms it, and a listener only ever
    // re-runs the same prepare — it cannot loop.
    useEffect(() => {
        if (!hasFailures || typeof window === 'undefined') return;
        const retry = (): void => setRetryToken((token) => token + 1);
        window.addEventListener('online', retry);
        window.addEventListener('focus', retry);
        return () => {
            window.removeEventListener('online', retry);
            window.removeEventListener('focus', retry);
        };
    }, [hasFailures]);

    return prepared;
};
