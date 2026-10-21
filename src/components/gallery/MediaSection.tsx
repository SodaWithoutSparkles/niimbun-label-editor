import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResourceRecord } from '../../data/resourceRepo';
import { useStore } from '../../store/useStore';
import { confirm } from '../common/dialogs/dialogService';
import { CatalogueLayout, type CatalogueStatus } from './CatalogueLayout';
import { MediaCard } from './MediaCard';
import { MediaRenameDialog } from './MediaRenameDialog';
import { useCatalogue } from './useCatalogue';
import { useOrphans } from './useOrphans';

/**
 * Gallery main pane for media (phase 9, W2): a searchable card grid over
 * `resourceRepo` with upload / preview / rename / delete. It reuses the W1 shell
 * ({@link CatalogueLayout}) and the repo-agnostic {@link useCatalogue} hook, so
 * the paper-type, CSV and media sections read the same.
 *
 * Upload reads the picked file's bytes and stores a `ResourceRecord` whose
 * `mediaType` is the file's MIME and whose `name` is the filename. The bytes are
 * stored as-is; the tile derives a preview (object URL) and legacy records with
 * no metadata still render (name falls back to the id, a type icon stands in).
 *
 * The search is a pure exported predicate ({@link filterMedia}) so it is
 * unit-testable without a DOM.
 */

/**
 * Case-insensitive substring search over the resource's **name** (falling back
 * to the id for a legacy record) **or** its **mediaType**; an empty/whitespace
 * query returns every item.
 */
export const filterMedia = (
    items: readonly ResourceRecord[],
    query: string,
): ResourceRecord[] => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [...items];
    return items.filter(
        (item) =>
            (item.name ?? item.id).toLowerCase().includes(q) ||
            item.mediaType.toLowerCase().includes(q),
    );
};

/** `crypto.randomUUID` with a fallback for a DOM run without Web Crypto UUID. */
const mintMediaId = (): string => {
    const randomUUID = globalThis.crypto?.randomUUID;
    if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto);
    return `media-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const MediaSection: React.FC = () => {
    const { t } = useTranslation();
    const resourceRepo = useStore((state) => state.resourceRepo);
    const addNotification = useStore((state) => state.addNotification);
    const { items, loading, error, save, remove } = useCatalogue<ResourceRecord>({
        repo: resourceRepo,
        messages: {
            saveFailed: t('media.saveFailed'),
            deleteFailed: t('media.deleteFailed'),
        },
    });
    const orphans = useOrphans();

    const [query, setQuery] = useState('');
    const [renaming, setRenaming] = useState<ResourceRecord | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const visible = filterMedia(items, query);
    // Only stored records still listed by the catalogue count: the badge and the
    // button must agree with what is on screen.
    const orphanIds = items.filter((item) => orphans.resourceIds.has(item.id)).map((item) => item.id);

    const handleFile = async (file: File) => {
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            // `save` notifies on a storage failure; nothing else to do here.
            await save({
                id: mintMediaId(),
                mediaType: file.type || 'application/octet-stream',
                name: file.name,
                bytes,
            });
        } catch {
            addNotification({ type: 'error', message: t('media.uploadFailed') });
        }
    };

    const handleDelete = async (record: ResourceRecord) => {
        const ok = await confirm({
            danger: true,
            message: t('media.deleteConfirm', { name: record.name ?? record.id }),
        });
        if (!ok) return;
        await remove(record.id);
    };

    /**
     * Delete every media record no document references (W4, hardened in the
     * 2026-10-22 storage-safety run). Confirmed once for the whole batch; after
     * the confirm the sweep is re-run and only the ids that are **still**
     * orphans in that fresh, complete inventory are removed. A stale or
     * unprovable inventory deletes nothing.
     */
    const handleDeleteUnused = async () => {
        if (orphanIds.length === 0) return;
        const shown = orphanIds;
        const ok = await confirm({
            danger: true,
            message: t('media.deleteUnusedConfirm', { count: shown.length }),
        });
        if (!ok) return;
        const fresh = await orphans.reload();
        if (!fresh || !fresh.complete) {
            addNotification({ type: 'error', message: t('media.orphanReadError') });
            return;
        }
        const deletable = shown.filter((id) => fresh.resourceIds.has(id));
        for (const id of deletable) {
            await remove(id);
        }
    };

    const handleRename = async (name: string): Promise<boolean> => {
        if (!renaming) return false;
        return save({ ...renaming, name });
    };

    const status: CatalogueStatus = loading
        ? { kind: 'loading', message: t('media.loading') }
        : error
          ? { kind: 'error', message: t('media.readError') }
          : items.length === 0
            ? { kind: 'empty', message: t('media.empty') }
            : visible.length === 0
              ? { kind: 'searchEmpty', message: t('media.searchEmpty', { query }) }
              : { kind: 'ready' };

    return (
        <CatalogueLayout
            title={t('media.title')}
            addLabel={t('media.upload')}
            onAdd={() => fileInputRef.current?.click()}
            search={{
                value: query,
                onChange: setQuery,
                placeholder: t('media.searchPlaceholder'),
            }}
            status={status}
            actions={
                !orphans.complete ? (
                    <span role="alert" className="text-xs text-red-400">
                        {t('media.orphanReadError')}
                    </span>
                ) : orphanIds.length > 0 ? (
                    <button
                        type="button"
                        onClick={() => {
                            void handleDeleteUnused();
                        }}
                        className="rounded border border-red-800 px-3 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/40"
                    >
                        {t('media.deleteUnused', { count: orphanIds.length })}
                    </button>
                ) : null
            }
            dialog={
                <>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,font/*,.ttf,.otf,.woff,.woff2"
                        aria-label={t('media.upload')}
                        className="hidden"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            // Reset so picking the same file twice still fires `change`.
                            event.target.value = '';
                            if (file) void handleFile(file);
                        }}
                    />
                    <MediaRenameDialog
                        open={renaming !== null}
                        record={renaming}
                        onClose={() => setRenaming(null)}
                        onSave={handleRename}
                    />
                </>
            }
        >
            {visible.map((record) => (
                <MediaCard
                    key={record.id}
                    record={record}
                    isOrphan={orphans.resourceIds.has(record.id)}
                    onRename={() => setRenaming(record)}
                    onDelete={() => {
                        void handleDelete(record);
                    }}
                />
            ))}
        </CatalogueLayout>
    );
};
