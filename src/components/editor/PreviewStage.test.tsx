import { describe, expect, it } from 'vitest';
import { createLabelDoc } from '../../core/doc/factory';
import type { ContentSource, Node } from '../../core/doc/types';
import type { ResolvedContent } from '../../editor/render/resolve';
import { resolvePreviewTree } from './PreviewStage';

/**
 * W6 wiring: `PreviewStage` feeds the shared sample-row **override map** into
 * `resolve(doc, { overrides })` on every render, so evaluated csv/template
 * content shows up while geometry-only changes repaint synchronously (without a
 * new async pass). `PreviewStage` itself needs Konva/canvas, so the exact
 * `useMemo` expression is exercised through the exported helper it calls.
 */

const textNode = (text: ContentSource): Node => ({
    id: 't1',
    parentId: null,
    type: 'text',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    text,
});

const textOf = (nodes: ReturnType<typeof resolvePreviewTree>, id: string): string => {
    const node = nodes.find((entry) => entry.id === id);
    if (!node || node.type !== 'text') throw new Error(`no text node ${id}`);
    return node.text;
};

describe('resolvePreviewTree — PreviewStage sample-row wiring', () => {
    it('applies the override map for a text node id', () => {
        const doc = createLabelDoc({ id: 'doc-1', nodes: [textNode({ kind: 'csv', column: 'name', fallback: 'FB' })] });

        // Without overrides the csv source falls back to its static fallback.
        expect(textOf(resolvePreviewTree(doc, undefined), 't1')).toBe('FB');

        const overrides = new Map<string, ResolvedContent>([
            ['t1', { text: 'Ada Lovelace', placeholder: false }],
        ]);
        expect(textOf(resolvePreviewTree(doc, overrides), 't1')).toBe('Ada Lovelace');
    });

    it('repaints a geometry-only change synchronously (no override involved)', () => {
        const doc = createLabelDoc({ id: 'doc-1', nodes: [textNode({ kind: 'static', value: 'hi' })] });
        expect(resolvePreviewTree(doc, new Map()).find((n) => n.id === 't1')!.bounds.x).toBe(0);

        // A transient move replaces the doc but not the override map.
        const moved = createLabelDoc({
            id: 'doc-1',
            nodes: [{ ...doc.nodes[0], transform: { ...doc.nodes[0].transform, x: 500 } }],
        });
        expect(resolvePreviewTree(moved, new Map()).find((n) => n.id === 't1')!.bounds.x).toBe(500);
    });

    it('returns the shared empty tree for a missing document', () => {
        expect(resolvePreviewTree(null, undefined)).toEqual([]);
    });
});
