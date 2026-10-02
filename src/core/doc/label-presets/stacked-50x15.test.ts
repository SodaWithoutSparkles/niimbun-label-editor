import { describe, expect, it } from 'vitest';
import { LABEL_PRESETS } from './index';
import { pointInUnion } from './point-in-region';
import { stacked50x15Regions } from './stacked-50x15';

describe('Stacked 2× 50×15 preset (stacked50x15)', () => {
    it('pins the geometry exactly (5000×3000 backing, two r-200 roundedRect halves)', () => {
        expect(stacked50x15Regions()).toEqual([
            { kind: 'roundedRect', x: 0, y: 0, w: 5000, h: 1500, r: 200 },
            { kind: 'roundedRect', x: 0, y: 1500, w: 5000, h: 1500, r: 200 },
        ]);
        expect(LABEL_PRESETS['stacked50x15'].regions).toEqual(stacked50x15Regions());
        expect(LABEL_PRESETS['stacked50x15'].backingW).toBe(5000);
        expect(LABEL_PRESETS['stacked50x15'].backingH).toBe(3000);
    });

    it('returns a fresh region array each call', () => {
        expect(stacked50x15Regions()).not.toBe(stacked50x15Regions());
        expect(stacked50x15Regions()).toEqual(stacked50x15Regions());
    });

    it('covers the seam mid-span but excludes the corner bites at the seam', () => {
        const regions = stacked50x15Regions();
        // Mid-span the halves' straight edges meet, so the seam is covered.
        expect(pointInUnion(2500, 1500, regions), '(2500,1500) seam mid-span').toBe(true);
        // Near the edges both halves have rounded corners meeting, so the
        // outline dips inward — the intended "parts missing at the corners".
        expect(pointInUnion(50, 1460, regions), '(50,1460) left bite, upper half').toBe(false);
        expect(pointInUnion(50, 1540, regions), '(50,1540) left bite, lower half').toBe(false);
        expect(pointInUnion(4950, 1460, regions), '(4950,1460) right bite, upper half').toBe(false);
        expect(pointInUnion(4950, 1540, regions), '(4950,1540) right bite, lower half').toBe(false);
        expect(pointInUnion(2500, 750, regions), '(2500,750) upper half interior').toBe(true);
        expect(pointInUnion(2500, 2250, regions), '(2500,2250) lower half interior').toBe(true);
    });

    it('rounds the outer corners', () => {
        const regions = stacked50x15Regions();
        expect(pointInUnion(10, 10, regions), '(10,10) top-left corner').toBe(false);
        expect(pointInUnion(4950, 10, regions), '(4950,10) top-right corner').toBe(false);
        expect(pointInUnion(10, 2990, regions), '(10,2990) bottom-left corner').toBe(false);
        expect(pointInUnion(4950, 2990, regions), '(4950,2990) bottom-right corner').toBe(false);
    });
});
