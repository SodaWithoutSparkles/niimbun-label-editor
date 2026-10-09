import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import type { LabelDoc } from '../../core/doc/types';
import { HM_PER_INCH } from '../../core/render';
import type { AssetDeps, AssetWarning, BytesProvider, PreparedAsset } from '../../editor/render/assets';
import { createFontProvider } from '../../editor/render/fontAssets';
import { prepareResolvedAssets } from '../../editor/render/prepareAssets';
import type { ResolvedNode } from '../../editor/render/resolve';
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
 * Cancellation: a change to the doc / resolved tree / deps abandons the
 * in-flight result; a stale prepare can never overwrite a newer one. The result
 * is keyed to its inputs, so a changed document never briefly shows the previous
 * document's assets, and imported fonts are registered before preparing.
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

    // The prepared result is only valid for the inputs it was built from. Keying
    // it to the exact `nodes`/`doc` identity means a changed document reports
    // empty assets on the very next render, instead of briefly showing the
    // previous document's rasters until the new prepare settles (must-fix #6).
    const [state, setState] = useState<{
        nodes: readonly ResolvedNode[];
        doc: LabelDoc | null;
        prepared: PreparedAssets;
    }>(() => ({ nodes, doc, prepared: EMPTY }));

    useEffect(() => {
        if (!doc) {
            setState({ nodes, doc, prepared: EMPTY });
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
            return prepareResolvedAssets(nodes, doc, deps);
        };
        run()
            .then((prepared) => {
                if (!cancelled) setState({ nodes, doc, prepared });
            })
            .catch(() => {
                if (!cancelled) setState({ nodes, doc, prepared: EMPTY });
            });
        return () => {
            cancelled = true;
        };
    }, [nodes, doc, deps]);

    return state.nodes === nodes && state.doc === doc ? state.prepared : EMPTY;
};
