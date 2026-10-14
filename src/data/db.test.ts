import { describe, expect, it } from 'vitest';
import { createMemoryAdapter, DB_VERSION, runUpgrade, STORE_NAMES } from './db';

describe('createMemoryAdapter', () => {
    it('round-trips values per store', async () => {
        const adapter = createMemoryAdapter();
        await adapter.put('labels', 'a', { x: 1 });

        expect(await adapter.get('labels', 'a')).toEqual({ x: 1 });
        expect(await adapter.get('labels', 'missing')).toBeUndefined();
        expect(await adapter.keys('labels')).toEqual(['a']);
        expect(await adapter.getAll('labels')).toEqual([{ x: 1 }]);
    });

    it('keeps stores isolated and supports delete/clear', async () => {
        const adapter = createMemoryAdapter();
        await adapter.put('labels', 'a', 1);
        await adapter.put('csvs', 'a', 2);

        await adapter.delete('labels', 'a');
        expect(await adapter.get('labels', 'a')).toBeUndefined();
        expect(await adapter.get('csvs', 'a')).toBe(2);

        await adapter.clear('csvs');
        expect(await adapter.getAll('csvs')).toEqual([]);
        expect(await adapter.keys('csvs')).toEqual([]);
    });

    it('seeds from initial data', async () => {
        const adapter = createMemoryAdapter({ labels: { a: { y: 2 } } });
        expect(await adapter.get('labels', 'a')).toEqual({ y: 2 });
        expect(await adapter.getAll('labels')).toEqual([{ y: 2 }]);
    });

    it('seeds the trust store', async () => {
        const adapter = createMemoryAdapter({ trust: { 'doc-1': 'always' } });
        expect(await adapter.get('trust', 'doc-1')).toBe('always');
        expect(await adapter.keys('trust')).toEqual(['doc-1']);
    });

    it('includes trust in STORE_NAMES', () => {
        expect(STORE_NAMES).toContain('trust');
    });

    it('includes papers in STORE_NAMES and bumps DB_VERSION to 3', () => {
        expect(STORE_NAMES).toContain('papers');
        expect(DB_VERSION).toBe(3);
    });

    it('seeds the papers store', async () => {
        const adapter = createMemoryAdapter({ papers: { p1: { id: 'p1' } } });
        expect(await adapter.get('papers', 'p1')).toEqual({ id: 'p1' });
        expect(await adapter.keys('papers')).toEqual(['p1']);
    });

    it('preserves reference identity of values (no copy)', async () => {
        const adapter = createMemoryAdapter();
        const value = new Uint8Array([1, 2, 3]);
        await adapter.put('labels', 'a', value);
        expect(await adapter.get('labels', 'a')).toBe(value);
    });

    it('exposes a no-op close() so callers can release uniformly', () => {
        const adapter = createMemoryAdapter();
        expect(adapter.close).toBeTypeOf('function');
        adapter.close?.();
        expect(adapter.close?.()).toBeUndefined();
    });
});

describe('runUpgrade (bump-friendly, non-destructive guarantee)', () => {
    /** A stub `IDBDatabase`-like recording created store names. */
    const makeDatabase = (existing: readonly string[]) => {
        const created: string[] = [];
        const has = new Set(existing);
        return {
            created,
            objectStoreNames: { contains: (name: string) => has.has(name) },
            createObjectStore: (name: string) => {
                created.push(name);
            },
        };
    };

    it('creates only the missing stores and never recreates existing ones', () => {
        // Simulates a v1 → v3 bump: the four v1 stores already exist and the
        // two stores added since (`trust` in v2, `papers` in v3) are missing.
        const db = makeDatabase(['labels', 'resources', 'csvs', 'thumbs']);

        runUpgrade(db);

        expect(db.created).toEqual(['trust', 'papers']);
        expect(db.created).not.toContain('labels');
        expect(db.created).not.toContain('resources');
        expect(db.created).not.toContain('csvs');
        expect(db.created).not.toContain('thumbs');
    });

    it('creates every store on a fresh database', () => {
        const db = makeDatabase([]);

        runUpgrade(db);

        expect(db.created).toEqual([...STORE_NAMES]);
    });

    it('adds papers on a v2 → v3 bump without recreating existing stores', () => {
        // Simulates the v2 → v3 bump: the five v2 stores already exist and only
        // the new `papers` store is missing. The upgrade is additive, so no
        // existing store is dropped or recreated (existing records survive).
        const db = makeDatabase(['labels', 'resources', 'csvs', 'thumbs', 'trust']);

        runUpgrade(db);

        expect(db.created).toEqual(['papers']);
        expect(db.created).not.toContain('labels');
        expect(db.created).not.toContain('resources');
        expect(db.created).not.toContain('csvs');
        expect(db.created).not.toContain('thumbs');
        expect(db.created).not.toContain('trust');
    });

    it('creates nothing when all stores already exist (bump is a no-op)', () => {
        const db = makeDatabase([...STORE_NAMES]);

        runUpgrade(db);

        expect(db.created).toEqual([]);
    });
});
