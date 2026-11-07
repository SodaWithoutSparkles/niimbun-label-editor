import { describe, expect, it } from 'vitest';
import { copyLabelDoc, createFtagSpareDoc, createLabelDoc, newLabelId } from './factory';
import { isLabelDoc } from './validate';
import type { LabelDoc, Node } from './types';

/** Keys that carry hm (integer hundredths of a mm) geometry. */
const GEOMETRY_KEYS = new Set([
    'backingW',
    'backingH',
    'x',
    'y',
    'w',
    'h',
    'cx',
    'cy',
    'r',
    'fontSize',
    'cornerRadius',
    'strokeWidth',
    'x1',
    'y1',
    'x2',
    'y2',
]);

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

    it('does not let callers mutate paper-type regions through the returned doc', () => {
        const first = createFtagSpareDoc();
        const second = createFtagSpareDoc();
        (first.label.regions[0] as { x: number }).x = -999;
        expect(second.label.regions[0]).toMatchObject({ x: 0 });
    });

    it('records meta.paperTypeId when created from a paper type', () => {
        expect(createFtagSpareDoc().meta.paperTypeId).toBe('ftagSpare-25x78');
        expect(createLabelDoc({ paperTypeId: 'rounded30x20' }).meta.paperTypeId).toBe('rounded30x20');
        expect(createLabelDoc().meta.paperTypeId).toBeUndefined();
    });

    it('writes an explicit label kind by default', () => {
        expect(createLabelDoc().meta.kind).toBe('label');
        expect(createFtagSpareDoc().meta.kind).toBe('label');
    });

    it('honours kind: "preset"', () => {
        const doc = createLabelDoc({ kind: 'preset', name: 'Price tag' });
        expect(doc.meta.kind).toBe('preset');
        expect(isLabelDoc(doc).ok).toBe(true);
        const validated = isLabelDoc(doc);
        if (!validated.ok) return;
        expect(validated.doc.meta.kind).toBe('preset');
    });

    it('records an unknown user-authored paperTypeId (no built-in preset)', () => {
        const doc = createLabelDoc({
            paperTypeId: 'user-123',
            backingW: 1000,
            backingH: 500,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 1000, h: 500 }],
        });
        // The caller's id is provenance, not just a preset lookup key.
        expect(doc.meta.paperTypeId).toBe('user-123');
        // Explicit geometry still wins over the (absent) preset fallback.
        expect(doc.label.backingW).toBe(1000);
        expect(doc.label.backingH).toBe(500);
        expect(doc.label.regions).toEqual([{ kind: 'rect', x: 0, y: 0, w: 1000, h: 500 }]);
        expect(isLabelDoc(doc).ok).toBe(true);
    });

    it('copies the paper-type guides onto label.guides (F-tag score line)', () => {
        expect(createFtagSpareDoc().label.guides).toEqual([
            { id: 'ftag-spare-score', kind: 'score', line: { x1: 1250, y1: 0, x2: 1250, y2: 3800 } },
        ]);
        // A paper type with no guide, and a bare doc, both get an empty list.
        expect(createLabelDoc({ paperTypeId: 'rounded30x20' }).label.guides).toEqual([]);
        expect(createLabelDoc().label.guides).toEqual([]);
    });

    it('lets explicit guides win over the paper type and rounds their hm geometry', () => {
        const doc = createLabelDoc({
            paperTypeId: 'ftagSpare-25x78',
            guides: [{ id: 'g', kind: 'score', line: { x1: 1.4, y1: 2.6, x2: 3.5, y2: 4.4 } }],
        });
        expect(doc.label.guides).toEqual([
            { id: 'g', kind: 'score', line: { x1: 1, y1: 3, x2: 4, y2: 4 } },
        ]);
        assertIntegerGeometry(doc);
    });

    it('does not let callers mutate paper-type guides through the returned doc', () => {
        const first = createFtagSpareDoc();
        const second = createFtagSpareDoc();
        first.label.guides[0]!.line.x1 = -999;
        expect(second.label.guides[0]!.line.x1).toBe(1250);
    });

    it('rounds caller-supplied node geometry (size/fontSize/cornerRadius/points/strokeWidth)', () => {
        const doc = createLabelDoc({
            nodes: [
                {
                    id: 't1',
                    parentId: null,
                    type: 'text',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    text: { kind: 'static', value: 'a' },
                    size: { w: 10.4, h: 20.6 },
                    fontSize: 300.5,
                },
                {
                    id: 's1',
                    parentId: null,
                    type: 'shape',
                    shape: 'rectangle',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    size: { w: 100.2, h: 50.7 },
                    cornerRadius: 5.5,
                    strokeWidth: 2.5,
                },
                {
                    id: 'p1',
                    parentId: null,
                    type: 'shape',
                    shape: 'polygon',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    points: [[1.1, 2.2], [3.3, 4.4]],
                    closed: true,
                },
            ],
        });
        expect(doc.nodes[0]).toMatchObject({ size: { w: 10, h: 21 }, fontSize: 301 });
        expect(doc.nodes[1]).toMatchObject({
            size: { w: 100, h: 51 },
            cornerRadius: 6,
            strokeWidth: 3,
        });
        expect(doc.nodes[2]).toMatchObject({ points: [[1, 2], [3, 4]] });
        assertIntegerGeometry(doc);
        expect(isLabelDoc(doc).ok).toBe(true);
    });

    it('copies a print offset option (P9) and stays validator-clean', () => {
        const doc = createLabelDoc({ printOffset: { xHm: 120, yHm: -85, type: 'outer' } });
        expect(doc.label.printOffset).toEqual({ xHm: 120, yHm: -85, type: 'outer' });
        const parsed = isLabelDoc(doc);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.doc.label.printOffset).toEqual({ xHm: 120, yHm: -85, type: 'outer' });

        // Absent by default…
        expect(createLabelDoc().label.printOffset).toBeUndefined();
        // …and the copy is detached from the caller's object.
        const source = { xHm: 5, yHm: 6, type: 'inner' as const };
        const owned = createLabelDoc({ printOffset: source });
        source.xHm = 999;
        expect(owned.label.printOffset?.xHm).toBe(5);
    });

    it('creates no field declarations by default (P6a)', () => {
        expect('fields' in createLabelDoc().data).toBe(false);
        expect('fields' in createFtagSpareDoc().data).toBe(false);
    });
});

describe('integer hm invariant', () => {
    it('factory output contains only integer geometry (deep scan)', () => {
        assertIntegerGeometry(createFtagSpareDoc());
        assertIntegerGeometry(createLabelDoc({ backingW: 12.4, backingH: 8.8 }));
    });

    it('rounds quantizer params and drops malformed optional values', () => {
        const imageNode = {
            id: 'i', parentId: null, type: 'image' as const, imageId: 'img', visible: true, locked: false,
            transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
            quantizerParams: { threshold: 300.4, strength: 1.234 },
        };
        const doc = createLabelDoc({ nodes: [imageNode] });
        expect(doc.nodes[0]?.quantizerParams).toEqual({ threshold: 255, strength: 1.23 });
        const invalid = createLabelDoc({ nodes: [{ ...imageNode, quantizerParams: { threshold: Number.NaN } }] });
        expect(invalid.nodes[0]?.quantizerParams).toBeUndefined();
    });

    it('keeps screentoneBoldness through roundNode and clamps it to [-1, 1]', () => {
        const rect = {
            id: 's', parentId: null, type: 'shape' as const, shape: 'rectangle' as const,
            visible: true, locked: false,
            transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        };
        // A node update runs through `roundNode`; dropping the key here made the
        // inspector's value vanish on the next commit.
        expect(
            createLabelDoc({ nodes: [{ ...rect, quantizerParams: { screentoneBoldness: 0.456 } }] })
                .nodes[0]?.quantizerParams,
        ).toEqual({ screentoneBoldness: 0.46 });
        expect(
            createLabelDoc({ nodes: [{ ...rect, quantizerParams: { screentoneBoldness: 9 } }] })
                .nodes[0]?.quantizerParams,
        ).toEqual({ screentoneBoldness: 1 });
        expect(
            createLabelDoc({ nodes: [{ ...rect, quantizerParams: { screentoneBoldness: -9 } }] })
                .nodes[0]?.quantizerParams,
        ).toEqual({ screentoneBoldness: -1 });
        // Non-finite values are dropped, matching `validate`.
        expect(
            createLabelDoc({ nodes: [{ ...rect, quantizerParams: { screentoneBoldness: Number.NaN } }] })
                .nodes[0]?.quantizerParams,
        ).toBeUndefined();
    });

    it('drops an empty/invalid quantizerParams on a text node (early-return regression)', () => {
        const textNode = {
            id: 't', parentId: null, type: 'text' as const, visible: true, locked: false,
            transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
            text: { kind: 'static' as const, value: 'hi' },
        };
        // The delete used to sit after the text early return, so a text node
        // kept the inert key. It must be dropped here too.
        expect(
            createLabelDoc({ nodes: [{ ...textNode, quantizerParams: {} }] }).nodes[0]?.quantizerParams,
        ).toBeUndefined();
        expect(
            createLabelDoc({ nodes: [{ ...textNode, quantizerParams: { threshold: Number.NaN } }] }).nodes[0]
                ?.quantizerParams,
        ).toBeUndefined();
        // A valid text-node params object still survives and rounds identically.
        expect(
            createLabelDoc({
                nodes: [{ ...textNode, quantizerParams: { threshold: 200.6, strength: 2.345 } }],
            }).nodes[0]?.quantizerParams,
        ).toEqual({ threshold: 201, strength: 2.35 });
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

    it('clamps negative region w/h/r to 0 (rect, roundedRect, circle)', () => {
        const doc = createLabelDoc({
            regions: [
                { kind: 'rect', x: 1, y: 2, w: -500, h: -1 },
                { kind: 'roundedRect', x: 0, y: 0, w: 10, h: 20, r: -3 },
                { kind: 'circle', cx: 5, cy: 6, r: -7 },
            ],
        });
        expect(doc.label.regions).toEqual([
            { kind: 'rect', x: 1, y: 2, w: 0, h: 0 },
            { kind: 'roundedRect', x: 0, y: 0, w: 10, h: 20, r: 0 },
            { kind: 'circle', cx: 5, cy: 6, r: 0 },
        ]);
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

describe('copyLabelDoc', () => {
    const textNode: Node = {
        id: 'n1',
        parentId: null,
        type: 'text',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        text: { kind: 'field', name: '', fallback: '—' },
    };

    /** A preset carrying every field a `createLabelDoc` rebuild would drop. */
    const sourceDoc = (): LabelDoc => {
        const doc = createLabelDoc({
            id: 'src-1',
            name: 'Price tag',
            kind: 'preset',
            paperTypeId: 'ftagSpare-25x78',
            now: 1_600_000_000,
            nodes: [textNode],
        });
        doc.meta.thumb = {
            mediaType: 'image/png',
            dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAF0lEQVR42mNgYGD4//8/FhK7KAQMPh0AXXNfoWyFCAcAAAAASUVORK5CYII=',
            at: 1_600_000_000,
        };
        doc.data.csv = {
            csvId: 'c1',
            name: 'prices.csv',
            source: { kind: 'local', mediaType: 'text/csv', resourceId: 'c1' },
        };
        doc.data.sampleRowIndex = 3;
        doc.data.globals = [{ name: 'rate', kind: 'static', value: '0.2' }];
        doc.resources.fonts.push({
            fontId: 'f1',
            familyName: 'Fam',
            name: 'Fam File',
            source: { kind: 'system', descriptor: 'Fam' },
        });
        doc.resources.images.push({
            imageId: 'i1',
            name: 'logo.png',
            source: { kind: 'inline', mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAAA' },
            widthPx: 8,
            heightPx: 8,
        });
        return doc;
    };

    it('takes a fresh id, or the injected one', () => {
        const source = sourceDoc();
        const copy = copyLabelDoc(source, { kind: 'label', now: 1 });
        expect(copy.meta.id).not.toBe(source.meta.id);
        expect(copy.meta.id.length).toBeGreaterThan(0);
        expect(copyLabelDoc(source, { kind: 'label', id: 'copy-1' }).meta.id).toBe('copy-1');
    });

    it('uses an explicit kind, never the source kind', () => {
        const preset = sourceDoc();
        expect(copyLabelDoc(preset, { kind: 'label', now: 1 }).meta.kind).toBe('label');
        const label = createLabelDoc({ id: 'l1', kind: 'label', now: 1 });
        expect(copyLabelDoc(label, { kind: 'preset', now: 1 }).meta.kind).toBe('preset');
        expect(label.meta.kind).toBe('label');
    });

    it('defaults the name to the source and accepts an override', () => {
        const source = sourceDoc();
        expect(copyLabelDoc(source, { kind: 'label', now: 1 }).meta.name).toBe('Price tag');
        expect(copyLabelDoc(source, { kind: 'preset', name: 'Mine', now: 1 }).meta.name).toBe('Mine');
    });

    it('stamps both timestamps with now and clears the thumb', () => {
        const source = sourceDoc();
        const copy = copyLabelDoc(source, { kind: 'label', now: 1_700_000_000 });
        expect(copy.meta.createdAt).toBe(1_700_000_000);
        expect(copy.meta.updatedAt).toBe(1_700_000_000);
        expect('thumb' in copy.meta).toBe(false);
        // The source keeps its own thumb.
        expect(source.meta.thumb).toBeDefined();
    });

    it('preserves the CSV, globals, resources and paper provenance', () => {
        const source = sourceDoc();
        const copy = copyLabelDoc(source, { kind: 'label', now: 1_700_000_000 });

        expect(copy.meta.paperTypeId).toBe('ftagSpare-25x78');
        expect(copy.data.csv).toEqual(source.data.csv);
        expect(copy.data.sampleRowIndex).toBe(3);
        expect(copy.data.globals).toEqual(source.data.globals);
        expect(copy.resources.fonts).toEqual(source.resources.fonts);
        expect(copy.resources.images).toEqual(source.resources.images);
        expect(copy.label).toEqual(source.label);
    });

    it('deep-clones the nodes (equal but not shared)', () => {
        const source = sourceDoc();
        const copy = copyLabelDoc(source, { kind: 'label', now: 1 });
        expect(copy.nodes).toEqual(source.nodes);
        expect(copy.nodes[0]).not.toBe(source.nodes[0]);
    });

    it('never mutates the source document', () => {
        const source = sourceDoc();
        const snapshot = structuredClone(source);
        const copy = copyLabelDoc(source, { kind: 'label', name: 'Other', now: 1_700_000_000 });

        expect(source).toEqual(snapshot);
        // Mutating the copy must not leak back either.
        copy.nodes[0]!.transform.x = 999;
        copy.data.globals.push({ name: 'extra', kind: 'static', value: '1' });
        expect(source).toEqual(snapshot);
    });

    it('produces a document the validator accepts', () => {
        const copy = copyLabelDoc(sourceDoc(), { kind: 'label', now: 1_700_000_000 });
        const result = isLabelDoc(copy);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.repairs).toEqual([]);
        expect(result.doc.meta.kind).toBe('label');
    });
});
