// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import type { Node } from '../../core/doc/types';
import { ViewControls } from './ViewControls';

/**
 * ViewControls (action-plan W2 / D2): the general VIEW block is unchanged and an
 * object-specific icon block sits below it — align 6 + tile 2 only with a
 * selection, and the text-align trio only for a text node. Every icon button
 * keeps an accessible name.
 */

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

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

const groupNode = (): Node =>
    node({
        id: 'g',
        parentId: null,
        type: 'group',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    });

const doc = (nodes: Node[]) =>
    createLabelDoc({ id: 'doc-1', now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes });

const withSelection = (nodes: Node[]) => {
    useStore.setState({ currentDoc: doc(nodes), selectedNodeIds: nodes.map((n) => n.id), docPast: [] });
};

afterEach(() => {
    cleanup();
    useStore.setState({ currentDoc: null, selectedNodeIds: [], docPast: [] });
});

describe('ViewControls — general VIEW block', () => {
    it('keeps the 8 general icons, 4 per row', () => {
        useStore.setState({ currentDoc: doc([]), selectedNodeIds: [] });
        render(<ViewControls />);
        for (const name of [
            'Grid',
            'Snap',
            'Rulers',
            'Rotate view',
            'Zoom out',
            'Zoom in',
            'Fit',
            'Real size',
        ]) {
            expect(screen.getByRole('button', { name })).toBeTruthy();
        }
    });

    it('hides the object-specific block with no selection', () => {
        useStore.setState({ currentDoc: doc([]), selectedNodeIds: [] });
        render(<ViewControls />);
        expect(screen.queryByTestId('object-align-icons')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Align left' })).toBeNull();
    });
});

describe('ViewControls — object-specific block (D2)', () => {
    it('shows align 6 + tile 2 for a selection, each with an accessible name', () => {
        const selected = shapeNode();
        withSelection([selected]);
        render(<ViewControls />);

        expect(screen.getByTestId('object-align-icons')).toBeTruthy();
        for (const name of [
            'Align left',
            'Align center horizontally',
            'Align right',
            'Align top',
            'Align middle vertically',
            'Align bottom',
            'Tile vertical',
            'Tile horizontal',
        ]) {
            expect(screen.getByRole('button', { name })).toBeTruthy();
        }
    });

    it('hides the text-align icons for a non-text selection', () => {
        withSelection([shapeNode()]);
        render(<ViewControls />);
        expect(screen.queryByTestId('text-align-icons')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Text align left' })).toBeNull();
    });

    it('aligns the selection to the backing right edge', () => {
        withSelection([shapeNode()]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Align right' }));

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 's')!;
        expect(persisted.transform.x).toBe(2600);
    });

    it('tiles the selection vertically through the icon', () => {
        const a = shapeNode({ id: 'a' });
        const b = shapeNode({ id: 'b', transform: { x: 100, y: 1000, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 200, h: 500 } });
        withSelection([a, b]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Tile vertical' }));

        const persisted = useStore.getState().currentDoc!.nodes;
        // Anchor keeps its place; the next node sits directly below it.
        expect(persisted.find((n) => n.id === 'a')!.transform).toMatchObject({ x: 0, y: 0 });
        expect(persisted.find((n) => n.id === 'b')!.transform).toMatchObject({ x: 0, y: 400 });
    });

    it('tiles horizontally through the icon', () => {
        const a = shapeNode({ id: 'a' });
        const b = shapeNode({ id: 'b', transform: { x: 1000, y: 50, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 200, h: 500 } });
        withSelection([a, b]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Tile horizontal' }));

        const persisted = useStore.getState().currentDoc!.nodes;
        expect(persisted.find((n) => n.id === 'b')!.transform).toMatchObject({ x: 500, y: 0 });
    });

    it('leaves a selected geometry-less group untouched when tiling', () => {
        const group = groupNode();
        const a = shapeNode({ id: 'a', transform: { x: 500, y: 500, rotDeg: 0, scaleX: 1, scaleY: 1 } });
        const b = shapeNode({ id: 'b', transform: { x: 100, y: 1000, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 200, h: 500 } });
        withSelection([group, a, b]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Tile vertical' }));

        const persisted = useStore.getState().currentDoc!.nodes;
        // Never teleported to the world origin.
        expect(persisted.find((n) => n.id === 'g')!.transform).toMatchObject({ x: 0, y: 0 });
        expect(persisted.find((n) => n.id === 'a')!.transform).toMatchObject({ x: 500, y: 500 });
        expect(persisted.find((n) => n.id === 'b')!.transform).toMatchObject({ x: 500, y: 900 });
    });

    it('aligns a multi-node selection as exactly one undo step', () => {
        const a = shapeNode({ id: 'a' });
        const b = shapeNode({
            id: 'b',
            transform: { x: 100, y: 500, rotDeg: 0, scaleX: 1, scaleY: 1 },
            size: { w: 200, h: 500 },
        });
        withSelection([a, b]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Align right' }));

        const persisted = useStore.getState().currentDoc!.nodes;
        expect(persisted.find((n) => n.id === 'a')!.transform.x).toBe(2600);
        expect(persisted.find((n) => n.id === 'b')!.transform.x).toBe(2800);
        // One click ⇒ one `docPast` entry, not one per selected node.
        expect(useStore.getState().docPast).toHaveLength(1);

        useStore.getState().undoDoc();
        const reverted = useStore.getState().currentDoc!.nodes;
        expect(reverted.find((n) => n.id === 'a')!.transform.x).toBe(0);
        expect(reverted.find((n) => n.id === 'b')!.transform.x).toBe(100);
    });

    it('tiles a multi-node selection as exactly one undo step', () => {
        const a = shapeNode({ id: 'a' });
        const b = shapeNode({
            id: 'b',
            transform: { x: 100, y: 1000, rotDeg: 0, scaleX: 1, scaleY: 1 },
            size: { w: 200, h: 500 },
        });
        withSelection([a, b]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Tile vertical' }));

        expect(useStore.getState().docPast).toHaveLength(1);
        expect(
            useStore.getState().currentDoc!.nodes.find((n) => n.id === 'b')!.transform.y,
        ).toBe(400);

        useStore.getState().undoDoc();
        expect(
            useStore.getState().currentDoc!.nodes.find((n) => n.id === 'b')!.transform.y,
        ).toBe(1000);
    });

    it('leaves no undo entry when the align changes nothing', () => {
        // Already flush with the backing right edge: 3000 - 400 = 2600.
        const a = shapeNode({
            id: 'a',
            transform: { x: 2600, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });
        withSelection([a]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Align right' }));

        expect(useStore.getState().docPast).toHaveLength(0);
    });
});

describe('ViewControls — text-align icons', () => {
    it('shows left/center/right (no justify) for a text selection', () => {
        withSelection([textNode()]);
        render(<ViewControls />);

        expect(screen.getByTestId('text-align-icons')).toBeTruthy();
        for (const name of ['Text align left', 'Text align center', 'Text align right']) {
            expect(screen.getByRole('button', { name })).toBeTruthy();
        }
        expect(screen.queryByRole('button', { name: /justif/i })).toBeNull();
    });

    it('writes the text alignment to the node (one undo entry)', () => {
        withSelection([textNode()]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Text align center' }));

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 't')!;
        expect((persisted as { align?: string }).align).toBe('center');
        expect(useStore.getState().docPast).toHaveLength(1);
    });

    it('marks the node’s current alignment as pressed', () => {
        withSelection([textNode({ align: 'right' })]);
        render(<ViewControls />);
        expect(screen.getByRole('button', { name: 'Text align right' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Text align left' }).getAttribute('aria-pressed')).toBe('false');
    });
});
