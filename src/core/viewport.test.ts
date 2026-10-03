import { describe, expect, it } from 'vitest';
import {
    backingPixelSize,
    centerPan,
    clampPan,
    fitZoom,
    hitTestScreen,
    hitTestWorld,
    labelScreenRect,
    MIN_ZOOM,
    realZoom,
    screenToHm,
    screenToWorld,
    snapCandidates,
    transformBounds,
    worldToScreen,
} from './viewport';
import type { Backing, HitTestable, Point, Rect, Size, Viewport } from './viewport';

const VIEWPORT: Viewport = { x: 12.5, y: -3.25, zoom: 0.03779527559055118, rotation: 0 };
const VIEWPORT_ROT: Viewport = { ...VIEWPORT, rotation: 90 };

const expectPointClose = (actual: Point, expected: Point, digits = 9): void => {
    expect(actual.x).toBeCloseTo(expected.x, digits);
    expect(actual.y).toBeCloseTo(expected.y, digits);
};

const makeTarget = (over: Partial<HitTestable> & { id: string }): HitTestable => ({
    bounds: { x: 0, y: 0, w: 100, h: 50 },
    visible: true,
    locked: false,
    ...over,
});

describe('worldToScreen / screenToWorld', () => {
    it('round trips within tolerance at rotation 0', () => {
        for (const p of [
            { x: 0, y: 0 },
            { x: 2500, y: 7800 },
            { x: -100, y: 50 },
            { x: 1234, y: 567 },
        ]) {
            expectPointClose(screenToWorld(worldToScreen(p, VIEWPORT), VIEWPORT), p, 6);
        }
    });

    it('round trips within tolerance at rotation 90', () => {
        for (const p of [
            { x: 0, y: 0 },
            { x: 2500, y: 7800 },
            { x: -100, y: 50 },
        ]) {
            expectPointClose(screenToWorld(worldToScreen(p, VIEWPORT_ROT), VIEWPORT_ROT), p, 6);
        }
    });

    it('maps the world origin to the pan point for both rotations', () => {
        expectPointClose(worldToScreen({ x: 0, y: 0 }, VIEWPORT), { x: VIEWPORT.x, y: VIEWPORT.y });
        expectPointClose(worldToScreen({ x: 0, y: 0 }, VIEWPORT_ROT), {
            x: VIEWPORT_ROT.x,
            y: VIEWPORT_ROT.y,
        });
    });

    it('rotates world +x onto screen +y at rotation 90 (clockwise, y-down)', () => {
        const vp: Viewport = { x: 10, y: 20, zoom: 2, rotation: 90 };
        expectPointClose(worldToScreen({ x: 3, y: 0 }, vp), { x: 10, y: 26 });
        expectPointClose(worldToScreen({ x: 0, y: 4 }, vp), { x: 2, y: 20 });
    });

    it('screenToHm rounds the world result to integer hm (exact values, rotation 0)', () => {
        const world = screenToHm({ x: VIEWPORT.x + 10.4, y: VIEWPORT.y + 10.6 }, VIEWPORT);
        expect(world).toEqual({ x: 275, y: 280 });
    });

    it('screenToHm rounds the world result at rotation 90', () => {
        const world = screenToHm({ x: VIEWPORT_ROT.x + 10.4, y: VIEWPORT_ROT.y + 10.6 }, VIEWPORT_ROT);
        expect(world).toEqual({ x: 280, y: -275 });
    });

    it('guards a zero or negative zoom so screenToHm stays finite', () => {
        for (const zoom of [0, -1]) {
            const world = screenToHm({ x: 100, y: 100 }, { x: 0, y: 0, zoom, rotation: 0 });
            expect(Number.isFinite(world.x)).toBe(true);
            expect(Number.isFinite(world.y)).toBe(true);
            expect(Number.isInteger(world.x)).toBe(true);
            expect(Number.isInteger(world.y)).toBe(true);
        }
    });
});

describe('labelScreenRect', () => {
    it('does not swap axes at rotation 0', () => {
        const rect = labelScreenRect({ x: 5, y: 7, zoom: 2, rotation: 0 }, { backingW: 2500, backingH: 7800 });
        expect(rect).toEqual({ x: 5, y: 7, w: 5000, h: 15600 });
    });

    it('swaps axes at rotation 90 so the long axis runs horizontally', () => {
        const rect = labelScreenRect({ x: 5, y: 7, zoom: 2, rotation: 90 }, { backingW: 2500, backingH: 7800 });
        expect(rect).toEqual({ x: 5 - 15600, y: 7, w: 15600, h: 5000 });
        expect(rect.w).toBeGreaterThan(rect.h);
    });
});

describe('realZoom', () => {
    it('is px per hm at the calibrated ppi', () => {
        expect(realZoom(96)).toBeCloseTo(96 / 25.4 / 100, 12);
        expect(realZoom(96)).toBeCloseTo(0.03779527559055118, 12);
    });

    it('scales linearly with ppi', () => {
        expect(realZoom(300)).toBeCloseTo(realZoom(96) * (300 / 96), 12);
    });
});

describe('backingPixelSize', () => {
    it('multiplies CSS size by zoom and devicePixelRatio', () => {
        // realZoom(96) * 2540 hm === 96 CSS px, so 2x DPR is 192 backing px.
        const size = backingPixelSize(2540, 1270, realZoom(96), 2);
        expect(size).toEqual({ width: 192, height: 96 });
    });
});

describe('fitZoom', () => {
    it('fits the raw backing at rotation 0', () => {
        expect(fitZoom(2500, 7800, 800, 600, 0)).toBeCloseTo(600 / 7800, 12);
    });

    it('uses the rotated extents at rotation 90', () => {
        expect(fitZoom(2500, 7800, 800, 600, 90)).toBeCloseTo(800 / 7800, 12);
        // Long axis horizontal fits a landscape screen better than portrait.
        expect(fitZoom(2500, 7800, 800, 600, 90)).toBeGreaterThan(fitZoom(2500, 7800, 800, 600, 0));
    });

    it('never returns a non-positive zoom for degenerate input', () => {
        expect(fitZoom(0, 100, 800, 600)).toBe(MIN_ZOOM);
        expect(fitZoom(100, 100, 0, 600)).toBe(MIN_ZOOM);
        expect(fitZoom(2500, 7800, 800, 600)).toBeGreaterThan(0);
    });
});

const assertBackingWithin = (rect: Rect, avail: Size): void => {
    if (rect.w <= avail.w) {
        expect(rect.x).toBeGreaterThanOrEqual(-1e-9);
        expect(rect.x + rect.w).toBeLessThanOrEqual(avail.w + 1e-9);
    } else {
        expect(rect.x).toBeLessThanOrEqual(1e-9);
        expect(rect.x + rect.w).toBeGreaterThanOrEqual(avail.w - 1e-9);
    }
    if (rect.h <= avail.h) {
        expect(rect.y).toBeGreaterThanOrEqual(-1e-9);
        expect(rect.y + rect.h).toBeLessThanOrEqual(avail.h + 1e-9);
    } else {
        expect(rect.y).toBeLessThanOrEqual(1e-9);
        expect(rect.y + rect.h).toBeGreaterThanOrEqual(avail.h - 1e-9);
    }
};

describe('clampPan', () => {
    const backing: Backing = { backingW: 2500, backingH: 7800 };
    const avail: Size = { w: 800, h: 600 };
    const fit = fitZoom(backing.backingW, backing.backingH, avail.w, avail.h, 0);

    it('keeps the backing within bounds at every zoom (rotation 0)', () => {
        for (const zoom of [fit, fit / 2, fit * 3]) {
            for (const [x, y] of [
                [-9999, -9999],
                [9999, 9999],
                [-500, 0],
                [5000, -2000],
            ]) {
                const clamped = clampPan({ x, y, zoom, rotation: 0 }, backing, avail);
                assertBackingWithin(labelScreenRect(clamped, backing), avail);
            }
        }
    });

    it('keeps the backing within bounds at every zoom (rotation 90)', () => {
        const fit90 = fitZoom(backing.backingW, backing.backingH, avail.w, avail.h, 90);
        for (const zoom of [fit90, fit90 / 2, fit90 * 3]) {
            for (const [x, y] of [
                [-9999, -9999],
                [9999, 9999],
            ]) {
                const clamped = clampPan({ x, y, zoom, rotation: 90 }, backing, avail);
                assertBackingWithin(labelScreenRect(clamped, backing), avail);
            }
        }
    });

    it('leaves a viewport already in bounds unchanged and does not mutate input', () => {
        const input: Viewport = { x: 100, y: 0, zoom: fit, rotation: 0 };
        const clamped = clampPan(input, backing, avail);
        expect(clamped).toEqual(input);
        expect(input).toEqual({ x: 100, y: 0, zoom: fit, rotation: 0 });
    });

    it('preserves rotation', () => {
        const clamped = clampPan({ x: 9999, y: 9999, zoom: fit, rotation: 90 }, backing, avail);
        expect(clamped.rotation).toBe(90);
    });
});

describe('centerPan', () => {
    it('centers the fitted backing and clamps it inside', () => {
        const backing: Backing = { backingW: 2500, backingH: 7800 };
        const avail: Size = { w: 800, h: 600 };
        const zoom = fitZoom(backing.backingW, backing.backingH, avail.w, avail.h, 0);
        const centered = centerPan({ x: 0, y: 0, zoom, rotation: 0 }, backing, avail);
        const rect = labelScreenRect(centered, backing);
        expect(rect.x).toBeCloseTo((avail.w - rect.w) / 2, 6);
        expect(rect.y).toBeCloseTo((avail.h - rect.h) / 2, 6);
        assertBackingWithin(rect, avail);
    });
});

describe('transformBounds', () => {
    it('expands a rect rotated 45 degrees', () => {
        const matrix = { a: Math.SQRT1_2, b: Math.SQRT1_2, c: -Math.SQRT1_2, d: Math.SQRT1_2, e: 0, f: 0 };
        const bounds = transformBounds({ x: 0, y: 0, w: 2, h: 0 }, matrix);
        expect(bounds.w).toBeCloseTo(Math.SQRT2, 9);
        expect(bounds.h).toBeCloseTo(Math.SQRT2, 9);
    });

    it('applies translation', () => {
        const bounds = transformBounds(
            { x: 0, y: 0, w: 10, h: 20 },
            { a: 1, b: 0, c: 0, d: 1, e: 5, f: -3 },
        );
        expect(bounds).toEqual({ x: 5, y: -3, w: 10, h: 20 });
    });
});

describe('hitTestWorld', () => {
    const targets: HitTestable[] = [makeTarget({ id: 'a' }), makeTarget({ id: 'b' })];

    it('returns the topmost node (later array entry wins an overlap)', () => {
        expect(hitTestWorld({ x: 50, y: 25 }, targets)).toBe('b');
    });

    it('returns null outside every node', () => {
        expect(hitTestWorld({ x: 150, y: 25 }, targets)).toBeNull();
    });

    it('consumes world-space AABBs directly, without re-applying a transform', () => {
        // Pre-transformed world AABB at x = 100..150; the point is inside it.
        expect(
            hitTestWorld(
                { x: 120, y: 10 },
                [makeTarget({ id: 'c', bounds: { x: 100, y: 0, w: 50, h: 50 } })],
            ),
        ).toBe('c');
        // The same box left in local space is not hit at x = 120.
        expect(
            hitTestWorld(
                { x: 120, y: 10 },
                [makeTarget({ id: 'c', bounds: { x: 0, y: 0, w: 50, h: 50 } })],
            ),
        ).toBeNull();
    });

    it('skips hidden nodes (effective visibility via resolved flags)', () => {
        expect(hitTestWorld({ x: 50, y: 25 }, [makeTarget({ id: 'hidden', visible: false })])).toBeNull();
    });

    it('skips locked nodes (effective lock via resolved flags)', () => {
        expect(hitTestWorld({ x: 50, y: 25 }, [makeTarget({ id: 'locked', locked: true })])).toBeNull();
    });

    it('prefers the topmost selectable node over hidden/locked entries above it', () => {
        const stack: HitTestable[] = [
            makeTarget({ id: 'base' }),
            makeTarget({ id: 'locked', locked: true }),
            makeTarget({ id: 'hidden', visible: false }),
        ];
        expect(hitTestWorld({ x: 50, y: 25 }, stack)).toBe('base');
    });
});

describe('hitTestScreen', () => {
    const targets: HitTestable[] = [makeTarget({ id: 'a' }), makeTarget({ id: 'b' })];

    it('is zoom- and rotation-independent', () => {
        const world: Point = { x: 50, y: 25 };
        for (const vp of [
            { x: 0, y: 0, zoom: 1, rotation: 0 } as Viewport,
            { x: 300, y: 200, zoom: 5, rotation: 0 } as Viewport,
            { x: 300, y: 200, zoom: 5, rotation: 90 } as Viewport,
        ]) {
            expect(hitTestScreen(worldToScreen(world, vp), vp, targets)).toBe('b');
        }
    });

    it('never selects locked or hidden nodes', () => {
        const vp: Viewport = { x: 0, y: 0, zoom: 1, rotation: 0 };
        const locked: HitTestable[] = [makeTarget({ id: 'locked', locked: true })];
        const hidden: HitTestable[] = [makeTarget({ id: 'hidden', visible: false })];
        expect(hitTestScreen(worldToScreen({ x: 50, y: 25 }, vp), vp, locked)).toBeNull();
        expect(hitTestScreen(worldToScreen({ x: 50, y: 25 }, vp), vp, hidden)).toBeNull();
    });
});

describe('snapCandidates', () => {
    const backing: Backing = { backingW: 2500, backingH: 7800 };
    const moving: Rect = { x: 96, y: 196, w: 100, h: 50 };
    const candidates = snapCandidates(moving, {
        backing,
        regions: [{ kind: 'rect', x: 0, y: 0, w: 500, h: 500 }],
        siblings: [{ x: 1000, y: 1000, w: 200, h: 200 }],
        grid: 50,
    });

    it('offers a delta to a backing edge', () => {
        const candidate = candidates.find(
            (c) => c.axis === 'x' && c.edge === 'start' && c.source === 'backing' && c.guide === 0,
        );
        expect(candidate?.delta).toBe(-96);
    });

    it('offers a delta to a region edge', () => {
        const candidate = candidates.find(
            (c) => c.axis === 'x' && c.edge === 'end' && c.source === 'region' && c.guide === 500,
        );
        expect(candidate?.delta).toBe(500 - 196);
    });

    it('offers a delta to a backing edge on the y axis', () => {
        const candidate = candidates.find(
            (c) => c.axis === 'y' && c.edge === 'start' && c.source === 'backing' && c.guide === 0,
        );
        expect(candidate?.delta).toBe(-196);
    });

    it('offers y-axis region, sibling, and grid deltas', () => {
        const region = candidates.find(
            (c) => c.axis === 'y' && c.edge === 'end' && c.source === 'region' && c.guide === 500,
        );
        expect(region?.delta).toBe(500 - 246);

        const sibling = candidates.find(
            (c) => c.axis === 'y' && c.edge === 'start' && c.source === 'sibling' && c.guide === 1000,
        );
        expect(sibling?.delta).toBe(1000 - 196);

        const grid = candidates.find((c) => c.axis === 'y' && c.edge === 'start' && c.source === 'grid');
        expect(grid?.guide).toBe(200);
        expect(grid?.delta).toBe(4);
    });

    it('uses regionBounds for non-rect regions (circle)', () => {
        const circle = snapCandidates(moving, {
            backing,
            regions: [{ kind: 'circle', cx: 500, cy: 500, r: 100 }],
        });
        const xGuides = circle
            .filter((c) => c.axis === 'x' && c.source === 'region')
            .map((c) => c.guide);
        expect(xGuides).toContain(400);
        expect(xGuides).toContain(600);
        const yGuides = circle
            .filter((c) => c.axis === 'y' && c.source === 'region')
            .map((c) => c.guide);
        expect(yGuides).toContain(400);
        expect(yGuides).toContain(600);
    });

    it('emits no region guides for a zero-area region', () => {
        const degenerate = snapCandidates(moving, {
            backing,
            regions: [{ kind: 'rect', x: 100, y: 100, w: 0, h: 0 }],
        });
        expect(degenerate.some((c) => c.source === 'region')).toBe(false);
    });

    it('offers a delta to a sibling bound', () => {
        const candidate = candidates.find(
            (c) => c.axis === 'x' && c.edge === 'start' && c.source === 'sibling' && c.guide === 1000,
        );
        expect(candidate?.delta).toBe(1000 - 96);
    });

    it('offers grid candidates when a grid step is configured', () => {
        const candidate = candidates.find(
            (c) => c.axis === 'x' && c.edge === 'start' && c.source === 'grid',
        );
        expect(candidate?.guide).toBe(100);
        expect(candidate?.delta).toBe(4);
    });

    it('omits grid candidates without a grid step', () => {
        const plain = snapCandidates(moving, { backing });
        expect(plain.some((c) => c.source === 'grid')).toBe(false);
        expect(plain.length).toBeGreaterThan(0);
    });
});
