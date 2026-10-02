import { describe, expect, it } from 'vitest';
import { createMemoryAdapter } from './db';
import { createCsvRepo, isCsvRecord, type CsvRecord } from './csvRepo';

const record = (id: string): CsvRecord => ({
    id,
    name: `${id}.csv`,
    columns: ['name', 'price'],
    rows: [
        ['a', '1'],
        ['b', '2'],
    ],
});

describe('createCsvRepo', () => {
    it('round-trips a csv record', async () => {
        const repo = createCsvRepo(createMemoryAdapter());
        await repo.put(record('c1'));

        expect(await repo.get('c1')).toEqual(record('c1'));
        expect(await repo.has('c1')).toBe(true);
        expect(await repo.list()).toHaveLength(1);

        await repo.remove('c1');
        expect(await repo.get('c1')).toBeNull();
    });

    it('reads a shallow-valid record but put rejects invalid row content', async () => {
        const adapter = createMemoryAdapter();
        const repo = createCsvRepo(adapter);
        const badRows = { id: 'bad', name: 'x', columns: ['a'], rows: [[1]] };
        await adapter.put('csvs', 'bad', badRows);

        // Reads use the cheap shape check (not a per-row scan), so an invalid
        // record that already sits in the store is returned as-is…
        expect(await repo.get('bad')).toEqual(badRows);
        expect(await repo.list()).toHaveLength(1);

        // …but the write boundary (`put`) runs the full per-row validation.
        await expect(repo.put(badRows as unknown as CsvRecord)).rejects.toThrow();
    });

    it('returns null for structurally invalid stored values', async () => {
        const adapter = createMemoryAdapter();
        const repo = createCsvRepo(adapter);
        await adapter.put('csvs', 'bad', { id: 'bad', name: 'x', columns: ['a'], rows: 'nope' });

        expect(await repo.get('bad')).toBeNull();
        expect(await repo.list()).toEqual([]);
    });

    it('collects per-record errors in saveAll', async () => {
        const repo = createCsvRepo(createMemoryAdapter());

        const result = await repo.saveAll([
            record('good'),
            { id: 'bad', name: 'x', columns: ['a'], rows: 'nope' } as unknown as CsvRecord,
        ]);

        expect(result.ok).toEqual(['good']);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.id).toBe('bad');
    });

    it('validates the record shape', () => {
        expect(isCsvRecord(record('c'))).toBe(true);
        expect(isCsvRecord({ id: 'c', name: 'x', columns: [1], rows: [] })).toBe(false);
        expect(isCsvRecord({ id: 'c', name: 'x', columns: [], rows: [['a', 1]] })).toBe(false);
        expect(isCsvRecord(undefined)).toBe(false);
    });
});
