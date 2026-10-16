// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import type { Node } from '../../core/doc/types';
import { LayersPanel } from './LayersPanel';

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const doc = () =>
    createLabelDoc({
        id: 'doc-1',
        now: 1_700_000_000,
        backingW: 3000,
        backingH: 2000,
        nodes: [
            node({
                id: 'a',
                parentId: null,
                type: 'shape',
                shape: 'rectangle',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                size: { w: 500, h: 500 },
            }),
            node({
                id: 'b',
                parentId: null,
                type: 'text',
                visible: true,
                locked: false,
                transform: { x: 600, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                text: { kind: 'static', value: 'hi' },
                size: { w: 500, h: 200 },
            }),
        ],
    });

afterEach(() => {
    cleanup();
    useStore.setState({ currentDoc: null, selectedNodeIds: [] });
});

describe('LayersPanel', () => {
    it('selects a node on row pointer-down and mirrors selection', () => {
        useStore.setState({ currentDoc: doc() });
        render(<LayersPanel />);
        const rows = screen.getAllByRole('listitem');
        // Reversed order: front-most (b) first.
        expect(rows).toHaveLength(2);
        fireEvent.pointerDown(rows[0]!);
        expect(useStore.getState().selectedNodeIds).toEqual(['b']);
    });

    it('toggles a node visible flag from the eye button', () => {
        useStore.setState({ currentDoc: doc() });
        render(<LayersPanel />);
        const eye = screen.getAllByRole('button', { name: 'Hide' })[0]!;
        fireEvent.click(eye);
        const state = useStore.getState();
        expect(state.currentDoc?.nodes.some((entry) => entry.visible === false)).toBe(true);
    });

    it('reorders front-to-back: dropping the back node above the front row makes it front-most', () => {
        const shapes = (ids: string[]) =>
            createLabelDoc({
                id: 'doc-3',
                now: 1_700_000_000,
                backingW: 3000,
                backingH: 2000,
                nodes: ids.map((id, index) =>
                    node({
                        id,
                        parentId: null,
                        type: 'shape',
                        shape: 'rectangle',
                        visible: true,
                        locked: false,
                        transform: { x: index * 100, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                        size: { w: 500, h: 500 },
                    }),
                ),
            });
        // Array order is back-to-front: a (back), b, c (front). The list shows
        // c, b, a. Drag 'a' onto the top half of 'c' → it should land in front
        // of 'c', i.e. last in the array.
        useStore.setState({ currentDoc: shapes(['a', 'b', 'c']) });
        render(<LayersPanel />);
        const rows = screen.getAllByRole('listitem');
        expect(rows).toHaveLength(3);
        fireEvent.dragStart(rows[2]!);
        // happy-dom's DragEvent ignores the `clientY` init, so set it directly.
        const drop = createEvent.drop(rows[0]!);
        Object.defineProperty(drop, 'clientY', { value: -1 });
        fireEvent(rows[0]!, drop);
        const ids = useStore
            .getState()
            .currentDoc!.nodes.filter((entry) => entry.parentId === null)
            .map((entry) => entry.id);
        expect(ids).toEqual(['b', 'c', 'a']);
    });

    it('reorders back-to-front: dropping a node below a sibling lands it behind (index)', () => {
        const shapes = (ids: string[]) =>
            createLabelDoc({
                id: 'doc-4',
                now: 1_700_000_000,
                backingW: 3000,
                backingH: 2000,
                nodes: ids.map((id, index) =>
                    node({
                        id,
                        parentId: null,
                        type: 'shape',
                        shape: 'rectangle',
                        visible: true,
                        locked: false,
                        transform: { x: index * 100, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                        size: { w: 500, h: 500 },
                    }),
                ),
            });
        // List shows c, b, a. Drop front-most 'c' onto the bottom half of 'a'
        // (before=false) → array index of 'a' (0), i.e. behind everything.
        useStore.setState({ currentDoc: shapes(['a', 'b', 'c']) });
        render(<LayersPanel />);
        const rows = screen.getAllByRole('listitem');
        fireEvent.dragStart(rows[0]!);
        const drop = createEvent.drop(rows[2]!);
        Object.defineProperty(drop, 'clientY', { value: 1 });
        fireEvent(rows[2]!, drop);
        const ids = useStore
            .getState()
            .currentDoc!.nodes.filter((entry) => entry.parentId === null)
            .map((entry) => entry.id);
        expect(ids).toEqual(['c', 'a', 'b']);
    });

    it('reparents into a group: dropping a node onto a group appends it as the last child', () => {
        useStore.setState({
            currentDoc: createLabelDoc({
                id: 'doc-into-group',
                now: 1_700_000_000,
                backingW: 3000,
                backingH: 2000,
                nodes: [
                    node({
                        id: 's',
                        parentId: null,
                        type: 'shape',
                        shape: 'rectangle',
                        visible: true,
                        locked: false,
                        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                        size: { w: 500, h: 500 },
                    }),
                    node({
                        id: 'g',
                        parentId: null,
                        type: 'group',
                        visible: true,
                        locked: false,
                        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    }),
                    node({
                        id: 'k',
                        parentId: 'g',
                        type: 'shape',
                        shape: 'rectangle',
                        visible: true,
                        locked: false,
                        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                        size: { w: 500, h: 500 },
                    }),
                ],
            }),
        });
        render(<LayersPanel />);
        // Rows are g, k, s (front-to-back). Drag 's' (the last row, outside the
        // group) onto the group row's bottom half → parentId 'g', clamped to the
        // end of its children.
        const rows = screen.getAllByRole('listitem');
        const groupRow = rows.find((row) => row.querySelector('[aria-label="Collapse group"]'))!;
        const draggedRow = rows[rows.length - 1]!;
        expect(draggedRow).not.toBe(groupRow);
        fireEvent.dragStart(draggedRow);
        const drop = createEvent.drop(groupRow);
        Object.defineProperty(drop, 'clientY', { value: 1 });
        fireEvent(groupRow, drop);
        const moved = useStore.getState().currentDoc!.nodes.find((entry) => entry.id === 's')!;
        expect(moved.parentId).toBe('g');
        const childIds = useStore
            .getState()
            .currentDoc!.nodes.filter((entry) => entry.parentId === 'g')
            .map((entry) => entry.id);
        expect(childIds).toEqual(['k', 's']);
    });

    it('collapses a group to hide its descendant rows, then expands it again', () => {
        useStore.setState({
            currentDoc: createLabelDoc({
                id: 'doc-group',
                now: 1_700_000_000,
                backingW: 3000,
                backingH: 2000,
                nodes: [
                    node({
                        id: 'g',
                        parentId: null,
                        type: 'group',
                        visible: true,
                        locked: false,
                        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    }),
                    node({
                        id: 'k',
                        parentId: 'g',
                        type: 'shape',
                        shape: 'rectangle',
                        visible: true,
                        locked: false,
                        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                        size: { w: 500, h: 500 },
                    }),
                ],
            }),
        });
        render(<LayersPanel />);
        expect(screen.getAllByRole('listitem')).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: 'Collapse group' }));
        expect(screen.getAllByRole('listitem')).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Expand group' }));
        expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });

    it('hides the group button unless two sibling nodes are selected', () => {
        useStore.setState({ currentDoc: doc() });
        const { rerender } = render(<LayersPanel />);
        expect(screen.queryByRole('button', { name: 'Group' })).toBeNull();
        useStore.setState({ selectedNodeIds: ['a'] });
        rerender(<LayersPanel />);
        expect(screen.queryByRole('button', { name: 'Group' })).toBeNull();
        useStore.setState({ selectedNodeIds: ['a', 'b'] });
        rerender(<LayersPanel />);
        expect(screen.getByRole('button', { name: 'Group' })).toBeTruthy();
    });

    it('groups the selected siblings when the group button is clicked', () => {
        useStore.setState({ currentDoc: doc(), selectedNodeIds: ['a', 'b'] });
        render(<LayersPanel />);
        fireEvent.click(screen.getByRole('button', { name: 'Group' }));
        const nodes = useStore.getState().currentDoc!.nodes;
        const group = nodes.find((entry) => entry.type === 'group');
        expect(group).toBeTruthy();
        // The group stays at the shared parent level...
        expect(group!.parentId).toBeNull();
        // ...and takes the topmost selected node's z-slot: a, b, then the group.
        expect(nodes.map((entry) => entry.id)).toEqual(['a', 'b', group!.id]);
        const childIds = nodes
            .filter((entry) => entry.parentId === group!.id)
            .map((entry) => entry.id)
            .sort();
        expect(childIds).toEqual(['a', 'b']);
    });

    it('hides the group button when the selected nodes have different parents', () => {
        useStore.setState({
            currentDoc: createLabelDoc({
                id: 'doc-mixed-parents',
                now: 1_700_000_000,
                backingW: 3000,
                backingH: 2000,
                nodes: [
                    node({
                        id: 'g',
                        parentId: null,
                        type: 'group',
                        visible: true,
                        locked: false,
                        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    }),
                    node({
                        id: 'k',
                        parentId: 'g',
                        type: 'shape',
                        shape: 'rectangle',
                        visible: true,
                        locked: false,
                        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                        size: { w: 500, h: 500 },
                    }),
                    node({
                        id: 's',
                        parentId: null,
                        type: 'shape',
                        shape: 'rectangle',
                        visible: true,
                        locked: false,
                        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                        size: { w: 500, h: 500 },
                    }),
                ],
            }),
            selectedNodeIds: ['k', 's'],
        });
        render(<LayersPanel />);
        expect(screen.queryByRole('button', { name: 'Group' })).toBeNull();
    });

    it('hides the group button when the selection contains an unknown (phantom) id', () => {
        useStore.setState({ currentDoc: doc(), selectedNodeIds: ['a', 'does-not-exist'] });
        render(<LayersPanel />);
        expect(screen.queryByRole('button', { name: 'Group' })).toBeNull();
    });
});
