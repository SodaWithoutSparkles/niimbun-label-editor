import type { CsvRecord } from '../data/csvRepo';

/**
 * CSV key lookup for the preset fill dialog (P6b).
 *
 * The dialog chooses one record by an exact, trimmed cell match and hands the
 * print seam a **single-row table**, so the preview and the printed page come
 * from the same record. Nothing here is fuzzy, multi-row or stateful.
 */

/**
 * First row whose cell in `column` equals `key.trim()` after trimming the cell.
 *
 * Returns `-1` for a blank key, a blank/unknown column or no match. A blank
 * cell therefore never matches a blank key; duplicates match the first row.
 */
export const findCsvRow = (csv: CsvRecord, column: string, key: string): number => {
    const needle = key.trim();
    if (needle.length === 0 || column.length === 0) return -1;
    const columnIndex = csv.columns.indexOf(column);
    if (columnIndex < 0) return -1;
    return csv.rows.findIndex((row) => (row[columnIndex] ?? '').trim() === needle);
};

/**
 * A copy of `csv` holding exactly one row: `rowIndex` when it exists, otherwise
 * one all-empty row with the real columns. `-1` and out-of-range indices are the
 * explicit "no key match" fallback.
 *
 * Pure: neither the record, its columns nor its rows are mutated.
 */
export const singleRowCsv = (csv: CsvRecord, rowIndex: number): CsvRecord => {
    const row = rowIndex >= 0 ? csv.rows[rowIndex] : undefined;
    return {
        ...csv,
        columns: [...csv.columns],
        rows: [row === undefined ? csv.columns.map(() => '') : [...row]],
    };
};
