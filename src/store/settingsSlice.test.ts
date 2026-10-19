import { describe, expect, it } from 'vitest';
import { createAppStore } from './useStore';
import { defaultUsePrinterDpi } from './storeDefaults';

/** Minimal in-memory Storage, mirroring `docSlice.persistence.test.ts`. */
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

describe('usePrinterDpi setting', () => {
    it('defaults ON and persists a change across a reload', () => {
        const storage = makeStorage();
        const store = createAppStore(storage);
        expect(store.getState().usePrinterDpi).toBe(defaultUsePrinterDpi);
        expect(defaultUsePrinterDpi).toBe(true);

        store.getState().setUsePrinterDpi(false);
        expect(store.getState().usePrinterDpi).toBe(false);

        const reloaded = createAppStore(storage);
        expect(reloaded.getState().usePrinterDpi).toBe(false);
    });

    it('is written into ui_settings', () => {
        const storage = makeStorage();
        const store = createAppStore(storage);
        store.getState().setUsePrinterDpi(false);
        expect(storage.getItem('ui_settings')).toContain('"usePrinterDpi":false');
    });

    it('resetSettings restores the ON default', () => {
        const store = createAppStore(makeStorage());
        store.getState().setUsePrinterDpi(false);
        store.getState().resetSettings();
        expect(store.getState().usePrinterDpi).toBe(defaultUsePrinterDpi);
    });
});
