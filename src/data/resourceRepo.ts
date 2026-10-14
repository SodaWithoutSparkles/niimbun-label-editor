import type { BulkError, BulkResult, StorageAdapter } from './db';
import { errorMessage, isRecord } from './guards';

/**
 * `resources` repo — font/image binaries stored as `{ id, mediaType, bytes }`.
 *
 * Storage only (plan P2): import/export policy, fingerprinting, and asset UI
 * are P8/P5. Keys are the `AssetRef.local.resourceId`.
 *
 * Phase 9 (W2, decision D2) adds **optional** display metadata so the media
 * gallery can render a name/dimensions without decoding the bytes. These are
 * additive and never required: a legacy record (`{id,mediaType,bytes}`) still
 * validates, and the UI falls back to the id + a type icon.
 */

export interface ResourceRecord {
    id: string;
    mediaType: string;
    bytes: Uint8Array;
    /** Display name (source filename / font family). Optional for legacy rows. */
    name?: string;
    /** Natural pixel width — images only; absent for fonts/legacy rows. */
    widthPx?: number;
    /** Natural pixel height — images only; absent for fonts/legacy rows. */
    heightPx?: number;
}

export interface ResourceRepo {
    get(id: string): Promise<ResourceRecord | null>;
    has(id: string): Promise<boolean>;
    list(): Promise<ResourceRecord[]>;
    put(record: ResourceRecord): Promise<void>;
    remove(id: string): Promise<void>;
    saveAll(records: ResourceRecord[]): Promise<BulkResult>;
    clear(): Promise<void>;
}

export const isResourceRecord = (value: unknown): value is ResourceRecord =>
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.mediaType === 'string' &&
    value.bytes instanceof Uint8Array &&
    // Optional metadata (D2): accepted when present, never required — a legacy
    // record without any of these still validates.
    (value.name === undefined || typeof value.name === 'string') &&
    (value.widthPx === undefined || typeof value.widthPx === 'number') &&
    (value.heightPx === undefined || typeof value.heightPx === 'number');

export const createResourceRepo = (adapter: StorageAdapter): ResourceRepo => {
    const repo: ResourceRepo = {
        async get(id) {
            const value = await adapter.get('resources', id);
            return isResourceRecord(value) ? value : null;
        },

        async has(id) {
            return (await adapter.get('resources', id)) !== undefined;
        },

        async list() {
            const values = await adapter.getAll('resources');
            return values.filter(isResourceRecord);
        },

        async put(record) {
            if (!isResourceRecord(record)) {
                throw new Error('resources: invalid resource record');
            }
            await adapter.put('resources', record.id, record);
        },

        remove: (id) => adapter.delete('resources', id),

        async saveAll(records) {
            const ok: string[] = [];
            const errors: BulkError[] = [];
            for (const record of records) {
                const id =
                    isRecord(record) && typeof record.id === 'string' ? record.id : '';
                try {
                    await repo.put(record);
                    ok.push(record.id);
                } catch (error) {
                    errors.push({ id, error: errorMessage(error) });
                }
            }
            return { ok, errors };
        },

        clear: () => adapter.clear('resources'),
    };

    return repo;
};
