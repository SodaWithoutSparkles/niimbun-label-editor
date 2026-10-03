import { describe, expect, it } from 'vitest';
import type { LabelDoc, Node } from '../../core/doc/types';
import { createLabelDoc } from '../../core/doc/factory';
import type { ResolvedNode } from './resolve';
import { DEFAULT_EMPTY_TEXT, resolve, resolveContent } from './resolve';
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

describe('resolveGuides — seam', () => {
    it('returns [] when the document records no preset', () => {
        expect(resolveGuides(smallDoc())).toEqual([]);
    });
});
