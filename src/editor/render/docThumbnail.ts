import type { LabelDoc } from '../../core/doc/types';
import type { AssetDeps } from './assets';
import { renderLabelPage } from './renderLabelPage';
import type { ResolveContext } from './resolve';

/**
 * D-50 — gallery card previews.
 *
 * The `thumbs` IDB store (`data/thumbRepo.ts`) and `labelRepo.putThumb`
 * (`data/labelRepo.ts:198`) existed with no producer in `src/`, so every "Recent"
 * card fell through to the geometry placeholder (`LabelCard` `PlaceholderArt`).
 * This module is the pure producer, called by the components-layer hook
 * `components/editor/useDocThumbnail.ts` on document changes.
 *
 * **Layer.** This lives in `editor/render/` (the render layer, below `store/`),
 * NOT in the store: the store must not import a renderer (`code-organization.md`
 * — dependencies flow one way). The hook that owns the debounce/save trigger
 * lives in `components/` and calls in here.
 *
 * **Entry point.** `renderLabelPage` (`editor/render/renderLabelPage.ts:537`) is
 * the one shared render path preview and print both use (invariant 7). We call
 * it at a small dpi and encode `RenderedLabelPage.canvas`, rather than building a
 * second render pipeline. The result is the same quantized/clipped 1-bit page the
 * print preview shows, just smaller.
 *
 * **Assets.** `assets` is forwarded verbatim so a document with a locally-stored
 * image or an imported font renders its real content. Without it, image/qr/
 * barcode leaves whose asset is not inline draw nothing
 * (`renderLabelPage.ts:89-94`) — a thumbnail would silently miss content. The
 * components-layer caller supplies the repo-backed providers
 * (`createResourceAssetDeps`).
 *
 * **Dpi.** The print queue/preview thumbnails render at
 * `THUMBNAIL_DPI = 100` (`components/print/usePrintThumbnails.ts:45`). We keep
 * the same 100 dpi for a comparable look, but declare the constant here instead
 * of importing that module: the print module pulls in React and the whole print
 * dialog graph, which the render layer has no business loading. The two values
 * are intentionally equal; keep them in sync.
 *
 * **Never throws.** A render failure (bad dpi, absurd raster, no 2D context,
 * encode failure) resolves `null` so a broken document can never turn a
 * background thumbnail pass into an error.
 */
export const GALLERY_THUMBNAIL_DPI = 100;

/** Encode a canvas to a PNG `Blob`, or `null` when `toBlob` is unavailable. */
const canvasToPngBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
    new Promise((resolve) => {
        // A non-throwing guard: `toBlob` is absent in some DOM shims, and a
        // missing callback (rather than a throw) would hang the promise, so
        // check before calling instead of only catching around it.
        if (typeof canvas.toBlob !== 'function') {
            resolve(null);
            return;
        }
        canvas.toBlob((blob) => resolve(blob), 'image/png');
    });

/**
 * Render `doc` to a small PNG `Blob` for the gallery card. Resolves `null`
 * (never rejects) when the document cannot be rendered.
 */
export const renderDocThumbnail = async (
    doc: LabelDoc,
    assets?: AssetDeps,
    ctx: ResolveContext = {},
): Promise<Blob | null> => {
    try {
        const rendered = await renderLabelPage(doc, ctx, {
            dpi: GALLERY_THUMBNAIL_DPI,
            ...(assets !== undefined ? { assets } : {}),
        });
        return await canvasToPngBlob(rendered.canvas);
    } catch {
        return null;
    }
};
