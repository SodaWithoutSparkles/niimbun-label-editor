import { describe, expect, it } from 'vitest';
import { centeredViewport, resolveZoom, zoomAt } from './viewportController';
import { realZoom, screenToWorld, worldToScreen } from '../core/viewport';

const backing = { backingW: 2500, backingH: 7800 };
const avail = { w: 800, h: 600 };

describe('resolveZoom', () => {
    it('uses realZoom for real mode', () => {
        expect(resolveZoom('real', 0.1, backing, avail, 0, 96)).toBeCloseTo(realZoom(96), 10);
    });

    it('uses the manual value for manual mode', () => {
        expect(resolveZoom('manual', 0.25, backing, avail, 0, 96)).toBe(0.25);
    });

    it('fits the long axis at rotation 90', () => {
        const flat = resolveZoom('fit', 0, backing, avail, 0, 96);
        const rotated = resolveZoom('fit', 0, backing, avail, 90, 96);
        expect(rotated).toBeGreaterThan(flat);
    });
});

describe('centeredViewport', () => {
    it('centres the label within the available area', () => {
        const viewport = centeredViewport(0.1, backing, avail, 0);
        const rect = { w: backing.backingW * 0.1, h: backing.backingH * 0.1 };
        expect(viewport.x).toBeCloseTo((avail.w - rect.w) / 2, 6);
    });
});

describe('zoomAt', () => {
    it('keeps the world point under the anchor fixed', () => {
        const viewport = centeredViewport(0.1, backing, avail, 0);
        const anchor = { x: 300, y: 250 };
        const worldBefore = screenToWorld(anchor, viewport);
        const next = zoomAt(viewport, anchor, 0.2, backing, avail);
        const worldAfter = screenToWorld(anchor, next);
        expect(worldAfter.x).toBeCloseTo(worldBefore.x, 4);
        expect(worldAfter.y).toBeCloseTo(worldBefore.y, 4);
    });

    it('is consistent with worldToScreen', () => {
        const viewport = centeredViewport(0.1, backing, avail, 90);
        const world = { x: 500, y: 500 };
        const screen = worldToScreen(world, viewport);
        expect(screen.x).toBeCloseTo(viewport.x - world.y * viewport.zoom, 6);
        expect(screen.y).toBeCloseTo(viewport.y + world.x * viewport.zoom, 6);
    });
});
