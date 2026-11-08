import { describe, expect, it } from 'vitest';
import { PAPER_TYPE_SEEDS } from './index';
import { rounded40x60Regions } from './rounded-40x60';

describe('Rounded 40×60 preset (rounded40x60)', () => {
    it('pins the geometry exactly (4000×6000 backing, one roundedRect r 200)', () => {
        expect(rounded40x60Regions()).toEqual([
            { kind: 'roundedRect', x: 0, y: 0, w: 4000, h: 6000, r: 200 },
        ]);
        expect(PAPER_TYPE_SEEDS['rounded40x60'].regions).toEqual(rounded40x60Regions());
        expect(PAPER_TYPE_SEEDS['rounded40x60'].backingW).toBe(4000);
        expect(PAPER_TYPE_SEEDS['rounded40x60'].backingH).toBe(6000);
        expect(PAPER_TYPE_SEEDS['rounded40x60'].guides).toEqual([]);
    });
});
