import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { ensureLegacyMigrated } from './migrate';

/**
 * IndexedDB layer for `labeleditor.v1`.
 *
 * The stores are keyed out-of-line (the key is passed to `put`/`get`
 * explicitly, so no `keyPath`). Values are opaque here; each repo module owns
 * the shape that lives in its store.
 *
 * Design rules from the phase plan:
 *   - per-record `put`, never delete-all-then-rewrite,
 *   - bulk operations collect per-record errors (`{ ok, errors }`) instead of
 *     blanking the gallery,
 *   - version bumps add stores through `runUpgrade`'s `contains` guard, so an
 *     existing database is never recreated and existing records survive.
 */

export type StoreName = 'labels' | 'resources' | 'csvs' | 'thumbs' | 'trust';

export const DB_NAME = 'labeleditor.v1';
// v2 added the `trust` store (P6). The upgrade is additive: `runUpgrade` only
// creates stores that do not already exist, so v1 data is preserved.
export const DB_VERSION = 2;

export const STORE_NAMES: readonly StoreName[] = [
    'labels',
    'resources',
    'csvs',
    'thumbs',
    'trust',
];

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
    /**
     * Release the underlying connection. Optional: the shared boot adapter is
     * process-lifetime and never closes; an adapter opened for a transient scope
     * (e.g. Settings) must close it on unmount.
     */
    close?(): void;
}

interface LabelEditorDB extends DBSchema {
    labels: { key: string; value: unknown };
    resources: { key: string; value: unknown };
    csvs: { key: string; value: unknown };
    thumbs: { key: string; value: Blob };
    trust: { key: string; value: unknown };
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
        close: () => db.close(),
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
    // Captured so the `blocking` callback can close this connection before the
    // race below has resolved.
    let current: IDBPDatabase<LabelEditorDB> | null = null;

    const open = openDB<LabelEditorDB>(DB_NAME, DB_VERSION, {
        upgrade(database) {
            runUpgrade(database);
        },
        blocked() {
            rejectBlocked(new Error('labeleditor.v1: upgrade blocked by another tab'));
        },
        blocking() {
            // Another tab wants to upgrade. idb does NOT auto-close a connection
            // when a `blocking` callback is supplied, so close this stale
            // connection ourselves; otherwise the other tab's openDB stays blocked.
            current?.close();
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
    current = db;
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
        trust: new Map(),
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
        close: () => {
            // Nothing to release; kept so callers can close uniformly.
        },
    };
};
