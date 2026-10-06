import { describe, expect, it } from 'vitest';
import type Konva from 'konva';
import { createLabelDoc } from '../../core/doc/factory';
import type { ContentSource, Node } from '../../core/doc/types';
import type { ResolvedContent } from '../../editor/render/resolve';
import { isTransformerTarget, resolvePreviewTree, transformerTargetIds } from './PreviewStage';

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

describe('isTransformerTarget — Transformer anchor guard (task 12)', () => {
    /** Minimal Konva.Node stand-in whose `findAncestor` matches `ancestor`. */
    const fakeTarget = (ancestor: string | null): Konva.Node =>
        ({
            findAncestor: (selector: string) => (selector === ancestor ? {} : null),
        }) as unknown as Konva.Node;

    it('returns true when the target sits inside the Transformer', () => {
        expect(isTransformerTarget(fakeTarget('Transformer'))).toBe(true);
    });

    it('returns false when the target has no Transformer ancestor', () => {
        expect(isTransformerTarget(fakeTarget(null))).toBe(false);
        expect(isTransformerTarget(fakeTarget('Layer'))).toBe(false);
    });

    it('returns false for a null/undefined target', () => {
        expect(isTransformerTarget(null)).toBe(false);
        expect(isTransformerTarget(undefined)).toBe(false);
    });
});

describe('transformerTargetIds — groups excluded from the Transformer (#13/D-10)', () => {
    const group: Node = {
        id: 'g',
        parentId: null,
        type: 'group',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    };
    const rect: Node = {
        id: 'r',
        parentId: null,
        type: 'shape',
        shape: 'rectangle',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    };

    it('drops selected groups but keeps the leaves', () => {
        expect(transformerTargetIds(['g', 'r'], [group, rect])).toEqual(['r']);
    });

    it('keeps a selection with no groups intact', () => {
        expect(transformerTargetIds(['r'], [group, rect])).toEqual(['r']);
    });

    it('keeps ids with no matching node (only groups are dropped here)', () => {
        // The downstream `.filter(Boolean)` on the Konva refs drops unknown ids;
        // this helper only filters groups.
        expect(transformerTargetIds(['g', 'missing'], [group])).toEqual(['missing']);
    });
});
