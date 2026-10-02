import { describe, expect, it } from 'vitest';
import { createMemoryAdapter } from './db';
import { createResourceRepo, isResourceRecord, type ResourceRecord } from './resourceRepo';

const record = (id: string): ResourceRecord => ({
    id,
    mediaType: 'font/woff2',
    bytes: new Uint8Array([1, 2, 3]),
});

describe('createResourceRepo', () => {
    it('round-trips a resource', async () => {
        const repo = createResourceRepo(createMemoryAdapter());
        await repo.put(record('r1'));

        expect(await repo.get('r1')).toEqual(record('r1'));
        expect(await repo.has('r1')).toBe(true);
        expect(await repo.list()).toHaveLength(1);

        await repo.remove('r1');
        expect(await repo.get('r1')).toBeNull();
        expect(await repo.has('r1')).toBe(false);
    });

    it('returns null for invalid stored values', async () => {
        const adapter = createMemoryAdapter();
        const repo = createResourceRepo(adapter);
        await adapter.put('resources', 'bad', { id: 'bad', mediaType: 'image/png' });

        expect(await repo.get('bad')).toBeNull();
        expect(await repo.list()).toEqual([]);
    });

    it('rejects an invalid record on put and collects it in saveAll', async () => {
        const repo = createResourceRepo(createMemoryAdapter());

        await expect(repo.put({ id: '', mediaType: 'x', bytes: new Uint8Array() })).rejects.toThrow();

        const result = await repo.saveAll([
            record('good'),
            { id: 'bad', mediaType: 'image/png', bytes: 'nope' } as unknown as ResourceRecord,
        ]);

        expect(result.ok).toEqual(['good']);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.id).toBe('bad');
    });

    it('validates the record shape', () => {
        expect(isResourceRecord(record('r'))).toBe(true);
        expect(isResourceRecord({ id: 'r', mediaType: 'x', bytes: new Uint8Array() })).toBe(true);
        expect(isResourceRecord({ id: 'r', mediaType: 'x', bytes: [1, 2] })).toBe(false);
        expect(isResourceRecord(null)).toBe(false);
    });
});
