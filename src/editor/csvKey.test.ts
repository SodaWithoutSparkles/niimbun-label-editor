import { describe, expect, it } from 'vitest';
import type { CsvRecord } from '../data/csvRepo';
import { findCsvRow, singleRowCsv } from './csvKey';

/**
 * P6b — the preset fill dialog's exact key lookup and single-row override.
 * Pure helpers: no React, no storage.
 */

const table = (): CsvRecord => ({
    id: 'csv-1',
    name: 'items.csv',
    columns: ['sku', 'name'],
    rows: [
        [' 23 ', 'Widget'],
        ['23', 'Duplicate'],
        ['', 'No sku'],
    ],
});

describe('findCsvRow', () => {
    it('matches the first row with an exact, trimmed cell value', () => {
        expect(findCsvRow(table(), 'sku', ' 23 ')).toBe(0);
        expect(findCsvRow(table(), 'sku', '23')).toBe(0);
    });

    it('returns the first row when duplicate keys exist', () => {
        expect(findCsvRow(table(), 'sku', '23')).toBe(0);
    });

    it('returns -1 for an unknown column', () => {
        expect(findCsvRow(table(), 'missing', '23')).toBe(-1);
    });

    it('returns -1 for a blank key or a blank column', () => {
        expect(findCsvRow(table(), 'sku', '')).toBe(-1);
        expect(findCsvRow(table(), 'sku', '   ')).toBe(-1);
        expect(findCsvRow(table(), '', '23')).toBe(-1);
    });

    it('never matches a blank cell with a blank key', () => {
        const csv = table();
        expect(csv.rows[2]![0]).toBe('');
        expect(findCsvRow(csv, 'sku', '')).toBe(-1);
    });

    it('is a first-match scan that does not mutate the table', () => {
        const csv = table();
        findCsvRow(csv, 'sku', '23');
        expect(csv.rows).toHaveLength(3);
        expect(csv.rows[0]).toEqual([' 23 ', 'Widget']);
    });
});

describe('singleRowCsv', () => {
    it('copies the chosen row while keeping the table identity fields', () => {
        const csv = table();
        const single = singleRowCsv(csv, 1);

        expect(single.id).toBe('csv-1');
        expect(single.name).toBe('items.csv');
        expect(single.columns).toEqual(['sku', 'name']);
        expect(single.rows).toEqual([['23', 'Duplicate']]);
        expect(single).not.toBe(csv);
        expect(single.rows).not.toBe(csv.rows);
        expect(single.rows[0]).not.toBe(csv.rows[1]);
    });

    it('returns one all-empty row for -1 and out-of-range indices', () => {
        const csv = table();
        expect(singleRowCsv(csv, -1).rows).toEqual([['', '']]);
        expect(singleRowCsv(csv, 99).rows).toEqual([['', '']]);
    });

    it('never mutates the input table', () => {
        const csv = table();
        const before = structuredClone(csv);

        singleRowCsv(csv, 0);
        singleRowCsv(csv, -1);

        expect(csv).toEqual(before);
        expect(csv.rows).toHaveLength(3);
    });
});
