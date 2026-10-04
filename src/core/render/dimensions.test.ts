import { describe, expect, it } from 'vitest';
import { HM_PER_INCH, hmToPx, rasterDimensions } from './dimensions';

describe('dimensions', () => {
    it('uses 2540 hm per inch (1 in = 25.4 mm)', () => {
        expect(HM_PER_INCH).toBe(2540);
    });

    describe('hmToPx', () => {
        it('maps one inch to the dpi', () => {
            expect(hmToPx(2540, 300)).toBe(300);
            expect(hmToPx(2540, 203)).toBe(203);
        });

        it('scales fractionally (no rounding here)', () => {
            expect(hmToPx(1270, 300)).toBe(150);
            expect(hmToPx(635, 300)).toBe(75);
        });

        it('returns 0 for a zero extent', () => {
            expect(hmToPx(0, 300)).toBe(0);
        });
    });

    describe('rasterDimensions', () => {
        it('rounds each axis to whole device px', () => {
            expect(rasterDimensions(2540, 1270, 300)).toEqual({ widthPx: 300, heightPx: 150 });
        });

        it('rounds to nearest, not floor', () => {
            // 1000 / 2540 * 203 = 79.921... → 80
            expect(rasterDimensions(1000, 1000, 203)).toEqual({ widthPx: 80, heightPx: 80 });
        });

        it('clamps each axis to a minimum of 1 px', () => {
            expect(rasterDimensions(0, 0, 300)).toEqual({ widthPx: 1, heightPx: 1 });
            expect(rasterDimensions(1, 1, 203)).toEqual({ widthPx: 1, heightPx: 1 });
        });

        it('handles a many-inch backing', () => {
            expect(rasterDimensions(2540 * 4, 2540 * 6, 300)).toEqual({
                widthPx: 1200,
                heightPx: 1800,
            });
        });
    });
});
