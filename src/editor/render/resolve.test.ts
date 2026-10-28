import { describe, expect, it } from 'vitest';
import type { LabelDoc, Node } from '../../core/doc/types';
import { createFtagSpareDoc, createLabelDoc } from '../../core/doc/factory';
import type { ResolvedNode } from './resolve';
import { DEFAULT_EMPTY_TEXT, DEFAULT_CONTENT_SIZE, DEFAULT_FONT_SIZE, resolve, resolveContent } from './resolve';
import { resolveGuides } from './guides';

/** Attach the render layer's optional geometry to a raw node (schema elides it). */
const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const smallDoc = (): LabelDoc =>
    createLabelDoc({
        id: 'doc-1',
        now: 1_700_000_000,
        backingW: 3000,
        backingH: 2000,
        regions: [{ kind: 'rect', x: 0, y: 0, w: 3000, h: 2000 }],
        nodes: [
            node({
                id: 't1',
                parentId: null,
                type: 'text',
                visible: true,
                locked: false,
                transform: { x: 100, y: 200, rotDeg: 0, scaleX: 1, scaleY: 1 },
                text: { kind: 'static', value: 'hello' },
                size: { w: 400, h: 100 },
            }),
            node({
                id: 'r1',
                parentId: null,
                type: 'shape',
                shape: 'rectangle',
                visible: true,
                locked: false,
                transform: { x: 500, y: 600, rotDeg: 0, scaleX: 1, scaleY: 1 },
                size: { w: 200, h: 300 },
            }),
            node({
                id: 'g1',
                parentId: null,
                type: 'group',
                visible: true,
                locked: false,
                transform: { x: 1000, y: 100, rotDeg: 0, scaleX: 1, scaleY: 1 },
            }),
            node({
                id: 't2',
                parentId: 'g1',
                type: 'text',
                visible: true,
                locked: false,
                transform: { x: 10, y: 20, rotDeg: 0, scaleX: 1, scaleY: 1 },
                text: { kind: 'static', value: 'in group' },
                size: { w: 100, h: 50 },
            }),
        ],
    });

/** Deterministic, snapshot-like projection of the resolved tree. */
const summarize = (nodes: readonly ResolvedNode[]): unknown =>
    nodes.map((n) => ({
        id: n.id,
        type: n.type,
        visible: n.visible,
        locked: n.locked,
        transform: n.transform,
        bounds: n.bounds,
        ...(n.type === 'text'
            ? { text: n.text, placeholder: n.placeholder, w: n.w, h: n.h }
            : {}),
        ...(n.type === 'rectangle' ? { w: n.w, h: n.h } : {}),
        ...(n.type === 'group' ? { children: summarize(n.children) } : {}),
    }));

describe('resolve — deterministic scene graph', () => {
    it('resolves text + rect + group in document order with effective transforms', () => {
        expect(summarize(resolve(smallDoc()))).toEqual([
            {
                id: 't1',
                type: 'text',
                visible: true,
                locked: false,
                transform: { a: 1, b: 0, c: 0, d: 1, e: 100, f: 200 },
                bounds: { x: 100, y: 200, w: 400, h: 100 },
                text: 'hello',
                placeholder: false,
                w: 400,
                h: 100,
            },
            {
                id: 'r1',
                type: 'rectangle',
                visible: true,
                locked: false,
                transform: { a: 1, b: 0, c: 0, d: 1, e: 500, f: 600 },
                bounds: { x: 500, y: 600, w: 200, h: 300 },
                w: 200,
                h: 300,
            },
            {
                id: 'g1',
                type: 'group',
                visible: true,
                locked: false,
                transform: { a: 1, b: 0, c: 0, d: 1, e: 1000, f: 100 },
                bounds: { x: 1010, y: 120, w: 100, h: 50 },
                children: [
                    {
                        id: 't2',
                        type: 'text',
                        visible: true,
                        locked: false,
                        transform: { a: 1, b: 0, c: 0, d: 1, e: 1010, f: 120 },
                        bounds: { x: 1010, y: 120, w: 100, h: 50 },
                        text: 'in group',
                        placeholder: false,
                        w: 100,
                        h: 50,
                    },
                ],
            },
        ]);
    });

    it('is deterministic across calls', () => {
        const doc = smallDoc();
        expect(resolve(doc)).toEqual(resolve(doc));
    });

    it('omits hidden nodes and their subtrees', () => {
        const doc = smallDoc();
        const hidden = doc.nodes.find((n) => n.id === 't1');
        if (hidden) hidden.visible = false;
        const ids = resolve(doc).map((n) => n.id);
        expect(ids).toEqual(['r1', 'g1']);
    });

    it('applies the parent transform to children (rotation + scale)', () => {
        const doc = createLabelDoc({
            regions: [{ kind: 'rect', x: 0, y: 0, w: 1000, h: 1000 }],
            nodes: [
                node({
                    id: 'g',
                    parentId: null,
                    type: 'group',
                    visible: true,
                    locked: false,
                    transform: { x: 100, y: 0, rotDeg: 0, scaleX: 2, scaleY: 2 },
                }),
                node({
                    id: 'c',
                    parentId: 'g',
                    type: 'shape',
                    shape: 'rectangle',
                    visible: true,
                    locked: false,
                    transform: { x: 10, y: 10, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    size: { w: 10, h: 10 },
                }),
            ],
        });
        const group = resolve(doc)[0];
        expect(group?.type).toBe('group');
        const child = group?.type === 'group' ? group.children[0] : undefined;
        expect(child?.transform).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 120, f: 20 });
        expect(child?.bounds).toEqual({ x: 120, y: 20, w: 20, h: 20 });
    });
});

describe('resolveContent — no template execution', () => {
    it('uses the placeholder for empty static content', () => {
        expect(resolveContent({ kind: 'static', value: '' })).toEqual({
            text: DEFAULT_EMPTY_TEXT,
            placeholder: true,
        });
    });

    it('uses the fallback for csv/template content', () => {
        expect(resolveContent({ kind: 'csv', column: 'sku', fallback: 'N/A' })).toEqual({
            text: 'N/A',
            placeholder: false,
        });
        expect(resolveContent({ kind: 'template', code: '{{x}}', fallback: 'T' })).toEqual({
            text: 'T',
            placeholder: false,
        });
    });

    it('accepts a custom empty placeholder', () => {
        const doc = smallDoc();
        const t1 = doc.nodes.find((n) => n.id === 't1');
        if (t1 && t1.type === 'text') t1.text = { kind: 'static', value: '' };
        const resolved = resolve(doc, { emptyText: '—' });
        expect(resolved[0]?.type === 'text' && resolved[0].text).toBe('—');
    });
});

describe('resolveGuides — persisted label.guides', () => {
    it('returns [] when the document has no guides', () => {
        expect(resolveGuides(smallDoc())).toEqual([]);
    });

    it('guides are not regions: the score line is absent from label.regions', () => {
        // The F-tag guide now comes from the preset's data via createLabelDoc.
        const doc = createFtagSpareDoc();
        const guides = resolveGuides(doc);
        expect(guides).toHaveLength(1);
        // A guide is an annotation, never a clip/print region: no region's
        // geometry matches the vertical score segment.
        const { x1, y1, x2, y2 } = guides[0]!.line;
        for (const region of doc.label.regions) {
            if (region.kind === 'rect' || region.kind === 'roundedRect') {
                const isVerticalSegment =
                    region.x === x1 && region.x + region.w === x2 && region.y === y1 && region.y + region.h === y2;
                expect(isVerticalSegment).toBe(false);
            }
        }
        // The F-tag's regions are its die-cut shapes, not the guide.
        expect(doc.label.regions.length).toBeGreaterThan(0);
        expect(doc.label.regions.every((r) => r.kind === 'roundedRect')).toBe(true);
    });
});

describe('resolve — geometry fallbacks', () => {
    it('resolves a node without size via DEFAULT_CONTENT_SIZE', () => {
        const doc = createLabelDoc({
            id: 'doc-fallback',
            now: 1_700_000_000,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 1000, h: 1000 }],
            nodes: [
                node({
                    id: 't1',
                    parentId: null,
                    type: 'text',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    text: { kind: 'static', value: 'hi' },
                }),
            ],
        });
        const resolved = resolve(doc)[0];
        expect(resolved?.type).toBe('text');
        if (resolved?.type === 'text') {
            expect(resolved.w).toBe(DEFAULT_CONTENT_SIZE);
            expect(resolved.h).toBe(DEFAULT_CONTENT_SIZE);
            expect(resolved.fontSize).toBe(DEFAULT_FONT_SIZE);
        }
    });

    it('resolves a P2-era line/polygon without points to empty geometry', () => {
        const doc = createLabelDoc({
            id: 'doc-p2',
            now: 1_700_000_000,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 1000, h: 1000 }],
            nodes: [
                node({
                    id: 'l1',
                    parentId: null,
                    type: 'shape',
                    shape: 'line',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                }),
            ],
        });
        const resolved = resolve(doc)[0];
        expect(resolved?.type).toBe('line');
        if (resolved?.type === 'line') {
            expect(resolved.points).toEqual([]);
            expect(resolved.bounds).toEqual({ x: 0, y: 0, w: 0, h: 0 });
        }
    });
});

describe('resolve — shape static style (#8)', () => {
    const resolvedShape = (over: Record<string, unknown>) => {
        const doc = createLabelDoc({
            id: 'doc-style',
            now: 1_700_000_000,
            backingW: 3000,
            backingH: 2000,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 3000, h: 2000 }],
            nodes: [
                node({
                    id: 's',
                    parentId: null,
                    type: 'shape',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    ...over,
                }),
            ],
        });
        return resolve(doc)[0]!;
    };

    it('defaults a closed shape to transparent fill, #374151 stroke, width 50, radius 0', () => {
        const rect = resolvedShape({ shape: 'rectangle', size: { w: 100, h: 100 } });
        expect(rect).toMatchObject({
            type: 'rectangle',
            fill: 'transparent',
            stroke: '#374151',
            strokeWidth: 50,
            cornerRadius: 0,
        });
        expect((rect as { fill?: string }).fill).toBe('transparent');
    });

    it('gives an ellipse the same transparent-fill default', () => {
        const ellipse = resolvedShape({ shape: 'ellipse', size: { w: 100, h: 100 } });
        expect(ellipse).toMatchObject({
            type: 'ellipse',
            fill: 'transparent',
            stroke: '#374151',
            strokeWidth: 50,
        });
        expect((ellipse as { fill?: string }).fill).toBe('transparent');
    });

    it('defaults an open line to transparent fill', () => {
        const line = resolvedShape({ shape: 'line', points: [[0, 0], [100, 0]], closed: false });
        expect(line).toMatchObject({
            type: 'line',
            fill: 'transparent',
            stroke: '#374151',
            strokeWidth: 50,
        });
        expect((line as { fill?: string }).fill).toBe('transparent');
    });

    it('does not fill a closed polygon or a closed line (default is transparent)', () => {
        const poly = resolvedShape({
            shape: 'polygon',
            points: [[0, 0], [100, 0], [100, 100]],
            closed: true,
        });
        expect(poly).toMatchObject({ type: 'polygon', closed: true, fill: 'transparent' });
        expect((poly as { fill?: string }).fill).toBe('transparent');
        const closedLine = resolvedShape({
            shape: 'line',
            points: [[0, 0], [100, 0], [100, 100]],
            closed: true,
        });
        expect(closedLine).toMatchObject({ type: 'line', closed: true, fill: 'transparent' });
        expect((closedLine as { fill?: string }).fill).toBe('transparent');
    });

    it('honours explicit fill/stroke/strokeWidth/cornerRadius', () => {
        const rect = resolvedShape({
            shape: 'rectangle',
            size: { w: 100, h: 100 },
            fill: '#ff0000',
            stroke: '#00ff00',
            strokeWidth: 4,
            cornerRadius: 5,
        });
        expect(rect).toMatchObject({
            fill: '#ff0000',
            stroke: '#00ff00',
            strokeWidth: 4,
            cornerRadius: 5,
        });
    });

    it('honours an explicit fill on an open shape (default only applies when absent)', () => {
        const line = resolvedShape({
            shape: 'line',
            points: [[0, 0], [100, 0]],
            closed: false,
            fill: '#123456',
        });
        expect((line as { fill?: string }).fill).toBe('#123456');
    });
});

describe('resolve — content overrides (P6 W2)', () => {
    const overridesFor = (id: string, text: string): Map<string, { text: string; placeholder: boolean }> =>
        new Map([[id, { text, placeholder: false }]]);

    it('prefers an override over static content', () => {
        const resolved = resolve(smallDoc(), { overrides: overridesFor('t1', 'overridden') });
        const t1 = resolved.find((n) => n.id === 't1');
        expect(t1?.type === 'text' && t1.text).toBe('overridden');
        expect(t1?.type === 'text' && t1.placeholder).toBe(false);
    });

    it('honours an override placeholder', () => {
        const overrides = new Map([['t1', { text: DEFAULT_EMPTY_TEXT, placeholder: true }]]);
        const t1 = resolve(smallDoc(), { overrides }).find((n) => n.id === 't1');
        expect(t1?.type === 'text' && t1.placeholder).toBe(true);
    });

    it('applies an override to a nested child node', () => {
        const overrides = new Map([['t2', { text: 'child overridden', placeholder: false }]]);
        const group = resolve(smallDoc(), { overrides }).find((n) => n.id === 'g1');
        const child = group?.type === 'group' ? group.children[0] : undefined;
        expect(child?.type === 'text' && child.text).toBe('child overridden');
    });

    it('overrides qr and barcode payloads', () => {
        const doc = createLabelDoc({
            id: 'doc-override',
            now: 1_700_000_000,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 1000, h: 1000 }],
            nodes: [
                node({
                    id: 'q1',
                    parentId: null,
                    type: 'qr',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    data: { kind: 'csv', column: 'sku', fallback: 'N/A' },
                    size: { w: 100, h: 100 },
                }),
                node({
                    id: 'b1',
                    parentId: null,
                    type: 'barcode',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    data: { kind: 'csv', column: 'sku', fallback: 'N/A' },
                    size: { w: 100, h: 100 },
                }),
            ],
        });
        const overrides = new Map([
            ['q1', { text: 'QR-1', placeholder: false }],
            ['b1', { text: 'BC-1', placeholder: false }],
        ]);
        const byId = new Map(resolve(doc, { overrides }).map((n) => [n.id, n]));
        const qr = byId.get('q1');
        const barcode = byId.get('b1');
        expect(qr?.type === 'qr' && qr.text).toBe('QR-1');
        expect(barcode?.type === 'barcode' && barcode.text).toBe('BC-1');
    });

    it('keeps the fallback path when no override matches', () => {
        const doc = createLabelDoc({
            id: 'doc-fallback',
            now: 1_700_000_000,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 1000, h: 1000 }],
            nodes: [
                node({
                    id: 't1',
                    parentId: null,
                    type: 'text',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    text: { kind: 'csv', column: 'sku', fallback: 'N/A' },
                    size: { w: 100, h: 50 },
                }),
            ],
        });
        const t1 = resolve(doc, { overrides: overridesFor('other', 'x') })[0];
        expect(t1?.type === 'text' && t1.text).toBe('N/A');
    });

    it('stays deterministic with the same overrides', () => {
        const overrides = overridesFor('t1', 'X');
        expect(resolve(smallDoc(), { overrides })).toEqual(resolve(smallDoc(), { overrides }));
    });
});

describe('resolve — text wrap + lineHeight (P5 D2)', () => {
    const textDoc = (over: Record<string, unknown>) =>
        createLabelDoc({
            id: 'doc-wrap',
            now: 1_700_000_000,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 1000, h: 1000 }],
            nodes: [
                node({
                    id: 't1',
                    parentId: null,
                    type: 'text',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    text: { kind: 'static', value: 'hello' },
                    size: { w: 200, h: 100 },
                    ...over,
                }),
            ],
        });

    it("defaults wrap to 'word' and lineHeight to 1 when absent", () => {
        expect(resolve(textDoc({}))[0]).toMatchObject({ type: 'text', wrap: 'word', lineHeight: 1 });
    });

    it('passes an explicit wrap and lineHeight through', () => {
        expect(resolve(textDoc({ wrap: 'shrink', lineHeight: 1.5 }))[0]).toMatchObject({
            type: 'text',
            wrap: 'shrink',
            lineHeight: 1.5,
        });
    });

    it('emits every explicit wrap mode', () => {
        for (const wrap of ['word', 'char', 'clip', 'shrink', 'cut'] as const) {
            expect(resolve(textDoc({ wrap }))[0], wrap).toMatchObject({ wrap });
        }
    });
});
