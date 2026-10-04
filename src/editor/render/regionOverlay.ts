import type { Bounds } from '../../core/doc/derive';
import { effectiveTransform, nodeLookup, regionUnionBounds } from '../../core/doc/derive';
import type { hm } from '../../core/hm';
import type { LabelDoc, Region } from '../../core/doc/types';
import { nodeLocalPoints, transformedBounds } from './resolve';

/**
 * Region overlay + keep-out data for the editor view.
 *
 * `regions` is consumed only as `union(regions)` (plan decision 25). Region
 * rectangles may overlap on purpose; union membership is "inside any region",
 * which is exactly the **nonzero-winding** union — overlapping bands stay
 * covered, they are never subtracted into holes. The P4 raster clip must apply
 * the same rule (plan.md:187); this module only produces data, it does not clip.
 */

export interface RegionOverlay {
    /** The document's raw regions (winding/overlap preserved). */
    regions: readonly Region[];
    /** Bounding rect of the union, or `undefined` when there is no drawable region. */
    unionBounds: Bounds | undefined;
}

/** One closed contour of the union silhouette, in `hm`. */
export type UnionSubpath =
    | { kind: 'rect'; x: hm; y: hm; w: hm; h: hm }
    | { kind: 'roundedRect'; x: hm; y: hm; w: hm; h: hm; r: hm }
    | { kind: 'circle'; cx: hm; cy: hm; r: hm }
    | { kind: 'polygon'; points: [hm, hm][] };

/**
 * Shoelace signed area of a closed polygon (positive = the rect/`arcTo` tracing
 * direction used by `traceUnion`). Orientation only matters in sign.
 */
const signedArea = (points: readonly [hm, hm][]): number => {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i]!;
        const [x2, y2] = points[(i + 1) % points.length]!;
        sum += x1 * y2 - x2 * y1;
    }
    return sum / 2;
};

/**
 * True when a polygon has at least one non-collinear triple, i.e. a nonzero
 * fill actually paints something.
 *
 * This is deliberately **not** "signed area ≠ 0": a self-intersecting
 * ("bow-tie") polygon has net signed area `0` yet a nonzero fill still paints
 * both lobes, so the two would disagree. We test a cross product against the
 * first vertex instead.
 */
const hasNonCollinearTriple = (points: readonly [hm, hm][]): boolean => {
    const [x0, y0] = points[0]!;
    for (let i = 1; i < points.length - 1; i++) {
        const [x1, y1] = points[i]!;
        const [x2, y2] = points[i + 1]!;
        if ((x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0) !== 0) return true;
    }
    return false;
};

/**
 * True when a region contributes a drawable interior. Used by
 * `regionUnionPath` (below) and mirrored in `src/core/doc/derive.ts`
 * (`isDrawableRegion`, which core cannot import from the editor).
 */
const isDrawableRegion = (region: Region): boolean => {
    switch (region.kind) {
        case 'rect':
        case 'roundedRect':
            return region.w > 0 && region.h > 0;
        case 'circle':
            return region.r > 0;
        case 'polygon':
            return (
                region.closed === true &&
                region.points.length >= 3 &&
                hasNonCollinearTriple(region.points)
            );
    }
};

/**
 * Reverse a polygon's vertices when it is wound opposite to the rect/`arcTo`
 * contours, so every union subpath shares one orientation (S6). Without this, a
 * reverse-wound polygon overlapping a rect produces winding 0 in the overlap and
 * nonzero fill punches a hole.
 *
 * A zero signed area (e.g. a bow-tie) has no dominant orientation; leave it as
 * authored rather than "reverse" a shape that would come back identical.
 */
const withPositiveWinding = (points: readonly [hm, hm][]): [hm, hm][] => {
    const area = signedArea(points);
    return area < 0 ? [...points].reverse() : [...points];
};

/**
 * Outline of `union(regions)` as closed subpaths — the label silhouette.
 *
 * Returns one subpath per **drawable** region, in document order. Filling them
 * together with the default **nonzero** winding gives a single white union with
 * **no internal seams**: every region is wound the same (see `withPositiveWinding`
 * and `traceUnion`), so overlap bands have winding +1/+2 (never 0) and are never
 * punched into holes.
 *
 * "Drawable" = a contour whose nonzero fill actually paints something:
 *   - `rect` / `roundedRect`: `w > 0 && h > 0` (excludes zero/negative extents);
 *   - `circle`: `r > 0`;
 *   - `polygon`: `closed === true`, ≥ 3 points, and at least one **non-collinear
 *     triple** — so a bow-tie (net signed area 0) is kept, while a collinear
 *     "polygon" is dropped.
 * A region set with no drawable contour declares no printable area (the clip
 * no-ops rather than blanking the whole label — see `applyRegionClip`).
 *
 * An **open** polygon does not define a printable area (it has no interior) and
 * is excluded, matching `pointInRegion` (which returns false unless `closed`) and
 * `regionUnionBounds`.
 *
 * Pure: no React, no Konva, no mutation of the input.
 */
export const regionUnionPath = (regions: readonly Region[]): UnionSubpath[] => {
    const paths: UnionSubpath[] = [];
    for (const region of regions) {
        if (!isDrawableRegion(region)) continue;
        switch (region.kind) {
            case 'rect':
                paths.push({ kind: 'rect', x: region.x, y: region.y, w: region.w, h: region.h });
                break;
            case 'roundedRect':
                paths.push({
                    kind: 'roundedRect',
                    x: region.x,
                    y: region.y,
                    w: region.w,
                    h: region.h,
                    r: region.r,
                });
                break;
            case 'circle':
                paths.push({ kind: 'circle', cx: region.cx, cy: region.cy, r: region.r });
                break;
            case 'polygon':
                if (region.closed !== true) break;
                paths.push({ kind: 'polygon', points: withPositiveWinding(region.points) });
                break;
        }
    }
    return paths;
};

/** Region union geometry for the editor overlay. Data only — no styling. */
export const resolveRegionOverlay = (doc: LabelDoc): RegionOverlay => ({
    regions: doc.label.regions,
    unionBounds: regionUnionBounds(doc.label.regions),
});

const pointInRoundedRect = (
    x: number,
    y: number,
    region: Extract<Region, { kind: 'roundedRect' }>,
): boolean => {
    const { x: rx, y: ry, w, h } = region;
    if (x < rx || x > rx + w || y < ry || y > ry + h) return false;
    // Clamp exactly like `traceUnion` so keep-out agrees with the printed clip
    // for an over-large radius (r > min(w,h)/2).
    const r = Math.max(0, Math.min(region.r, w / 2, h / 2));
    const cx = x < rx + r ? rx + r : x > rx + w - r ? rx + w - r : null;
    const cy = y < ry + r ? ry + r : y > ry + h - r ? ry + h - r : null;
    if (cx !== null && cy !== null) return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
    return true;
};

/** Even-odd ray cast for a closed polygon region. */
const pointInPolygon = (x: number, y: number, points: readonly [number, number][]): boolean => {
    if (points.length < 3) return false;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i]!;
        const [xj, yj] = points[j]!;
        const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (crosses) inside = !inside;
    }
    return inside;
};

/**
 * Production point-in-region test covering every `Region` kind. Non-drawable
 * regions (zero/negative extents, zero radius, open or collinear polygon) return
 * `false`, matching the clip's `isDrawableRegion` predicate exactly.
 */
export const pointInRegion = (x: number, y: number, region: Region): boolean => {
    if (!isDrawableRegion(region)) return false;
    switch (region.kind) {
        case 'rect':
            return x >= region.x && x <= region.x + region.w && y >= region.y && y <= region.y + region.h;
        case 'roundedRect':
            return pointInRoundedRect(x, y, region);
        case 'circle':
            return (x - region.cx) ** 2 + (y - region.cy) ** 2 <= region.r * region.r;
        case 'polygon':
            // `isDrawableRegion` already requires `closed === true`.
            return pointInPolygon(x, y, region.points);
    }
};

/** Nonzero union membership: inside any region. Overlaps are covered, never holes. */
export const pointInUnion = (x: number, y: number, regions: readonly Region[]): boolean =>
    regions.some((region) => pointInRegion(x, y, region));

/** Corners, edge midpoints, and centre — a conservative containment sample. */
const samplePoints = (b: Bounds): [number, number][] => {
    const x0 = b.x;
    const y0 = b.y;
    const x1 = b.x + b.w;
    const y1 = b.y + b.h;
    const xm = b.x + b.w / 2;
    const ym = b.y + b.h / 2;
    return [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [xm, ym],
        [xm, y0],
        [xm, y1],
        [x0, ym],
        [x1, ym],
    ];
};

/**
 * Ids of content nodes whose transformed bounds are not fully inside the region
 * union. Groups are skipped — their children are tested individually and already
 * carry the parent transform. Returns ids in document order. Pure and testable.
 *
 * A document whose regions yield no **drawable** union declares no printable
 * area; the predicate is then silent (`[]`) rather than flagging every object.
 * Keyed on `regionUnionPath` so it matches `applyRegionClip` exactly (a doc of
 * only open/degenerate contours is a clip no-op, hence a keep-out no-op).
 */
export const nodesIntersectNonPrintable = (doc: LabelDoc): string[] => {
    const regions = doc.label.regions;
    if (regionUnionPath(regions).length === 0) return [];
    const byId = nodeLookup(doc.nodes);
    const offenders: string[] = [];
    for (const node of doc.nodes) {
        if (node.type === 'group') continue;
        const bounds = transformedBounds(nodeLocalPoints(node), effectiveTransform(node, byId));
        const inside = samplePoints(bounds).every(([x, y]) => pointInUnion(x, y, regions));
        if (!inside) offenders.push(node.id);
    }
    return offenders;
};
