import type { BulkError, BulkResult, StorageAdapter } from './db';
import { errorMessage, isRecord } from './guards';

/**
 * `resources` repo — font/image binaries stored as `{ id, mediaType, bytes }`.
 *
 * Storage only (plan P2): import/export policy, fingerprinting, and asset UI
 * are P8/P5. Keys are the `AssetRef.local.resourceId`.
 */

export interface ResourceRecord {
    id: string;
    mediaType: string;
    bytes: Uint8Array;
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
    value.bytes instanceof Uint8Array;

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
