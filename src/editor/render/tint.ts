import { tintRgbaByLuminance } from '../../core/render';
import type { PreparedAsset } from './assets';

/**
 * Per-leaf image tint (P4 A6).
 *
 * The asset pipeline caches decoded (and per-leaf capped) rasters by asset
 * identity; a tint is **per node**, so it is applied to a fresh canvas after
 * that cache step and never in place. The input `PreparedAsset` is left
 * untouched, which keeps two differently tinted leaves of the same image (and
 * every other render sharing a cached raster) independent.
 *
 * The same rule as the print path (`core/render/tint`): the source luminance
 * picks ink density, the tint picks the ink colour, alpha is preserved.
 */

/** The same asset when `tint` is absent/`'transparent'`; otherwise a fresh
 *  canvas carrying the tinted pixels (never mutates the cached asset). */
export const tintAsset = (asset: PreparedAsset, tint: string | undefined): PreparedAsset => {
    if (tint === undefined || tint === 'transparent') return asset;
    if (typeof document === 'undefined') return asset;
    let canvas: HTMLCanvasElement;
    try {
        canvas = document.createElement('canvas');
        canvas.width = Math.max(1, asset.widthPx);
        canvas.height = Math.max(1, asset.heightPx);
        const ctx = canvas.getContext('2d');
        if (!ctx) return asset;
        ctx.drawImage(asset.image, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        tintRgbaByLuminance(imageData, tint);
        ctx.putImageData(imageData, 0, 0);
    } catch {
        // A hostile/cross-origin source must never break the render.
        return asset;
    }
    return { image: canvas, widthPx: canvas.width, heightPx: canvas.height };
};
