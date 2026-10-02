import { describe, expect, it } from 'vitest';
import {
    LEGACY_AUTOSAVE_KEY,
    MIGRATION_MARKER_KEY,
    migrateLegacyIfNeeded,
    type LegacyStorageLike,
} from './migrate';

const makeStorage = (seed: Record<string, string> = {}): LegacyStorageLike => {
    const map = new Map(Object.entries(seed));
    return {
        getItem: (key) => (map.has(key) ? map.get(key)! : null),
        setItem: (key, value) => {
            map.set(key, value);
        },
        removeItem: (key) => {
            map.delete(key);
        },
    };
};

describe('migrateLegacyIfNeeded', () => {
    it('clears the unreadable legacy autosave and sets the marker', () => {
        const storage = makeStorage({ [LEGACY_AUTOSAVE_KEY]: '{"huge":"blob"}' });

        const result = migrateLegacyIfNeeded(storage);

        expect(result.migrated).toBe(true);
        expect(result.cleared).toEqual([LEGACY_AUTOSAVE_KEY]);
        expect(storage.getItem(LEGACY_AUTOSAVE_KEY)).toBeNull();
        expect(storage.getItem(MIGRATION_MARKER_KEY)).toBe('1');
    });

    it('sets the marker even when there was no legacy key', () => {
        const storage = makeStorage();

        const result = migrateLegacyIfNeeded(storage);

        expect(result.migrated).toBe(true);
        expect(storage.getItem(MIGRATION_MARKER_KEY)).toBe('1');
    });

    it('is idempotent — a second call does nothing', () => {
        const storage = makeStorage({ [LEGACY_AUTOSAVE_KEY]: 'x' });
        migrateLegacyIfNeeded(storage);
        // Re-create the legacy key to prove the second run does not touch it.
        storage.setItem(LEGACY_AUTOSAVE_KEY, 'x');

        const second = migrateLegacyIfNeeded(storage);

        expect(second.migrated).toBe(false);
        expect(second.cleared).toEqual([]);
        expect(storage.getItem(LEGACY_AUTOSAVE_KEY)).toBe('x');
    });

    it('never throws when storage access fails', () => {
        const storage: LegacyStorageLike = {
            getItem: () => null,
            setItem: () => {
                throw new Error('quota');
            },
            removeItem: () => {
                throw new Error('denied');
            },
        };

        const result = migrateLegacyIfNeeded(storage);
        expect(result.migrated).toBe(true);
        expect(result.cleared).toEqual([]);
    });
});
