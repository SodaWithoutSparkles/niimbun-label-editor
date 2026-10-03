import { describe, expect, it } from 'vitest';
import { createAppStore } from './useStore';
import { createLabelDoc } from '../core/doc/factory';
import type { Node } from '../core/doc/types';

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const doc = () =>
    createLabelDoc({
        id: 'doc-1',
        now: 1_700_000_000,
        backingW: 3000,
        backingH: 2000,
        nodes: [
            node({
                id: 'n1',
                parentId: null,
                type: 'shape',
                shape: 'rectangle',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                size: { w: 500, h: 500 },
            }),
        ],
    });

describe('selection slice wiring', () => {
    it('selects, toggles, replaces and clears node ids', () => {
        const store = createAppStore();
        store.getState().selectNode('a');
        expect(store.getState().selectedNodeIds).toEqual(['a']);
        store.getState().toggleSelectNode('b');
        expect(store.getState().selectedNodeIds).toEqual(['a', 'b']);
        store.getState().toggleSelectNode('a');
        expect(store.getState().selectedNodeIds).toEqual(['b']);
        store.getState().selectNodes(['x', 'y', 'x']);
        expect(store.getState().selectedNodeIds).toEqual(['x', 'y']);
        store.getState().clearNodeSelection();
        expect(store.getState().selectedNodeIds).toEqual([]);
    });
});

describe('view slice wiring', () => {
    it('toggles grid/snap/rulers and rotates the view', () => {
        const store = createAppStore();
        const before = store.getState();
        store.getState().toggleGrid();
        expect(store.getState().gridVisible).toBe(!before.gridVisible);
        store.getState().toggleSnap();
        expect(store.getState().snapEnabled).toBe(!before.snapEnabled);
        store.getState().toggleRulers();
        expect(store.getState().rulersVisible).toBe(!before.rulersVisible);
        store.getState().toggleViewRotation();
        expect(store.getState().viewRotation).toBe(90);
        store.getState().toggleViewRotation();
        expect(store.getState().viewRotation).toBe(0);
    });

    it('switches zoom mode and records manual zoom', () => {
        const store = createAppStore();
        store.getState().setManualZoom(0.2);
        expect(store.getState().zoomMode).toBe('manual');
        expect(store.getState().manualZoom).toBe(0.2);
        store.getState().setZoomMode('real');
        expect(store.getState().zoomMode).toBe('real');
    });
});

describe('setSampleRowIndex', () => {
    it('writes the sample row as one undoable document change', () => {
        const store = createAppStore();
        store.setState({ currentDoc: doc() });
        store.getState().setSampleRowIndex(3);
        expect(store.getState().currentDoc?.data.sampleRowIndex).toBe(3);
        expect(store.getState().docPast).toHaveLength(1);
        // No-op write does not add another undo entry.
        store.getState().setSampleRowIndex(3);
        expect(store.getState().docPast).toHaveLength(1);
    });
});
