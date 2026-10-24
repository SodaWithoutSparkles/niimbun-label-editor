import { describe, expect, it } from 'vitest';
import { createLabelDoc } from '../core/doc/factory';
import { PAPER_TYPE_SEEDS } from '../core/doc/paper-types';
import { createMemoryAdapter } from './db';
import { createPaperRepo, type PaperRepo } from './paperRepo';
import {
    PAPER_SEED_MARKER_KEY,
    PAPER_SEED_VERSION_KEY,
    paperSeedRecords,
    seedPaperTypesIfNeeded,
    type PaperSeedStorageLike,
} from './paperSeeds';

/** Minimal in-memory `Storage`, mirroring `migrate.test.ts`. */
const makeStorage = (): PaperSeedStorageLike => {
    const map = new Map<string, string>();
    return {
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => {
            map.set(key, value);
        },
        removeItem: (key) => {
            map.delete(key);
        },
    };
};

const seedIds = Object.keys(PAPER_TYPE_SEEDS);

describe('seedPaperTypesIfNeeded', () => {
    it('seeds every built-in into an empty store when the marker is unset', async () => {
        const repo = createPaperRepo(createMemoryAdapter());
        const storage = makeStorage();

        const result = await seedPaperTypesIfNeeded(repo, storage);

        expect(result).toEqual({ seeded: true, count: seedIds.length });
        expect((await repo.list()).map((r) => r.id).sort()).toEqual([...seedIds].sort());
        expect(storage.getItem(PAPER_SEED_MARKER_KEY)).not.toBeNull();
    });

    it('is a no-op when the marker and the seed version are current', async () => {
        const repo = createPaperRepo(createMemoryAdapter());
        const storage = makeStorage();
        storage.setItem(PAPER_SEED_MARKER_KEY, '1');
        storage.setItem(PAPER_SEED_VERSION_KEY, '2');

        const result = await seedPaperTypesIfNeeded(repo, storage);

        expect(result).toEqual({ seeded: false, count: 0 });
        expect(await repo.list()).toHaveLength(0);
    });

    it('adds only the v2 seed to a catalogue seeded before the version key existed', async () => {
        const repo = createPaperRepo(createMemoryAdapter());
        const storage = makeStorage();
        // A v1 install: the original seeds are present and the legacy marker is
        // set, but there is no version key.
        for (const record of paperSeedRecords()) {
            if (record.id !== 'rounded48x30') await repo.put(record);
        }
        storage.setItem(PAPER_SEED_MARKER_KEY, '1');

        const result = await seedPaperTypesIfNeeded(repo, storage);

        expect(result).toEqual({ seeded: true, count: 1 });
        expect(await repo.get('rounded48x30')).not.toBeNull();
        expect(storage.getItem(PAPER_SEED_VERSION_KEY)).toBe('2');

        // Deleting the new seed later must stick.
        await repo.remove('rounded48x30');
        await expect(seedPaperTypesIfNeeded(repo, storage)).resolves.toEqual({
            seeded: false,
            count: 0,
        });
        expect(await repo.get('rounded48x30')).toBeNull();
    });

    it('does not resurrect a deleted v1 seed while adding the v2 seed', async () => {
        const repo = createPaperRepo(createMemoryAdapter());
        const storage = makeStorage();
        const deletedV1 = 'ftagSpare-25x78';
        for (const record of paperSeedRecords()) {
            if (record.id === deletedV1 || record.id === 'rounded48x30') continue;
            await repo.put(record);
        }
        storage.setItem(PAPER_SEED_MARKER_KEY, '1');

        const result = await seedPaperTypesIfNeeded(repo, storage);

        expect(result).toEqual({ seeded: true, count: 1 });
        expect(await repo.get(deletedV1)).toBeNull();
        expect(await repo.get('rounded48x30')).not.toBeNull();
    });

    it('does not resurrect a deleted seed on a later run', async () => {
        const repo = createPaperRepo(createMemoryAdapter());
        const storage = makeStorage();
        await seedPaperTypesIfNeeded(repo, storage);

        const victim = 'ftagSpare-25x78';
        await repo.remove(victim);

        const result = await seedPaperTypesIfNeeded(repo, storage);

        expect(result).toEqual({ seeded: false, count: 0 });
        expect(await repo.get(victim)).toBeNull();
        expect(await repo.list()).toHaveLength(seedIds.length - 1);
    });

    it('tops up only the missing seed in a pre-populated store, then sets the marker', async () => {
        const repo = createPaperRepo(createMemoryAdapter());
        const storage = makeStorage();
        const missing = 'ftagSpare-25x78';
        for (const record of paperSeedRecords()) {
            if (record.id !== missing) await repo.put(record);
        }

        const result = await seedPaperTypesIfNeeded(repo, storage);

        // The old "seed only when the store is empty" rule would have skipped
        // this; the per-record fill tops up the single missing seed.
        expect(result).toEqual({ seeded: true, count: 1 });
        expect(storage.getItem(PAPER_SEED_MARKER_KEY)).not.toBeNull();
        expect((await repo.list()).map((r) => r.id).sort()).toEqual([...seedIds].sort());

        // Marker is now set: a re-run is a no-op and nothing is duplicated.
        await expect(seedPaperTypesIfNeeded(repo, storage)).resolves.toEqual({
            seeded: false,
            count: 0,
        });
        expect((await repo.list()).map((r) => r.id).sort()).toEqual([...seedIds].sort());
    });

    it('keeps the marker unset after a partial write failure, then retries only the missing seed', async () => {
        const adapter = createMemoryAdapter();
        const real = createPaperRepo(adapter);
        const storage = makeStorage();
        const victim = seedIds[0];
        let failing = true;
        const flaky: PaperRepo = {
            ...real,
            put: async (record) => {
                if (failing && record.id === victim) throw new Error('transient write failure');
                return real.put(record);
            },
        };

        const partial = await seedPaperTypesIfNeeded(flaky, storage);

        // The others landed, but the store must not look "settled".
        expect(partial).toEqual({ seeded: false, count: seedIds.length - 1 });
        expect(storage.getItem(PAPER_SEED_MARKER_KEY)).toBeNull();
        expect((await real.list()).map((r) => r.id).sort()).toEqual(
            seedIds.filter((id) => id !== victim).sort(),
        );

        // Next boot: `has` skips the survivors, so only the missing seed is
        // written; the marker is finally set and the exact final set matches.
        failing = false;
        const retried = await seedPaperTypesIfNeeded(flaky, storage);

        expect(retried).toEqual({ seeded: true, count: 1 });
        expect(storage.getItem(PAPER_SEED_MARKER_KEY)).not.toBeNull();
        expect((await real.list()).map((r) => r.id).sort()).toEqual([...seedIds].sort());
    });

    it('never throws when storage is unavailable (a read failure looks like "unseeded")', async () => {
        const repo = createPaperRepo(createMemoryAdapter());
        const storage: PaperSeedStorageLike = {
            getItem: () => {
                throw new Error('nope');
            },
            setItem: () => {
                throw new Error('nope');
            },
            removeItem: () => undefined,
        };

        // No rejection, and the (unreadable) marker does not block a first seed.
        await expect(seedPaperTypesIfNeeded(repo, storage)).resolves.toEqual({
            seeded: true,
            count: seedIds.length,
        });
        // The store is now non-empty, so a retry seeds nothing.
        await expect(seedPaperTypesIfNeeded(repo, storage)).resolves.toEqual({
            seeded: false,
            count: 0,
        });
    });
});

describe('paper seed records round-trip through createLabelDoc', () => {
    it('clones regions/guides off the shared seed registry', () => {
        const records = paperSeedRecords();
        const ftag = records.find((r) => r.id === 'ftagSpare-25x78')!;
        expect(ftag.regions).toEqual(PAPER_TYPE_SEEDS['ftagSpare-25x78'].regions);
        expect(ftag.regions).not.toBe(PAPER_TYPE_SEEDS['ftagSpare-25x78'].regions);

        (ftag.regions[0] as { x: number }).x = -999;
        expect(PAPER_TYPE_SEEDS['ftagSpare-25x78'].regions[0]).toMatchObject({ x: 0 });
    });

    it('yields the same seeded geometry, including the F-tag score-line guide', async () => {
        const repo = createPaperRepo(createMemoryAdapter());
        await seedPaperTypesIfNeeded(repo, makeStorage());
        const seeded = await repo.get('ftagSpare-25x78');
        expect(seeded).not.toBeNull();

        const doc = createLabelDoc({ paperTypeId: 'ftagSpare-25x78' });

        expect(doc.meta.paperTypeId).toBe('ftagSpare-25x78');
        expect(doc.label.backingW).toBe(seeded!.backingW);
        expect(doc.label.backingH).toBe(seeded!.backingH);
        expect(doc.label.regions).toEqual(seeded!.regions);
        expect(doc.label.guides).toEqual([
            { id: 'ftag-spare-score', kind: 'score', line: { x1: 1250, y1: 0, x2: 1250, y2: 3800 } },
        ]);
        expect(doc.label.guides).toEqual(seeded!.guides);
    });
});
