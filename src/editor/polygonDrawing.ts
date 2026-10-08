import type { hm } from '../core/hm';
import type { LabelDoc } from '../core/doc/types';
import type { Rect } from '../core/viewport';
import { snapCandidates } from '../core/viewport';

export type PolygonPoint = [hm, hm];

/**
 * Smallest accepted **twice-area** (the shoelace sum, in hm²) for a finished
 * polygon. An absolute area floor of `500 hm²` (0.05 mm²) rejects hairline
 * "slivers" that would render as an invisible crack while accepting every
 * grid-aligned shape (the smallest 5 mm triangle has a twice-area of 250 000).
 */
export const MIN_POLYGON_TWICE_AREA_HM2 = 1000;

export const snapPolygonPoint = (
    point: PolygonPoint,
    doc: LabelDoc,
    siblings: readonly Rect[],
    thresholdHm: number,
    gridStep: hm,
): PolygonPoint => {
    const candidates = snapCandidates(
        { x: point[0], y: point[1], w: 0, h: 0 },
        {
            backing: { backingW: doc.label.backingW, backingH: doc.label.backingH },
            regions: doc.label.regions,
            siblings,
            grid: gridStep,
        },
    );
    const nearest = (axis: 'x' | 'y'): number => {
        let best: number | null = null;
        for (const candidate of candidates) {
            if (candidate.axis !== axis || Math.abs(candidate.delta) > thresholdHm) continue;
            if (best === null || Math.abs(candidate.delta) < Math.abs(best)) best = candidate.delta;
        }
        return best ?? 0;
    };
    return [Math.round(point[0] + nearest('x')) as hm, Math.round(point[1] + nearest('y')) as hm];
};

/**
 * Snap `point` only when snapping is armed and a document is open. The single
 * seam the preview uses for both click and cursor snapping, so the disabled path
 * is exercised without mounting Konva.
 */
export const snapPolygonPointIfEnabled = (
    point: PolygonPoint,
    doc: LabelDoc | null,
    siblings: readonly Rect[],
    thresholdHm: number,
    gridStep: hm,
    enabled: boolean,
): PolygonPoint =>
    enabled && doc ? snapPolygonPoint(point, doc, siblings, thresholdHm, gridStep) : point;

/**
 * Normalize collected vertices into a printable outline, or `null` when the
 * draft is not a usable polygon.
 *
 * Collapses adjacent duplicates and drops a repeated closing vertex (the
 * "click the first point" gesture). It then rejects:
 *  - fewer than three distinct vertices;
 *  - any **non-adjacent** duplicate vertex (a self-touching outline);
 *  - a net-area outline below {@link MIN_POLYGON_TWICE_AREA_HM2} — this rejects
 *    both an exactly collinear "polygon" and a near-collinear sliver.
 *
 * The area rule is deliberately **stricter** than the region print path
 * (`hasNonCollinearTriple` in `core/doc/derive.ts` / `editor/render/regionOverlay.ts`):
 * that path keeps a net-zero-area bow-tie because a nonzero fill still paints
 * its lobes, whereas the drawing tool treats a self-intersecting/zero-area
 * outline as a mis-click the user can redraw. The stricter direction is safe —
 * every accepted draft is also printable.
 */
export const finishPolygonPoints = (points: readonly PolygonPoint[]): PolygonPoint[] | null => {
    const distinct: PolygonPoint[] = [];
    for (const point of points) {
        const previous = distinct.at(-1);
        if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) distinct.push(point);
    }
    if (distinct.length > 2 && distinct[0][0] === distinct.at(-1)![0] && distinct[0][1] === distinct.at(-1)![1]) {
        distinct.pop();
    }
    if (distinct.length < 3) return null;

    // Adjacent duplicates were collapsed and the closing vertex popped, so any
    // remaining repeat is non-adjacent — a self-touching outline.
    const seen = new Set<string>();
    for (const [x, y] of distinct) {
        const key = `${x},${y}`;
        if (seen.has(key)) return null;
        seen.add(key);
    }

    let twiceArea = 0;
    for (let index = 0; index < distinct.length; index++) {
        const [x1, y1] = distinct[index];
        const [x2, y2] = distinct[(index + 1) % distinct.length];
        twiceArea += x1 * y2 - x2 * y1;
    }
    if (Math.abs(twiceArea) < MIN_POLYGON_TWICE_AREA_HM2) return null;
    return distinct;
};
