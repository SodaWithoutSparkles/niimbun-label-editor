import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseCsvFile } from '../../data/csvImport';
import type { CsvRecord } from '../../data/csvRepo';
import { useStore } from '../../store/useStore';
import { confirm } from '../common/dialogs/dialogService';
import { CatalogueLayout, type CatalogueStatus } from './CatalogueLayout';
import { CsvCard } from './CsvCard';
import { CsvRenameDialog } from './CsvRenameDialog';
import { CsvViewDialog } from './CsvViewDialog';
import { useCatalogue } from './useCatalogue';
import { useOrphans } from './useOrphans';

/**
 * Gallery main pane for CSV tables (phase 9, W1b): a searchable card grid over
 * `csvRepo` with upload / view / rename / delete. It reuses the W1 shell
 * ({@link CatalogueLayout}) and the repo-agnostic {@link useCatalogue} hook, so
 * the paper-type and CSV sections read the same.
 *
 * Upload parses through the shared `parseCsvFile` (the same helper the editor's
 * `DataSourceTab` uses) — no parsing is reimplemented here. The record is stored
 * under a fresh id and its `name` is the import filename; the parse is storage-
 * free, so a read failure is surfaced as a notification rather than a crash.
 *
 * The search is a pure exported predicate ({@link filterCsvs}) so it is
 * unit-testable without a DOM.
 */

/**
 * Case-insensitive substring search over the table's **name** and its joined
 * **column names** (so a table can be found by one of its columns); an
 * empty/whitespace query returns every item.
 */
export const filterCsvs = (items: readonly CsvRecord[], query: string): CsvRecord[] => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [...items];
    return items.filter(
        (item) =>
            item.name.toLowerCase().includes(q) || item.columns.join(' ').toLowerCase().includes(q),
    );
};

/** `crypto.randomUUID` with a fallback for a DOM run without Web Crypto UUID. */
const mintCsvId = (): string => {
    const randomUUID = globalThis.crypto?.randomUUID;
    if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto);
    return `csv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const CsvSection: React.FC = () => {
    const { t } = useTranslation();
    const csvRepo = useStore((state) => state.csvRepo);
    const addNotification = useStore((state) => state.addNotification);
    const { items, loading, error, save, remove } = useCatalogue<CsvRecord>({
        repo: csvRepo,
        messages: {
            saveFailed: t('csvs.saveFailed'),
            deleteFailed: t('csvs.deleteFailed'),
        },
    });
    const orphans = useOrphans();

    const [query, setQuery] = useState('');
    const [viewing, setViewing] = useState<CsvRecord | null>(null);
    const [renaming, setRenaming] = useState<CsvRecord | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const visible = filterCsvs(items, query);
    // Only stored records still listed by the catalogue count: the badge and the
    // button must agree with what is on screen.
    const orphanIds = items.filter((item) => orphans.csvIds.has(item.id)).map((item) => item.id);

    const handleFile = async (file: File) => {
        try {
            const parsed = await parseCsvFile(file);
            // `save` notifies on a storage failure; nothing else to do here.
            await save({
                id: mintCsvId(),
                name: file.name,
                columns: parsed.columns,
                rows: parsed.rows,
            });
        } catch {
            addNotification({ type: 'error', message: t('csvs.uploadFailed') });
        }
    };

    const handleDelete = async (record: CsvRecord) => {
        const ok = await confirm({
            danger: true,
            message: t('csvs.deleteConfirm', { name: record.name }),
        });
        if (!ok) return;
        await remove(record.id);
    };

    /**
     * Delete every table no document references (W4). Confirmed once for the
     * whole batch; each `remove` notifies on failure (never silent), and the
     * sweep is reloaded so the badges/action reflect the new store.
     */
    const handleDeleteUnused = async () => {
        if (orphanIds.length === 0) return;
        const ok = await confirm({
            danger: true,
            message: t('csvs.deleteUnusedConfirm', { count: orphanIds.length }),
        });
        if (!ok) return;
        for (const id of orphanIds) {
            await remove(id);
        }
        await orphans.reload();
    };

    const handleRename = async (name: string): Promise<boolean> => {
        if (!renaming) return false;
        return save({ ...renaming, name });
    };

    const status: CatalogueStatus = loading
        ? { kind: 'loading', message: t('csvs.loading') }
        : error
          ? { kind: 'error', message: t('csvs.readError') }
          : items.length === 0
            ? { kind: 'empty', message: t('csvs.empty') }
            : visible.length === 0
              ? { kind: 'searchEmpty', message: t('csvs.searchEmpty', { query }) }
              : { kind: 'ready' };

    return (
        <CatalogueLayout
            title={t('csvs.title')}
            addLabel={t('csvs.upload')}
            onAdd={() => fileInputRef.current?.click()}
            search={{
                value: query,
                onChange: setQuery,
                placeholder: t('csvs.searchPlaceholder'),
            }}
            status={status}
            actions={
                orphans.error ? (
                    <span role="alert" className="text-xs text-red-400">
                        {t('csvs.orphanReadError')}
                    </span>
                ) : orphanIds.length > 0 ? (
                    <button
                        type="button"
                        onClick={() => {
                            void handleDeleteUnused();
                        }}
                        className="rounded border border-red-800 px-3 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/40"
                    >
                        {t('csvs.deleteUnused', { count: orphanIds.length })}
                    </button>
                ) : null
            }
            dialog={
                <>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        aria-label={t('csvs.upload')}
                        className="hidden"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            // Reset so picking the same file twice still fires `change`.
                            event.target.value = '';
                            if (file) void handleFile(file);
                        }}
                    />
                    <CsvViewDialog
                        open={viewing !== null}
                        record={viewing}
                        onClose={() => setViewing(null)}
                    />
                    <CsvRenameDialog
                        open={renaming !== null}
                        record={renaming}
                        onClose={() => setRenaming(null)}
                        onSave={handleRename}
                    />
                </>
            }
        >
            {visible.map((record) => (
                <CsvCard
                    key={record.id}
                    record={record}
                    isOrphan={orphans.csvIds.has(record.id)}
                    onView={() => setViewing(record)}
                    onRename={() => setRenaming(record)}
                    onDelete={() => {
                        void handleDelete(record);
                    }}
                />
            ))}
        </CatalogueLayout>
    );
};
