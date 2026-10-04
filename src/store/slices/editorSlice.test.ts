import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../useStore';
import { createLabelDoc } from '../../core/doc/factory';
import { effectiveTransform, nodeLookup } from '../../core/doc/derive';
import type { LabelDoc, Node } from '../../core/doc/types';
import type { LabelRepo } from '../../data/labelRepo';
import type { NodePatch } from '../storeTypes';
import { transformEndPatch } from '../../editor/transformGesture';
import { CLONE_OFFSET_HM, DOC_HISTORY_CAP } from './editorSlice';

/** Minimal in-memory Storage, mirroring the other store tests. */
const makeStorage = (): Storage => {
    const map = new Map<string, string>();
    return {
        get length() {
            return map.size;
        },
        clear: () => map.clear(),
        getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
        key: (index: number) => [...map.keys()][index] ?? null,
        removeItem: (key: string) => {
            map.delete(key);
        },
        setItem: (key: string, value: string) => {
            map.set(key, value);
        },
    };
};

const textNode = (id: string, parentId: string | null = null): Node => ({
    id,
    parentId,
    type: 'text',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    text: { kind: 'static', value: 'hello' },
});

const groupNode = (id: string, parentId: string | null = null): Node => ({
    id,
    parentId,
    type: 'group',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
});

const imageNodeWithSize = (id: string, size: { w: number; h: number }): Node => ({
    id,
    parentId: null,
    type: 'image',
    imageId: 'img',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    size,
});

const makeDoc = (nodes: Node[] = []): LabelDoc =>
    createLabelDoc({ id: 'doc-1', name: 'Test', nodes, now: 1_000_000 });

const setupStore = (doc: LabelDoc | null = makeDoc()) => {
    const store = createAppStore(makeStorage());
    // Keep the debounce from firing unless a test advances the fake clock.
    store.getState().setDocAutosaveDelay(50);
    store.setState({ currentDoc: doc, view: doc ? 'editor' : 'gallery' });
    return store;
};

const makeMemoryRepo = (docs: Record<string, LabelDoc> = {}) => {
    const save = vi.fn(async (_doc: LabelDoc): Promise<void> => undefined);
    const remove = vi.fn(async (_id: string): Promise<void> => undefined);
    const repo: LabelRepo = {
        list: async () => [],
        get: async (id: string) => docs[id] ?? null,
        save,
        saveAll: async () => ({ ok: [], errors: [] }),
        remove,
        putThumb: async () => undefined,
        getThumb: async () => null,
        removeThumb: async () => undefined,
        listDetailed: async () => ({ ok: [], errors: [] }),
    };
    return { repo, save, remove };
};

describe('editorSlice — document operations', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('addNode appends a fresh-id node, stamps updatedAt, pushes one undo entry', () => {
        const doc = makeDoc();
        const store = setupStore(doc);
        const id = store.getState().addNode(textNode('incoming'));

        expect(id).toBeTruthy();
        const next = store.getState().currentDoc!;
        // Structured clone: the stored doc is replaced, not mutated.
        expect(next).not.toBe(doc);
        expect(doc.nodes).toHaveLength(0);
        expect(next.nodes).toHaveLength(1);
        // The slice mints its own id (decision 39); the incoming id is ignored.
        expect(next.nodes[0]!.id).toBe(id);
        expect(next.nodes[0]!.id).not.toBe('incoming');
        expect(Number.isInteger(next.meta.updatedAt)).toBe(true);
        expect(next.meta.updatedAt).toBe(Math.floor(Date.now() / 1000));
        expect(store.getState().docPast).toHaveLength(1);
        expect(store.getState().docFuture).toHaveLength(0);
    });

    it('is a no-op with no open document (gallery)', () => {
        const store = setupStore(null);
        expect(store.getState().addNode(textNode('x'))).toBeNull();
        store.getState().removeNode('x');
        store.getState().updateNode('x', { visible: false });
        store.getState().undoDoc();
        expect(store.getState().currentDoc).toBeNull();
        expect(store.getState().docPast).toHaveLength(0);
    });

    it('updateNode patches the clone without mutating the source doc', () => {
        const doc = makeDoc([textNode('a')]);
        const store = setupStore(doc);
        store.getState().updateNode('a', {
            visible: false,
            transform: { x: 500, y: 600, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });

        const node = store.getState().currentDoc!.nodes[0]!;
        expect(node.visible).toBe(false);
        expect(node.transform.x).toBe(500);
        // Source untouched.
        expect(doc.nodes[0]!.visible).toBe(true);
        expect(doc.nodes[0]!.transform.x).toBe(0);
    });

    it('never mutates the stored doc (deep compare, including untouched payload)', () => {
        const doc = makeDoc([textNode('a')]);
        doc.label.regions.push({ kind: 'rect', x: 1, y: 2, w: 3, h: 4 });
        doc.data.globals.push({ name: 'g', url: 'u', extract: 'e', expiresAt: 5 });
        doc.resources.fonts.push({
            fontId: 'f',
            familyName: 'F',
            name: 'F',
            source: { kind: 'system', descriptor: 'x' },
        });
        const preOp = structuredClone(doc);

        const store = setupStore(doc);
        store.getState().updateNode('a', {
            visible: false,
            transform: { x: 5, y: 6, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });

        expect(doc).toEqual(preOp);
        expect(store.getState().docPast[0]).toEqual(preOp);
    });

    it('updateNode cannot set parentId/type (type-level) nor bypass the cycle guard', () => {
        const store = setupStore(makeDoc([textNode('a'), textNode('b', 'a')]));

        // @ts-expect-error parentId is excluded from NodePatch
        store.getState().updateNode('a', { parentId: 'a' });
        // @ts-expect-error type is excluded from NodePatch
        store.getState().updateNode('a', { type: 'group' });

        const node = store.getState().currentDoc!.nodes.find((n) => n.id === 'a')!;
        // Runtime restoration keeps the structural keys intact even through a
        // (cast) patch, so no self-parent/cycle can reach IDB via autosave.
        expect(node.parentId).toBeNull();
        expect(node.type).toBe('text');
    });

    it('resizeNode resizes geometry through the commit path (one undo entry)', () => {
        const doc = makeDoc([imageNodeWithSize('i', { w: 100, h: 50 })]);
        const store = setupStore(doc);
        store.getState().resizeNode('i', { w: 200, h: 100 }, { preserveAspect: false });

        const node = store.getState().currentDoc!.nodes[0]!;
        expect(node.size).toEqual({ w: 200, h: 100 });
        // Source untouched; exactly one undo entry; updatedAt stamped.
        expect(doc.nodes[0]!.size).toEqual({ w: 100, h: 50 });
        expect(store.getState().docPast).toHaveLength(1);
        expect(store.getState().docFuture).toHaveLength(0);

        store.getState().undoDoc();
        expect(store.getState().currentDoc!.nodes[0]!.size).toEqual({ w: 100, h: 50 });
    });

    it('resizeNode is a no-op for a missing node or a group', () => {
        const store = setupStore(makeDoc([groupNode('g')]));
        store.getState().resizeNode('missing', { w: 10, h: 10 });
        store.getState().resizeNode('g', { w: 10, h: 10 });
        expect(store.getState().docPast).toHaveLength(0);
    });

    it('updateNode rounds fractional hm geometry to integers', () => {
        const store = setupStore(makeDoc([textNode('a')]));
        store.getState().updateNode('a', {
            transform: { x: 10.6, y: -3.5, rotDeg: 12.5, scaleX: 1, scaleY: 1 },
        });
        const t = store.getState().currentDoc!.nodes[0]!.transform;
        expect(t.x).toBe(11);
        expect(t.y).toBe(-3);
        expect(Number.isInteger(t.x)).toBe(true);
        expect(Number.isInteger(t.y)).toBe(true);
        // Non-hm transform fields are preserved untouched.
        expect(t.rotDeg).toBe(12.5);
    });

    it('updateNode rounds every hm geometry field in the patch, not just x/y', () => {
        const shape: Node = {
            id: 's',
            parentId: null,
            type: 'shape',
            visible: true,
            locked: false,
            transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
            shape: 'polygon',
            points: [
                [0, 0],
                [1, 1],
            ],
            closed: true,
        };
        const store = setupStore(makeDoc([textNode('t'), shape]));
        store.getState().updateNode('t', { size: { w: 10.4, h: 20.6 }, fontSize: 12.5 });
        store.getState().updateNode('s', {
            size: { w: 1.5, h: 2.5 },
            strokeWidth: 3.7,
            points: [
                [4.2, 5.8],
                [6.1, 7.9],
            ],
        });

        const text = store.getState().currentDoc!.nodes.find((n) => n.id === 't')!;
        expect(text.size).toEqual({ w: 10, h: 21 });
        expect((text as { fontSize?: number }).fontSize).toBe(13);

        const poly = store.getState().currentDoc!.nodes.find((n) => n.id === 's')!;
        expect(poly.size).toEqual({ w: 2, h: 3 });
        expect(poly.strokeWidth).toBe(4);
        expect((poly as { points?: [number, number][] }).points).toEqual([
            [4, 6],
            [6, 8],
        ]);
    });

    it('N transient updates + one commitDoc = one undo entry', () => {
        const doc = makeDoc([textNode('a')]);
        const store = setupStore(doc);

        for (let i = 1; i <= 5; i += 1) {
            store.getState().updateNodeTransient('a', {
                transform: { x: i, y: i, rotDeg: 0, scaleX: 1, scaleY: 1 },
            });
        }

        expect(store.getState().currentDoc!.nodes[0]!.transform.x).toBe(5);
        // No history and no autosave while transient; baseline untouched.
        expect(store.getState().docPast).toHaveLength(0);
        expect(doc.nodes[0]!.transform.x).toBe(0);

        store.getState().commitDoc();
        expect(store.getState().docPast).toHaveLength(1);
        expect(store.getState().docFuture).toHaveLength(0);
        expect(store.getState().docPast[0]!.nodes[0]!.transform.x).toBe(0);

        store.getState().undoDoc();
        expect(store.getState().currentDoc!.nodes[0]!.transform.x).toBe(0);
        expect(store.getState().docPast).toHaveLength(0);
        expect(store.getState().docFuture).toHaveLength(1);
    });

    it('commitDoc is a no-op without a transient gesture', () => {
        const store = setupStore(makeDoc([textNode('a')]));
        store.getState().commitDoc();
        expect(store.getState().docPast).toHaveLength(0);
    });

    it('a resize+rotate transform gesture commits exactly one undo entry (must-fix #3)', () => {
        const rect: Node = {
            id: 's',
            parentId: null,
            type: 'shape',
            shape: 'rectangle',
            visible: true,
            locked: false,
            transform: { x: 10, y: 10, rotDeg: 0, scaleX: 1, scaleY: 1 },
            size: { w: 100, h: 50 },
        };
        const store = setupStore(makeDoc([rect]));
        const source = store.getState().currentDoc!.nodes[0]!;

        // The Preview applies the combined patch transiently then commits once.
        // Live x/y includes the anchor fit from a top/left resize/rotate.
        store.getState().updateNodeTransient(
            's',
            transformEndPatch(source, { w: 300, h: 150 }, false, { x: 40, y: 30, rotDeg: 25 }),
        );
        store.getState().commitDoc();

        const node = store.getState().currentDoc!.nodes[0]!;
        expect(node.size).toEqual({ w: 300, h: 150 });
        expect(node.transform.rotDeg).toBe(25);
        // The gesture translation is committed, not dropped (must-fix #6).
        expect(node.transform.x).toBe(40);
        expect(node.transform.y).toBe(30);
        expect(node.transform.scaleX).toBe(1);
        expect(store.getState().docPast).toHaveLength(1);

        store.getState().undoDoc();
        expect(store.getState().currentDoc!.nodes[0]!.size).toEqual({ w: 100, h: 50 });
        expect(store.getState().currentDoc!.nodes[0]!.transform.rotDeg).toBe(0);
        expect(store.getState().currentDoc!.nodes[0]!.transform.x).toBe(10);
    });

    it('a no-op handle click adds no undo entry (must-fix #3)', () => {
        const rect: Node = {
            id: 's',
            parentId: null,
            type: 'shape',
            shape: 'rectangle',
            visible: true,
            locked: false,
            transform: { x: 10, y: 10, rotDeg: 0, scaleX: 1, scaleY: 1 },
            size: { w: 100, h: 50 },
        };
        const store = setupStore(makeDoc([rect]));
        const source = store.getState().currentDoc!.nodes[0]!;
        // Geometry unchanged: the patch equals the baseline.
        store.getState().updateNodeTransient(
            's',
            transformEndPatch(source, { w: 100, h: 50 }, false, { x: 10, y: 10, rotDeg: 0 }),
        );
        store.getState().commitDoc();
        expect(store.getState().docPast).toHaveLength(0);
    });

    it('a transient update changes currentDoc identity without a deep clone', () => {
        const store = setupStore(makeDoc([textNode('a')]));
        store.getState().updateNodeTransient('a', {
            transform: { x: 1, y: 1, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });
        const first = store.getState().currentDoc!;
        store.getState().updateNodeTransient('a', {
            transform: { x: 2, y: 2, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });
        const second = store.getState().currentDoc!;
        // New doc identity (repaint) but shared node objects (no deep clone).
        expect(second).not.toBe(first);
        expect(second.nodes).not.toBe(first.nodes);
        expect(second.nodes[0]).toBe(first.nodes[0]);
        expect(second.nodes[0]!.transform.x).toBe(2);
    });

    it('commitDoc skips the undo entry when the working doc is unchanged', () => {
        const store = setupStore(makeDoc([textNode('a')]));
        // Drag out and back to the origin: the patch equals the baseline.
        store.getState().updateNodeTransient('a', {
            transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });
        store.getState().commitDoc();
        expect(store.getState().docPast).toHaveLength(0);
    });

    it('a transient baseline never leaks across a document switch (finding 1)', () => {
        const docA = makeDoc([textNode('a')]);
        const store = setupStore(docA);
        store.getState().updateNodeTransient('a', {
            transform: { x: 5, y: 5, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });

        // openLabel(B): a different doc replaces `currentDoc` mid-gesture.
        const docB = createLabelDoc({ id: 'doc-2', name: 'B', nodes: [textNode('a')], now: 2_000_000 });
        store.setState({ currentDoc: docB, view: 'editor' });

        // Next transient takes the in-place branch on B — with the stale
        // baseline this would later push doc A into editor B's history.
        store.getState().updateNodeTransient('a', {
            transform: { x: 9, y: 9, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });
        store.getState().commitDoc();

        const past = store.getState().docPast;
        expect(past).toHaveLength(1);
        expect(past[0]!.meta.id).toBe('doc-2');
        expect(past[0]!.nodes[0]!.transform.x).toBe(0);

        store.getState().undoDoc();
        expect(store.getState().currentDoc!.meta.id).toBe('doc-2');
    });

    it('a committed op clears the transient baseline so commitDoc cannot push it', () => {
        const store = setupStore(makeDoc([textNode('a')]));
        store.getState().updateNodeTransient('a', {
            transform: { x: 5, y: 5, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });
        store.getState().addNode(textNode('b'));
        expect(store.getState().docPast).toHaveLength(1);
        store.getState().commitDoc();
        // The baseline was cleared by `commit`; commitDoc is a no-op.
        expect(store.getState().docPast).toHaveLength(1);
    });

    it('resetTransient abandons a gesture without touching history', () => {
        const store = setupStore(makeDoc([textNode('a')]));
        store.getState().updateNodeTransient('a', {
            transform: { x: 5, y: 5, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });
        store.getState().resetTransient();
        store.getState().commitDoc();
        expect(store.getState().docPast).toHaveLength(0);
    });

    it('commitDoc truncates the redo branch', () => {
        const store = setupStore(makeDoc([textNode('a')]));
        store.getState().updateNodeTransient('a', {
            transform: { x: 5, y: 5, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });
        store.getState().commitDoc();
        store.getState().addNode(textNode('b'));
        store.getState().undoDoc();
        expect(store.getState().docFuture).toHaveLength(1);

        store.getState().updateNodeTransient('a', {
            transform: { x: 9, y: 9, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });
        store.getState().commitDoc();
        expect(store.getState().docFuture).toHaveLength(0);
    });

    it('undo and redo re-stamp updatedAt (gallery sort key)', () => {
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        const doc = makeDoc([textNode('a')]);
        doc.meta.updatedAt = 1_000;
        const store = setupStore(doc);
        store.getState().addNode(textNode('b'));

        vi.setSystemTime(new Date('2026-01-02T00:00:00Z'));
        store.getState().undoDoc();
        expect(store.getState().currentDoc!.meta.updatedAt).toBe(Math.floor(Date.now() / 1000));

        vi.setSystemTime(new Date('2026-01-03T00:00:00Z'));
        store.getState().redoDoc();
        expect(store.getState().currentDoc!.meta.updatedAt).toBe(Math.floor(Date.now() / 1000));
    });

    it('a cast patch cannot smuggle id/parentId/type past updateNode', () => {
        const store = setupStore(makeDoc([groupNode('g'), textNode('a', 'g')]));
        store.getState().updateNode('a', {
            id: 'evil',
            parentId: null,
            type: 'group',
        } as unknown as NodePatch);

        const node = store.getState().currentDoc!.nodes.find((n) => n.id === 'a')!;
        expect(node.id).toBe('a');
        expect(node.parentId).toBe('g');
        expect(node.type).toBe('text');
    });

    it('a cast patch with transform: undefined does not throw and keeps the transform', () => {
        const store = setupStore(makeDoc([textNode('a')]));
        expect(() =>
            store.getState().updateNode('a', { transform: undefined } as unknown as NodePatch),
        ).not.toThrow();
        expect(store.getState().currentDoc!.nodes[0]!.transform).toEqual({
            x: 0,
            y: 0,
            rotDeg: 0,
            scaleX: 1,
            scaleY: 1,
        });
    });

    it('clearing an optional field removes the key, not just its value (ObjectTab hint clear)', () => {
        const withHint: Node = { ...textNode('a'), quantizerHint: 'atkinson' };
        const store = setupStore(makeDoc([withHint]));
        expect(store.getState().currentDoc!.nodes[0]!.quantizerHint).toBe('atkinson');

        // Mirrors the ObjectTab clear path: transient edit, then commit.
        store.getState().updateNodeTransient('a', { quantizerHint: undefined });
        store.getState().commitDoc();

        const node = store.getState().currentDoc!.nodes[0]! as Node & Record<string, unknown>;
        expect(node.quantizerHint).toBeUndefined();
        expect(Object.hasOwn(node, 'quantizerHint')).toBe(false);
    });

    it('groupNodes requires at least two ids', () => {
        const store = setupStore(makeDoc([textNode('a'), textNode('b')]));
        expect(store.getState().groupNodes(['a'])).toBeNull();
        expect(store.getState().docPast).toHaveLength(0);
    });

    it('removeNode removes the node and its descendants', () => {
        const store = setupStore(
            makeDoc([textNode('p'), textNode('c', 'p'), textNode('g', 'c'), textNode('o')]),
        );
        store.getState().removeNode('p');
        expect(store.getState().currentDoc!.nodes.map((n) => n.id)).toEqual(['o']);
    });

    it('cloneNode deep-clones a subtree with unique ids and offsets the root', () => {
        const store = setupStore(makeDoc([textNode('p'), textNode('c', 'p')]));
        const newRoot = store.getState().cloneNode('p');
        expect(newRoot).toBeTruthy();

        const nodes = store.getState().currentDoc!.nodes;
        expect(nodes).toHaveLength(4);
        expect(new Set(nodes.map((n) => n.id)).size).toBe(4);

        // Original ids survive; the cloned child is reparented to the clone root.
        expect(nodes.some((n) => n.id === 'p')).toBe(true);
        expect(nodes.some((n) => n.id === 'c')).toBe(true);
        const clonedChild = nodes.find((n) => n.parentId === newRoot && n.id !== 'c');
        expect(clonedChild).toBeDefined();
        expect(clonedChild!.id).not.toBe('c');

        const clonedRoot = nodes.find((n) => n.id === newRoot)!;
        expect(clonedRoot.transform.x).toBe(CLONE_OFFSET_HM);
        expect(clonedRoot.transform.y).toBe(CLONE_OFFSET_HM);
    });

    it('reparentNode moves a node and rejects cycles', () => {
        const store = setupStore(makeDoc([groupNode('g'), groupNode('g2', 'g'), textNode('a', 'g2')]));

        // Moving `g` under its own descendant `g2` is rejected: no change, no history.
        store.getState().reparentNode('g', 'g2', 0);
        expect(store.getState().currentDoc!.nodes.find((n) => n.id === 'g')!.parentId).toBeNull();
        expect(store.getState().docPast).toHaveLength(0);

        // Moving a node to itself is rejected too.
        store.getState().reparentNode('g2', 'g2', 0);
        expect(store.getState().docPast).toHaveLength(0);

        // Valid move: `a` back to root.
        store.getState().reparentNode('a', null, 0);
        expect(store.getState().currentDoc!.nodes.find((n) => n.id === 'a')!.parentId).toBeNull();
        expect(store.getState().docPast).toHaveLength(1);
    });

    it('reparentNode only accepts a group (or root) as the new parent', () => {
        const store = setupStore(makeDoc([textNode('a'), textNode('b'), groupNode('g')]));

        store.getState().reparentNode('a', 'b', 0);
        expect(store.getState().docPast).toHaveLength(0);
        expect(store.getState().currentDoc!.nodes.find((n) => n.id === 'a')!.parentId).toBeNull();

        store.getState().reparentNode('a', 'g', 0);
        expect(store.getState().currentDoc!.nodes.find((n) => n.id === 'a')!.parentId).toBe('g');
        expect(store.getState().docPast).toHaveLength(1);
    });

    it('addNode only accepts a group (or root) as the incoming parentId', () => {
        const store = setupStore(makeDoc([textNode('a'), groupNode('g')]));

        expect(store.getState().addNode(textNode('x', 'a'))).toBeNull();
        expect(store.getState().docPast).toHaveLength(0);

        const id = store.getState().addNode(textNode('x', 'g'));
        expect(id).toBeTruthy();
        expect(store.getState().currentDoc!.nodes.find((n) => n.id === id)!.parentId).toBe('g');
    });

    it('reparentNode inserts at the requested sibling index', () => {
        const store = setupStore(
            makeDoc([textNode('g'), textNode('a'), textNode('b'), textNode('c')]),
        );
        // Insert at sibling index 2 => before the current index-2 sibling (`c`).
        store.getState().reparentNode('a', null, 2);
        expect(store.getState().currentDoc!.nodes.map((n) => n.id)).toEqual(['g', 'b', 'a', 'c']);
    });

    it('moveNodeZ reorders among siblings and clamps at the ends', () => {
        const store = setupStore(makeDoc([textNode('a'), textNode('b'), textNode('c')]));
        const order = () => store.getState().currentDoc!.nodes.map((n) => n.id);

        store.getState().moveNodeZ('a', 'up');
        expect(order()).toEqual(['b', 'a', 'c']);
        store.getState().moveNodeZ('a', 'up');
        expect(order()).toEqual(['b', 'c', 'a']);

        const pastBefore = store.getState().docPast.length;
        store.getState().moveNodeZ('a', 'up'); // already front
        expect(order()).toEqual(['b', 'c', 'a']);
        expect(store.getState().docPast).toHaveLength(pastBefore);

        store.getState().moveNodeZ('a', 'down');
        expect(order()).toEqual(['b', 'a', 'c']);
    });

    it('groupNodes creates a group and ungroupNode dissolves it (order preserved)', () => {
        const store = setupStore(makeDoc([textNode('a'), textNode('b'), textNode('c')]));
        const groupId = store.getState().groupNodes(['a', 'b'])!;
        expect(groupId).toBeTruthy();

        let nodes = store.getState().currentDoc!.nodes;
        const group = nodes.find((n) => n.id === groupId)!;
        expect(group.type).toBe('group');
        expect(group.parentId).toBeNull();
        expect(nodes.find((n) => n.id === 'a')!.parentId).toBe(groupId);
        expect(nodes.find((n) => n.id === 'b')!.parentId).toBe(groupId);
        expect(nodes.find((n) => n.id === 'c')!.parentId).toBeNull();
        // Resulting array order (z-order) is asserted, not just parentIds.
        expect(nodes.map((n) => n.id)).toEqual(['a', 'b', groupId, 'c']);

        store.getState().ungroupNode(groupId);
        nodes = store.getState().currentDoc!.nodes;
        expect(nodes.some((n) => n.id === groupId)).toBe(false);
        expect(nodes.find((n) => n.id === 'a')!.parentId).toBeNull();
        expect(nodes.find((n) => n.id === 'b')!.parentId).toBeNull();
        expect(nodes).toHaveLength(3);
        expect(nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    });

    it('groupNodes rejects a selection spanning parents or containing an ancestor', () => {
        // `a` is a child of group `g`, `b` is a root node: different parents.
        const store = setupStore(makeDoc([groupNode('g'), textNode('a', 'g'), textNode('b')]));
        expect(store.getState().groupNodes(['a', 'b'])).toBeNull();
        expect(store.getState().docPast).toHaveLength(0);

        // Ancestor (`g`) together with its descendant (`a`).
        const nested = setupStore(makeDoc([groupNode('g'), textNode('a', 'g')]));
        expect(nested.getState().groupNodes(['g', 'a'])).toBeNull();
        expect(nested.getState().docPast).toHaveLength(0);
    });

    it('groupNodes nests the group under the shared parent', () => {
        const store = setupStore(makeDoc([groupNode('g'), textNode('a', 'g'), textNode('b', 'g')]));
        const groupId = store.getState().groupNodes(['a', 'b'])!;
        const group = store.getState().currentDoc!.nodes.find((n) => n.id === groupId)!;
        expect(group.parentId).toBe('g');
    });

    it('undo/redo walk the document history', () => {
        const store = setupStore(makeDoc());
        store.getState().addNode(textNode('a'));
        store.getState().addNode(textNode('b'));
        expect(store.getState().currentDoc!.nodes).toHaveLength(2);

        store.getState().undoDoc();
        expect(store.getState().currentDoc!.nodes).toHaveLength(1);
        store.getState().undoDoc();
        expect(store.getState().currentDoc!.nodes).toHaveLength(0);
        store.getState().undoDoc(); // empty
        expect(store.getState().currentDoc!.nodes).toHaveLength(0);

        store.getState().redoDoc();
        expect(store.getState().currentDoc!.nodes).toHaveLength(1);
        store.getState().redoDoc();
        expect(store.getState().currentDoc!.nodes).toHaveLength(2);
        store.getState().redoDoc(); // empty
        expect(store.getState().currentDoc!.nodes).toHaveLength(2);
    });

    it('caps the undo history at DOC_HISTORY_CAP', () => {
        const store = setupStore(makeDoc());
        for (let i = 0; i < DOC_HISTORY_CAP + 5; i += 1) {
            store.getState().addNode(textNode(`n${i}`));
        }
        expect(store.getState().docPast).toHaveLength(DOC_HISTORY_CAP);

        for (let i = 0; i < DOC_HISTORY_CAP + 5; i += 1) {
            store.getState().undoDoc();
        }
        // 25 ops, cap 20: undo can only reach the 5-node snapshot.
        expect(store.getState().currentDoc!.nodes).toHaveLength(5);
        expect(store.getState().docPast).toHaveLength(0);
    });

    it('a new operation truncates the redo branch', () => {
        const store = setupStore(makeDoc());
        const a = store.getState().addNode(textNode('x'))!;
        store.getState().addNode(textNode('x'));
        store.getState().undoDoc();
        expect(store.getState().docFuture).toHaveLength(1);

        const c = store.getState().addNode(textNode('x'))!;
        expect(store.getState().docFuture).toHaveLength(0);

        store.getState().redoDoc(); // branch gone: no-op
        expect(store.getState().currentDoc!.nodes.map((n) => n.id)).toEqual([a, c]);
    });

    it('clearDocHistory drops both stacks and the transient baseline', () => {
        const store = setupStore(makeDoc([textNode('a')]));
        store.getState().updateNodeTransient('a', {
            transform: { x: 5, y: 5, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });
        store.getState().commitDoc();
        store.getState().undoDoc();
        expect(store.getState().docPast).toHaveLength(0);
        expect(store.getState().docFuture).toHaveLength(1);

        store.getState().clearDocHistory();
        expect(store.getState().docPast).toHaveLength(0);
        expect(store.getState().docFuture).toHaveLength(0);
        // The baseline is gone too: a later commitDoc cannot push it.
        store.getState().commitDoc();
        expect(store.getState().docPast).toHaveLength(0);
    });
});

describe('editorSlice — doc-switch history isolation', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('openLabel clears docPast/docFuture and any transient baseline (finding 1)', async () => {
        const docA = makeDoc([textNode('a')]);
        const docB = createLabelDoc({ id: 'doc-2', name: 'B', nodes: [textNode('b')], now: 2_000_000 });
        const { repo } = makeMemoryRepo({ 'doc-2': docB });
        const store = createAppStore(makeStorage());
        store.getState().setLabelRepo(repo);
        store.getState().setDocAutosaveDelay(50);
        store.setState({ currentDoc: docA, view: 'editor' });

        // Build history on A, with an in-flight transient gesture.
        store.getState().addNode(textNode('a2'));
        store.getState().updateNodeTransient('a', {
            transform: { x: 7, y: 7, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });
        expect(store.getState().docPast.length).toBeGreaterThan(0);

        await store.getState().openLabel('doc-2');

        expect(store.getState().currentDoc!.meta.id).toBe('doc-2');
        expect(store.getState().docPast).toHaveLength(0);
        expect(store.getState().docFuture).toHaveLength(0);
    });

    it('undoDoc immediately after openLabel(B) does nothing and never loads A', async () => {
        const docA = makeDoc([textNode('a')]);
        const docB = createLabelDoc({ id: 'doc-2', name: 'B', nodes: [textNode('b')], now: 2_000_000 });
        const { repo } = makeMemoryRepo({ 'doc-2': docB });
        const store = createAppStore(makeStorage());
        store.getState().setLabelRepo(repo);
        store.getState().setDocAutosaveDelay(50);
        store.setState({ currentDoc: docA, view: 'editor' });
        store.getState().addNode(textNode('a2'));

        await store.getState().openLabel('doc-2');
        store.getState().undoDoc();

        const current = store.getState().currentDoc!;
        expect(current.meta.id).toBe('doc-2');
        expect(current.nodes.map((n) => n.id)).toEqual(['b']);
        expect(store.getState().docPast).toHaveLength(0);
    });

    it('undoDoc/redoDoc clear a foreign snapshot defensively (identity guard)', () => {
        const store = setupStore(makeDoc([textNode('a')]));
        // Simulate a stale snapshot from another doc reaching the stack — e.g. a
        // future regression that skips the boundary clear.
        const foreign = createLabelDoc({ id: 'doc-other', name: 'Other', nodes: [], now: 3 });
        store.setState({ docPast: [foreign], docFuture: [foreign] });

        store.getState().undoDoc();
        expect(store.getState().currentDoc!.meta.id).toBe('doc-1');
        expect(store.getState().docPast).toHaveLength(0);

        store.setState({ docFuture: [foreign] });
        store.getState().redoDoc();
        expect(store.getState().currentDoc!.meta.id).toBe('doc-1');
        expect(store.getState().docFuture).toHaveLength(0);
    });

    it('deleteLabel clears the open doc and its history', async () => {
        const docA = makeDoc([textNode('a')]);
        const { repo } = makeMemoryRepo();
        const store = createAppStore(makeStorage());
        store.getState().setLabelRepo(repo);
        store.getState().setDocAutosaveDelay(50);
        store.setState({ currentDoc: docA, view: 'editor' });
        store.getState().addNode(textNode('a2'));
        expect(store.getState().docPast.length).toBeGreaterThan(0);

        await store.getState().deleteLabel('doc-1');

        expect(store.getState().currentDoc).toBeNull();
        expect(store.getState().docPast).toHaveLength(0);
        expect(store.getState().docFuture).toHaveLength(0);
    });
});

describe('editorSlice — autosave', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('debounces a burst of doc changes into a single repo.save', async () => {
        const store = createAppStore(makeStorage());
        const { repo, save } = makeMemoryRepo();
        store.getState().setLabelRepo(repo);
        store.getState().setDocAutosaveDelay(50);
        store.setState({ currentDoc: makeDoc(), view: 'editor' });

        store.getState().addNode(textNode('a'));
        store.getState().addNode(textNode('b'));

        expect(save).not.toHaveBeenCalled();
        vi.advanceTimersByTime(49);
        expect(save).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(save).toHaveBeenCalledTimes(1);
        expect(save.mock.calls[0]![0].nodes).toHaveLength(2);
    });

    it('does not autosave while the gallery view is showing', () => {
        const store = createAppStore(makeStorage());
        const { repo, save } = makeMemoryRepo();
        store.getState().setLabelRepo(repo);
        store.getState().setDocAutosaveDelay(50);
        store.setState({ currentDoc: makeDoc(), view: 'gallery' });

        store.getState().addNode(textNode('a'));
        vi.advanceTimersByTime(1000);
        expect(save).not.toHaveBeenCalled();
    });

    it('does not autosave without an open document', () => {
        const store = createAppStore(makeStorage());
        const { repo, save } = makeMemoryRepo();
        store.getState().setLabelRepo(repo);
        store.getState().setDocAutosaveDelay(50);
        store.setState({ currentDoc: null, view: 'editor' });

        expect(store.getState().addNode(textNode('a'))).toBeNull();
        vi.advanceTimersByTime(1000);
        expect(save).not.toHaveBeenCalled();
    });

    it('does not autosave when the autoSave preference is off', () => {
        const store = createAppStore(makeStorage());
        const { repo, save } = makeMemoryRepo();
        store.getState().setLabelRepo(repo);
        store.getState().setDocAutosaveDelay(50);
        store.setState({ currentDoc: makeDoc(), view: 'editor', autoSave: false });

        store.getState().addNode(textNode('a'));
        vi.advanceTimersByTime(1000);
        expect(save).not.toHaveBeenCalled();
    });

    it('transients never autosave; commitDoc autosaves exactly once', async () => {
        const store = createAppStore(makeStorage());
        const { repo, save } = makeMemoryRepo();
        store.getState().setLabelRepo(repo);
        store.getState().setDocAutosaveDelay(50);
        store.setState({ currentDoc: makeDoc([textNode('a')]), view: 'editor' });

        store.getState().updateNodeTransient('a', {
            transform: { x: 1, y: 1, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });
        store.getState().updateNodeTransient('a', {
            transform: { x: 2, y: 2, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });
        await vi.advanceTimersByTimeAsync(100);
        expect(save).not.toHaveBeenCalled();

        store.getState().commitDoc();
        await vi.advanceTimersByTimeAsync(50);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('records lastAutoSaveAt in ms (Date.now) after a successful save', async () => {
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        const store = createAppStore(makeStorage());
        const { repo, save } = makeMemoryRepo();
        store.getState().setLabelRepo(repo);
        store.getState().setDocAutosaveDelay(50);
        store.setState({ currentDoc: makeDoc(), view: 'editor' });

        store.getState().addNode(textNode('a'));
        await vi.advanceTimersByTimeAsync(50);

        expect(save).toHaveBeenCalledTimes(1);
        // ms epoch, not seconds: exactly the fake clock at save time.
        expect(store.getState().lastAutoSaveAt).toBe(Date.now());
        expect(store.getState().lastAutoSaveAt).toBeGreaterThan(1_000_000_000_000);
    });

    it('swallows a rejected save (no unhandled rejection, no lastAutoSaveAt)', async () => {
        const store = createAppStore(makeStorage());
        const save = vi.fn((): Promise<void> => Promise.reject(new Error('boom')));
        const repo: LabelRepo = { ...makeMemoryRepo().repo, save };
        store.getState().setLabelRepo(repo);
        store.getState().setDocAutosaveDelay(50);
        store.setState({ currentDoc: makeDoc(), view: 'editor' });

        store.getState().addNode(textNode('a'));
        await vi.advanceTimersByTimeAsync(50);

        expect(save).toHaveBeenCalledTimes(1);
        expect(store.getState().lastAutoSaveAt).toBeNull();
    });

    it('swallows a synchronous throw from save', async () => {
        const store = createAppStore(makeStorage());
        const save = vi.fn((): Promise<void> => {
            throw new Error('sync boom');
        });
        const repo: LabelRepo = { ...makeMemoryRepo().repo, save };
        store.getState().setLabelRepo(repo);
        store.getState().setDocAutosaveDelay(50);
        store.setState({ currentDoc: makeDoc(), view: 'editor' });

        store.getState().addNode(textNode('a'));
        await vi.advanceTimersByTimeAsync(50);

        expect(save).toHaveBeenCalledTimes(1);
        expect(store.getState().lastAutoSaveAt).toBeNull();
    });

    it('flushes the pending save when switching view before the debounce fires', async () => {
        const store = createAppStore(makeStorage());
        const { repo, save } = makeMemoryRepo();
        store.getState().setLabelRepo(repo);
        store.getState().setDocAutosaveDelay(800);
        store.setState({ currentDoc: makeDoc(), view: 'editor' });

        store.getState().addNode(textNode('a'));
        // Leave the editor well within the debounce window.
        store.getState().setView('gallery');
        await vi.advanceTimersByTimeAsync(0);

        expect(save).toHaveBeenCalledTimes(1);
        expect(save.mock.calls[0]![0].nodes).toHaveLength(1);
        // The cancelled timer must not fire a second, stale write.
        await vi.advanceTimersByTimeAsync(1000);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('flushes the pending save when switching docs, and never writes A over B', async () => {
        const docA = makeDoc([textNode('a')]);
        const docB = createLabelDoc({ id: 'doc-2', name: 'B', nodes: [textNode('b')], now: 2_000_000 });
        const { repo, save } = makeMemoryRepo({ 'doc-2': docB });
        const store = createAppStore(makeStorage());
        store.getState().setLabelRepo(repo);
        store.getState().setDocAutosaveDelay(800);
        store.setState({ currentDoc: docA, view: 'editor' });

        store.getState().addNode(textNode('a2'));
        await store.getState().openLabel('doc-2');
        await vi.advanceTimersByTimeAsync(1000);

        // A's pending edit is flushed exactly once...
        expect(save).toHaveBeenCalledTimes(1);
        expect(save.mock.calls[0]![0].meta.id).toBe('doc-1');
        expect(save.mock.calls[0]![0].nodes).toHaveLength(2);
        // ...and B is never written with A's content.
        expect(save.mock.calls.some((c) => c[0].meta.id === 'doc-2')).toBe(false);
    });

    it('never fires a scheduled save for doc A after currentDoc became doc B', async () => {
        const docA = makeDoc([textNode('a')]);
        const docB = createLabelDoc({ id: 'doc-2', name: 'B', nodes: [textNode('b')], now: 2_000_000 });
        const { repo, save } = makeMemoryRepo();
        const store = createAppStore(makeStorage());
        store.getState().setLabelRepo(repo);
        store.getState().setDocAutosaveDelay(800);
        store.setState({ currentDoc: docA, view: 'editor' });

        store.getState().addNode(textNode('a2'));
        // Replace the doc without going through the flush boundary, then let the
        // timer fire: the captured identity no longer matches, so it is dropped.
        store.setState({ currentDoc: docB });
        await vi.advanceTimersByTimeAsync(1000);

        expect(save).not.toHaveBeenCalled();
    });
});

const worldOf = (nodes: readonly Node[], id: string) => {
    const byId = nodeLookup(nodes);
    return effectiveTransform(byId.get(id)!, byId);
};

describe('editorSlice — reparent/ungroup preserve world transform (must-fix #4)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('reparent under a translated group keeps the node world position', () => {
        const group = groupNode('g');
        group.transform = { x: 1000, y: 200, rotDeg: 0, scaleX: 1, scaleY: 1 };
        const a = textNode('a');
        a.transform = { x: 100, y: 100, rotDeg: 0, scaleX: 1, scaleY: 1 };

        const store = setupStore(makeDoc([group, a]));
        store.getState().reparentNode('a', 'g', 0);

        const nodes = store.getState().currentDoc!.nodes;
        const world = worldOf(nodes, 'a');
        expect(world.e).toBe(100);
        expect(world.f).toBe(100);
        // The local transform absorbed the parent delta rather than jumping.
        expect(nodes.find((n) => n.id === 'a')!.transform.x).toBe(-900);
    });

    it('reparent under a rotated group keeps the node world position', () => {
        const group = groupNode('g');
        group.transform = { x: 0, y: 0, rotDeg: 90, scaleX: 1, scaleY: 1 };
        const a = textNode('a');
        a.transform = { x: 100, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 };

        const store = setupStore(makeDoc([group, a]));
        store.getState().reparentNode('a', 'g', 0);

        const world = worldOf(store.getState().currentDoc!.nodes, 'a');
        expect(world.e).toBeCloseTo(100, 6);
        expect(world.f).toBeCloseTo(0, 6);
    });

    it('ungrouping a translated, moved group preserves the child world bounds', () => {
        const group = groupNode('g');
        group.transform = { x: 1000, y: 500, rotDeg: 0, scaleX: 1, scaleY: 1 };
        const child = textNode('a', 'g');
        child.transform = { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 };

        const store = setupStore(makeDoc([group, child]));
        const before = worldOf(store.getState().currentDoc!.nodes, 'a');
        store.getState().ungroupNode('g');

        const nodes = store.getState().currentDoc!.nodes;
        expect(nodes.find((n) => n.id === 'g')).toBeUndefined();
        const after = worldOf(nodes, 'a');
        expect(after.e).toBeCloseTo(before.e, 6);
        expect(after.f).toBeCloseTo(before.f, 6);
        // Folded out of the group: local x now carries the group translation.
        expect(nodes.find((n) => n.id === 'a')!.transform.x).toBe(1000);
    });

    it('ungrouping a rotated group preserves the child world bounds', () => {
        const group = groupNode('g');
        group.transform = { x: 1000, y: 500, rotDeg: 90, scaleX: 1, scaleY: 1 };
        const child = textNode('a', 'g');
        child.transform = { x: 100, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 };

        const store = setupStore(makeDoc([group, child]));
        const before = worldOf(store.getState().currentDoc!.nodes, 'a');
        store.getState().ungroupNode('g');

        const after = worldOf(store.getState().currentDoc!.nodes, 'a');
        expect(after.e).toBeCloseTo(before.e, 6);
        expect(after.f).toBeCloseTo(before.f, 6);
    });
});
