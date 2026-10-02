import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { ensureLegacyMigrated } from './migrate';

/**
 * IndexedDB layer for `labeleditor.v1`.
 *
 * The four stores are keyed out-of-line (the key is passed to `put`/`get`
 * explicitly, so no `keyPath`). Values are opaque here; each repo module owns
 * the shape that lives in its store.
 *
 * Design rules from the phase plan:
 *   - per-record `put`, never delete-all-then-rewrite,
 *   - bulk operations collect per-record errors (`{ ok, errors }`) instead of
 *     blanking the gallery,
 *   - the `trust` store is deliberately absent (P6); keep the DB version bump
 *     friendly so P6 can add it in a non-destructive upgrade.
 */

export type StoreName = 'labels' | 'resources' | 'csvs' | 'thumbs';

export const DB_NAME = 'labeleditor.v1';
export const DB_VERSION = 1;

export const STORE_NAMES: readonly StoreName[] = ['labels', 'resources', 'csvs', 'thumbs'];

/** One failing record in a bulk operation, tagged with the record it belongs to. */
export interface BulkError {
    id: string;
    error: string;
}

/** Result of a bulk write: which records succeeded, and which failed and why. */
export interface BulkResult {
    ok: string[];
    errors: BulkError[];
}

export interface StorageAdapter {
    get(store: StoreName, key: string): Promise<unknown>;
    getAll(store: StoreName): Promise<unknown[]>;
    keys(store: StoreName): Promise<string[]>;
    put(store: StoreName, key: string, value: unknown): Promise<void>;
    delete(store: StoreName, key: string): Promise<void>;
    clear(store: StoreName): Promise<void>;
}

interface LabelEditorDB extends DBSchema {
    labels: { key: string; value: unknown };
    resources: { key: string; value: unknown };
    csvs: { key: string; value: unknown };
    thumbs: { key: string; value: Blob };
}

const createAdapterFromDb = (db: IDBPDatabase<LabelEditorDB>): StorageAdapter => {
    // The localStorage → IDB transition runs on the first read, once per
    // session, then never again (the marker makes later calls no-ops).
    let migration: Promise<void> | null = null;
    const ensureMigrated = (): Promise<void> => {
        if (!migration) {
            migration = Promise.resolve()
                .then(() => {
                    ensureLegacyMigrated();
                })
                .catch(() => {
                    // A failed migration must never block reading IDB.
                });
        }
        return migration;
    };

    return {
        async get(store, key) {
            await ensureMigrated();
            return db.get(store, key);
        },
        async getAll(store) {
            await ensureMigrated();
            return db.getAll(store);
        },
        keys: (store) => db.getAllKeys(store),
        put: async (store, key, value) => {
            await db.put(store, value, key);
        },
        delete: (store, key) => db.delete(store, key),
        clear: (store) => db.clear(store),
    };
};

/** How long to wait for `openDB` before treating the connection as hung. */
const IDB_OPEN_TIMEOUT_MS = 5000;

/** The subset of an IDB upgrade transaction the schema setup needs. */
export interface UpgradeDatabaseLike {
    objectStoreNames: { contains(name: string): boolean };
    createObjectStore(name: string): unknown;
}

/**
 * Schema setup, extracted so the non-destructive guarantee is unit-testable
 * without a real IndexedDB (which happy-dom lacks). Version-bump friendly: an
 * existing store is never recreated.
 */
export const runUpgrade = (database: UpgradeDatabaseLike): void => {
    for (const name of STORE_NAMES) {
        if (!database.objectStoreNames.contains(name)) {
            database.createObjectStore(name);
        }
    }
};

/**
 * Opens (or creates) `labeleditor.v1` and returns a typed adapter over `idb`.
 *
 * A cross-tab version block makes `openDB` hang (another tab holds an older
 * version open and ignores `versionchange`). The `blocked` callback and a
 * timeout both reject the promise so the caller can surface a retryable storage
 * error instead of showing an infinite spinner.
 */
export const createIdbAdapter = async (): Promise<StorageAdapter> => {
    let rejectBlocked: (error: Error) => void = () => {};
    const blocked = new Promise<never>((_, reject) => {
        rejectBlocked = reject;
    });

    const open = openDB<LabelEditorDB>(DB_NAME, DB_VERSION, {
        upgrade(database) {
            runUpgrade(database);
        },
        blocked() {
            rejectBlocked(new Error('labeleditor.v1: upgrade blocked by another tab'));
        },
        blocking() {
            // Another tab wants to upgrade; this tab's connection is stale. The
            // idb library closes it for us, so nothing to do here.
        },
    });
    // `blocked` can fire before `open` resolves; race so either path rejects.
    const db = await Promise.race([
        open,
        blocked,
        new Promise<never>((_, reject) =>
            setTimeout(
                () => reject(new Error('labeleditor.v1: open timed out')),
                IDB_OPEN_TIMEOUT_MS,
            ),
        ),
    ]);
    return createAdapterFromDb(db);
};

/**
 * In-memory `StorageAdapter` for tests. Deliberately not backed by
 * `indexedDB` — happy-dom's IDB support is incomplete and the repo logic is
 * what we want to exercise. Optionally seed store contents.
 */
export const createMemoryAdapter = (
    initial?: Partial<Record<StoreName, Record<string, unknown>>>,
): StorageAdapter => {
    const stores: Record<StoreName, Map<string, unknown>> = {
        labels: new Map(),
        resources: new Map(),
        csvs: new Map(),
        thumbs: new Map(),
    };

    if (initial) {
        for (const name of STORE_NAMES) {
            const entries = initial[name];
            if (!entries) continue;
            for (const [key, value] of Object.entries(entries)) {
                stores[name].set(key, value);
            }
        }
    }

    return {
        async get(store, key) {
            return stores[store].get(key);
        },
        async getAll(store) {
            return [...stores[store].values()];
        },
        async keys(store) {
            return [...stores[store].keys()];
        },
        async put(store, key, value) {
            stores[store].set(key, value);
        },
        async delete(store, key) {
            stores[store].delete(key);
        },
        async clear(store) {
            stores[store].clear();
        },
    };
};
