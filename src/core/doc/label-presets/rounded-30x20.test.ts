import { describe, expect, it } from 'vitest';
import { LABEL_PRESETS } from './index';
import { pointInUnion } from './point-in-region';
import { rounded30x20Regions } from './rounded-30x20';

describe('Rounded 30×20 preset (rounded30x20)', () => {
    it('pins the geometry exactly (3000×2000 backing, one roundedRect r 200)', () => {
        expect(rounded30x20Regions()).toEqual([
            { kind: 'roundedRect', x: 0, y: 0, w: 3000, h: 2000, r: 200 },
        ]);
        expect(LABEL_PRESETS['rounded30x20'].regions).toEqual(rounded30x20Regions());
        expect(LABEL_PRESETS['rounded30x20'].backingW).toBe(3000);
        expect(LABEL_PRESETS['rounded30x20'].backingH).toBe(2000);
    });

    it('returns a fresh region array each call', () => {
        expect(rounded30x20Regions()).not.toBe(rounded30x20Regions());
        expect(rounded30x20Regions()).toEqual(rounded30x20Regions());
    });

    it('rounds the corners and covers the interior', () => {
        const regions = rounded30x20Regions();
        expect(pointInUnion(10, 10, regions), '(10,10) corner square, outside the disc').toBe(false);
        expect(pointInUnion(200, 200, regions), '(200,200) corner-disc centre').toBe(true);
        expect(pointInUnion(250, 100, regions), '(250,100) straight edge').toBe(true);
        expect(pointInUnion(1500, 1000, regions), '(1500,1000) interior').toBe(true);
    });
});
