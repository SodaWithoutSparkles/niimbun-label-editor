import { describe, expect, it } from 'vitest';
import { createLabelDoc } from '../core/doc/factory';
import type { LabelDoc, Node } from '../core/doc/types';
import {
    ancestors,
    childrenOf,
    descendants,
    effectiveLockedMap,
    effectiveVisibleMap,
    layerStateMap,
    paintOrder,
    rootNodes,
    siblingIndex,
    siblingZOrder,
    treeRows,
    nodeById,
} from './selectors';

const base = (id: string, parentId: string | null, type: Node['type'] = 'text'): Node => {
    const shared = {
        id,
        parentId,
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    };
    switch (type) {
        case 'group':
            return { ...shared, type: 'group' };
        case 'text':
            return { ...shared, type: 'text', text: { kind: 'static', value: id } };
        case 'image':
            return { ...shared, type: 'image', imageId: id };
        case 'shape':
            return { ...shared, type: 'shape', shape: 'rectangle' };
        case 'qr':
            return { ...shared, type: 'qr', data: { kind: 'static', value: id } };
        case 'barcode':
            return { ...shared, type: 'barcode', data: { kind: 'static', value: id } };
    }
};

/**
 * root
 *  ├─ group (hidden)
 *  │   ├─ textA
 *  │   └─ shapeA (locked)
 *  └─ textB
 */
const makeDoc = (): LabelDoc => {
    const nodes: Node[] = [
        base('root', null, 'text'),
        { ...base('group', 'root', 'group'), visible: false } as Node,
        base('textA', 'group', 'text'),
        { ...base('shapeA', 'group', 'shape'), locked: true } as Node,
        base('textB', 'root', 'text'),
    ];
    return createLabelDoc({ id: 'doc', nodes, now: 1_000_000 });
};

describe('selectors — hierarchy', () => {
    it('childrenOf / rootNodes follow parentId and array order', () => {
        const doc = makeDoc();
        expect(rootNodes(doc).map((n) => n.id)).toEqual(['root']);
        expect(childrenOf(doc, 'root').map((n) => n.id)).toEqual(['group', 'textB']);
        expect(childrenOf(doc, 'group').map((n) => n.id)).toEqual(['textA', 'shapeA']);
        expect(childrenOf(doc, null).map((n) => n.id)).toEqual(['root']);
    });

    it('nodeById finds the node or returns undefined', () => {
        const doc = makeDoc();
        expect(nodeById(doc, 'textA')?.id).toBe('textA');
        expect(nodeById(doc, 'nope')).toBeUndefined();
    });

    it('ancestors returns root-first ancestry excluding the node', () => {
        const doc = makeDoc();
        expect(ancestors(doc, 'textA').map((n) => n.id)).toEqual(['root', 'group']);
        expect(ancestors(doc, 'root')).toEqual([]);
    });

    it('descendants returns depth-first pre-order excluding the node', () => {
        const doc = makeDoc();
        expect(descendants(doc, 'root').map((n) => n.id)).toEqual(['group', 'textA', 'shapeA', 'textB']);
        expect(descendants(doc, 'textA')).toEqual([]);
    });

    it('tolerates a parentId pointing at a missing node without looping', () => {
        const doc = createLabelDoc({
            id: 'doc',
            nodes: [base('orphan', 'ghost', 'text')],
            now: 1_000_000,
        });
        expect(rootNodes(doc)).toEqual([]);
        expect(ancestors(doc, 'orphan')).toEqual([]);
    });
});

describe('selectors — z-order views', () => {
    it('siblingZOrder and siblingIndex reflect array order', () => {
        const doc = makeDoc();
        expect(siblingZOrder(doc, 'textB').map((n) => n.id)).toEqual(['group', 'textB']);
        expect(siblingIndex(doc, 'group')).toBe(0);
        expect(siblingIndex(doc, 'textB')).toBe(1);
        expect(siblingIndex(doc, 'textA')).toBe(0);
    });

    it('paintOrder is a depth-first pre-order including hidden nodes', () => {
        const doc = makeDoc();
        expect(paintOrder(doc).map((n) => n.id)).toEqual(['root', 'group', 'textA', 'shapeA', 'textB']);
    });
});

describe('selectors — effective dimming', () => {
    it('a hidden parent makes descendants effectively invisible; the child keeps its own flag', () => {
        const doc = makeDoc();
        const visible = effectiveVisibleMap(doc);
        expect(visible.get('group')).toBe(false);
        expect(visible.get('textA')).toBe(false);
        expect(visible.get('shapeA')).toBe(false);
        expect(visible.get('textB')).toBe(true);
        // own flag unchanged — the row still toggles its own value
        expect(nodeById(doc, 'textA')!.visible).toBe(true);
    });

    it('a hidden ancestor dims an entire subtree', () => {
        const doc = makeDoc();
        // root hidden → everything under it is effectively invisible
        const hiddenRoot: LabelDoc = {
            ...doc,
            nodes: doc.nodes.map((n) => (n.id === 'root' ? { ...n, visible: false } : n)),
        };
        const visible = effectiveVisibleMap(hiddenRoot);
        expect(visible.get('root')).toBe(false);
        expect(visible.get('textB')).toBe(false);
        expect(visible.get('textA')).toBe(false);
    });

    it('a locked parent makes descendants effectively locked', () => {
        const doc = makeDoc();
        const locked = effectiveLockedMap(doc);
        expect(locked.get('group')).toBe(false);
        expect(locked.get('shapeA')).toBe(true);
        expect(locked.get('textA')).toBe(false);
        expect(locked.get('root')).toBe(false);
    });

    it('a locked ancestor locks an entire subtree', () => {
        const doc = makeDoc();
        const lockedRoot: LabelDoc = {
            ...doc,
            nodes: doc.nodes.map((n) => (n.id === 'root' ? { ...n, locked: true } : n)),
        };
        const locked = effectiveLockedMap(lockedRoot);
        expect(locked.get('root')).toBe(true);
        expect(locked.get('group')).toBe(true);
        expect(locked.get('textA')).toBe(true);
    });

    it('layerStateMap combines both derived flags per node', () => {
        const doc = makeDoc();
        const state = layerStateMap(doc);
        expect(state.get('textA')).toEqual({ effectiveVisible: false, effectiveLocked: false });
        expect(state.get('shapeA')).toEqual({ effectiveVisible: false, effectiveLocked: true });
        expect(state.get('root')).toEqual({ effectiveVisible: true, effectiveLocked: false });
    });
});

describe('selectors — tree rows', () => {
    it('flattens depth-first with depth and both own and effective flags', () => {
        const doc = makeDoc();
        expect(treeRows(doc)).toEqual([
            {
                id: 'root',
                depth: 0,
                type: 'text',
                visible: true,
                locked: false,
                effectiveVisible: true,
                effectiveLocked: false,
            },
            {
                id: 'group',
                depth: 1,
                type: 'group',
                visible: false,
                locked: false,
                effectiveVisible: false,
                effectiveLocked: false,
            },
            {
                id: 'textA',
                depth: 2,
                type: 'text',
                visible: true,
                locked: false,
                effectiveVisible: false,
                effectiveLocked: false,
            },
            {
                id: 'shapeA',
                depth: 2,
                type: 'shape',
                visible: true,
                locked: true,
                effectiveVisible: false,
                effectiveLocked: true,
            },
            {
                id: 'textB',
                depth: 1,
                type: 'text',
                visible: true,
                locked: false,
                effectiveVisible: true,
                effectiveLocked: false,
            },
        ]);
    });

    it('includes the name only when the node has one', () => {
        const doc = createLabelDoc({
            id: 'doc',
            nodes: [{ ...base('n1', null, 'text'), name: 'Title' } as Node],
            now: 1_000_000,
        });
        expect(treeRows(doc)[0]!.name).toBe('Title');
    });
});
