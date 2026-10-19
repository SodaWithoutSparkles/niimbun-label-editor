import type { LabelDoc } from '../../core/doc/types';
import { THUMB_MAX_BYTES, THUMB_MAX_SIDE } from '../../core/doc/validate';
import { HM_PER_INCH, type RgbaBuffer } from '../../core/render';
import type { AssetDeps } from './assets';
import { applyRegionClip } from './clip';
import { renderPageBase } from './renderLabelPage';
import type { ResolveContext } from './resolve';

/**
 * D-50 — gallery card previews.
 *
 * This module is the pure **colour** producer for the two saved previews,
 * called by the components-layer hook `components/editor/useDocThumbnail.ts` on
 * document changes:
 *
 * - `blob` — a 100-dpi PNG of the page for the `thumbs` IDB store
 *   (`data/thumbRepo.ts`, `labelRepo.putThumb`);
 * - `metaThumb` — a downscaled PNG/JPEG data URL (≤ 512 px longest side,
 *   ≤ 64 KB decoded) shaped for `doc.meta.thumb`, so the gallery still has a
 *   preview when the IDB thumb is missing.
 *
 * **Colour, not quantized.** The gallery shows the design the user made, so the
 * preview is `renderPageBase` → region clip → encode. It deliberately skips the
 * policy mask, quantization and the print-only overrides (invert / mirror /
 * offset) that `renderLabelPage` applies afterwards: none of them is part of the
 * saved design's appearance on screen.
 *
 * **Layer.** This lives in `editor/render/` (the render layer, below `store/`),
 * NOT in the store: the store must not import a renderer (`code-organization.md`
 * — dependencies flow one way). The hook that owns the debounce/save trigger
 * lives in `components/` and calls in here.
 *
 * **Assets.** `assets` is forwarded verbatim so a document with a locally-stored
 * image or an imported font renders its real content. Without it, image/qr/
 * barcode leaves whose asset is not inline draw nothing
 * (`renderLabelPage.ts:89-94`) — a preview would silently miss content. The
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
 * background preview pass into an error.
 */
export const GALLERY_THUMBNAIL_DPI = 100;

/** The `meta.thumb` payload shape (`core/doc/types.ts`). Epoch seconds. */
export interface MetaThumb {
    mediaType: string;
    dataUrl: string;
    at: number;
}

/** One render, two outputs: the `thumbs` blob and the `meta.thumb` data URL. */
export interface DocPreview {
    /** Fresh canvas holding the colour page at {@link GALLERY_THUMBNAIL_DPI}. */
    canvas: HTMLCanvasElement;
    /** The same pixels as `canvas`, clipped to the printable union. */
    rgba: RgbaBuffer;
    /** PNG for the `thumbs` store; `null` when `toBlob` is unavailable. */
    blob: Blob | null;
    /** `undefined` when no encoding fits the cap. */
    metaThumb: MetaThumb | undefined;
}

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
 * Decoded byte length of a base64 data URL, without allocating the bytes.
 * Returns `Infinity` for anything that is not a base64 data URL, so an
 * unrecognised encoding can never be mistaken for "fits".
 */
const dataUrlByteLength = (dataUrl: string): number => {
    if (!dataUrl.startsWith('data:')) return Infinity;
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return Infinity;
    if (!dataUrl.slice(5, comma).toLowerCase().split(';').includes('base64')) return Infinity;
    const base64 = dataUrl.slice(comma + 1).replace(/\s+/g, '');
    if (base64.length === 0) return Infinity;
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.floor((base64.length * 3) / 4) - padding;
};

/** The MIME the data URL itself declares (`image/png` / `image/jpeg`). */
const dataUrlMediaType = (dataUrl: string): string => {
    const comma = dataUrl.indexOf(',');
    if (!dataUrl.startsWith('data:') || comma < 0) return '';
    return dataUrl.slice(5, comma).split(';')[0]!.toLowerCase();
};

/** Copy `source` scaled to fit `limit` px on its longest side on a fresh canvas. */
const downscale = (source: HTMLCanvasElement, limit: number): HTMLCanvasElement | null => {
    const longest = Math.max(source.width, source.height);
    if (longest <= 0) return null;
    const scale = Math.min(1, limit / longest);
    const widthPx = Math.max(1, Math.round(source.width * scale));
    const heightPx = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, widthPx, heightPx);
    return canvas;
};

/**
 * Encode `canvas` fitted to `limit` px on its longest side: PNG first, then
 * JPEG 0.85. Returns `undefined` when no candidate fits {@link THUMB_MAX_BYTES}.
 */
const encodeFitting = (
    canvas: HTMLCanvasElement,
    limit: number,
): { mediaType: string; dataUrl: string } | undefined => {
    const scaled = downscale(canvas, limit);
    if (!scaled) return undefined;
    const candidates: [string, number | undefined][] = [
        ['image/png', undefined],
        ['image/jpeg', 0.85],
    ];
    for (const [type, quality] of candidates) {
        let dataUrl: string;
        try {
            dataUrl = quality === undefined ? scaled.toDataURL(type) : scaled.toDataURL(type, quality);
        } catch {
            continue;
        }
        if (dataUrlByteLength(dataUrl) > THUMB_MAX_BYTES) continue;
        const mediaType = dataUrlMediaType(dataUrl);
        if (mediaType.length === 0) continue;
        return { mediaType, dataUrl };
    }
    return undefined;
};

/**
 * Build the `meta.thumb`: fit the longest side to {@link THUMB_MAX_SIDE}, encode
 * PNG, fall back to JPEG 0.85, then halve the longest side (down to a 128 px
 * floor) until the decoded payload fits {@link THUMB_MAX_BYTES}. `undefined`
 * means "no acceptable encoding" — never an error.
 */
const buildMetaThumb = (canvas: HTMLCanvasElement): MetaThumb | undefined => {
    if (typeof canvas.toDataURL !== 'function') return undefined;
    const at = Math.floor(Date.now() / 1000);
    for (let limit = THUMB_MAX_SIDE; limit >= 128; limit = Math.floor(limit / 2)) {
        const encoded = encodeFitting(canvas, limit);
        if (encoded) return { ...encoded, at };
    }
    return undefined;
};

/** Draw an RGBA buffer onto a fresh canvas (safe for encoding). */
const canvasFromRgba = (rgba: RgbaBuffer): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = rgba.width;
    canvas.height = rgba.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('renderDocPreview: no 2D context for the preview canvas');
    const encoded = ctx.createImageData(rgba.width, rgba.height);
    encoded.data.set(rgba.data);
    ctx.putImageData(encoded, 0, 0);
    return canvas;
};

/**
 * Render `doc` to the colour preview pair. Resolves `null` (never rejects) when
 * the document cannot be rendered or a preview cannot be encoded.
 */
export const renderDocPreview = async (
    doc: LabelDoc,
    assets?: AssetDeps,
    ctx: ResolveContext = {},
): Promise<DocPreview | null> => {
    try {
        const base = await renderPageBase(doc, ctx, {
            dpi: GALLERY_THUMBNAIL_DPI,
            ...(assets !== undefined ? { assets } : {}),
        });
        // Same page composition as the print path's pre-clip: the printable
        // union is white outside. No mask / quantize / overrides follow.
        applyRegionClip(
            base.imageData,
            { widthPx: base.widthPx, heightPx: base.heightPx },
            doc.label.regions,
            HM_PER_INCH / base.dpi,
        );
        const canvas = canvasFromRgba(base.imageData);
        return {
            canvas,
            rgba: base.imageData,
            blob: await canvasToPngBlob(canvas),
            metaThumb: buildMetaThumb(canvas),
        };
    } catch {
        return null;
    }
};
