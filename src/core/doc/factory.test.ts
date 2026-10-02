import { describe, expect, it } from 'vitest';
import { createFtagSpareDoc, createLabelDoc, newLabelId } from './factory';
import { isLabelDoc } from './validate';

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
