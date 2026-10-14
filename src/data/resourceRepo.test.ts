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

    it('accepts optional metadata and still loads a legacy record without it (phase 9, D2)', async () => {
        // Optional metadata is accepted when present…
        expect(
            isResourceRecord({
                id: 'r',
                mediaType: 'image/png',
                bytes: new Uint8Array([1]),
                name: 'logo.png',
                widthPx: 9,
                heightPx: 7,
            }),
        ).toBe(true);
        // …never required: a legacy `{id,mediaType,bytes}` row still validates.
        expect(isResourceRecord({ id: 'legacy', mediaType: 'image/png', bytes: new Uint8Array() })).toBe(
            true,
        );
        // Wrong-typed metadata is rejected (the bytes check is unchanged).
        expect(
            isResourceRecord({
                id: 'r',
                mediaType: 'image/png',
                bytes: new Uint8Array(),
                widthPx: 'wide',
            }),
        ).toBe(false);

        // A legacy row round-trips through the repo unchanged.
        const repo = createResourceRepo(createMemoryAdapter());
        await repo.put({ id: 'legacy', mediaType: 'image/png', bytes: new Uint8Array([4, 5]) });
        expect(await repo.get('legacy')).toMatchObject({ id: 'legacy', mediaType: 'image/png' });
    });
});
