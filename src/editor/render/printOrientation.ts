import type { PrintDirection } from '@mmote/niimbluelib';
import type { LabelDoc } from '../../core/doc/types';
import type { RenderedLabelPage } from './renderLabelPage';

/**
 * Print orientation seam (W2): map the document's 4-way `printDirection` onto
 * the encoder's 2-value {@link PrintDirection} plus any pixel pre-rotation.
 *
 * The encoder only understands two feed orientations: `'left'` rotates the
 * raster 90° clockwise itself (`cols`/`rows` swap), `'top'` sends it unrotated.
 * The document model also carries `right`/`bottom`; those are realised by
 * **pre-rotating the raster 180°** and then encoding it as `'top'`/`'left'`
 * respectively (D-04 resolved — the printer only cares about pixels).
 *
 * `right`→180°+`'left'` is legal because a 90° CW encoder rotation followed by
 * a pre-baked 180° equals the 270° CW a raw `right` would need.
 *
 * This module touches `document.createElement('canvas')`, so it lives in the
 * editor render layer, not `src/core/` (which stays DOM-free).
 */

export type LabelPrintDirection = LabelDoc['label']['printDirection'];

/**
 * Degrees the raster must be **pre-rotated (baked)** before encoding. Pure.
 * `bottom`/`right` are the document's extra two directions; they are realised
 * by a 180° pre-rotation (D-04 resolved — the printer only cares about pixels).
 */
export const preRotationDegrees = (direction: LabelPrintDirection): 0 | 180 =>
    direction === 'bottom' || direction === 'right' ? 180 : 0;

/**
 * The encoder feed direction to use **after** the {@link preRotationDegrees}
 * bake. `left`/`right` feed the raster sideways (the encoder rotates 90° CW
 * itself, so `right`'s 180° bake + 90° CW = the 270° CW a raw `right` needs);
 * `top`/`bottom` send it unrotated.
 */
export const encoderDirection = (direction: LabelPrintDirection): PrintDirection =>
    direction === 'left' || direction === 'right' ? 'left' : 'top';

/** A raster paired with the encoder direction it must be sent as. */
export interface OrientedRaster {
    /** Safe to hand to the encoder; a fresh canvas when pre-rotated. */
    canvas: HTMLCanvasElement;
    direction: PrintDirection;
}

/**
 * Rotate a canvas 180° onto a **fresh** canvas. Pixel-copy rather than
 * `drawImage` so it is independent of host canvas interop and deterministic.
 * The source is only read (never mutated).
 */
const rotate180 = (source: HTMLCanvasElement): HTMLCanvasElement => {
    const width = source.width;
    const height = source.height;
    const sourceCtx = source.getContext('2d');
    if (!sourceCtx) throw new Error('orientForPrint: source canvas has no 2D context');
    const src = sourceCtx.getImageData(0, 0, width, height).data;

    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const outCtx = out.getContext('2d');
    if (!outCtx) throw new Error('orientForPrint: no 2D context for the rotated canvas');

    const dst = outCtx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
        const sourceRow = (height - 1 - y) * width;
        const destRow = y * width;
        for (let x = 0; x < width; x++) {
            const s = (sourceRow + (width - 1 - x)) * 4;
            const d = (destRow + x) * 4;
            dst.data[d] = src[s]!;
            dst.data[d + 1] = src[s + 1]!;
            dst.data[d + 2] = src[s + 2]!;
            dst.data[d + 3] = src[s + 3]!;
        }
    }
    outCtx.putImageData(dst, 0, 0);
    return out;
};

/**
 * Resolve a rendered page into the canvas + encoder direction for printing.
 *
 * - `top`    → {@link preRotationDegrees} 0°,   encode `'top'`
 * - `left`   → 0°,   encode `'left'` (the encoder rotates 90° CW itself)
 * - `bottom` → 180°, encode `'top'`
 * - `right`  → 180°, encode `'left'` (180° baked + 90° CW = 270° CW)
 *
 * The 180° cases bake the rotation on a **fresh** canvas; `page.canvas` is
 * never mutated. The 0° cases return `page.canvas` by reference.
 */
export const orientForPrint = (
    page: RenderedLabelPage,
    direction: LabelPrintDirection,
): OrientedRaster => ({
    canvas: preRotationDegrees(direction) === 180 ? rotate180(page.canvas) : page.canvas,
    direction: encoderDirection(direction),
});

/**
 * Printhead overflow check (dec 18 — non-blocking warning, never a gate).
 *
 * The printhead spans the raster's cross-feed axis: `left`/`right` feed the
 * raster sideways, so the head length compares against `heightPx`; `top`/
 * `bottom` compare against `widthPx`. A missing reported head size (`undefined`)
 * disables the warning and returns `false`.
 */
export const printheadOverflow = (
    widthPx: number,
    heightPx: number,
    direction: LabelPrintDirection,
    printheadPixels: number | undefined,
): boolean => {
    if (printheadPixels === undefined) return false;
    const headSize = direction === 'left' || direction === 'right' ? heightPx : widthPx;
    return headSize > printheadPixels;
};

/**
 * Ink-beyond-printhead check (D-31) — the **content** half of the dec-18
 * warning. {@link printheadOverflow} is a pure size check, so a *blank* label
 * that is wider than the head still warns even though nothing would be clipped.
 * This predicate says whether any ink actually falls past `printheadPixels`.
 *
 * The scan maps the encoder's clipped output columns back onto the **source**
 * raster. The encoder feeds `top` unrotated, bakes 180° for `bottom`, rotates
 * 90° CW for `left` (and 180° + 90° CW for `right`), and the printer keeps the
 * start of every encoded row. The clipped source edge is therefore:
 *
 * - `top`    → right columns  `x >= head`      (no rotation)
 * - `bottom` → left columns   `x <  W - head`  (180° flips the row)
 * - `left`   → top rows       `y <  H - head`  (90° CW flips the column)
 * - `right`  → bottom rows    `y >= head`      (180° + 90° CW)
 *
 * Scanning the source unrotated for all four directions (the old behaviour)
 * missed a bottom/left page whose ink only reaches the far end after the bake:
 * a top-left dot lands on encoded column 15 for `bottom` and `left`, i.e. past
 * an 8-dot head. The cross-feed size comes from the source page; the scan
 * **early-exits on the first ink pixel** and returns `false` when there is no
 * such region (`undefined` head size, or the raster is not actually over) — a
 * missing reported head size disables the warning, exactly like the size check.
 *
 * A pixel is ink when it is **not paper white** (`r !== 255 || g !== 255 ||
 * b !== 255`), mirroring `countInkPx`. The detector runs on the post-quantize
 * raster, where every pixel is an exact palette colour, so the white test is
 * exact: a `r < 128` luminance test would classify grayscale levels 1–7
 * (bytes 238…136) as paper and miss clipped light-grey ink. Testing every
 * channel also keeps this correct for a future `RedBlack` raster (an R-only
 * test would miss red ink). Alpha is ignored — it is opacity metadata, never
 * pigment. Pure and DOM-free so it can run on a `RenderedLabelPage.rgba`
 * directly.
 */
export const hasInkBeyondPrinthead = (
    page: Pick<RenderedLabelPage, 'rgba' | 'widthPx' | 'heightPx'>,
    direction: LabelPrintDirection,
    printheadPixels: number | undefined,
): boolean => {
    if (printheadPixels === undefined) return false;
    const { rgba, widthPx, heightPx } = page;
    const { data } = rgba;
    const sideways = direction === 'left' || direction === 'right';
    const headSize = sideways ? heightPx : widthPx;
    if (headSize <= printheadPixels) return false;

    // Not paper white = ink. Post-quantize every pixel is an exact palette
    // colour (black, a grey level, red, or white), so no luminance threshold is
    // needed — and a `< 128` test would miss grayscale levels 1–7. Any non-white
    // channel also covers red ink (an R-only test would miss it).
    const isInk = (base: number): boolean =>
        data[base] !== 255 || data[base + 1] !== 255 || data[base + 2] !== 255;

    // Each branch scans the source edge that the encoder clips for that feed
    // direction (see the mapping above).
    if (direction === 'top') {
        for (let y = 0; y < heightPx; y++) {
            const row = y * widthPx;
            for (let x = printheadPixels; x < widthPx; x++) {
                if (isInk((row + x) * 4)) return true;
            }
        }
        return false;
    }
    if (direction === 'bottom') {
        // 180° bake: the source's left columns reach the far end of the row.
        const clippedWidth = widthPx - printheadPixels;
        for (let y = 0; y < heightPx; y++) {
            const row = y * widthPx;
            for (let x = 0; x < clippedWidth; x++) {
                if (isInk((row + x) * 4)) return true;
            }
        }
        return false;
    }
    if (direction === 'left') {
        // 90° CW: the source's top rows become the far end of the encoded row.
        const clippedHeight = heightPx - printheadPixels;
        for (let y = 0; y < clippedHeight; y++) {
            const row = y * widthPx;
            for (let x = 0; x < widthPx; x++) {
                if (isInk((row + x) * 4)) return true;
            }
        }
        return false;
    }
    // right: 180° + 90° CW — the source's bottom rows reach the far end.
    for (let y = printheadPixels; y < heightPx; y++) {
        const row = y * widthPx;
        for (let x = 0; x < widthPx; x++) {
            if (isInk((row + x) * 4)) return true;
        }
    }
    return false;
};
