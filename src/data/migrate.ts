/**
 * localStorage → IndexedDB transition.
 *
 * The only legacy key that matters is the template's `autosave_project` blob.
 * It is write-only in the old app (a project autosave owned by `Header.tsx`)
 * and cannot be decoded, so there is nothing to preserve: we clear it and
 * record that the transition ran. This mirrors the migrate-then-delete shape of
 * `src/store/legacyStorage.ts` (clear the old key only as part of the
 * transition) without niim.blue's destructive delete-all-then-rewrite.
 *
 * `migrateLegacyIfNeeded` is injectable (takes a `Storage`-like object) so it
 * is testable; `ensureLegacyMigrated` is the runtime convenience that reads the
 * real `localStorage`.
 */

export const MIGRATION_MARKER_KEY = 'labeleditor.v1.migrated';
export const LEGACY_AUTOSAVE_KEY = 'autosave_project';

/** The subset of `Storage` the migration needs; lets tests inject a fake. */
export interface LegacyStorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface MigrationResult {
    /** `true` when this call performed the transition (marker was absent). */
    migrated: boolean;
    /** Legacy keys actually removed by this call. */
    cleared: string[];
}

const safeGet = (storage: LegacyStorageLike, key: string): string | null => {
    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
};

const safeRemove = (storage: LegacyStorageLike, key: string): boolean => {
    try {
        storage.removeItem(key);
        return true;
    } catch {
        return false;
    }
};

const safeSet = (storage: LegacyStorageLike, key: string, value: string): boolean => {
    try {
        storage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
};

/**
 * Runs the transition once, guarded by `MIGRATION_MARKER_KEY`. Idempotent: a
 * second call sees the marker and does nothing. Never throws.
 */
export const migrateLegacyIfNeeded = (storage: LegacyStorageLike): MigrationResult => {
    if (safeGet(storage, MIGRATION_MARKER_KEY) !== null) {
        return { migrated: false, cleared: [] };
    }

    const cleared: string[] = [];
    // Do not preserve the unreadable autosave contents — just drop the key.
    // Only report it as cleared when it actually existed.
    if (safeGet(storage, LEGACY_AUTOSAVE_KEY) !== null && safeRemove(storage, LEGACY_AUTOSAVE_KEY)) {
        cleared.push(LEGACY_AUTOSAVE_KEY);
    }
    // Set the marker last; if it cannot be written the next load retries, which
    // is safe because nothing was carried forward.
    safeSet(storage, MIGRATION_MARKER_KEY, '1');

    return { migrated: true, cleared };
};

const globalStorage = (): LegacyStorageLike | undefined => {
    try {
        return (globalThis as { localStorage?: Storage }).localStorage ?? undefined;
    } catch {
        // Access can throw in private mode / sandboxed contexts.
        return undefined;
    }
};

/** Runtime entry point: migrates the real `localStorage` if it is available. */
export const ensureLegacyMigrated = (): MigrationResult => {
    const storage = globalStorage();
    if (!storage) return { migrated: false, cleared: [] };
    return migrateLegacyIfNeeded(storage);
};
