import { describe, expect, it } from 'vitest';
import {
    LABEL_PRESETS,
    createFtagSpareDoc,
    createLabelDoc,
    ftagSpareRegions,
    newLabelId,
} from './factory';
import { isLabelDoc } from './validate';
import type { Region } from './types';

/** Keys that carry hm (integer hundredths of a mm) geometry. */
const GEOMETRY_KEYS = new Set(['backingW', 'backingH', 'x', 'y', 'w', 'h', 'cx', 'cy', 'r']);

const assertIntegerGeometry = (value: unknown, path = 'doc'): void => {
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertIntegerGeometry(item, `${path}[${index}]`));
        return;
    }
    if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            if (GEOMETRY_KEYS.has(key)) {
                expect(Number.isInteger(child), `${path}.${key}=${String(child)} must be an integer`).toBe(true);
            }
            assertIntegerGeometry(child, `${path}.${key}`);
        }
    }
};

describe('newLabelId', () => {
    it('mints a non-empty unique id each call', () => {
        const a = newLabelId();
        const b = newLabelId();
        expect(a.length).toBeGreaterThan(0);
        expect(a).not.toBe(b);
    });
});

describe('createLabelDoc', () => {
    it('builds a valid doc with epoch-seconds dates', () => {
        const doc = createLabelDoc({ name: 'Mine', now: 1_700_000_000 });
        expect(isLabelDoc(doc).ok).toBe(true);
        expect(doc.version).toBe(1);
        expect(doc.meta.name).toBe('Mine');
        expect(doc.meta.createdAt).toBe(1_700_000_000);
        expect(doc.meta.updatedAt).toBe(1_700_000_000);
    });

    it('uses epoch seconds, not milliseconds', () => {
        const doc = createLabelDoc();
        // ms timestamps are ~1e12; seconds are ~1e9. This is the whole point.
        expect(doc.meta.createdAt).toBeLessThan(1e11);
        expect(Number.isInteger(doc.meta.createdAt)).toBe(true);
        expect(Math.abs(doc.meta.createdAt - Date.now() / 1000)).toBeLessThan(5);
    });

    it('clamps dpi through the shared normalizer', () => {
        expect(createLabelDoc({ dpi: 5000 }).label.dpi).toBe(1200);
        expect(createLabelDoc({ dpi: 12 }).label.dpi).toBe(100);
    });

    it('does not let callers mutate preset regions through the returned doc', () => {
        const first = createFtagSpareDoc();
        const second = createFtagSpareDoc();
        (first.label.regions[0] as { x: number }).x = -999;
        expect(second.label.regions[0]).toMatchObject({ x: 0 });
    });
});

describe('F-tag spare preset (ftagSpare-25x78)', () => {
    it('reproduces the backing size and all three raw regions exactly', () => {
        const doc = createFtagSpareDoc({ name: 'F-tag' });
        expect(doc.label.backingW).toBe(2500);
        expect(doc.label.backingH).toBe(7800);
        expect(doc.label.regions).toEqual([
            { kind: 'roundedRect', x: 0, y: 0, w: 2500, h: 3800, r: 200 },
            { kind: 'roundedRect', x: 0, y: 3400, w: 1975, h: 4400, r: 200 },
            { kind: 'roundedRect', x: 1575, y: 0, w: 600, h: 7800, r: 200 },
        ]);
    });

    it('pins the preset geometry exactly (three roundedRect regions, x/y/w/h/r)', () => {
        // Pin every field so a future edit cannot silently reshape the preset.
        expect(ftagSpareRegions()).toEqual([
            { kind: 'roundedRect', x: 0, y: 0, w: 2500, h: 3800, r: 200 },
            { kind: 'roundedRect', x: 0, y: 3400, w: 1975, h: 4400, r: 200 },
            { kind: 'roundedRect', x: 1575, y: 0, w: 600, h: 7800, r: 200 },
        ]);
        expect(ftagSpareRegions()).toHaveLength(3);
        // The preset must equal a fresh factory call.
        expect(LABEL_PRESETS['ftagSpare-25x78'].regions).toEqual(ftagSpareRegions());
    });

    it('is registered under the expected preset id', () => {
        expect(LABEL_PRESETS['ftagSpare-25x78'].backingW).toBe(2500);
        expect(LABEL_PRESETS['ftagSpare-25x78'].backingH).toBe(7800);
    });

    it('returns a fresh region array each call', () => {
        expect(ftagSpareRegions()).not.toBe(ftagSpareRegions());
        expect(ftagSpareRegions()).toEqual(ftagSpareRegions());
    });
});

/**
 * Point-in-region test for the union-coverage contract below. Bounding box,
 * then — for a `roundedRect` — the four corner discs: a point is inside unless
 * it sits in the corner square *outside* the quarter-disc at that corner. This
 * is deliberately the same arithmetic the renderer's `union(regions)` clip
 * uses, so a defect at a seam shows up here.
 */
const pointInRegion = (x: number, y: number, region: { kind: string; x?: number; y?: number; w?: number; h?: number; r?: number }): boolean => {
    if (region.kind !== 'roundedRect') return false;
    const { x: rx = 0, y: ry = 0, w = 0, h = 0, r = 0 } = region;
    if (x < rx || x > rx + w || y < ry || y > ry + h) return false;
    // Only the four corner squares can fall outside the rounded body.
    const cx = x < rx + r ? rx + r : x > rx + w - r ? rx + w - r : null;
    const cy = y < ry + r ? ry + r : y > ry + h - r ? ry + h - r : null;
    if (cx !== null && cy !== null) {
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
    }
    return true;
};

const pointInUnion = (x: number, y: number, regions: Region[]): boolean =>
    regions.some((region) => pointInRegion(x, y, region as never));

describe('F-tag spare preset union coverage (the defect this pins)', () => {
    /**
     * Pins the *intent*, not the region numbers. Every point below was reported
     * OUTSIDE the old four-region union because abutting roundedRect corners
     * lost half-discs at each seam. The union outline must be the intended
     * silhouette, so these must all be inside.
     */
    it('contains every seam point the old geometry punched out', () => {
        const regions = ftagSpareRegions();
        // Top edge where the two flag halves used to meet.
        expect(pointInUnion(1250, 0, regions), '(1250,0) flag top seam').toBe(true);
        // Flag/tab seam.
        expect(pointInUnion(1250, 3800, regions), '(1250,3800) flag seam').toBe(true);
        // Left outline where flag meets tail.
        expect(pointInUnion(0, 3800, regions), '(0,3800) flag/tail seam').toBe(true);
        // Tab/tail bottom corner.
        expect(pointInUnion(1575, 7800, regions), '(1575,7800) tab/tail corner').toBe(true);
        // Interior of flag and of the tab column.
        expect(pointInUnion(625, 1900, regions), '(625,1900) flag interior').toBe(true);
        expect(pointInUnion(1875, 7700, regions), '(1875,7700) tab interior').toBe(true);
    });

    it('excludes the lower-right notch (intent: cut OUT of the silhouette)', () => {
        expect(pointInUnion(2400, 7700, ftagSpareRegions()), '(2400,7700) notch').toBe(false);
    });

    it('reads the preset, not a private copy of the numbers', () => {
        // Guards the exact "dishonest test" failure: if this hardcoded the
        // regions it could pass while the preset regressed. It must be the same
        // array the factory ships.
        expect(pointInUnion(1250, 0, LABEL_PRESETS['ftagSpare-25x78'].regions)).toBe(true);
    });
});

describe('integer hm invariant', () => {
    it('factory output contains only integer geometry (deep scan)', () => {
        assertIntegerGeometry(createFtagSpareDoc());
        assertIntegerGeometry(createLabelDoc({ backingW: 12.4, backingH: 8.8 }));
    });

    it('rounds caller-supplied float regions (regression: factory bypassed hm rounding)', () => {
        const doc = createLabelDoc({
            backingW: 2500.4,
            backingH: 7800.6,
            regions: [
                { kind: 'rect', x: 1.5, y: 2.5, w: 3.4, h: 4.6 },
                { kind: 'roundedRect', x: 10.4, y: 20.5, w: 30.6, h: 40.4, r: 5.5 },
                { kind: 'circle', cx: 9.9, cy: 8.8, r: 7.7 },
                { kind: 'polygon', points: [[1.1, 2.2], [3.3, 4.4]], closed: true },
            ],
        });

        assertIntegerGeometry(doc);
        expect(doc.label.regions).toEqual([
            { kind: 'rect', x: 2, y: 3, w: 3, h: 5 },
            { kind: 'roundedRect', x: 10, y: 21, w: 31, h: 40, r: 6 },
            { kind: 'circle', cx: 10, cy: 9, r: 8 },
            { kind: 'polygon', points: [[1, 2], [3, 4]], closed: true },
        ]);
        // The serialized doc contains no float geometry either.
        expect(JSON.stringify(doc)).not.toMatch(/"(x|y|w|h|cx|cy|r|backingW|backingH)":-?\d+\.\d/);
        expect(isLabelDoc(doc).ok).toBe(true);
    });

    it('rounds caller-supplied float node transforms (regression: factory bypassed hm rounding)', () => {
        const doc = createLabelDoc({
            nodes: [
                {
                    id: 'n1',
                    parentId: null,
                    type: 'group',
                    visible: true,
                    locked: false,
                    transform: { x: 1.2, y: 2.8, rotDeg: 1.5, scaleX: 1, scaleY: 1 },
                },
            ],
        });

        assertIntegerGeometry(doc);
        // hm components rounded; the only non-hm transform numbers are untouched.
        expect(doc.nodes[0]!.transform).toEqual({
            x: 1,
            y: 3,
            rotDeg: 1.5,
            scaleX: 1,
            scaleY: 1,
        });
        expect(isLabelDoc(doc).ok).toBe(true);
    });

    it('validator-repaired output contains only integer geometry (deep scan)', () => {
        const result = isLabelDoc({
            version: 1,
            meta: { id: 'doc', name: 'n', createdAt: 1.9, updatedAt: 2.9 },
            label: {
                backingW: 2500.7,
                backingH: 7800.2,
                dpi: 300,
                regions: [
                    { kind: 'rect', x: 1.5, y: 2.5, w: 3.4, h: 4.6 },
                    { kind: 'circle', cx: 9.9, cy: 8.8, r: 7.7 },
                    { kind: 'polygon', points: [[1.1, 2.2], [3.3, 4.4]], closed: true },
                ],
            },
            nodes: [
                {
                    id: 'n1',
                    type: 'group',
                    visible: true,
                    locked: false,
                    transform: { x: 1.2, y: 2.8, rotDeg: 1.5, scaleX: 1, scaleY: 1 },
                },
            ],
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        assertIntegerGeometry(result.doc);
    });
});
