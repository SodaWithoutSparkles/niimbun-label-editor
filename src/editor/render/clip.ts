import type { RgbaBuffer } from '../../core/render/colorspace';
import type { Region } from '../../core/doc/types';
import { regionUnionPath } from './regionOverlay';
import { traceUnion } from './unionPath';

/**
 * Region clip for the raster path (plan.md:187).
 *
 * `regions` is consumed only as `union(regions)` (decision 25). The union is
 * rasterized by **reusing `regionUnionPath`** and the shared `traceUnion` — this
 * module never re-derives rounded-rect / circle / polygon point tests, so it can
 * never drift from the editor overlay's silhouette.
 *
 * **⚠ The fill uses the canvas DEFAULT (nonzero) winding. Do NOT pass
 * `'evenodd'` and do not use an even-odd point test.** Region rectangles overlap
 * on purpose (the F-tag tail covers the flag's rounded corners); under even-odd
 * every overlap band would become an interior hole. Nonzero keeps the overlap
 * wound at +2/+3, so the union has no seams and no holes.
 *
 * DOM/canvas module (not `src/core/`): `src/core/` stays pure.
 */

export interface ClipDims {
    widthPx: number;
    heightPx: number;
}

/**
 * Force every pixel **outside** `union(regions)` to opaque white (blank);
 * pixels inside the union are left untouched. Mutates `rgba` in place and
 * returns it (parity with the quantize/clip pipeline; callers that need the
 * source must clone first).
 *
 * `hmPerPx` is hectomicrometres per device pixel (`HM_PER_INCH / dpi`), so a
 * region coordinate `h` maps to raster pixel `h / hmPerPx`. The mask canvas is
 * exactly the raster size; regions extending past the backing are clipped by
 * the canvas, matching "raster dimensions stay the full backing rect".
 *
 * The early return is keyed on the **drawable union** (`regionUnionPath` already
 * filters zero-area / open / degenerate contours): a document with regions that
 * produce no drawable contour declares no printable area and is a no-op, so the
 * whole raster prints instead of being silently blanked (M5/B). The `hmPerPx`
 * validity check runs first so an invalid scale always throws, even with no
 * regions.
 */
export const applyRegionClip = (
    rgba: RgbaBuffer,
    dims: ClipDims,
    regions: readonly Region[],
    hmPerPx: number,
): RgbaBuffer => {
    if (!Number.isFinite(hmPerPx) || hmPerPx <= 0) {
        throw new RangeError(`applyRegionClip: hmPerPx must be > 0 (got ${hmPerPx})`);
    }
    const subpaths = regionUnionPath(regions);
    if (subpaths.length === 0) return rgba;

    const { widthPx, heightPx } = dims;
    const scale = 1 / hmPerPx;

    const mask = document.createElement('canvas');
    mask.width = widthPx;
    mask.height = heightPx;
    const mctx = mask.getContext('2d');
    if (!mctx) throw new Error('applyRegionClip: no 2D context for the mask canvas');

    // White background, then the union painted black. Default nonzero winding.
    mctx.fillStyle = '#ffffff';
    mctx.fillRect(0, 0, widthPx, heightPx);
    mctx.fillStyle = '#000000';
    traceUnion(mctx, subpaths, scale);
    mctx.fill();

    const maskData = mctx.getImageData(0, 0, widthPx, heightPx).data;
    const data = rgba.data;
    const pixelCount = widthPx * heightPx;
    for (let p = 0; p < pixelCount; p++) {
        // A near-white mask pixel is outside the union; antialiased edges resolve
        // to the nearer side at the 50% mark (>=128 → blank).
        if (maskData[p * 4] >= 128) {
            const i = p * 4;
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = 255;
        }
    }
    return rgba;
};
