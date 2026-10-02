import { describe, expect, it } from 'vitest';
import {
    clearLegacyPreferencesIfMigrated,
    LEGACY_KEYS,
    readLegacyPreferences,
} from './legacyStorage';
import { createAppStore, createSafeStorage } from './useStore';
import { defaultColors, defaultToolSettings } from './storeDefaults';

const makeStorage = (initial: Record<string, string> = {}): Storage => {
    const map = new Map<string, string>(Object.entries(initial));
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

const PREFERENCE_KEYS = [
    LEGACY_KEYS.keyboardShortcuts,
    LEGACY_KEYS.autoSave,
    LEGACY_KEYS.toolSettings,
    LEGACY_KEYS.colors,
];

const seedLegacy = (storage: Storage): void => {
    storage.setItem(LEGACY_KEYS.autoSave, 'false');
    storage.setItem(LEGACY_KEYS.toolSettings, JSON.stringify(defaultToolSettings));
    storage.setItem(LEGACY_KEYS.colors, JSON.stringify(defaultColors));
    storage.setItem(LEGACY_KEYS.keyboardShortcuts, JSON.stringify({ modifyKey: 'alt' }));
};

/**
 * Reads and deletes keep working, but every write throws like a full quota.
 * `seed` runs against the backing map before the guard is installed, the only
 * way to populate a storage that cannot be written to.
 */
const makeThrowingStorage = (seed?: (storage: Storage) => void): Storage => {
    const backing = makeStorage();
    if (seed) seed(backing);
    return {
        get length() {
            return backing.length;
        },
        clear: () => backing.clear(),
        getItem: (key: string) => backing.getItem(key),
        key: (index: number) => backing.key(index),
        removeItem: (key: string) => backing.removeItem(key),
        setItem: () => {
            throw new DOMException('QuotaExceededError', 'QuotaExceededError');
        },
    };
};

describe('readLegacyPreferences', () => {
    it('reads and repairs the four preference keys', () => {
        const storage = makeStorage();
        seedLegacy(storage);
        const prefs = readLegacyPreferences(storage);

        expect(prefs.autoSave).toBe(false);
        expect(prefs.toolSettings).toEqual(defaultToolSettings);
        expect(prefs.colors).toEqual(defaultColors);
        expect(prefs.keyboardShortcuts?.modifyKey).toBe('alt');
    });

    it('ignores unparseable / wrong-typed legacy values', () => {
        const storage = makeStorage({
            [LEGACY_KEYS.autoSave]: 'maybe',
            [LEGACY_KEYS.toolSettings]: 'not json',
            [LEGACY_KEYS.colors]: '[1,2,3]',
            [LEGACY_KEYS.keyboardShortcuts]: 'null',
        });
        expect(readLegacyPreferences(storage)).toEqual({});
    });
});

describe('clearLegacyPreferencesIfMigrated', () => {
    it('does NOT delete legacy keys when the new settings were not written', () => {
        const storage = makeStorage();
        seedLegacy(storage);

        const cleared = clearLegacyPreferencesIfMigrated(storage, false);

        expect(cleared).toBe(false);
        for (const key of PREFERENCE_KEYS) expect(storage.getItem(key)).not.toBeNull();
    });

    it('deletes legacy keys when the new settings were written', () => {
        const storage = makeStorage();
        seedLegacy(storage);

        const cleared = clearLegacyPreferencesIfMigrated(storage, true);

        expect(cleared).toBe(true);
        for (const key of PREFERENCE_KEYS) expect(storage.getItem(key)).toBeNull();
    });

    it('leaves the project autosave blob untouched', () => {
        const storage = makeStorage();
        seedLegacy(storage);
        storage.setItem(LEGACY_KEYS.autosaveProject, '{"keep":true}');

        clearLegacyPreferencesIfMigrated(storage, true);

        expect(storage.getItem(LEGACY_KEYS.autosaveProject)).toBe('{"keep":true}');
    });
});

describe('migration gating through createAppStore', () => {
    it('deletes legacy keys after a successful write', () => {
        const storage = makeStorage();
        seedLegacy(storage);

        createAppStore(storage);

        for (const key of PREFERENCE_KEYS) expect(storage.getItem(key)).toBeNull();
        expect(storage.getItem('ui_settings')).not.toBeNull();
    });

    it('keeps legacy keys when setItem throws (quota exceeded / private mode)', () => {
        const map = new Map<string, string>();
        // Seed directly; the read path must keep working even though writes throw.
        map.set(LEGACY_KEYS.autoSave, 'false');
        map.set(LEGACY_KEYS.toolSettings, JSON.stringify(defaultToolSettings));
        map.set(LEGACY_KEYS.colors, JSON.stringify(defaultColors));
        map.set(LEGACY_KEYS.keyboardShortcuts, JSON.stringify({ modifyKey: 'alt' }));

        const throwingStorage: Storage = {
            getItem: (key: string) => map.get(key) ?? null,
            setItem: () => {
                throw new DOMException('QuotaExceededError', 'QuotaExceededError');
            },
            removeItem: (key: string) => {
                map.delete(key);
            },
            clear: () => map.clear(),
            key: () => null,
            get length() {
                return map.size;
            },
        };

        createAppStore(throwingStorage);

        // No new blob landed, and the legacy keys — the only surviving copy —
        // must still be present.
        expect(map.get('ui_settings')).toBeUndefined();
        for (const key of PREFERENCE_KEYS) expect(map.get(key)).not.toBeNull();
    });

    it('gates each store on its own write, not another store\'s', () => {
        const healthy = makeStorage();
        seedLegacy(healthy);

        const failing = makeThrowingStorage(seedLegacy);

        // The healthy store migrates first, so a shared flag would already be
        // `true` when the failing one runs.
        createAppStore(healthy);
        createAppStore(failing);

        // Each store cleared (or kept) only its own legacy keys. Documents the
        // intended behaviour; the leak itself is caught by the `lastWrite` unit
        // test below — `setItem`'s catch always overwrites the flag before
        // `finishMigration` reads it, so no interleaving can expose a shared one.
        for (const key of PREFERENCE_KEYS) expect(healthy.getItem(key)).toBeNull();
        for (const key of PREFERENCE_KEYS) expect(failing.getItem(key)).not.toBeNull();
        expect(healthy.getItem('ui_settings')).not.toBeNull();
    });
});

describe('createSafeStorage last-write flag', () => {
    it('starts false and flips true on a landed write', () => {
        const { storage, lastWrite } = createSafeStorage(makeStorage());
        expect(lastWrite.ok).toBe(false);

        storage.setItem('ui_settings', '{}');

        expect(lastWrite.ok).toBe(true);
    });

    it('stays false when the underlying write throws', () => {
        const { storage, lastWrite } = createSafeStorage(makeThrowingStorage());

        storage.setItem('ui_settings', '{}'); // swallowed by the wrapper

        expect(lastWrite.ok).toBe(false);
    });

    it('is per instance: one wrapper\'s failure never flips another\'s flag', () => {
        const healthy = createSafeStorage(makeStorage());
        const quotaFull = createSafeStorage(makeThrowingStorage());

        quotaFull.storage.setItem('ui_settings', '{}');
        expect(quotaFull.lastWrite.ok).toBe(false);
        expect(healthy.lastWrite.ok).toBe(false);

        healthy.storage.setItem('ui_settings', '{}');
        expect(healthy.lastWrite.ok).toBe(true);
        // The discriminator: with a module-global flag this would read `true`,
        // and `createAppStore` would delete legacy keys after a failed write.
        expect(quotaFull.lastWrite.ok).toBe(false);
    });
});
