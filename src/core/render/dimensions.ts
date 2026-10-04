/**
 * Raster dimension math for the render pipeline. Pure and headless — no React,
 * Konva or DOM. The document keeps integer `hm`; pixels exist only here and in
 * the raster (floats allowed until the final round).
 */

/**
 * Hectomicrometres per inch: 1 in = 25.4 mm = 2.54 cm = 2540 hm
 * (1 mm = 1000 hm at 0.01 mm resolution).
 */
export const HM_PER_INCH = 2540;

/** `hm` → device px at `dpi`. Fractional: the caller rounds at the raster edge. */
export const hmToPx = (hm: number, dpi: number): number => (hm / HM_PER_INCH) * dpi;

/** Raster size of a label backing, rounded to whole device px (min 1). */
export interface RasterDimensions {
    widthPx: number;
    heightPx: number;
}

/**
 * Round a label backing (`hm`) to device px at `dpi`. Both axes clamp to a
 * minimum of 1 so a degenerate/collapsed backing still yields a drawable
 * (non-zero) canvas.
 */
export const rasterDimensions = (
    backingW: number,
    backingH: number,
    dpi: number,
): RasterDimensions => ({
    widthPx: Math.max(1, Math.round(hmToPx(backingW, dpi))),
    heightPx: Math.max(1, Math.round(hmToPx(backingH, dpi))),
});
