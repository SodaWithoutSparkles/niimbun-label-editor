import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../useStore';
import { createLabelDoc } from '../../core/doc/factory';
import { createMemoryAdapter } from '../../data/db';
import { createResourceRepo } from '../../data/resourceRepo';
import type { FontRef, ImageRef, LabelDoc, Node } from '../../core/doc/types';

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

const makeDoc = (nodes: Node[] = []): LabelDoc =>
    createLabelDoc({ id: 'doc-1', name: 'Test', nodes, now: 1_000_000 });

const setupStore = (doc: LabelDoc | null = makeDoc()) => {
    const store = createAppStore(makeStorage());
    store.getState().setDocAutosaveDelay(50);
    store.setState({ currentDoc: doc, view: doc ? 'editor' : 'gallery' });
    return store;
};

const imageRef = (id: string, name = id): ImageRef => ({
    imageId: id,
    name,
    source: { kind: 'external', mediaType: 'image/png', filename: `${id}.png` },
    widthPx: 10,
    heightPx: 20,
});

const fontRef = (id: string, name = id): FontRef => ({
    fontId: id,
    familyName: `Family-${id}`,
    name,
    source: { kind: 'system', descriptor: id },
});

const imageNode = (id: string, imageId: string): Node => ({
    id,
    parentId: null,
    type: 'image',
    imageId,
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
});

const textNodeWithFont = (id: string, fontId: string): Node => ({
    id,
    parentId: null,
    type: 'text',
    text: { kind: 'static', value: 'hello' },
    fontId,
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
});

describe('editorSlice — asset refs', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('addImageRef appends one image as exactly one undo entry', () => {
        const store = setupStore(makeDoc());
        expect(store.getState().addImageRef(imageRef('i1'))).toBe(true);

        expect(store.getState().currentDoc!.resources.images).toHaveLength(1);
        expect(store.getState().docPast).toHaveLength(1);
        expect(store.getState().docFuture).toHaveLength(0);

        store.getState().undoDoc();
        expect(store.getState().currentDoc!.resources.images).toHaveLength(0);
    });

    it('addImageRef refuses a duplicate imageId without touching history', () => {
        const doc = makeDoc();
        doc.resources.images.push(imageRef('i1'));
        const store = setupStore(doc);

        expect(store.getState().addImageRef(imageRef('i1'))).toBe(false);
        expect(store.getState().docPast).toHaveLength(0);
        expect(store.getState().currentDoc!.resources.images).toHaveLength(1);
    });

    it('addImageRef is a no-op (false) without an open document', () => {
        const store = setupStore(null);
        expect(store.getState().addImageRef(imageRef('i1'))).toBe(false);
        expect(store.getState().docPast).toHaveLength(0);
    });

    it('addImageRef clones the caller ref (later mutation cannot leak)', () => {
        const store = setupStore(makeDoc());
        const ref = imageRef('i1', 'Original');
        store.getState().addImageRef(ref);
        ref.name = 'Mutated';

        expect(store.getState().currentDoc!.resources.images[0]!.name).toBe('Original');
    });

    it('updateImageRef renames, rounds px to non-negative ints, one undo entry', () => {
        const doc = makeDoc();
        doc.resources.images.push(imageRef('i1', 'Old'));
        const store = setupStore(doc);

        store.getState().updateImageRef('i1', {
            name: 'New',
            alt: 'a photo',
            widthPx: 12.6,
            heightPx: -3.2,
        });

        const ref = store.getState().currentDoc!.resources.images[0]!;
        expect(ref.name).toBe('New');
        expect(ref.alt).toBe('a photo');
        expect(ref.widthPx).toBe(13);
        expect(ref.heightPx).toBe(0);
        expect(store.getState().docPast).toHaveLength(1);

        store.getState().undoDoc();
        expect(store.getState().currentDoc!.resources.images[0]!.name).toBe('Old');
    });

    it('updateImageRef is a no-op for a missing id or no doc', () => {
        const doc = makeDoc();
        doc.resources.images.push(imageRef('i1'));
        const store = setupStore(doc);

        store.getState().updateImageRef('missing', { name: 'x' });
        expect(store.getState().docPast).toHaveLength(0);

        const gallery = setupStore(null);
        gallery.getState().updateImageRef('i1', { name: 'x' });
        expect(gallery.getState().docPast).toHaveLength(0);
    });

    it('renaming an image never changes a node reference (stable imageId)', () => {
        const doc = makeDoc([imageNode('n', 'i1')]);
        doc.resources.images.push(imageRef('i1', 'Old'));
        const store = setupStore(doc);

        store.getState().updateImageRef('i1', { name: 'Renamed' });

        const node = store.getState().currentDoc!.nodes.find((n) => n.id === 'n')!;
        expect(node.type).toBe('image');
        expect(node.type === 'image' && node.imageId).toBe('i1');
        expect(store.getState().currentDoc!.resources.images[0]!.name).toBe('Renamed');
    });

    it('addFontRef appends one font as exactly one undo entry, refusing duplicates', () => {
        const store = setupStore(makeDoc());
        expect(store.getState().addFontRef(fontRef('f1'))).toBe(true);
        expect(store.getState().docPast).toHaveLength(1);

        expect(store.getState().addFontRef(fontRef('f1'))).toBe(false);
        expect(store.getState().docPast).toHaveLength(1);
        expect(store.getState().currentDoc!.resources.fonts).toHaveLength(1);
    });

    it('updateFontRef renames as one undo entry and keeps node fontId stable', () => {
        const doc = makeDoc([textNodeWithFont('t', 'f1')]);
        doc.resources.fonts.push(fontRef('f1', 'Old'));
        const store = setupStore(doc);

        store.getState().updateFontRef('f1', { name: 'New', familyName: 'Brand' });

        const ref = store.getState().currentDoc!.resources.fonts[0]!;
        expect(ref.name).toBe('New');
        expect(ref.familyName).toBe('Brand');
        expect(store.getState().docPast).toHaveLength(1);

        const node = store.getState().currentDoc!.nodes.find((n) => n.id === 't')!;
        expect(node.type === 'text' && node.fontId).toBe('f1');
    });

    it('updateFontRef clears alt when explicitly set to undefined', () => {
        const doc = makeDoc();
        const ref = fontRef('f1');
        ref.alt = 'remove me';
        doc.resources.fonts.push(ref);
        const store = setupStore(doc);

        store.getState().updateFontRef('f1', { alt: undefined });

        const target = store.getState().currentDoc!.resources.fonts[0]!;
        expect(target.alt).toBeUndefined();
        expect(Object.hasOwn(target, 'alt')).toBe(false);
    });
});

describe('docSlice — resourceRepo handle', () => {
    it('defaults to null and accepts an injected repo', () => {
        const store = createAppStore(makeStorage());
        expect(store.getState().resourceRepo).toBeNull();

        const repo = createResourceRepo(createMemoryAdapter());
        store.getState().setResourceRepo(repo);
        expect(store.getState().resourceRepo).toBe(repo);
    });
});
