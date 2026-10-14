import { describe, expect, it } from 'vitest';
import type { CsvRecord } from '../../data/csvRepo';
import { filterCsvs } from './CsvSection';

/**
 * Pure search predicate — no DOM. Covers the two searchable fields (name and
 * the joined column names) and the empty-query passthrough.
 */

const record = (id: string, name: string, columns: string[]): CsvRecord => ({
    id,
    name,
    columns,
    rows: [],
});

const items: CsvRecord[] = [
    record('c1', 'Products', ['sku', 'qty']),
    record('c2', 'Customers', ['name', 'email']),
    record('c3', 'Orders', ['order_id', 'total']),
];

const ids = (query: string): string[] => filterCsvs(items, query).map((item) => item.id);

describe('filterCsvs', () => {
    it('returns every item for an empty or whitespace query', () => {
        expect(ids('')).toEqual(['c1', 'c2', 'c3']);
        expect(ids('   ')).toEqual(['c1', 'c2', 'c3']);
    });

    it('matches the name case-insensitively', () => {
        expect(ids('products')).toEqual(['c1']);
        expect(ids('ORDERS')).toEqual(['c3']);
    });

    it('matches a column name, so a table is findable by one of its columns', () => {
        expect(ids('email')).toEqual(['c2']);
        expect(ids('TOTAL')).toEqual(['c3']);
    });

    it('ignores surrounding whitespace', () => {
        expect(ids('  customers  ')).toEqual(['c2']);
    });

    it('returns nothing when neither the name nor the columns match', () => {
        expect(ids('nope-999')).toEqual([]);
    });
});
