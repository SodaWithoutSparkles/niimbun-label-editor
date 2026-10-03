import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import type { Node } from '../../core/doc/types';
import { ObjectTab, clampSizeHm, sizePatch } from './ObjectTab';

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const imageNode = (over: Record<string, unknown> = {}): Node =>
    node({
        id: 'a',
        parentId: null,
        type: 'image',
        imageId: '',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 500, h: 300 },
        ...over,
    });

const doc = (nodes: Node[]) =>
    createLabelDoc({ id: 'doc-1', now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes });

afterEach(() => {
    cleanup();
    useStore.setState({ currentDoc: null, selectedNodeIds: [], docPast: [] });
});

describe('size mapping (must-fix #1)', () => {
    it('clamps to integer hm >= 0 and rejects non-finite input', () => {
        expect(clampSizeHm(12.4)).toBe(12);
        expect(clampSizeHm(12.6)).toBe(13);
        expect(clampSizeHm(-5)).toBe(0);
        expect(clampSizeHm(Number.NaN)).toBe(0);
        expect(clampSizeHm(Number.POSITIVE_INFINITY)).toBe(0);
    });

    it('maps sizeW/sizeH into the {w,h} box, never a bare scalar', () => {
        const source = imageNode();
        expect(sizePatch(source, 'sizeW', 800)).toEqual({ size: { w: 800, h: 300 } });
        expect(sizePatch(source, 'sizeH', 450)).toEqual({ size: { w: 500, h: 450 } });
        // Clamped too.
        expect(sizePatch(source, 'sizeW', -1)).toEqual({ size: { w: 0, h: 300 } });
    });

    it('a sizeW transient edit writes a valid {w,h} and commits one entry', () => {
        const store = [imageNode()];
        useStore.setState({ currentDoc: doc(store), selectedNodeIds: ['a'] });
        const first = useStore.getState().currentDoc!.nodes[0]!;

        useStore.getState().updateNodeTransient('a', sizePatch(first, 'sizeW', 700));
        useStore.getState().updateNodeTransient('a', sizePatch(first, 'sizeW', 750));
        useStore.getState().commitDoc();

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 'a')!;
        expect(persisted.size).toEqual({ w: 750, h: 300 });
        expect(Number.isFinite(persisted.size!.w)).toBe(true);
        expect(useStore.getState().docPast).toHaveLength(1);
    });
});

describe('ObjectTab — disabled field reasons (must-fix #12)', () => {
    it('shows the image-engine reason for image fields, not the quantizer one', () => {
        useStore.setState({ currentDoc: doc([imageNode()]), selectedNodeIds: ['a'] });
        render(<ObjectTab selected={[imageNode()]} />);
        // Image engine fields present.
        expect(screen.getByText('Image')).toBeTruthy();
        expect(screen.getByText('Resolution')).toBeTruthy();
        // Every image field carries the image reason (the old blanket behavior
        // gave all three the quantizer message).
        expect(screen.getAllByText(/image engine/i)).toHaveLength(3);
        // The only quantizer message on screen is the quantizer-hint field.
        expect(screen.getAllByText(/Quantizer settings/i)).toHaveLength(1);
    });

    it('renders real labels for unmapped ids instead of the raw key', () => {
        useStore.setState({ currentDoc: doc([imageNode()]), selectedNodeIds: ['a'] });
        render(<ObjectTab selected={[imageNode()]} />);
        expect(screen.queryByText('imageId')).toBeNull();
        expect(screen.queryByText('resolution')).toBeNull();
    });
});

describe('ObjectTab — selecting a node shows wired transform sliders', () => {
    it('renders a Width control bound to the size box', () => {
        const selected = imageNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['a'] });
        render(<ObjectTab selected={[selected]} />);
        expect(screen.getByText('Width')).toBeTruthy();
        expect(screen.getByText('Height')).toBeTruthy();
    });

    it('does not throw on render', () => {
        const selected = imageNode();
        render(<ObjectTab selected={[selected]} />);
        // Sanity: the tree mounted.
        expect(document.querySelector('.space-y-3')).toBeTruthy();
    });
});
