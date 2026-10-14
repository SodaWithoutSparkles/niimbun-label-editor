import { describe, expect, it } from 'vitest';
import type { ResourceRecord } from '../../data/resourceRepo';
import { filterMedia } from './MediaSection';

/**
 * Pure search predicate — no DOM. Covers the two searchable fields (name, with
 * an id fallback for a legacy record, and the media type) and the empty-query
 * passthrough.
 */

const record = (id: string, mediaType: string, name?: string): ResourceRecord => ({
    id,
    mediaType,
    bytes: new Uint8Array([1, 2, 3]),
    ...(name !== undefined ? { name } : {}),
});

const items: ResourceRecord[] = [
    record('r1', 'image/png', 'logo.png'),
    record('r2', 'font/ttf', 'Brand Sans'),
    record('r3', 'image/jpeg'), // legacy: no name → searchable by id
];

const ids = (query: string): string[] => filterMedia(items, query).map((item) => item.id);

describe('filterMedia', () => {
    it('returns every item for an empty or whitespace query', () => {
        expect(ids('')).toEqual(['r1', 'r2', 'r3']);
        expect(ids('   ')).toEqual(['r1', 'r2', 'r3']);
    });

    it('matches the name case-insensitively', () => {
        expect(ids('logo')).toEqual(['r1']);
        expect(ids('BRAND')).toEqual(['r2']);
    });

    it('falls back to the id when a legacy record has no name', () => {
        expect(ids('r3')).toEqual(['r3']);
    });

    it('matches the media type', () => {
        expect(ids('font/ttf')).toEqual(['r2']);
        expect(ids('image/')).toEqual(['r1', 'r3']);
    });

    it('ignores surrounding whitespace and returns nothing for a miss', () => {
        expect(ids('  logo.png  ')).toEqual(['r1']);
        expect(ids('nope-999')).toEqual([]);
    });
});
