import { describe, expect, it } from 'vitest';
import { createLabelDoc } from '../core/doc/factory';
import type { hm } from '../core/hm';
import { finishPolygonPoints, snapPolygonPoint } from './polygonDrawing';

describe('polygon drawing', () => {
    it('requires three distinct, non-degenerate vertices and removes repeated adjacent/closing points', () => {
        expect(finishPolygonPoints([[0, 0], [100, 0], [0, 0]])).toBeNull();
        expect(finishPolygonPoints([[0, 0], [100, 0], [200, 0]])).toBeNull();
        expect(finishPolygonPoints([[0, 0], [100, 0], [100, 100], [100, 100], [0, 0]])).toEqual([
            [0, 0], [100, 0], [100, 100],
        ]);
    });

    it('snaps points to the 5 mm grid and backing edges', () => {
        const doc = createLabelDoc({ backingW: 4000 as hm, backingH: 3000 as hm });
        expect(snapPolygonPoint([498, 503], doc, [], 60, 500)).toEqual([500, 500]);
                expect(snapPolygonPoint([3990, 1010], doc, [], 60, 500)).toEqual([4000, 1000]);
    });
});
