import { describe, expect, it } from 'vitest';
import type { Region } from '../types';
import { pointInRegion } from './point-in-region';

/**
 * `pointInRegion` is the preset tests' point-in-union helper. These pin that its
 * rounded-rect arithmetic matches the renderer's `traceUnion` clamp.
 */
describe('pointInRegion (rounded-rect host helper)', () => {
    it('clamps an over-large radius like the renderer tracer', () => {
        const region: Region = { kind: 'roundedRect', x: 0, y: 0, w: 10, h: 10, r: 100 };
        expect(pointInRegion(5, 5, region), 'centre is inside after clamping').toBe(true);
        expect(pointInRegion(0.5, 0.5, region), 'corner square is outside').toBe(false);
    });

    it('excludes rounded corners for a sane radius', () => {
        const region: Region = { kind: 'roundedRect', x: 0, y: 0, w: 10, h: 10, r: 3 };
        expect(pointInRegion(0.5, 0.5, region)).toBe(false);
        expect(pointInRegion(5, 5, region)).toBe(true);
    });
});
