import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import type { LabelDoc } from '../../core/doc/types';
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
 * Build the `AssetDeps` the render/print seam consumes from a `ResourceRepo`.
 * With no repo the local-bytes providers are omitted (a `local` image then
 * prepares as `missing`, while inline/remote images and qr/barcode still work).
 * `imageScale` is only forwarded when finite, so print can leave it undefined
 * and fall back to the document dpi.
 */
export const createResourceAssetDeps = (
    repo: ResourceRepo | null,
    imageScale?: number,
): AssetDeps => {
    const deps: AssetDeps = {};
    if (repo) {
        const bytes = bytesProviderFor(repo);
        deps.images = bytes;
        deps.fonts = createFontProvider({ getBytes: bytes.getBytes });
    }
    if (imageScale !== undefined && Number.isFinite(imageScale)) deps.imageScale = imageScale;
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

    const deps = useMemo(
        () => createResourceAssetDeps(resourceRepo, effectiveZoom * devicePixelRatioOf()),
        [resourceRepo, effectiveZoom],
    );

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
