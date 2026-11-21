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

describe('viewSlice — default view orientation (opt-in)', () => {
    it('defaults OFF: a portrait label keeps its real orientation (rotation 0)', () => {
        const s = store();
        expect(s.getState().autoOrientPortrait).toBe(false);

        s.getState().applyDefaultViewOrientation(2000, 3000);
        expect(s.getState().viewRotation).toBe(0);
    });

    it('when enabled, puts a portrait label on its side and leaves landscape flat', () => {
        const s = store();
        s.getState().setAutoOrientPortrait(true);
        s.getState().applyDefaultViewOrientation(2000, 3000);
        expect(s.getState().viewRotation).toBe(90);

        const s2 = store();
        s2.getState().setAutoOrientPortrait(true);
        s2.getState().applyDefaultViewOrientation(3000, 2000);
        expect(s2.getState().viewRotation).toBe(0);
    });

    it('disabling after a rotated open resets the next doc-open to rotation 0', () => {
        const s = store();
        s.getState().setAutoOrientPortrait(true);
        s.getState().applyDefaultViewOrientation(2000, 3000);
        expect(s.getState().viewRotation).toBe(90);

        // The pref change alone must not rotate the doc already on screen.
        s.getState().setAutoOrientPortrait(false);
        expect(s.getState().viewRotation).toBe(90);

        // At the next doc-open boundary the stale rotation is cleared.
        s.getState().resetViewOrientation();
        s.getState().applyDefaultViewOrientation(2000, 3000);
        expect(s.getState().viewRotation).toBe(0);
    });

    it('is view-only: nothing about the document is touched', () => {
        // The action has no document argument at all — structurally view-only.
        const s = store();
        s.getState().setAutoOrientPortrait(true);
        s.setState({ currentDoc: null });
        s.getState().applyDefaultViewOrientation(2000, 3000);
        expect(s.getState().viewRotation).toBe(90);
        expect(s.getState().currentDoc).toBeNull();
    });

    it('a manual toggle wins — the auto-pick must not clobber it', () => {
        const s = store();
        s.getState().setAutoOrientPortrait(true);
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
        s.getState().setAutoOrientPortrait(true);
        s.getState().toggleViewRotation();
        expect(s.getState().viewRotationUserSet).toBe(true);

        s.getState().resetViewOrientation();
        expect(s.getState().viewRotationUserSet).toBe(false);
        s.getState().applyDefaultViewOrientation(2000, 3000);
        expect(s.getState().viewRotation).toBe(90);
    });

    it('persists the preference in `ui_settings`', () => {
        const storage = makeStorage();
        const s = createAppStore(storage);
        s.getState().setAutoOrientPortrait(true);

        const raw = storage.getItem('ui_settings');
        expect(raw).not.toBeNull();
        expect(raw).toContain('autoOrientPortrait');
        expect(JSON.parse(raw!).state.autoOrientPortrait).toBe(true);
    });
});

describe('viewSlice — dithered-view render mode', () => {
    it('defaults to normal', () => {
        expect(store().getState().renderMode).toBe('normal');
    });

    it('sets the mode explicitly', () => {
        const s = store();
        s.getState().setRenderMode('quantized');
        expect(s.getState().renderMode).toBe('quantized');
        s.getState().setRenderMode('normal');
        expect(s.getState().renderMode).toBe('normal');
    });

    it('toggles both ways', () => {
        const s = store();
        s.getState().toggleRenderMode();
        expect(s.getState().renderMode).toBe('quantized');
        s.getState().toggleRenderMode();
        expect(s.getState().renderMode).toBe('normal');
    });

    it('is session-only: never written to the persisted settings blob', () => {
        const storage = makeStorage();
        const s = createAppStore(storage);
        s.getState().toggleRenderMode();
        const raw = storage.getItem('ui_settings');
        expect(raw).not.toBeNull();
        expect(raw).not.toContain('renderMode');
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
