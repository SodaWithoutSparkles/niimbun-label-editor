import { describe, expect, it } from 'vitest';
import { createMemoryAdapter } from './db';
import { createPaperRepo, isPaperRecord, type PaperRecord } from './paperRepo';

const record = (id: string): PaperRecord => ({
    id,
    name: `Paper ${id}`,
    backingW: 2500,
    backingH: 7800,
    regions: [{ kind: 'rect', x: 0, y: 0, w: 2500, h: 7800 }],
    guides: [
        { id: 'score', kind: 'score', line: { x1: 1250, y1: 0, x2: 1250, y2: 3800 } },
    ],
});

describe('createPaperRepo', () => {
    it('round-trips a paper record', async () => {
        const repo = createPaperRepo(createMemoryAdapter());
        await repo.put(record('p1'));

        expect(await repo.get('p1')).toEqual(record('p1'));
        expect(await repo.has('p1')).toBe(true);
        expect(await repo.list()).toHaveLength(1);

        await repo.remove('p1');
        expect(await repo.get('p1')).toBeNull();
    });

    it('reads a shallow-valid record but put rejects invalid region content', async () => {
        const adapter = createMemoryAdapter();
        const repo = createPaperRepo(adapter);
        const badRegion = {
            id: 'bad',
            name: 'x',
            backingW: 100,
            backingH: 100,
            regions: [{ kind: 'triangle', x: 1, y: 2, w: 3, h: 4 }],
            guides: [],
        };
        await adapter.put('papers', 'bad', badRegion);

        // Reads use the cheap shape check (not a per-element scan), so an
        // invalid record that already sits in the store is returned as-is…
        expect(await repo.get('bad')).toEqual(badRegion);
        expect(await repo.list()).toHaveLength(1);

        // …but the write boundary (`put`) runs the full region validation.
        await expect(repo.put(badRegion as unknown as PaperRecord)).rejects.toThrow();
    });

    it('put rejects invalid guide content', async () => {
        const repo = createPaperRepo(createMemoryAdapter());
        const badGuide = {
            ...record('p2'),
            guides: [{ id: 'g', kind: 'fold', line: { x1: 0, y1: 0, x2: 0, y2: 0 } }],
        };

        await expect(repo.put(badGuide as unknown as PaperRecord)).rejects.toThrow();
    });

    it('put rejects a guide with an empty id (matches doc validation)', async () => {
        const repo = createPaperRepo(createMemoryAdapter());
        const emptyIdGuide = {
            ...record('p2'),
            guides: [{ id: '', kind: 'score', line: { x1: 0, y1: 0, x2: 0, y2: 0 } }],
        };

        await expect(repo.put(emptyIdGuide as unknown as PaperRecord)).rejects.toThrow();
        expect(isPaperRecord(emptyIdGuide)).toBe(false);
        // A valid guide still passes the write guard.
        expect(isPaperRecord(record('p3'))).toBe(true);
    });

    it('returns null for structurally invalid stored values', async () => {
        const adapter = createMemoryAdapter();
        const repo = createPaperRepo(adapter);
        await adapter.put('papers', 'bad', {
            id: 'bad',
            name: 'x',
            backingW: 100,
            backingH: 100,
            regions: 'nope',
            guides: [],
        });

        expect(await repo.get('bad')).toBeNull();
        expect(await repo.list()).toEqual([]);
    });

    it('collects per-record errors in saveAll', async () => {
        const repo = createPaperRepo(createMemoryAdapter());

        const result = await repo.saveAll([
            record('good'),
            { id: 'bad', name: 'x', backingW: 1, backingH: 1, regions: 'nope', guides: [] } as unknown as PaperRecord,
        ]);

        expect(result.ok).toEqual(['good']);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.id).toBe('bad');
    });

    it('validates the record shape', () => {
        expect(isPaperRecord(record('p'))).toBe(true);
        // Non-finite backing size.
        expect(isPaperRecord({ ...record('p'), backingW: Number.NaN })).toBe(false);
        // Unknown region kind.
        expect(
            isPaperRecord({ ...record('p'), regions: [{ kind: 'triangle' }] }),
        ).toBe(false);
        // Unknown guide kind.
        expect(isPaperRecord({ ...record('p'), guides: [{ id: 'g', kind: 'fold' }] })).toBe(false);
        // Non-string / empty id.
        expect(isPaperRecord({ ...record('p'), id: '' })).toBe(false);
        expect(isPaperRecord(undefined)).toBe(false);
    });
});
