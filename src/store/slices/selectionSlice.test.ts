import { describe, expect, it } from 'vitest';
import { createAppStore } from '../useStore';

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

const setup = () => createAppStore(makeStorage());

describe('selectionSlice — document node selection', () => {
    it('starts empty', () => {
        expect(setup().getState().selectedNodeIds).toEqual([]);
    });

    it('selectNode replaces the selection; null clears it', () => {
        const store = setup();
        store.getState().selectNode('a');
        expect(store.getState().selectedNodeIds).toEqual(['a']);
        store.getState().selectNode('b');
        expect(store.getState().selectedNodeIds).toEqual(['b']);
        store.getState().selectNode(null);
        expect(store.getState().selectedNodeIds).toEqual([]);
    });

    it('toggleSelectNode adds when absent and removes when present', () => {
        const store = setup();
        store.getState().toggleSelectNode('a');
        store.getState().toggleSelectNode('b');
        expect(store.getState().selectedNodeIds).toEqual(['a', 'b']);
        store.getState().toggleSelectNode('a');
        expect(store.getState().selectedNodeIds).toEqual(['b']);
    });

    it('selectNodes replaces and de-duplicates ids', () => {
        const store = setup();
        store.getState().selectNode('a');
        store.getState().selectNodes(['b', 'c', 'b']);
        expect(store.getState().selectedNodeIds).toEqual(['b', 'c']);
    });

    it('clearNodeSelection empties the selection', () => {
        const store = setup();
        store.getState().selectNodes(['a', 'b']);
        store.getState().clearNodeSelection();
        expect(store.getState().selectedNodeIds).toEqual([]);
    });

    it('is not persisted into ui_settings', async () => {
        const storage = makeStorage();
        const store = createAppStore(storage);
        store.getState().selectNode('a');
        // Give persist a tick to flush.
        await Promise.resolve();
        const raw = storage.getItem('ui_settings') ?? '';
        expect(raw).not.toContain('selectedNodeIds');
    });
});
