import i18next from 'i18next';
import { parseDoc, serializeDoc } from '../core/doc/serialize';
import type { LabelDoc } from '../core/doc/types';
import type { BulkError, BulkResult, StorageAdapter } from './db';
import { errorMessage, isRecord } from './guards';
import { createThumbRepo, type ThumbRepo } from './thumbRepo';

/**
 * `labels` repo — gzip'd `LabelDoc` records plus a denormalized size cache.
 *
 * Record shape: `{ meta, docGz: Uint8Array, backingW, backingH }`. The
 * `backingW`/`backingH` fields are an additive deviation from the plan's
 * `{ meta, docGz }`: they are a cache so `list()` can build gallery cards
 * without decompressing every document. They mirror `doc.label.backingW/H`.
 *
 * Rules honoured here:
 *   - `get()` never throws: a corrupt `docGz` yields `null` (never a blank doc),
 *   - `list()` never blanks the gallery: bad records are skipped and reported
 *     through `listDetailed()`,
 *   - writes are per-record `put` (see `saveAll` for batched, error-collecting
 *     saves) — never delete-all-then-rewrite,
 *   - card art resolves local `thumbs` → `meta.thumb` → undefined.
 */

export interface LabelSummary {
    id: string;
    name: string;
    createdAt: number; // epoch seconds
    updatedAt: number; // epoch seconds
    backingW: number; // hm
    backingH: number; // hm
    thumb?: string; // data URL; resolve order: thumbs store → meta.thumb → undefined
}

export interface LabelRecord {
    meta: LabelDoc['meta'];
    docGz: Uint8Array;
    backingW: number;
    backingH: number;
}

export interface ListResult {
    ok: LabelSummary[];
    errors: BulkError[];
}

export interface LabelRepo {
    list(): Promise<LabelSummary[]>;
    get(id: string): Promise<LabelDoc | null>;
    save(doc: LabelDoc): Promise<void>;
    saveAll(docs: LabelDoc[]): Promise<BulkResult>;
    remove(id: string): Promise<void>;
    putThumb(id: string, thumb: Blob): Promise<void>;
    getThumb(id: string): Promise<Blob | null>;
    removeThumb(id: string): Promise<void>;
    listDetailed(): Promise<ListResult>;
}

const isLabelRecord = (value: unknown): value is LabelRecord => {
    if (!isRecord(value)) return false;
    if (!isRecord(value.meta)) return false;
    if (typeof value.meta.id !== 'string' || value.meta.id.length === 0) return false;
    if (!(value.docGz instanceof Uint8Array)) return false;
    if (typeof value.backingW !== 'number' || typeof value.backingH !== 'number') return false;
    return true;
};

const epochSeconds = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;

const recordId = (record: unknown): string =>
    isRecord(record) && isRecord(record.meta) && typeof record.meta.id === 'string'
        ? record.meta.id
        : '';

const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return btoa(binary);
};

const blobToDataUrl = async (blob: Blob): Promise<string> => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mediaType = blob.type && blob.type.length > 0 ? blob.type : 'application/octet-stream';
    return `data:${mediaType};base64,${bytesToBase64(bytes)}`;
};

const resolveThumb = async (thumbs: ThumbRepo, meta: LabelDoc['meta']): Promise<string | undefined> => {
    try {
        const blob = await thumbs.get(meta.id);
        if (blob) return await blobToDataUrl(blob);
    } catch {
        // Fall through to the in-document thumb; a broken thumb store must not
        // hide the label.
    }
    const dataUrl = meta.thumb?.dataUrl;
    return typeof dataUrl === 'string' && dataUrl.length > 0 ? dataUrl : undefined;
};

export const createLabelRepo = (adapter: StorageAdapter): LabelRepo => {
    const thumbs = createThumbRepo(adapter);

    const toSummary = async (record: unknown): Promise<LabelSummary | undefined> => {
        if (!isLabelRecord(record)) return undefined;
        const thumb = await resolveThumb(thumbs, record.meta);
        return {
            id: record.meta.id,
            name: typeof record.meta.name === 'string' ? record.meta.name : '',
            createdAt: epochSeconds(record.meta.createdAt),
            updatedAt: epochSeconds(record.meta.updatedAt),
            backingW: record.backingW,
            backingH: record.backingH,
            ...(thumb ? { thumb } : {}),
        };
    };

    const repo: LabelRepo = {
        async list() {
            const result = await repo.listDetailed();
            return result.ok;
        },

        async listDetailed() {
            let records: unknown[];
            try {
                records = await adapter.getAll('labels');
            } catch (error) {
                return { ok: [], errors: [{ id: '', error: errorMessage(error) }] };
            }

            const ok: LabelSummary[] = [];
            const errors: BulkError[] = [];
            for (const record of records) {
                const summary = await toSummary(record);
                if (summary) ok.push(summary);
                else errors.push({ id: recordId(record), error: i18next.t('errors.invalidStoredRecord') });
            }
            // Newest first (epoch seconds).
            ok.sort((a, b) => b.updatedAt - a.updatedAt);
            return { ok, errors };
        },

        async get(id) {
            try {
                const record = await adapter.get('labels', id);
                if (!isLabelRecord(record)) return null;
                const parsed = await parseDoc(record.docGz);
                return parsed.ok ? parsed.doc : null;
            } catch {
                // Never throw (and never reset to a blank doc) from a read path.
                return null;
            }
        },

        async save(doc) {
            const docGz = new Uint8Array(await serializeDoc(doc));
            const record: LabelRecord = {
                // Deep-copy `meta`: a live reference would (a) let a post-save
                // mutation of `doc.meta` silently mutate the stored record in
                // adapters that don't clone (the in-memory test adapter) while
                // real IndexedDB structured-clones it, and (b) make `meta.thumb`
                // auto-updates on a later save invisible. `structuredClone` also
                // preserves the thumb's shape for the real structured clone.
                meta: structuredClone(doc.meta),
                docGz,
                backingW: doc.label.backingW,
                backingH: doc.label.backingH,
            };
            await adapter.put('labels', doc.meta.id, record);
        },

        async saveAll(docs) {
            const ok: string[] = [];
            const errors: BulkError[] = [];
            for (const doc of docs) {
                const id = isRecord(doc) && isRecord(doc.meta) && typeof doc.meta.id === 'string'
                    ? doc.meta.id
                    : '';
                try {
                    await repo.save(doc);
                    ok.push(doc.meta.id);
                } catch (error) {
                    errors.push({ id, error: errorMessage(error) });
                }
            }
            return { ok, errors };
        },

        async remove(id) {
            await adapter.delete('labels', id);
            await thumbs.remove(id);
        },

        putThumb: (id, thumb) => thumbs.put(id, thumb),
        getThumb: (id) => thumbs.get(id),
        removeThumb: (id) => thumbs.remove(id),
    };

    return repo;
};
