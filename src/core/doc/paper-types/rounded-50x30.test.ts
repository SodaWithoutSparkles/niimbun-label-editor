import { describe, expect, it } from 'vitest';
import { PAPER_TYPE_SEEDS } from './index';
import { pointInUnion } from './point-in-region';
import { rounded50x30Regions } from './rounded-50x30';

describe('Rounded 50×30 preset (rounded50x30)', () => {
    it('pins the geometry exactly (5000×3000 backing, one roundedRect r 200)', () => {
        expect(rounded50x30Regions()).toEqual([
            { kind: 'roundedRect', x: 0, y: 0, w: 5000, h: 3000, r: 200 },
        ]);
        expect(PAPER_TYPE_SEEDS['rounded50x30'].regions).toEqual(rounded50x30Regions());
        expect(PAPER_TYPE_SEEDS['rounded50x30'].backingW).toBe(5000);
        expect(PAPER_TYPE_SEEDS['rounded50x30'].backingH).toBe(3000);
        // A die-cut preset carries no guides.
        expect(PAPER_TYPE_SEEDS['rounded50x30'].guides).toEqual([]);
    });

    it('returns a fresh region array each call', () => {
        expect(rounded50x30Regions()).not.toBe(rounded50x30Regions());
        expect(rounded50x30Regions()).toEqual(rounded50x30Regions());
    });

    it('rounds the corners and covers the interior', () => {
        const regions = rounded50x30Regions();
        expect(pointInUnion(10, 10, regions), '(10,10) corner square, outside the disc').toBe(false);
        expect(pointInUnion(200, 200, regions), '(200,200) corner-disc centre').toBe(true);
        expect(pointInUnion(2500, 1500, regions), '(2500,1500) interior').toBe(true);
    });
});
