import { isTrustDecision, normalizeTrustDecision, type TrustDecision } from '../core/trust';
import type { StorageAdapter } from './db';

/**
 * `trust` repo — template trust decisions, keyed by document id.
 *
 * Trust is LOCAL state, never document data (invariant 11, decision 32). IDB
 * stores the raw decision string; an absent key reads as `'ask'` and a malformed
 * value self-heals (deleted) on read. `set` is the only writer, and callers only
 * ever `set('ask')` to re-enable a document — import never writes trust
 * (decision 39).
 *
 * Record shape: the store key is the raw `docId`, the value is the raw
 * `'always' | 'never'` string (`'ask'` is normalized to a delete). `list()`
 * joins keys with values.
 */

// Re-exported so storage consumers keep a single import site; the definition
// (and its normalizer/guard) lives in the pure `src/core/trust` policy module.
export { normalizeTrustDecision };
export type { TrustDecision };

export interface TrustRecord {
    docId: string;
    decision: TrustDecision;
}

export interface TrustRepo {
    /** Persistent decision; absent or malformed reads as `'ask'`. */
    get(docId: string): Promise<TrustDecision>;
    set(docId: string, decision: TrustDecision): Promise<void>;
    list(): Promise<TrustRecord[]>;
    remove(docId: string): Promise<void>;
    clear(): Promise<void>;
    /**
     * Duplicate support (decision 39): copy the source's *explicit* trust record
     * to a freshly minted id. No explicit record (or an explicit `'ask'`) leaves
     * the new id unset rather than minting a default.
     */
    copy(sourceId: string, newId: string): Promise<void>;
}

export const createTrustRepo = (adapter: StorageAdapter): TrustRepo => {
    /**
     * Read a raw stored value, self-healing a malformed one in place so the
     * same bad record is not re-read forever. Returns `'ask'` for absent or
     * malformed values.
     */
    const read = async (docId: string): Promise<TrustDecision> => {
        const raw = await adapter.get('trust', docId);
        if (isTrustDecision(raw)) return raw;
        if (raw !== undefined) {
            try {
                await adapter.delete('trust', docId);
            } catch {
                // A failed heal must not break the read.
            }
        }
        return 'ask';
    };

    const repo: TrustRepo = {
        get: (docId) => read(docId),

        async set(docId, decision) {
            if (!isTrustDecision(decision)) {
                throw new Error('trust: invalid decision');
            }
            // `ask` is the absent/default state — normalize it to a delete so the
            // store never holds a meaningless row.
            if (decision === 'ask') {
                await adapter.delete('trust', docId);
                return;
            }
            await adapter.put('trust', docId, decision);
        },

        async list() {
            const keys = await adapter.keys('trust');
            const records: TrustRecord[] = [];
            for (const docId of keys) {
                const decision = await read(docId);
                // Malformed values heal to `'ask'` and drop out of the list.
                if (decision !== 'ask') records.push({ docId, decision });
            }
            return records;
        },

        remove: (docId) => adapter.delete('trust', docId),

        clear: () => adapter.clear('trust'),

        async copy(sourceId, newId) {
            if (sourceId === newId) return;
            // Use `read()` (not raw `adapter.get`) so a malformed source record
            // self-heals, mirroring `get`/`list`.
            const source = await read(sourceId);
            if (source !== 'ask') {
                await adapter.put('trust', newId, source);
            } else {
                // Defensive: the new id is minted fresh, but never let a stale
                // record survive under a reused id.
                await adapter.delete('trust', newId);
            }
        },
    };

    return repo;
};
