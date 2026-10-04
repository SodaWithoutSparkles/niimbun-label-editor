import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import type { Node } from '../../core/doc/types';
import {
    ObjectTab,
    alignTransformPatch,
    clampSizeHm,
    shapeKindPatch,
    sizePatch,
    textContentPatch,
    textContentValue,
} from './ObjectTab';

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

const textNode = (over: Record<string, unknown> = {}): Node =>
    node({
        id: 't',
        parentId: null,
        type: 'text',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        text: { kind: 'static', value: '' },
        size: { w: 2000, h: 800 },
        fontSize: 300,
        ...over,
    });

const shapeNode = (over: Record<string, unknown> = {}): Node =>
    node({
        id: 's',
        parentId: null,
        type: 'shape',
        shape: 'rectangle',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 400, h: 300 },
        ...over,
    });

describe('text content authoring (must-fix #3)', () => {
    it('reads and writes a static ContentSource', () => {
        expect(textContentValue(textNode())).toBe('');
        expect(textContentValue(textNode({ text: { kind: 'static', value: 'hi' } }))).toBe('hi');
        // A non-static source is not editable in the P3 inspector.
        expect(textContentValue(textNode({ text: { kind: 'csv', column: 'c', fallback: 'f' } }))).toBe('');
        expect(textContentPatch('hello')).toEqual({ text: { kind: 'static', value: 'hello' } });
    });

    it('edits the node text through the Object tab', () => {
        const selected = textNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t'] });
        render(<ObjectTab selected={[selected]} />);

        const field = screen.getByLabelText('Text') as HTMLTextAreaElement;
        fireEvent.change(field, { target: { value: 'authored' } });
        fireEvent.blur(field);

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 't')!;
        expect(persisted.type).toBe('text');
        expect((persisted as { text: { kind: string; value: string } }).text).toEqual({
            kind: 'static',
            value: 'authored',
        });
        // One committed op after the gesture ends, so it is undoable.
        expect(useStore.getState().docPast).toHaveLength(1);
    });

    it('batches a multi-keystroke text edit into one undo entry', () => {
        const selected = textNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t'], docPast: [] });
        render(<ObjectTab selected={[selected]} />);

        const field = screen.getByLabelText('Text') as HTMLTextAreaElement;
        fireEvent.change(field, { target: { value: 'h' } });
        fireEvent.change(field, { target: { value: 'he' } });
        fireEvent.change(field, { target: { value: 'hel' } });
        fireEvent.change(field, { target: { value: 'hell' } });
        fireEvent.change(field, { target: { value: 'hello' } });
        // No commit until the gesture ends.
        expect(useStore.getState().docPast).toHaveLength(0);
        fireEvent.blur(field);
        expect(useStore.getState().docPast).toHaveLength(1);
        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 't')!;
        expect((persisted as { text: { value: string } }).text.value).toBe('hello');
    });
});

describe('shape kind conversion (must-fix #5)', () => {
    it('seeds points from size when converting a rectangle to a polygon', () => {
        const patch = shapeKindPatch(shapeNode() as never, 'polygon') as {
            shape?: string;
            points?: [number, number][];
            closed?: boolean;
        };
        expect(patch.shape).toBe('polygon');
        expect(patch.points).toEqual([
            [0, 0],
            [400, 0],
            [400, 300],
            [0, 300],
        ]);
        expect(patch.closed).toBe(true);
    });

    it('seeds size from the point extent when converting a line to a rectangle', () => {
        const line = shapeNode({ shape: 'line', points: [[0, 0], [1500, 0], [1500, 600]], size: undefined });
        const patch = shapeKindPatch(line as never, 'rectangle') as {
            shape?: string;
            size?: { w: number; h: number };
            points?: unknown;
        };
        expect(patch.shape).toBe('rectangle');
        expect(patch.size).toEqual({ w: 1500, h: 600 });
        expect(patch.points).toBeUndefined();
    });

    it('leaves geometry alone for an in-family change', () => {
        expect(shapeKindPatch(shapeNode() as never, 'ellipse')).toEqual({ shape: 'ellipse' });
        const line = shapeNode({ shape: 'line', points: [[0, 0], [100, 0]] });
        expect(shapeKindPatch(line as never, 'polygon')).toEqual({ shape: 'polygon', closed: true });
    });

    it('converts through the Object tab so the node keeps rendering', () => {
        const selected = shapeNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['s'] });
        render(<ObjectTab selected={[selected]} />);

        fireEvent.change(screen.getByDisplayValue('rectangle'), { target: { value: 'polygon' } });

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 's')!;
        expect(persisted.type).toBe('shape');
        expect((persisted as { shape: string }).shape).toBe('polygon');
        expect((persisted as { points?: unknown }).points).toBeDefined();
    });
});

describe('align uses resolved world bounds (must-fix #10)', () => {
    it('aligns a rect to the right edge from its world bounds', () => {
        const child = shapeNode({ size: { w: 400, h: 300 } });
        const byId = new Map([[child.id, child]]);
        const patch = alignTransformPatch(child, byId, 3000, 2000, 'right');
        // World AABB is x=0..400, so right align moves x to 3000-400=2600.
        expect(patch?.transform?.x).toBe(2600);
    });

    it('aligns a line by its point extent, not an undefined size', () => {
        const line = shapeNode({ shape: 'line', points: [[0, 0], [500, 100], [1000, 0]], size: undefined });
        const byId = new Map([[line.id, line]]);
        const patch = alignTransformPatch(line, byId, 3000, 2000, 'right');
        // Point extent 1000 wide => x = 3000-1000 = 2000.
        expect(patch?.transform?.x).toBe(2000);
    });

    it('converts the world delta into the parent local space', () => {
        // Parent is translated by (1000, 500); child local x=0 => world x=1000.
        const parent = node({
            id: 'g',
            parentId: null,
            type: 'group',
            visible: true,
            locked: false,
            transform: { x: 1000, y: 500, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });
        const child = shapeNode({ parentId: 'g', transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 } });
        const byId = new Map([
            [parent.id, parent],
            [child.id, child],
        ]);
        const patch = alignTransformPatch(child, byId, 3000, 2000, 'right');
        // World right edge for a 400-wide box under +1000 parent is 3000-1400=1600 world.
        // Local delta = world delta (translation only) => local x = 1600.
        expect(patch?.transform?.x).toBe(1600);
    });
});
