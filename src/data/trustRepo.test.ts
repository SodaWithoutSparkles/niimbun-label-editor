import { describe, expect, it } from 'vitest';
import { createMemoryAdapter } from './db';
import { createTrustRepo, normalizeTrustDecision, type TrustDecision } from './trustRepo';

describe('createTrustRepo', () => {
    it('reads an absent record as ask', async () => {
        const repo = createTrustRepo(createMemoryAdapter());
        expect(await repo.get('missing')).toBe('ask');
    });

    it('round-trips always and never', async () => {
        const repo = createTrustRepo(createMemoryAdapter());

        await repo.set('a', 'always');
        await repo.set('b', 'never');

        expect(await repo.get('a')).toBe('always');
        expect(await repo.get('b')).toBe('never');
    });

    it('normalizes ask to a delete (absent is the canonical default)', async () => {
        const adapter = createMemoryAdapter();
        const repo = createTrustRepo(adapter);

        await repo.set('a', 'always');
        await repo.set('a', 'ask');

        expect(await repo.get('a')).toBe('ask');
        expect(await adapter.get('trust', 'a')).toBeUndefined();
        expect(await repo.list()).toEqual([]);
    });

    it('rejects an invalid decision on write', async () => {
        const repo = createTrustRepo(createMemoryAdapter());
        await expect(repo.set('a', 'maybe' as TrustDecision)).rejects.toThrow(
            'trust: invalid decision',
        );
    });

    it('reads a malformed stored value as ask, heals it, and hides it from list', async () => {
        const adapter = createMemoryAdapter({ trust: { a: 'bogus', b: 'never' } });
        const repo = createTrustRepo(adapter);

        expect(await repo.get('a')).toBe('ask');
        // Self-healed: the malformed row is deleted so it is not re-read forever.
        expect(await adapter.get('trust', 'a')).toBeUndefined();
        expect(await repo.list()).toEqual([{ docId: 'b', decision: 'never' }]);
    });

    it('list returns only explicit always/never decisions', async () => {
        const repo = createTrustRepo(createMemoryAdapter());
        await repo.set('a', 'always');
        await repo.set('b', 'never');

        const records = await repo.list();
        expect(records).toHaveLength(2);
        expect(records).toEqual(
            expect.arrayContaining([
                { docId: 'a', decision: 'always' },
                { docId: 'b', decision: 'never' },
            ]),
        );
    });

    it('removes a single record and clears every record', async () => {
        const repo = createTrustRepo(createMemoryAdapter());
        await repo.set('a', 'always');
        await repo.set('b', 'never');

        await repo.remove('a');
        expect(await repo.get('a')).toBe('ask');
        expect(await repo.get('b')).toBe('never');

        await repo.clear();
        expect(await repo.list()).toEqual([]);
    });

    it('copy carries an explicit source decision to the new id', async () => {
        const repo = createTrustRepo(createMemoryAdapter());
        await repo.set('source', 'always');

        await repo.copy('source', 'duplicate');

        expect(await repo.get('duplicate')).toBe('always');
        expect(await repo.get('source')).toBe('always');
    });

    it('copy leaves the new id at ask when the source has no explicit record', async () => {
        const repo = createTrustRepo(createMemoryAdapter());
        expect(await repo.get('source')).toBe('ask');

        await repo.copy('source', 'duplicate');

        expect(await repo.get('duplicate')).toBe('ask');
    });

    it('copy ignores an explicit ask source and clears a stale new id', async () => {
        const repo = createTrustRepo(createMemoryAdapter());
        await repo.set('source', 'ask');
        await repo.set('duplicate', 'never');

        await repo.copy('source', 'duplicate');

        expect(await repo.get('duplicate')).toBe('ask');
    });

    it('copy is a no-op when source and new id are the same', async () => {
        const repo = createTrustRepo(createMemoryAdapter());
        await repo.set('doc', 'never');

        await repo.copy('doc', 'doc');

        expect(await repo.get('doc')).toBe('never');
    });
});

describe('normalizeTrustDecision', () => {
    it('passes known decisions and coerces everything else to ask', () => {
        expect(normalizeTrustDecision('always')).toBe('always');
        expect(normalizeTrustDecision('never')).toBe('never');
        expect(normalizeTrustDecision('ask')).toBe('ask');
        expect(normalizeTrustDecision(undefined)).toBe('ask');
        expect(normalizeTrustDecision('bogus')).toBe('ask');
        expect(normalizeTrustDecision(42)).toBe('ask');
    });
});
