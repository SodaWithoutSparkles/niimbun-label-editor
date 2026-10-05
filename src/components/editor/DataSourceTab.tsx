import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useStore } from '../../store/useStore';
import { newLabelId } from '../../core/doc/factory';
import { parseCsvFile, type CsvWarning } from '../../data/csvImport';
import type { CsvRecord } from '../../data/csvRepo';
import type { LabelDoc } from '../../core/doc/types';
import { CsvPreviewTable } from './CsvPreviewTable';
import { Select, SettingRow } from '../common/forms';

/**
 * MFP → Data source tab (ui-spec.md §8, P6 W6).
 *
 * Attaches a CSV to the open document, shows the attached table's columns and
 * rows, and picks the sample row the editor renders/executes. The table bytes
 * are stored through the store's `csvRepo` (shared adapter, mirroring
 * `resourceRepo`); the document only carries a `local` `CsvRef` built by the
 * undoable `setDocCsv` action.
 *
 * Static sources stay as-is: attaching a CSV never rewrites node content. The
 * sample-row choice drives the `useSampleRow` resolve pipeline in the preview.
 */

interface DataSourceTabProps {
    /** Open document, supplied by `MfpPanel` (mirrors `ObjectTab`). */
    doc: LabelDoc;
}

/** Localized message for a parse warning (the data layer emits `kind` only). */
const WARNING_KEYS = {
    'rows-capped': 'editor.mfp.csvRowsCapped',
    empty: 'editor.mfp.csvEmpty',
    'parse-error': 'editor.mfp.csvParseError',
} as const;

const warningMessage = (warning: CsvWarning, t: TFunction): string => {
    if (warning.kind === 'rows-capped') {
        return t(WARNING_KEYS['rows-capped'], { cap: warning.cap, total: warning.total });
    }
    if (warning.kind === 'empty') return t(WARNING_KEYS.empty);
    return t(WARNING_KEYS['parse-error']);
};

export const DataSourceTab: React.FC<DataSourceTabProps> = ({ doc }) => {
    const { t } = useTranslation();
    const csvRepo = useStore((state) => state.csvRepo);
    const attachCsv = useStore((state) => state.attachCsv);
    const setDocCsv = useStore((state) => state.setDocCsv);
    const setSampleRowIndex = useStore((state) => state.setSampleRowIndex);
    const fileInputRef = useRef<HTMLInputElement>(null);
    // In-flight guard for `handleFile`. A ref, not the `attaching` render value:
    // two file picks dispatched before the re-render both read `attaching ===
    // false` and would attach twice.
    const attachingRef = useRef(false);

    const [record, setRecord] = useState<CsvRecord | null>(null);
    const [loading, setLoading] = useState(false);
    const [attaching, setAttaching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [warnings, setWarnings] = useState<CsvWarning[]>([]);

    const csvId = doc.data.csv?.csvId;
    const rowIndex = doc.data.sampleRowIndex;
    const docId = doc.meta.id;

    // Guard async work that outlives the mount / the open document: a parse or
    // `put` that settles after an unmount or a doc switch must not attach to, or
    // setState on, the wrong doc.
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);
    const docIdRef = useRef(docId);
    docIdRef.current = docId;

    // Load the attached table whenever the ref changes. A read failure leaves
    // the table empty rather than breaking the panel.
    useEffect(() => {
        if (!csvRepo || csvId === undefined) {
            setRecord(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        csvRepo
            .get(csvId)
            .then((next) => {
                if (!cancelled) setRecord(next);
            })
            .catch(() => {
                if (!cancelled) setRecord(null);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [csvRepo, csvId]);

    const handleFile = async (file: File) => {
        if (!csvRepo) {
            setError(t('editor.mfp.csvNeedsStorage'));
            return;
        }
        // Block a second attach while one is in flight (double file dialog). The
        // ref makes the guard synchronous, so a second pick before re-render is
        // rejected too.
        if (attachingRef.current) return;
        const originDocId = docIdRef.current;
        attachingRef.current = true;
        setAttaching(true);
        setError(null);
        setWarnings([]);
        try {
            const parsed = await parseCsvFile(file);
            const nextId = newLabelId();
            const nextRecord: CsvRecord = {
                id: nextId,
                name: file.name,
                columns: parsed.columns,
                rows: parsed.rows,
            };
            await csvRepo.put(nextRecord);
            // The doc may have been switched/closed while parsing: never attach to
            // the wrong doc. The just-stored record is left for the orphan sweep
            // (see below) rather than deleted on the write path.
            if (!mountedRef.current || docIdRef.current !== originDocId) return;
            // One undo entry: attach + reset the sample row. The previous table is
            // intentionally NOT deleted here. The `csvs` store is not part of undo,
            // so deleting the bytes on replace would leave `Ctrl+Z` restoring a
            // `data.csv` ref that points at nothing (panel loses its columns and
            // the status bar reads `Row: 0`). Orphaned records are reclaimed by a
            // later cleanup pass, not the write path.
            attachCsv({ csvId: nextId, name: file.name });
            setWarnings(parsed.warnings);
        } catch {
            if (mountedRef.current && docIdRef.current === originDocId) {
                setError(t('editor.mfp.csvStoreFailed'));
            }
        } finally {
            attachingRef.current = false;
            if (mountedRef.current) setAttaching(false);
        }
    };

    const handleDetach = () => {
        setError(null);
        setWarnings([]);
        // Clearing the ref is undoable; the stored bytes are intentionally kept so
        // an undo can restore the attachment. The orphan sweep reclaims them later
        // (the `csvs` store is not part of undo).
        setDocCsv(null);
    };

    const rowCount = record?.rows.length ?? 0;
    const columns = record?.columns ?? [];

    return (
        <div className="space-y-3 p-3 text-sm">
            <SettingRow label={t('editor.mfp.csvAttach')}>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
                    >
                        {t('editor.mfp.csvChoose')}
                    </button>
                    {csvId !== undefined && (
                        <button
                            type="button"
                            onClick={handleDetach}
                            className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
                        >
                            {t('editor.mfp.csvDetach')}
                        </button>
                    )}
                </div>
            </SettingRow>

            {csvId !== undefined && (
                <p className="text-xs text-gray-400">
                    {/* Suppress the row count until the table has actually loaded:
                        during the load window the stale/zero count would read as
                        "name — 0 rows" beside the loading hint. */}
                    {!loading && record
                        ? t('editor.mfp.csvAttached', { name: doc.data.csv?.name ?? '', count: rowCount })
                        : (doc.data.csv?.name ?? '')}
                </p>
            )}

            {attaching && <p className="text-xs text-gray-500">{t('editor.mfp.csvParsing')}</p>}

            {loading && <p className="text-xs text-gray-500">{t('editor.mfp.csvLoading')}</p>}

            {error && <p className="text-xs text-red-400">{error}</p>}

            {warnings.length > 0 && (
                <div className="rounded border border-amber-700 bg-amber-900/30 px-2 py-1 text-xs text-amber-200">
                    {warnings.map((warning, index) => (
                        <div key={`${warning.kind}-${index}`}>{warningMessage(warning, t)}</div>
                    ))}
                </div>
            )}

            {record && columns.length > 0 && (
                <>
                    <SettingRow label={t('editor.mfp.csvColumns')}>
                        <span className="text-xs text-gray-400">{columns.join(', ')}</span>
                    </SettingRow>

                    <SettingRow label={t('editor.mfp.csvSampleRow')}>
                        <Select
                            value={String(rowIndex)}
                            onChange={(value) => setSampleRowIndex(Number(value))}
                            options={record.rows.map((_, index) => ({
                                value: String(index),
                                label: t('editor.mfp.csvRowOption', { index: index + 1, count: rowCount }),
                            }))}
                            className="w-40"
                            aria-label={t('editor.mfp.csvSampleRow')}
                        />
                    </SettingRow>

                    <CsvPreviewTable columns={columns} rows={record.rows} />

                    <p className="text-xs text-gray-500">
                        {t('editor.mfp.csvSummary', { columns: columns.length, rows: rowCount })}
                    </p>
                </>
            )}

            {!record && !loading && csvId === undefined && (
                <p className="text-xs text-gray-500">{t('editor.mfp.csvNone')}</p>
            )}

            <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                aria-label={t('editor.mfp.csvChoose')}
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void handleFile(file);
                }}
            />
        </div>
    );
};
