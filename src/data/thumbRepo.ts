import type { StorageAdapter } from './db';
import { isBlob } from './guards';

/**
 * Raw CRUD over the `thumbs` store (values are raster `Blob`s keyed by
 * `labelId`). `labelRepo` uses this for the card-art resolve order; keeping it
 * separate means the thumbnail cache can be cleared/regenerated without
 * touching label records.
 */

export interface ThumbRepo {
    put(id: string, blob: Blob): Promise<void>;
    get(id: string): Promise<Blob | null>;
    remove(id: string): Promise<void>;
    keys(): Promise<string[]>;
    clear(): Promise<void>;
}

export const createThumbRepo = (adapter: StorageAdapter): ThumbRepo => ({
    put: (id, blob) => adapter.put('thumbs', id, blob),
    async get(id) {
        const value = await adapter.get('thumbs', id);
        return isBlob(value) ? value : null;
    },
    remove: (id) => adapter.delete('thumbs', id),
    keys: () => adapter.keys('thumbs'),
    clear: () => adapter.clear('thumbs'),
});
