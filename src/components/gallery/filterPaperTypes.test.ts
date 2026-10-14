import { describe, expect, it } from 'vitest';
import { mmToHm } from '../../core/hm';
import type { PaperRecord } from '../../data/paperRepo';
import { filterPaperTypes } from './PaperTypeSection';

/**
 * Pure search predicate — no DOM. Covers the two searchable fields (name and
 * dimensions) and the empty-query passthrough.
 */

const record = (id: string, name: string, wMm: number, hMm: number): PaperRecord => ({
    id,
    name,
    backingW: mmToHm(wMm),
    backingH: mmToHm(hMm),
    regions: [],
    guides: [],
});

const items: PaperRecord[] = [
    record('p1', 'F-tag spare 25×78', 25, 78),
    record('p2', 'Rounded 30×20', 30, 20),
    record('p3', 'Stacked', 50, 15),
];

const ids = (query: string): string[] => filterPaperTypes(items, query).map((item) => item.id);

describe('filterPaperTypes', () => {
    it('returns every item for an empty or whitespace query', () => {
        expect(ids('')).toEqual(['p1', 'p2', 'p3']);
        expect(ids('   ')).toEqual(['p1', 'p2', 'p3']);
    });

    it('matches the name case-insensitively', () => {
        expect(ids('f-tag')).toEqual(['p1']);
        expect(ids('F-TAG')).toEqual(['p1']);
        expect(ids('rounded')).toEqual(['p2']);
    });

    it('matches dimensions in both x and × notation, with or without mm', () => {
        expect(ids('25x78')).toEqual(['p1']);
        expect(ids('25×78')).toEqual(['p1']);
        expect(ids('25 × 78')).toEqual(['p1']);
        expect(ids('25x78mm')).toEqual(['p1']);
        expect(ids('30x20')).toEqual(['p2']);
    });

    it('matches a single dimension number and ignores surrounding whitespace', () => {
        expect(ids('78')).toEqual(['p1']);
        expect(ids('  50x15  ')).toEqual(['p3']);
    });

    it('returns nothing when neither name nor dimensions match', () => {
        expect(ids('nope-999')).toEqual([]);
    });
});
