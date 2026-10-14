/**
 * First-run seeding of the built-in paper-type catalogue.
 *
 * `PAPER_TYPE_SEEDS` is seed data, not a live registry: on a fresh install the
 * `papers` store is populated from it once, then the marker prevents a later
 * boot from re-seeding. That is what makes deleting a built-in **stick** — the
 * catalogue is user data (owner decision 2026-10-12), so a deleted seed must
 * never be resurrected.
 *
 * Mirroring `data/migrate.ts`, the logic is injectable (`Storage`-like seam) so
 * it is testable, and it never throws: a storage failure at boot must not block
 * the app shell.
 */

import { PAPER_TYPE_SEEDS } from '../core/doc/paper-types';
import type { PaperRecord, PaperRepo } from './paperRepo';

export const PAPER_SEED_MARKER_KEY = 'labeleditor.paperTypes.seeded';

/** The subset of `Storage` the seeding needs; lets tests inject a fake. */
export interface PaperSeedStorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface PaperSeedResult {
    /** `true` when this call wrote the seed records. */
    seeded: boolean;
    /** Number of records written by this call. */
    count: number;
}

const safeGet = (storage: PaperSeedStorageLike, key: string): string | null => {
    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
};

const safeSet = (storage: PaperSeedStorageLike, key: string, value: string): boolean => {
    try {
        storage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
};

/**
 * The seed records as plain `PaperRecord`s. `regions`/`guides` are cloned so a
 * repo write can never mutate the shared seed registry.
 */
export const paperSeedRecords = (): PaperRecord[] =>
    Object.values(PAPER_TYPE_SEEDS).map((paperType) => ({
        id: paperType.id,
        name: paperType.name,
        backingW: paperType.backingW,
        backingH: paperType.backingH,
        regions: paperType.regions.map((region) => structuredClone(region)),
        guides: paperType.guides.map((guide) => structuredClone(guide)),
    }));

/**
 * Seeds the built-in catalogue once, guarded by `PAPER_SEED_MARKER_KEY`.
 * Idempotent: a second call sees the marker and does nothing, so a
 * user-deleted seed is never resurrected. When the marker is unset, each seed
 * is inserted only if `repo.has(id)` is false — a per-record fill, not an
 * all-or-nothing "seed only when the store is empty" write. The marker is set
 * only when every missing seed was written; a partial failure leaves it unset
 * so the next boot retries, and `has` skips the ids that already landed, so a
 * retry never duplicates. Never throws.
 */
export const seedPaperTypesIfNeeded = async (
    repo: PaperRepo,
    storage: PaperSeedStorageLike,
): Promise<PaperSeedResult> => {
    if (safeGet(storage, PAPER_SEED_MARKER_KEY) !== null) {
        return { seeded: false, count: 0 };
    }

    let count = 0;
    let failed = false;
    try {
        // Per-record `has`-gated fill: this supersedes the original "seed only
        // when the store is empty" wording, which lost seeds when a batch write
        // partially failed (the survivors made the store non-empty, so the next
        // boot skipped seeding and marked it settled). Insert only what is
        // missing and let each write report its own failure.
        for (const record of paperSeedRecords()) {
            try {
                if (await repo.has(record.id)) continue;
                await repo.put(record);
                count += 1;
            } catch {
                failed = true;
            }
        }
    } catch {
        // `paperSeedRecords` / `has` threw unexpectedly. The marker stays unset
        // so the next boot retries — matching `migrateLegacyIfNeeded`'s
        // marker-last discipline. Never throw.
        return { seeded: false, count };
    }

    // A failed write must not look "settled": leave the marker unset so the
    // next boot retries, skipping the ids that already landed.
    if (failed) return { seeded: false, count };

    safeSet(storage, PAPER_SEED_MARKER_KEY, '1');
    return { seeded: count > 0, count };
};

const globalStorage = (): PaperSeedStorageLike | undefined => {
    try {
        return (globalThis as { localStorage?: Storage }).localStorage ?? undefined;
    } catch {
        // Access can throw in private mode / sandboxed contexts.
        return undefined;
    }
};

/** Runtime entry point: seeds the real `localStorage` if it is available. */
export const ensurePaperTypesSeeded = (repo: PaperRepo): Promise<PaperSeedResult> => {
    const storage = globalStorage();
    if (!storage) return Promise.resolve({ seeded: false, count: 0 });
    return seedPaperTypesIfNeeded(repo, storage);
};
