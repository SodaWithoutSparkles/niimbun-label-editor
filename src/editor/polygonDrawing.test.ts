import { describe, expect, it } from 'vitest';
import { createLabelDoc } from '../core/doc/factory';
import type { hm } from '../core/hm';
import { finishPolygonPoints, snapPolygonPoint, snapPolygonPointIfEnabled } from './polygonDrawing';

const doc = () => createLabelDoc({ backingW: 4000 as hm, backingH: 3000 as hm });

describe('polygon drawing — normalization', () => {
    it('requires three distinct, non-degenerate vertices and removes repeated adjacent/closing points', () => {
        expect(finishPolygonPoints([[0, 0], [100, 0], [0, 0]])).toBeNull();
        expect(finishPolygonPoints([[0, 0], [100, 0], [200, 0]])).toBeNull();
        expect(finishPolygonPoints([[0, 0], [100, 0], [100, 100], [100, 100], [0, 0]])).toEqual([
            [0, 0], [100, 0], [100, 100],
        ]);
    });

    it('rejects a bow-tie (net-zero area) and non-adjacent duplicate vertices', () => {
        // Net signed area 0 but the fill paints two lobes in the print path; the
        // drawing tool is deliberately stricter and rejects it.
        expect(finishPolygonPoints([[0, 0], [100, 100], [100, 0], [0, 100]])).toBeNull();
        // The first vertex reappears non-adjacently (self-touching outline).
        expect(finishPolygonPoints([[0, 0], [100, 0], [0, 0], [0, 100]])).toBeNull();
    });

    it('rejects a near-collinear sliver below the area floor', () => {
        expect(finishPolygonPoints([[0, 0], [100, 0], [200, 1]])).toBeNull();
        // ...but a thin-but-real triangle above the floor survives.
        expect(finishPolygonPoints([[0, 0], [100, 0], [200, 40]])).toEqual([
            [0, 0], [100, 0], [200, 40],
        ]);
    });
});

describe('polygon drawing — snapping', () => {
    it('snaps points to the 5 mm grid and backing edges', () => {
        expect(snapPolygonPoint([498, 503], doc(), [], 60, 500)).toEqual([500, 500]);
        expect(snapPolygonPoint([3990, 1010], doc(), [], 60, 500)).toEqual([4000, 1000]);
    });

    it('snaps at the threshold boundary but not beyond it', () => {
        // Backing edge at 4000: a 60 hm delta is exactly the threshold and snaps.
        expect(snapPolygonPoint([3940, 1000], doc(), [], 60, 500)).toEqual([4000, 1000]);
        // 61 hm is one past the threshold: no candidate, the point is left alone.
        expect(snapPolygonPoint([3939, 1000], doc(), [], 60, 500)).toEqual([3939, 1000]);
    });

    it('snaps to sibling edges', () => {
        const sibling = { x: 2000 as hm, y: 500 as hm, w: 1000 as hm, h: 1000 as hm };
        expect(snapPolygonPoint([2010, 490], doc(), [sibling], 60, 500)).toEqual([2000, 500]);
    });

    it('snaps to region edges', () => {
        const withRegion = createLabelDoc({
            backingW: 4000 as hm,
            backingH: 3000 as hm,
            regions: [{ kind: 'rect', x: 1000 as hm, y: 1000 as hm, w: 1000 as hm, h: 1000 as hm }],
        });
        expect(snapPolygonPoint([1010, 990], withRegion, [], 60, 500)).toEqual([1000, 1000]);
    });

    it('returns the raw point when snapping is disabled or no doc is open', () => {
        expect(snapPolygonPointIfEnabled([498, 503], doc(), [], 60, 500, false)).toEqual([498, 503]);
        expect(snapPolygonPointIfEnabled([498, 503], null, [], 60, 500, true)).toEqual([498, 503]);
        // The enabled path delegates to `snapPolygonPoint`.
        expect(snapPolygonPointIfEnabled([498, 503], doc(), [], 60, 500, true)).toEqual([500, 500]);
    });
});
