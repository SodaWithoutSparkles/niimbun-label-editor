import type { BulkError, BulkResult, StorageAdapter } from './db';
import { errorMessage, isRecord, isStringArray } from './guards';

/**
 * `csvs` repo — parsed table data stored as `{ id, name, columns, rows }`.
 *
 * Storage only (plan P2). CSV parsing, the ~50k-row warning, and name policy
 * (`name` = original import filename) are P6/P8. The document-level
 * `CsvRef.name` is a separate, user-editable display name.
 */

export interface CsvRecord {
    id: string;
    name: string;
    columns: string[];
    rows: string[][];
}

export interface CsvRepo {
    get(id: string): Promise<CsvRecord | null>;
    has(id: string): Promise<boolean>;
    list(): Promise<CsvRecord[]>;
    put(record: CsvRecord): Promise<void>;
    remove(id: string): Promise<void>;
    saveAll(records: CsvRecord[]): Promise<BulkResult>;
    clear(): Promise<void>;
}

export const isCsvRecord = (value: unknown): value is CsvRecord =>
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    isStringArray(value.columns) &&
    Array.isArray(value.rows) &&
    value.rows.every(isStringArray);

/**
 * Copy a stored CSV table under a fresh id ("import by clone", phase 9 W3). The
 * id is supplied by the caller so this stays a pure, storage-free helper; the
 * columns/rows are shared by reference (records are treated as immutable once
 * stored).
 */
export const cloneCsvRecord = (record: CsvRecord, id: string): CsvRecord => ({
    ...record,
    id,
});

/**
 * Cheap shape check for reads: verifies the container but not every row.
 * `isCsvRecord`'s per-row scan is O(rows) and must not run on every `get`/`list`
 * of a large table; the full check runs on `put` (the write boundary).
 */
const isCsvRecordShape = (value: unknown): value is CsvRecord =>
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    isStringArray(value.columns) &&
    Array.isArray(value.rows);

export const createCsvRepo = (adapter: StorageAdapter): CsvRepo => {
    const repo: CsvRepo = {
        async get(id) {
            const value = await adapter.get('csvs', id);
            return isCsvRecordShape(value) ? value : null;
        },

        async has(id) {
            return (await adapter.get('csvs', id)) !== undefined;
        },

        async list() {
            const values = await adapter.getAll('csvs');
            return values.filter(isCsvRecordShape);
        },

        async put(record) {
            if (!isCsvRecord(record)) {
                throw new Error('csvs: invalid csv record');
            }
            await adapter.put('csvs', record.id, record);
        },

        remove: (id) => adapter.delete('csvs', id),

        async saveAll(records) {
            const ok: string[] = [];
            const errors: BulkError[] = [];
            for (const record of records) {
                const id = isRecord(record) && typeof record.id === 'string' ? record.id : '';
                try {
                    await repo.put(record);
                    ok.push(record.id);
                } catch (error) {
                    errors.push({ id, error: errorMessage(error) });
                }
            }
            return { ok, errors };
        },

        clear: () => adapter.clear('csvs'),
    };

    return repo;
};
