import { describe, expect, it } from 'vitest';
import { createMemoryAdapter } from './db';
import { createThumbRepo } from './thumbRepo';

const png = (bytes: number[] = [1, 2, 3]): Blob =>
    new Blob([new Uint8Array(bytes)], { type: 'image/png' });

describe('createThumbRepo', () => {
    it('puts, gets and removes a thumb blob', async () => {
        const repo = createThumbRepo(createMemoryAdapter());
        const blob = png();

        await repo.put('label-1', blob);
        expect(await repo.get('label-1')).toBe(blob);
        expect(await repo.keys()).toEqual(['label-1']);

        await repo.remove('label-1');
        expect(await repo.get('label-1')).toBeNull();
    });

    it('returns null for a missing or non-blob value', async () => {
        const adapter = createMemoryAdapter();
        const repo = createThumbRepo(adapter);

        expect(await repo.get('nope')).toBeNull();
        await adapter.put('thumbs', 'bad', 'not-a-blob');
        expect(await repo.get('bad')).toBeNull();
    });

    it('clears every thumb', async () => {
        const repo = createThumbRepo(createMemoryAdapter());
        await repo.put('a', png());
        await repo.put('b', png());

        await repo.clear();

        expect(await repo.keys()).toEqual([]);
    });
});
