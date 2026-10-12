// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type Konva from 'konva';
import '../../i18n';
import { installCanvasShim } from '../../test/canvasHarness';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import type { ContentSource, Node, Region } from '../../core/doc/types';
import type { ResolvedContent } from '../../editor/render/resolve';
import { isTransformerTarget, PreviewStage, resolvePreviewTree, transformerTargetIds } from './PreviewStage';

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

/**
 * H2 regression: the preview-warnings producer must not touch the store when a
 * transient `doc` change leaves the derived warnings unchanged.
 * `updateNodeTransient` mints a fresh `doc` on every pointer-move and the
 * producer effect depends on `doc`, so before the fix each drag frame cleared
 * and republished the `preview` group — a store write cascading to every
 * `editorWarnings` subscriber (part of the owner-reported drag lag).
 */
describe('PreviewStage preview-warnings producer (H2: no per-frame store write)', () => {
    beforeAll(() => {
        installCanvasShim();
        // happy-dom has no layout; give the pane a non-degenerate box.
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
    });

    afterEach(() => {
        cleanup();
        useStore.setState({ currentDoc: null, selectedNodeIds: [], activeTool: 'select', editorWarnings: {} });
    });

    it('skips the store write when a doc identity change leaves the warnings unchanged', async () => {
        // A node fully outside the printable region yields a keep-out warning
        // synchronously (no asset/sample-row pass needed).
        const region: Region = { kind: 'rect', x: 0, y: 0, w: 1000, h: 1000 };
        const outside: Node = {
            id: 'r',
            parentId: null,
            type: 'shape',
            shape: 'rectangle',
            visible: true,
            locked: false,
            transform: { x: 2000, y: 2000, rotDeg: 0, scaleX: 1, scaleY: 1 },
            size: { w: 1000, h: 1000 },
        };
        const doc = createLabelDoc({
            id: 'doc-1',
            backingW: 4000,
            backingH: 3000,
            regions: [region],
            nodes: [outside],
        });

        useStore.setState({ view: 'editor', currentDoc: doc, selectedNodeIds: [], activeTool: 'select', snapEnabled: false });
        render(<PreviewStage />);
        // Flush the async producers (fonts/prepared assets) that also rebuild the
        // aggregated `editorWarnings` object, so the counter below is stable.
        await act(async () => {});

        const published = useStore.getState().editorWarnings.preview?.warnings ?? [];
        expect(published.map((entry) => entry.kind)).toContain('keep-out');

        // Count only `preview`-group identity changes: the fonts producer may
        // write the same `editorWarnings` object but leaves `.preview` intact.
        let previewWrites = 0;
        let last = useStore.getState().editorWarnings.preview;
        const unsubscribe = useStore.subscribe((state) => {
            if (state.editorWarnings.preview !== last) {
                last = state.editorWarnings.preview;
                previewWrites += 1;
            }
        });

        // One transient drag frame: a new `doc` identity with identical content,
        // hence identical derived warnings (the moved node stays outside).
        const moved = createLabelDoc({
            id: 'doc-1',
            backingW: 4000,
            backingH: 3000,
            regions: [region],
            nodes: [{ ...outside, transform: { ...outside.transform, x: 2100 } }],
        });
        act(() => {
            useStore.setState({ currentDoc: moved });
        });
        await act(async () => {});

        unsubscribe();
        expect(previewWrites).toBe(0);
    });
});
