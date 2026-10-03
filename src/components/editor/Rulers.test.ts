import { describe, expect, it } from 'vitest';
import { worldToScreen, type Viewport } from '../../core/viewport';
import { rulerTicks } from './Rulers';

/**
 * Rotation-90 rulers must agree with the view transform, not just swap the
 * lengths. `screen = pan + R(90)·(world·zoom)` gives
 *   screen.x = viewport.x - world.y·zoom
 *   screen.y = viewport.y + world.x·zoom
 * so the top ruler steps **leftwards** over world-y and the left ruler steps
 * **downwards** over world-x. Cross-checking each tick against `worldToScreen`
 * catches a half-fix (origin swapped, direction not).
 */

const ROT: Viewport = { x: 500, y: 120, zoom: 2, rotation: 90 };
const HM_PER_MM = 100;

describe('rulerTicks — rotation 90', () => {
    it('top ruler runs from viewport.x leftwards over the world-y axis', () => {
        // backingH = 2000 hm = 20 mm; top ruler reads world y.
        const ticks = rulerTicks(2000, ROT.x, ROT.zoom, -1);
        expect(ticks[0]).toEqual({ mm: 0, offset: 500, major: true });
        expect(ticks[1]).toEqual({ mm: 1, offset: 300, major: false });
        expect(ticks[5]).toEqual({ mm: 5, offset: -500, major: true });
        for (const tick of ticks) {
            const projected = worldToScreen({ x: 0, y: tick.mm * HM_PER_MM }, ROT);
            expect(tick.offset).toBeCloseTo(projected.x);
        }
    });

    it('left ruler runs from viewport.y downwards over the world-x axis', () => {
        // backingW = 3000 hm = 30 mm; left ruler reads world x.
        const ticks = rulerTicks(3000, ROT.y, ROT.zoom, 1);
        expect(ticks[0]).toEqual({ mm: 0, offset: 120, major: true });
        expect(ticks[1]).toEqual({ mm: 1, offset: 320, major: false });
        expect(ticks[5]).toEqual({ mm: 5, offset: 1120, major: true });
        for (const tick of ticks) {
            const projected = worldToScreen({ x: tick.mm * HM_PER_MM, y: 0 }, ROT);
            expect(tick.offset).toBeCloseTo(projected.y);
        }
    });

    it('spans exactly the backing extent in mm', () => {
        expect(rulerTicks(2000, ROT.x, ROT.zoom, -1)).toHaveLength(21);
        expect(rulerTicks(3000, ROT.y, ROT.zoom, 1)).toHaveLength(31);
    });

    it('unrotated top ruler steps rightwards from viewport.x', () => {
        const flat: Viewport = { x: 10, y: 20, zoom: 1, rotation: 0 };
        const ticks = rulerTicks(500, flat.x, flat.zoom, 1);
        expect(ticks[0]!.offset).toBe(10);
        expect(ticks[5]!.offset).toBe(10 + 5 * HM_PER_MM);
        for (const tick of ticks) {
            const projected = worldToScreen({ x: tick.mm * HM_PER_MM, y: 0 }, flat);
            expect(tick.offset).toBeCloseTo(projected.x);
        }
    });
});
