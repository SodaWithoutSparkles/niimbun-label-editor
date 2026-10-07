import { describe, expect, it } from 'vitest';
import { createAppStore } from '../useStore';
import type { EditorWarning } from '../../editor/warnings';

/**
 * warningsSlice — the live/session warning registry. Covers set/replace/clear
 * and the scope guard that stops a stale producer from dropping a newer group.
 */

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

const entry: EditorWarning = {
    id: 'asset:n1',
    kind: 'asset',
    nodeId: 'n1',
    assetWarning: 'missing',
    label: 'Logo',
};

const group = (docId: string, scopeId?: string) => ({
    docId,
    ...(scopeId === undefined ? {} : { scopeId }),
    warnings: [entry],
});

describe('warningsSlice — set / clear', () => {
    it('starts with no groups', () => {
        expect(createAppStore(makeStorage()).getState().editorWarnings).toEqual({});
    });

    it('stores a group per source and replaces it in place', () => {
        const store = createAppStore(makeStorage());
        store.getState().setEditorWarnings('preview', group('doc-1'));

        expect(store.getState().editorWarnings.preview?.docId).toBe('doc-1');
        expect(store.getState().editorWarnings.preview?.warnings).toEqual([entry]);

        store.getState().setEditorWarnings('preview', group('doc-2'));
        expect(store.getState().editorWarnings.preview?.docId).toBe('doc-2');
    });

    it('removes a group when passed null', () => {
        const store = createAppStore(makeStorage());
        store.getState().setEditorWarnings('csv', group('doc-1', 'csv-1'));
        store.getState().setEditorWarnings('csv', null);
        expect(store.getState().editorWarnings.csv).toBeUndefined();
    });

    it('keeps sources independent', () => {
        const store = createAppStore(makeStorage());
        store.getState().setEditorWarnings('preview', group('doc-1'));
        store.getState().setEditorWarnings('print', group('doc-1'));
        store.getState().setEditorWarnings('preview', null);

        expect(store.getState().editorWarnings.preview).toBeUndefined();
        expect(store.getState().editorWarnings.print?.docId).toBe('doc-1');
    });
});

describe('warningsSlice — clear scope guard', () => {
    it('clears when no scope is given', () => {
        const store = createAppStore(makeStorage());
        store.getState().setEditorWarnings('preview', group('doc-1', 'scope-a'));
        store.getState().clearEditorWarnings('preview');
        expect(store.getState().editorWarnings.preview).toBeUndefined();
    });

    it('clears when the scope still matches', () => {
        const store = createAppStore(makeStorage());
        store.getState().setEditorWarnings('csv', group('doc-1', 'csv-1'));
        store.getState().clearEditorWarnings('csv', 'csv-1');
        expect(store.getState().editorWarnings.csv).toBeUndefined();
    });

    it('keeps a newer group whose scope has changed', () => {
        const store = createAppStore(makeStorage());
        store.getState().setEditorWarnings('csv', group('doc-1', 'csv-2'));
        // An unmounting producer for the previous scope must not drop the new group.
        store.getState().clearEditorWarnings('csv', 'csv-1');
        expect(store.getState().editorWarnings.csv?.scopeId).toBe('csv-2');
    });

    it('is a no-op when the source has no group', () => {
        const store = createAppStore(makeStorage());
        store.getState().clearEditorWarnings('csv', 'csv-1');
        expect(store.getState().editorWarnings).toEqual({});
    });

    it('returns the same state object when the scope guard rejects the clear', () => {
        const store = createAppStore(makeStorage());
        store.getState().setEditorWarnings('csv', group('doc-1', 'csv-2'));
        const before = store.getState();

        store.getState().clearEditorWarnings('csv', 'csv-1');

        expect(store.getState()).toBe(before);
    });
});

describe('warningsSlice — persistence', () => {
    it('is never written into ui_settings', async () => {
        const storage = makeStorage();
        const store = createAppStore(storage);
        store.getState().setEditorWarnings('preview', group('doc-1'));
        await Promise.resolve();
        expect(storage.getItem('ui_settings') ?? '').not.toContain('editorWarnings');
    });
});
