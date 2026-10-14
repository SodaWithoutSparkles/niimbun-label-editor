import { describe, expect, it } from 'vitest';
import { createAppStore } from '../useStore';

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

const store = () => createAppStore(makeStorage());

describe('viewSlice — default view orientation (must-fix #8)', () => {    it('puts a portrait label on its side (long axis horizontal) and leaves landscape flat', () => {
        const s = store();
        s.getState().applyDefaultViewOrientation(2000, 3000);
        expect(s.getState().viewRotation).toBe(90);

        const s2 = store();
        s2.getState().applyDefaultViewOrientation(3000, 2000);
        expect(s2.getState().viewRotation).toBe(0);
    });

    it('is view-only: nothing about the document is touched', () => {
        // The action has no document argument at all — structurally view-only.
        const s = store();
        s.setState({ currentDoc: null });
        s.getState().applyDefaultViewOrientation(2000, 3000);
        expect(s.getState().viewRotation).toBe(90);
        expect(s.getState().currentDoc).toBeNull();
    });

    it('a manual toggle wins — the auto-pick must not clobber it', () => {
        const s = store();
        // Portrait doc auto-picks 90.
        s.getState().applyDefaultViewOrientation(2000, 3000);
        expect(s.getState().viewRotation).toBe(90);

        // User flips it back to landscape.
        s.getState().toggleViewRotation();
        expect(s.getState().viewRotation).toBe(0);
        expect(s.getState().viewRotationUserSet).toBe(true);

        // Any later auto-pick (a regression caller) is now a no-op.
        s.getState().applyDefaultViewOrientation(2000, 3000);
        expect(s.getState().viewRotation).toBe(0);
    });

    it('re-arms at a doc-open boundary so the next document gets a fresh pick', () => {
        const s = store();
        s.getState().toggleViewRotation();
        expect(s.getState().viewRotationUserSet).toBe(true);

        s.getState().resetViewOrientation();
        expect(s.getState().viewRotationUserSet).toBe(false);
        s.getState().applyDefaultViewOrientation(2000, 3000);
        expect(s.getState().viewRotation).toBe(90);
    });
});

describe('viewSlice — gallery section', () => {
    it('rests on `recent` and lifts the sidebar pick into the store', () => {
        const s = store();
        expect(s.getState().gallerySection).toBe('recent');

        s.getState().setGallerySection('paper');
        expect(s.getState().gallerySection).toBe('paper');

        s.getState().setGallerySection('csv');
        expect(s.getState().gallerySection).toBe('csv');

        s.getState().setGallerySection('media');
        expect(s.getState().gallerySection).toBe('media');
    });
});
