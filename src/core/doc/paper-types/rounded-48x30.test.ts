import { describe, expect, it } from 'vitest';
import { PAPER_TYPE_SEEDS } from './index';
import { pointInUnion } from './point-in-region';
import { rounded48x30Regions } from './rounded-48x30';

describe('Rounded 48×30 preset (rounded48x30)', () => {
    it('pins the geometry exactly (4800×3000 backing, one roundedRect r 200)', () => {
        expect(rounded48x30Regions()).toEqual([
            { kind: 'roundedRect', x: 0, y: 0, w: 4800, h: 3000, r: 200 },
        ]);
        expect(PAPER_TYPE_SEEDS['rounded48x30'].regions).toEqual(rounded48x30Regions());
        expect(PAPER_TYPE_SEEDS['rounded48x30'].backingW).toBe(4800);
        expect(PAPER_TYPE_SEEDS['rounded48x30'].backingH).toBe(3000);
        expect(PAPER_TYPE_SEEDS['rounded48x30'].guides).toEqual([]);
    });

    it('keeps the 50×30 preset untouched', () => {
        // The 48 mm stock is a separate id: editing `rounded50x30` would resize
        // every label whose `meta.paperTypeId` points at it.
        expect(PAPER_TYPE_SEEDS['rounded50x30'].backingW).toBe(5000);
    });

    it('returns a fresh region array each call', () => {
        expect(rounded48x30Regions()).not.toBe(rounded48x30Regions());
        expect(rounded48x30Regions()).toEqual(rounded48x30Regions());
    });

    it('rounds the corners and covers the interior', () => {
        const regions = rounded48x30Regions();
        expect(pointInUnion(10, 10, regions), '(10,10) corner square, outside the disc').toBe(false);
        expect(pointInUnion(200, 200, regions), '(200,200) corner-disc centre').toBe(true);
        expect(pointInUnion(2400, 1500, regions), '(2400,1500) interior').toBe(true);
        expect(pointInUnion(4790, 1500, regions), 'inside the right edge').toBe(true);
        expect(pointInUnion(4810, 1500, regions), 'past the 48 mm backing').toBe(false);
    });
});
