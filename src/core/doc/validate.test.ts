import { describe, expect, it } from 'vitest';
import {
    isAssetRef,
    isHm,
    isLabelDoc,
    isNode,
    isRegion,
    migrate,
    normalizeDpi,
} from './validate';

const validRaw = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    version: 1,
    meta: { id: 'doc-1', name: 'Label', createdAt: 1_700_000_000, updatedAt: 1_700_000_000 },
    label: { backingW: 2500, backingH: 7800, dpi: 300, regions: [], printDirection: 'top' },
    nodes: [],
    data: { sampleRowIndex: 0, globals: [] },
    resources: { fonts: [], images: [] },
    ...overrides,
});

const baseNode = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'node-1',
    parentId: null,
    type: 'shape',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    shape: 'rectangle',
    ...over,
});

const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
};

const pngBytes = (width: number, height: number, padding = 0): Uint8Array => {
    const bytes = new Uint8Array(24 + padding);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
    bytes[16] = (width >>> 24) & 0xff;
    bytes[17] = (width >>> 16) & 0xff;
    bytes[18] = (width >>> 8) & 0xff;
    bytes[19] = width & 0xff;
    bytes[20] = (height >>> 24) & 0xff;
    bytes[21] = (height >>> 16) & 0xff;
    bytes[22] = (height >>> 8) & 0xff;
    bytes[23] = height & 0xff;
    return bytes;
};

const pngDataUrl = (width: number, height: number, padding = 0): string =>
    `data:image/png;base64,${bytesToBase64(pngBytes(width, height, padding))}`;

const thumb = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    mediaType: 'image/png',
    dataUrl: pngDataUrl(64, 64),
    at: 1_700_000_000.9,
    ...over,
});

describe('isHm / normalizeDpi', () => {
    it('rounds finite numbers to integers', () => {
        expect(isHm(10.4)).toBe(10);
        expect(isHm(10.5)).toBe(11);
        expect(isHm(-3.5)).toBe(-3);
    });

    it('rejects non-numbers', () => {
        expect(isHm('10')).toBeUndefined();
        expect(isHm(Number.NaN)).toBeUndefined();
        expect(isHm(Infinity)).toBeUndefined();
        expect(isHm(null)).toBeUndefined();
    });

    it('clamps dpi to 100–1200 and defaults to 300', () => {
        expect(normalizeDpi(5000)).toBe(1200);
        expect(normalizeDpi(10)).toBe(100);
        expect(normalizeDpi(300.4)).toBe(300);
        expect(normalizeDpi(203)).toBe(203);
        expect(normalizeDpi('300')).toBe(300);
        expect(normalizeDpi(undefined)).toBe(300);
    });
});

describe('isRegion', () => {
    it('accepts all four region kinds and repairs aliases', () => {
        expect(isRegion({ kind: 'rect', x: 1, y: 2, w: 3, h: 4 })).toEqual({
            kind: 'rect',
            x: 1,
            y: 2,
            w: 3,
            h: 4,
        });
        expect(isRegion({ kind: 'roundedRect', x: 1, y: 2, w: 3, h: 4, r: 5.5 })).toEqual({
            kind: 'roundedRect',
            x: 1,
            y: 2,
            w: 3,
            h: 4,
            r: 6,
        });
        expect(isRegion({ kind: 'circle', cx: 1, cy: 2, r: 3 })).toEqual({
            kind: 'circle',
            cx: 1,
            cy: 2,
            r: 3,
        });
        expect(
            isRegion({ kind: 'polygon', points: [[1.2, 2.8], [3, 4]], closed: false }),
        ).toEqual({ kind: 'polygon', points: [[1, 3], [3, 4]], closed: false });
    });

    it('defaults roundedRect.r to 0 and polygon.closed to true', () => {
        expect(isRegion({ kind: 'roundedRect', x: 1, y: 2, w: 3, h: 4 })?.kind).toBe('roundedRect');
        expect(isRegion({ kind: 'roundedRect', x: 1, y: 2, w: 3, h: 4 })).toMatchObject({ r: 0 });
        expect(isRegion({ kind: 'polygon', points: [[1, 2]] })?.kind).toBe('polygon');
        expect(isRegion({ kind: 'polygon', points: [[1, 2]] })).toMatchObject({ closed: true });
    });

    it('reports a non-boolean polygon.closed as a repair', () => {
        const repairs: string[] = [];
        const region = isRegion({ kind: 'polygon', points: [[1, 2]], closed: 'yes' }, repairs);
        expect(region).toMatchObject({ closed: true });
        expect(repairs).toEqual([
            'region.polygon.closed: non-boolean closed defaulted to true',
        ]);

        // A genuinely boolean `false` is preserved without a repair.
        const okRepairs: string[] = [];
        expect(isRegion({ kind: 'polygon', points: [[1, 2]], closed: false }, okRepairs)).toMatchObject(
            { closed: false },
        );
        expect(okRepairs).toEqual([]);
    });

    it('rejects unknown kinds and missing geometry', () => {
        expect(isRegion({ kind: 'triangle', x: 1, y: 2, w: 3, h: 4 })).toBeUndefined();
        expect(isRegion({ kind: 'rect', x: 1, y: 2, w: 3 })).toBeUndefined();
        expect(isRegion({ kind: 'polygon', points: [[1]] })).toBeUndefined();
        expect(isRegion({ kind: 'polygon', points: [[1, 'x']] })).toBeUndefined();
        expect(isRegion(null)).toBeUndefined();
    });

    it('clamps negative region extents to 0 and records a repair', () => {
        const rectRepairs: string[] = [];
        expect(
            isRegion({ kind: 'rect', x: 0, y: 0, w: -500, h: 10 }, rectRepairs),
        ).toEqual({ kind: 'rect', x: 0, y: 0, w: 0, h: 10 });
        expect(rectRepairs.join(' ')).toContain('region.w: negative width clamped to 0');

        const roundedRepairs: string[] = [];
        expect(
            isRegion({ kind: 'roundedRect', x: 0, y: 0, w: 1, h: 1, r: -2 }, roundedRepairs),
        ).toMatchObject({ r: 0 });
        expect(roundedRepairs.join(' ')).toContain('region.r: negative radius clamped to 0');

        const circleRepairs: string[] = [];
        expect(isRegion({ kind: 'circle', cx: 0, cy: 0, r: -7 }, circleRepairs)).toMatchObject({
            r: 0,
        });
        expect(circleRepairs.join(' ')).toContain('region.r: negative radius clamped to 0');
    });
});

describe('isAssetRef', () => {
    it('accepts all four provenances', () => {
        expect(isAssetRef({ kind: 'inline', mediaType: 'image/png', dataUrl: 'data:,' })).toEqual({
            kind: 'inline',
            mediaType: 'image/png',
            dataUrl: 'data:,',
        });
        expect(isAssetRef({ kind: 'remote', mediaType: 'font/ttf', url: 'https://x/f.ttf' })).toEqual(
            { kind: 'remote', mediaType: 'font/ttf', url: 'https://x/f.ttf' },
        );
        expect(
            isAssetRef({ kind: 'local', mediaType: 'image/png', resourceId: 'r1', fingerprint: 'ab' }),
        ).toEqual({ kind: 'local', mediaType: 'image/png', resourceId: 'r1', fingerprint: 'ab' });
        expect(
            isAssetRef({ kind: 'external', mediaType: 'text/csv', filename: 'a.csv' }),
        ).toEqual({ kind: 'external', mediaType: 'text/csv', filename: 'a.csv' });
    });

    it('rejects unknown kinds and missing required fields', () => {
        expect(isAssetRef({ kind: 'cloud', mediaType: 'image/png', url: 'x' })).toBeUndefined();
        expect(isAssetRef({ kind: 'remote', mediaType: 'image/png' })).toBeUndefined();
        expect(isAssetRef({ kind: 'local', resourceId: 'r1' })).toBeUndefined();
        expect(isAssetRef({ kind: 'inline', mediaType: 'image/png' })).toBeUndefined();
    });
});

describe('isNode — geometry fields (P3 §13)', () => {
    it('accepts optional size and rounds/clamps it', () => {
        const node = isNode(baseNode({ size: { w: 10.4, h: 20.6 } }));
        expect(node?.size).toEqual({ w: 10, h: 21 });
        // Negative size is clamped to 0 with a repair.
        const repairs: string[] = [];
        const clamped = isNode(baseNode({ size: { w: -5, h: 10 } }), repairs);
        expect(clamped?.size).toEqual({ w: 0, h: 10 });
        expect(repairs.join(' ')).toContain('node.size');
    });

    it('drops a malformed size instead of failing the node', () => {
        expect(isNode(baseNode({ size: 'big' }))?.size).toBeUndefined();
        expect(isNode(baseNode({ size: { w: 10 } }))?.size).toBeUndefined();
    });

    it('accepts text font fields; fontSize must be > 0', () => {
        const node = isNode(
            baseNode({
                type: 'text',
                shape: undefined,
                text: 'hi',
                size: { w: 100, h: 50 },
                fontSize: 320.4,
                fontFamily: 'Inter',
                fontStyle: 'italic',
                align: 'center',
                letterSpacing: 1.5,
                lineHeight: 1.2,
                direction: 'rtl',
            }),
        );
        expect(node).toMatchObject({
            type: 'text',
            fontSize: 320,
            fontFamily: 'Inter',
            fontStyle: 'italic',
            align: 'center',
            letterSpacing: 1.5,
            lineHeight: 1.2,
            direction: 'rtl',
        });
        // fontSize ≤ 0 / non-integer is dropped, not rejected.
        const fontSize = (n: ReturnType<typeof isNode>) =>
            n?.type === 'text' ? n.fontSize : undefined;
        expect(fontSize(isNode(baseNode({ type: 'text', shape: undefined, fontSize: 0 })))).toBeUndefined();
        expect(fontSize(isNode(baseNode({ type: 'text', shape: undefined, fontSize: -10 })))).toBeUndefined();
        // A bad align defaults to absent.
        const align = (n: ReturnType<typeof isNode>) => (n?.type === 'text' ? n.align : undefined);
        expect(align(isNode(baseNode({ type: 'text', shape: undefined, align: 'middle' })))).toBeUndefined();
    });

    it('accepts rectangle cornerRadius and scales it as hm ≥ 0', () => {
        const node = isNode(baseNode({ shape: 'rectangle', cornerRadius: 5.5, size: { w: 10, h: 10 } }));
        expect(node?.type === 'shape' && node.cornerRadius).toBe(6);
        const negative = isNode(baseNode({ shape: 'rectangle', cornerRadius: -3 }));
        expect(negative?.type === 'shape' && negative.cornerRadius).toBe(0);
    });

    it('accepts points for line/polygon, defaults polygon.closed, drops size', () => {
        const line = isNode(baseNode({ shape: 'line', points: [[1.2, 2.8], [3, 4]] }));
        expect(line).toMatchObject({ shape: 'line', points: [[1, 3], [3, 4]], closed: false });
        const poly = isNode(baseNode({ shape: 'polygon', points: [[0, 0], [10, 0], [10, 10]] }));
        expect(poly).toMatchObject({ shape: 'polygon', closed: true });
        // `points` is authoritative: a stale size alongside them is dropped.
        const withSize = isNode(
            baseNode({ shape: 'line', points: [[0, 0], [1, 1]], size: { w: 50, h: 50 } }),
        );
        expect(withSize?.size).toBeUndefined();
        // Malformed points still reject the node.
        expect(isNode(baseNode({ shape: 'polygon', points: [[1]] }))).toBeUndefined();
        expect(isNode(baseNode({ shape: 'polygon', points: [['x', 1]] }))).toBeUndefined();
    });

    it('repairs a point-less line/polygon from size instead of rejecting (fix 10)', () => {
        const repairs: string[] = [];
        const repaired = isNode(
            baseNode({ shape: 'line', size: { w: 200, h: 100 } }),
            repairs,
        );
        expect(repaired).toMatchObject({ shape: 'line', points: [[0, 0], [200, 100]] });
        expect(repaired?.size).toBeUndefined();
        expect(repairs.join(' ')).toContain('missing points synthesised from size');

        // Without points or size there is no geometry to stand in: drop just the
        // node (not the whole document).
        const dropRepairs: string[] = [];
        expect(isNode(baseNode({ shape: 'polygon' }), dropRepairs)).toBeUndefined();
        expect(dropRepairs.join(' ')).toContain('node dropped');
    });
});

describe('isNode — quantizerHint (P4)', () => {
    it('keeps a known quantizer id', () => {
        expect(isNode(baseNode({ quantizerHint: 'atkinson' }))?.quantizerHint).toBe('atkinson');
    });

    it('drops an unknown quantizer id (absent) and records a repair', () => {
        const repairs: string[] = [];
        const node = isNode(baseNode({ quantizerHint: 'ordered' }), repairs);
        expect(node).toBeDefined();
        expect(node?.quantizerHint).toBeUndefined();
        expect(repairs.join(' ')).toContain('node.quantizerHint');
    });

    it('round-trips a valid hint and drops an invalid one through isLabelDoc', () => {
        const kept = isLabelDoc(
            validRaw({ nodes: [baseNode({ id: 'k', quantizerHint: 'stucki' })] }),
        );
        expect(kept.ok).toBe(true);
        if (!kept.ok) return;
        expect(kept.doc.nodes[0]?.quantizerHint).toBe('stucki');

        const dropped = isLabelDoc(
            validRaw({ nodes: [baseNode({ id: 'd', quantizerHint: 'nope' })] }),
        );
        expect(dropped.ok).toBe(true);
        if (!dropped.ok) return;
        expect(dropped.doc.nodes[0]?.quantizerHint).toBeUndefined();
        expect(dropped.repairs.join(' ')).toContain('nodes[0]: node.quantizerHint');
    });
});

describe('isNode — P5 object options', () => {
    it('round-trips a text fontId and drops a non-string one', () => {
        const kept = isNode(
            baseNode({ type: 'text', shape: undefined, text: 'hi', fontId: 'font-7' }),
        );
        expect(kept?.type === 'text' && kept.fontId).toBe('font-7');

        const dropped = isNode(
            baseNode({ type: 'text', shape: undefined, text: 'hi', fontId: 7 }),
        );
        expect(dropped?.type === 'text' && dropped.fontId).toBeUndefined();
    });

    it('keeps a valid image fit and drops an unknown one with a repair', () => {
        const kept = isNode(baseNode({ type: 'image', shape: undefined, imageId: 'i', fit: 'cover' }));
        expect(kept?.type === 'image' && kept.fit).toBe('cover');

        const repairs: string[] = [];
        const dropped = isNode(
            baseNode({ type: 'image', shape: undefined, imageId: 'i', fit: 'bogus' }),
            repairs,
        );
        expect(dropped?.type === 'image' && dropped.fit).toBeUndefined();
        expect(repairs.join(' ')).toContain('node.fit: unknown fit dropped');
    });

    it('keeps a valid qr errorCorrection and drops an unknown one with a repair', () => {
        const kept = isNode(
            baseNode({ type: 'qr', shape: undefined, data: 'x', errorCorrection: 'H' }),
        );
        expect(kept?.type === 'qr' && kept.errorCorrection).toBe('H');

        const repairs: string[] = [];
        const dropped = isNode(
            baseNode({ type: 'qr', shape: undefined, data: 'x', errorCorrection: 'X' }),
            repairs,
        );
        expect(dropped?.type === 'qr' && dropped.errorCorrection).toBeUndefined();
        expect(repairs.join(' ')).toContain('node.qr.errorCorrection: unknown level dropped');
    });

    it('keeps a valid barcode symbology and drops an unknown one with a repair', () => {
        const kept = isNode(
            baseNode({ type: 'barcode', shape: undefined, data: 'x', symbology: 'ean13' }),
        );
        expect(kept?.type === 'barcode' && kept.symbology).toBe('ean13');

        const repairs: string[] = [];
        const dropped = isNode(
            baseNode({ type: 'barcode', shape: undefined, data: 'x', symbology: 'nope' }),
            repairs,
        );
        expect(dropped?.type === 'barcode' && dropped.symbology).toBeUndefined();
        expect(repairs.join(' ')).toContain('node.barcode.symbology: unknown symbology dropped');
    });

    it('round-trips the new optionals through isLabelDoc', () => {
        const result = isLabelDoc(
            validRaw({
                nodes: [
                    baseNode({ id: 'a', type: 'text', shape: undefined, text: 't', fontId: 'f1' }),
                    baseNode({ id: 'b', type: 'image', shape: undefined, imageId: 'i1', fit: 'contain' }),
                    baseNode({ id: 'c', type: 'qr', shape: undefined, data: 'q', errorCorrection: 'M' }),
                    baseNode({ id: 'd', type: 'barcode', shape: undefined, data: 'b', symbology: 'code128' }),
                ],
            }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.doc.nodes[0]?.type === 'text' && result.doc.nodes[0].fontId).toBe('f1');
        expect(result.doc.nodes[1]?.type === 'image' && result.doc.nodes[1].fit).toBe('contain');
        expect(result.doc.nodes[2]?.type === 'qr' && result.doc.nodes[2].errorCorrection).toBe('M');
        expect(result.doc.nodes[3]?.type === 'barcode' && result.doc.nodes[3].symbology).toBe('code128');
    });
});

describe('isNode', () => {
    it('accepts every node kind', () => {
        expect(isNode(baseNode())?.type).toBe('shape');
        expect(isNode(baseNode({ type: 'group', shape: undefined }))?.type).toBe('group');
        expect(
            isNode(baseNode({ type: 'text', shape: undefined, text: { kind: 'static', value: 'hi' } }))
                ?.type,
        ).toBe('text');
        expect(isNode(baseNode({ type: 'image', shape: undefined, imageId: 'img-1' }))?.type).toBe(
            'image',
        );
        expect(
            isNode(baseNode({ type: 'qr', shape: undefined, data: { kind: 'csv', column: 'sku' } }))
                ?.type,
        ).toBe('qr');
        expect(
            isNode(baseNode({ type: 'barcode', shape: undefined, data: { kind: 'template', code: '{{x}}' } }))
                ?.type,
        ).toBe('barcode');
    });

    it('defaults visible/locked/transform and rounds transform hm', () => {
        const node = isNode({
            id: 'n',
            type: 'group',
            transform: { x: 10.4, y: 20.6, rotDeg: 45, scaleX: 2, scaleY: 0.5 },
        });
        expect(node).toMatchObject({
            parentId: null,
            visible: true,
            locked: false,
            transform: { x: 10, y: 21, rotDeg: 45, scaleX: 2, scaleY: 0.5 },
        });
    });

    it('coerces a text ContentSource from a string and defaults a missing one', () => {
        const fromString = isNode(baseNode({ type: 'text', shape: undefined, text: 'hello' }));
        expect(fromString).toMatchObject({ text: { kind: 'static', value: 'hello' } });
        const fromMissing = isNode(baseNode({ type: 'text', shape: undefined }));
        expect(fromMissing).toMatchObject({ text: { kind: 'static', value: '' } });
    });

    it('rejects structurally wrong nodes', () => {
        expect(isNode(baseNode({ id: '' }))).toBeUndefined();
        expect(isNode(baseNode({ id: 5 }))).toBeUndefined();
        expect(isNode(baseNode({ type: 'blob' }))).toBeUndefined();
        expect(isNode(baseNode({ type: 'image', shape: undefined }))).toBeUndefined();
        expect(isNode(baseNode({ type: 'shape', shape: 'star' }))).toBeUndefined();
        expect(isNode(null)).toBeUndefined();
        expect(isNode([])).toBeUndefined();
    });
});

describe('isLabelDoc — acceptance and repair', () => {
    it('accepts a structurally valid document', () => {
        const result = isLabelDoc(validRaw());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.doc.version).toBe(1);
        expect(result.doc.meta.id).toBe('doc-1');
        expect(result.doc.label.backingW).toBe(2500);
        expect(result.doc.resources).toEqual({ fonts: [], images: [] });
    });

    it('rounds hm and clamps dpi instead of rejecting', () => {
        const result = isLabelDoc(
            validRaw({
                label: { backingW: 2500.6, backingH: 7800.2, dpi: 9999, regions: [] },
            }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.doc.label.backingW).toBe(2501);
        expect(result.doc.label.backingH).toBe(7800);
        expect(result.doc.label.dpi).toBe(1200);
    });

    it('defaults missing optionals: regions, nodes, data, resources, printDirection', () => {
        const result = isLabelDoc({
            version: 1,
            meta: { id: 'doc-1', name: 'Label', createdAt: 1, updatedAt: 1 },
            label: { backingW: 100, backingH: 100 },
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.doc.label.regions).toEqual([]);
        expect(result.doc.label.dpi).toBe(300);
        expect(result.doc.label.printDirection).toBe('top');
        expect(result.doc.nodes).toEqual([]);
        expect(result.doc.data).toEqual({ sampleRowIndex: 0, globals: [] });
        expect(result.doc.resources).toEqual({ fonts: [], images: [] });
    });

    it('floors epoch-seconds dates', () => {
        const result = isLabelDoc(
            validRaw({ meta: { id: 'd', name: 'n', createdAt: 10.9, updatedAt: 11.1 } }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.doc.meta.createdAt).toBe(10);
        expect(result.doc.meta.updatedAt).toBe(11);
    });

    it('keeps a string meta.presetId and drops a non-string one', () => {
        const ok = isLabelDoc(
            validRaw({ meta: { id: 'd', name: 'n', createdAt: 1, updatedAt: 1, presetId: 'ftagSpare-25x78' } }),
        );
        expect(ok.ok).toBe(true);
        if (!ok.ok) return;
        expect(ok.doc.meta.presetId).toBe('ftagSpare-25x78');

        const dropped = isLabelDoc(
            validRaw({ meta: { id: 'd', name: 'n', createdAt: 1, updatedAt: 1, presetId: 7 } }),
        );
        expect(dropped.ok).toBe(true);
        if (!dropped.ok) return;
        expect(dropped.doc.meta.presetId).toBeUndefined();
    });

    it('accepts every AssetRef provenance and FontRef source inside resources', () => {
        const result = isLabelDoc(
            validRaw({
                data: {
                    sampleRowIndex: 2,
                    globals: [{ name: 'g', url: 'https://x', extract: '$.v', expiresAt: 1.9 }],
                    csv: { csvId: 'c1', name: 'rows', source: { kind: 'local', mediaType: 'text/csv', resourceId: 'c1' } },
                },
                resources: {
                    fonts: [
                        { fontId: 'f1', familyName: 'Inter', name: 'Inter', source: { kind: 'system', descriptor: 'Inter' } },
                        {
                            fontId: 'f2',
                            familyName: 'Custom',
                            name: 'Custom',
                            source: { kind: 'imported', asset: { kind: 'local', mediaType: 'font/ttf', resourceId: 'r' }, fingerprint: 'abc' },
                        },
                    ],
                    images: [
                        { imageId: 'i1', name: 'logo', source: { kind: 'remote', mediaType: 'image/png', url: 'https://x/a.png' }, widthPx: 10.4, heightPx: 20.6 },
                    ],
                },
            }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.doc.resources.fonts).toHaveLength(2);
        expect(result.doc.resources.images[0]).toMatchObject({ widthPx: 10, heightPx: 21 });
        expect(result.doc.data.globals[0]?.expiresAt).toBe(1);
        expect(result.doc.data.csv?.csvId).toBe('c1');
    });
});

describe('isLabelDoc — rejection', () => {
    it('rejects non-objects and missing/wrong version', () => {
        expect(isLabelDoc(null).ok).toBe(false);
        expect(isLabelDoc([]).ok).toBe(false);
        expect(isLabelDoc('doc').ok).toBe(false);
        const missing = isLabelDoc({ ...validRaw(), version: undefined });
        expect(missing.ok).toBe(false);
        const wrong = isLabelDoc({ ...validRaw(), version: 2 });
        expect(wrong.ok).toBe(false);
        if (wrong.ok) return;
        expect(wrong.errors.join(' ')).toContain('unsupported document version 2');
    });

    it('rejects present-but-wrong-typed data and resources instead of blanking them', () => {
        const badData = isLabelDoc(validRaw({ data: 'nope' }));
        expect(badData.ok).toBe(false);
        if (!badData.ok) expect(badData.errors.join(' ')).toContain('data: must be an object');

        const badResources = isLabelDoc(validRaw({ resources: [] }));
        expect(badResources.ok).toBe(false);
        if (!badResources.ok) expect(badResources.errors.join(' ')).toContain('resources: must be an object');
    });

    it('rejects duplicate node ids', () => {
        const result = isLabelDoc(validRaw({ nodes: [baseNode({ id: 'dup' }), baseNode({ id: 'dup' })] }));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.join(' ')).toContain('duplicate id "dup"');
    });

    it('rejects a node that is its own parent', () => {
        const result = isLabelDoc(validRaw({ nodes: [baseNode({ id: 'self', parentId: 'self' })] }));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.join(' ')).toContain('is its own parent');
    });

    it('reports non-string parentId/name as visible repairs', () => {
        const result = isLabelDoc(
            validRaw({
                nodes: [
                    baseNode({ id: 'a', parentId: 42 }),
                    baseNode({ id: 'b', name: 7 }),
                ],
            }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.doc.nodes[0]?.parentId).toBeNull();
        expect(result.doc.nodes[1]?.name).toBeUndefined();
        expect(result.repairs.join(' ')).toContain('nodes[0]: node.parentId');
        expect(result.repairs.join(' ')).toContain('nodes[1]: node.name');
    });

    it('reports non-finite transform rotDeg/scaleX/scaleY as visible repairs', () => {
        const result = isLabelDoc(
            validRaw({
                nodes: [
                    baseNode({
                        id: 'a',
                        transform: {
                            x: 0,
                            y: 0,
                            rotDeg: Number.POSITIVE_INFINITY,
                            scaleX: Number.NaN,
                            scaleY: Number.NEGATIVE_INFINITY,
                        },
                    }),
                ],
            }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.doc.nodes[0]?.transform).toEqual({
            x: 0,
            y: 0,
            rotDeg: 0,
            scaleX: 1,
            scaleY: 1,
        });
        expect(result.repairs.join(' ')).toContain('nodes[0]: node.transform.rotDeg');
        expect(result.repairs.join(' ')).toContain('nodes[0]: node.transform.scaleX');
        expect(result.repairs.join(' ')).toContain('nodes[0]: node.transform.scaleY');
    });

    it('rejects missing meta/label and invalid required fields', () => {
        expect(isLabelDoc({ ...validRaw(), meta: undefined }).ok).toBe(false);
        expect(isLabelDoc({ ...validRaw(), label: undefined }).ok).toBe(false);
        expect(isLabelDoc(validRaw({ meta: { id: '', name: 'x', createdAt: 1, updatedAt: 1 } })).ok).toBe(false);
        expect(isLabelDoc(validRaw({ meta: { id: 'x', name: 'x', updatedAt: 1 } })).ok).toBe(false);
        expect(
            isLabelDoc(validRaw({ label: { backingW: -1, backingH: 10, dpi: 300, regions: [] } })).ok,
        ).toBe(false);
        expect(
            isLabelDoc(validRaw({ label: { backingW: 10, backingH: 10, dpi: 300, regions: [{ kind: 'rect', x: 1 }] } })).ok,
        ).toBe(false);
    });

    it('rejects a document containing one invalid node and reports the index', () => {
        const result = isLabelDoc(validRaw({ nodes: [baseNode(), baseNode({ id: '' })] }));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors.join(' ')).toContain('nodes[1]');
    });

    it('rejects invalid resources entries', () => {
        const result = isLabelDoc(
            validRaw({
                resources: {
                    fonts: [{ fontId: 'f', familyName: 'x', name: 'x', source: { kind: 'embedded' } }],
                    images: [],
                },
            }),
        );
        expect(result.ok).toBe(false);
    });
});

describe('isLabelDoc — thumb trust boundary', () => {
    it('keeps a valid raster thumb under the caps', () => {
        const result = isLabelDoc(validRaw({ meta: { id: 'd', name: 'n', createdAt: 1, updatedAt: 1, thumb: thumb() } }));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.doc.meta.thumb?.mediaType).toBe('image/png');
        expect(result.doc.meta.thumb?.at).toBe(1_700_000_000);
    });

    it('strips an oversize-dimension thumb but keeps the document', () => {
        const result = isLabelDoc(
            validRaw({ meta: { id: 'd', name: 'n', createdAt: 1, updatedAt: 1, thumb: thumb({ dataUrl: pngDataUrl(600, 100) }) } }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.doc.meta.thumb).toBeUndefined();
    });

    it('strips a thumb over 64 KB decoded', () => {
        const result = isLabelDoc(
            validRaw({
                meta: {
                    id: 'd',
                    name: 'n',
                    createdAt: 1,
                    updatedAt: 1,
                    thumb: thumb({ dataUrl: pngDataUrl(64, 64, 70_000) }),
                },
            }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.doc.meta.thumb).toBeUndefined();
    });

    it('strips non-raster and malformed thumbs', () => {
        for (const bad of [
            thumb({ mediaType: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }),
            thumb({ mediaType: 'text/html', dataUrl: 'data:text/html;base64,PGI+' }),
            thumb({ dataUrl: 'not-a-data-url' }),
            // mediaType claims PNG but the payload is SVG — header parse fails.
            thumb({ dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }),
            thumb({ at: 'yesterday' }),
        ]) {
            const result = isLabelDoc(validRaw({ meta: { id: 'd', name: 'n', createdAt: 1, updatedAt: 1, thumb: bad } }));
            expect(result.ok).toBe(true);
            if (!result.ok) continue;
            expect(result.doc.meta.thumb).toBeUndefined();
        }
    });

    it('strips a thumb whose dataUrl MIME disagrees with mediaType', () => {
        const result = isLabelDoc(
            validRaw({
                meta: {
                    id: 'd',
                    name: 'n',
                    createdAt: 1,
                    updatedAt: 1,
                    // Declared png, payload self-identifies as jpeg.
                    thumb: thumb({ mediaType: 'image/png', dataUrl: `data:image/jpeg;base64,${bytesToBase64(pngBytes(64, 64))}` }),
                },
            }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.doc.meta.thumb).toBeUndefined();
    });

    it('strips a PNG whose first chunk is not IHDR', () => {
        const bytes = pngBytes(64, 64);
        bytes.set([0, 0, 0, 0], 12); // corrupt chunk type
        const result = isLabelDoc(
            validRaw({
                meta: {
                    id: 'd',
                    name: 'n',
                    createdAt: 1,
                    updatedAt: 1,
                    thumb: thumb({ dataUrl: `data:image/png;base64,${bytesToBase64(bytes)}` }),
                },
            }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.doc.meta.thumb).toBeUndefined();
    });
});

describe('isLabelDoc — never throws', () => {
    it('survives garbage input', () => {
        const inputs: unknown[] = [
            undefined,
            null,
            0,
            Number.NaN,
            'string',
            [],
            { version: 1, meta: Symbol('x') },
            { version: 1, meta: { id: 'a' }, label: [] },
            { version: 1, meta: { id: 'a' }, label: {}, nodes: 5 },
        ];
        for (const input of inputs) {
            expect(() => isLabelDoc(input)).not.toThrow();
        }
    });
});

describe('migrate', () => {
    it('is the identity for version 1 and passes unknown versions through for rejection', () => {
        const raw = validRaw();
        expect(migrate(raw)).toBe(raw);
        const v3 = { version: 3, foo: 'bar' };
        expect(migrate(v3)).toBe(v3);
        expect(isLabelDoc(migrate(v3)).ok).toBe(false);
    });

    it('passes non-objects through', () => {
        expect(migrate(null)).toBeNull();
        expect(migrate('x')).toBe('x');
    });
});
