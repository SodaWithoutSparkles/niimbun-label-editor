import type { hm } from '../core/hm';
import type { LabelDoc } from '../core/doc/types';
import type { Rect } from '../core/viewport';
import { snapCandidates } from '../core/viewport';

export type PolygonPoint = [hm, hm];

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
    let twiceArea = 0;
    for (let index = 0; index < distinct.length; index++) {
        const [x1, y1] = distinct[index];
        const [x2, y2] = distinct[(index + 1) % distinct.length];
        twiceArea += x1 * y2 - x2 * y1;
    }
    if (twiceArea === 0) return null;
    return distinct;
};
