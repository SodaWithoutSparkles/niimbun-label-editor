import { describe, expect, it } from 'vitest';
import {
    clearLegacyPreferencesIfMigrated,
    LEGACY_KEYS,
    readLegacyPreferences,
} from './legacyStorage';
import { createAppStore } from './useStore';
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
});
