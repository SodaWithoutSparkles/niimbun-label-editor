import { isGuide, isRegion } from '../core/doc/validate';
import type { Guide, Region } from '../core/doc/types';
import type { hm } from '../core/hm';
import type { BulkError, BulkResult, StorageAdapter } from './db';
import { errorMessage, isRecord } from './guards';

/**
 * `papers` repo — user-authored paper types stored as
 * `{ id, name, backingW, backingH, regions, guides }`.
 *
 * Pure data (plan P8): unlike `resourceRepo` there is no binary payload, and
 * unlike `csvRepo` the record itself is label geometry — a backing size, the
 * printable region set and the non-printing guide set. Storage only.
 */

export interface PaperRecord {
    id: string;
    name: string;
    backingW: hm;
    backingH: hm;
    regions: Region[];
    guides: Guide[];
}

export interface PaperRepo {
    get(id: string): Promise<PaperRecord | null>;
    has(id: string): Promise<boolean>;
    list(): Promise<PaperRecord[]>;
    put(record: PaperRecord): Promise<void>;
    remove(id: string): Promise<void>;
    saveAll(records: PaperRecord[]): Promise<BulkResult>;
    clear(): Promise<void>;
}

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

/**
 * Guide check for the write boundary. Delegates to `validate.ts`'s `isGuide`
 * (rather than a local copy) so a stored record can never yield a doc that
 * fails `isLabelDoc` — in particular an empty/blank guide `id` is rejected, as
 * the validator requires.
 */
export const isPaperRecord = (value: unknown): value is PaperRecord =>
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    isFiniteNumber(value.backingW) &&
    isFiniteNumber(value.backingH) &&
    Array.isArray(value.regions) &&
    value.regions.every((region) => isRegion(region) !== undefined) &&
    Array.isArray(value.guides) &&
    value.guides.every((guide) => isGuide(guide) !== undefined);

/**
 * Cheap shape check for reads: verifies the container but not every region or
 * guide. `isPaperRecord`'s element scan is O(regions + guides) and must not run
 * on every `get`/`list`; the full check runs on `put` (the write boundary).
 */
const isPaperRecordShape = (value: unknown): value is PaperRecord =>
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    isFiniteNumber(value.backingW) &&
    isFiniteNumber(value.backingH) &&
    Array.isArray(value.regions) &&
    Array.isArray(value.guides);

export const createPaperRepo = (adapter: StorageAdapter): PaperRepo => {
    const repo: PaperRepo = {
        async get(id) {
            const value = await adapter.get('papers', id);
            return isPaperRecordShape(value) ? value : null;
        },

        async has(id) {
            return (await adapter.get('papers', id)) !== undefined;
        },

        async list() {
            const values = await adapter.getAll('papers');
            return values.filter(isPaperRecordShape);
        },

        async put(record) {
            if (!isPaperRecord(record)) {
                throw new Error('papers: invalid paper record');
            }
            await adapter.put('papers', record.id, record);
        },

        remove: (id) => adapter.delete('papers', id),

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

        clear: () => adapter.clear('papers'),
    };

    return repo;
};
