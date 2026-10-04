import type { Region } from '../types';

/**
 * Test-only point-in-region helper for the per-preset union-coverage tests.
 * Bounding box, then — for a `roundedRect` — the four corner discs: a point is
 * inside unless it sits in the corner square *outside* the quarter-disc at that
 * corner. Deliberately the same arithmetic the renderer's `union(regions)` clip
 * uses, so a defect at a seam or corner shows up in tests. Not exported from
 * `index.ts`; import it from test files only.
 */
export const pointInRegion = (x: number, y: number, region: Region): boolean => {
    if (region.kind !== 'roundedRect') return false;
    const { x: rx, y: ry, w, h } = region;
    if (x < rx || x > rx + w || y < ry || y > ry + h) return false;
    // Same clamp as the renderer's `traceUnion` / `pointInRoundedRect`, so this
    // helper's arithmetic really matches the clip for an over-large radius.
    const r = Math.max(0, Math.min(region.r, w / 2, h / 2));
    // Only the four corner squares can fall outside the rounded body.
    const cx = x < rx + r ? rx + r : x > rx + w - r ? rx + w - r : null;
    const cy = y < ry + r ? ry + r : y > ry + h - r ? ry + h - r : null;
    if (cx !== null && cy !== null) {
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
    }
    return true;
};

export const pointInUnion = (x: number, y: number, regions: Region[]): boolean =>
    regions.some((region) => pointInRegion(x, y, region));
