import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
});
