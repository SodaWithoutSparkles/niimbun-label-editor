import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { newLabelId } from '../../core/doc/factory';
import { cloneCsvRecord, type CsvRecord } from '../../data/csvRepo';
import { Modal } from '../common/dialogs/Modal';
import { Input } from '../common/forms/Input';
import { filterCsvs } from '../gallery/CsvSection';

/**
 * "Use existing" CSV picker (phase 9, W3) — the Data source tab's counterpart to
 * `ImageImportDialog`'s existing-media mode.
 *
 * Lists the `csvs` store and attaches the chosen table either by **reference**
 * (attach the existing id, no write) or by **clone** (copy it to a fresh id and
 * attach that). The clone write happens here; the caller only receives the
 * `(csvId, name)` to attach.
 */

interface CsvPickDialogProps {
    open: boolean;
    onClose: () => void;
    /** Called with the id + display name of the table to attach. */
    onPick: (csvId: string, name: string) => void;
}

export const CsvPickDialog: React.FC<CsvPickDialogProps> = ({ open, onClose, onPick }) => {
    const { t } = useTranslation();
    const csvRepo = useStore((state) => state.csvRepo);
    const [records, setRecords] = useState<CsvRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [query, setQuery] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const busyRef = useRef(false);
    /**
     * Per-operation generation token. Every async operation captures the value
     * it started with (`++opTokenRef.current`) and re-checks it after each
     * `await`. The token is bumped whenever the dialog closes and whenever a
     * session (re)opens, so an operation started before a close/reopen can never
     * match again.
     *
     * A plain boolean is *not* enough: reopening resets it to "not cancelled",
     * which re-enables a continuation that was already in flight from the
     * previous session and lets it attach against the wrong (later) session.
     */
    const opTokenRef = useRef(0);

    useEffect(() => {
        if (!open) {
            // Close: invalidate every in-flight operation, including one from an
            // earlier session — its captured token can never match again.
            opTokenRef.current += 1;
            return;
        }
        // New session: bump past any operation still in flight from an earlier
        // session before resetting the form. StrictMode replays (mount → cleanup
        // → mount) only ever move the token forward, so a fresh session always
        // has a token no old operation can match.
        opTokenRef.current += 1;
        setQuery('');
        setSelectedId(null);
        setBusy(false);
        busyRef.current = false;
        setError(null);
        return () => {
            // Unmount (or the open → closed flip): invalidate all in-flight ops.
            opTokenRef.current += 1;
        };
    }, [open]);

    // Load the tables when opened. Cancellation-guarded (StrictMode replays it).
    useEffect(() => {
        if (!open || !csvRepo) return;
        let cancelled = false;
        setLoading(true);
        csvRepo
            .list()
            .then((next) => {
                if (cancelled) return;
                setRecords(next);
            })
            .catch(() => {
                if (cancelled) return;
                setRecords([]);
                setError(t('dataSource.readFailed'));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, csvRepo, t]);

    const confirm = async (mode: 'clone' | 'reference') => {
        if (busyRef.current) return;
        const record = records.find((entry) => entry.id === selectedId);
        if (!record || !csvRepo) return;
        const token = ++opTokenRef.current;
        busyRef.current = true;
        setBusy(true);
        setError(null);
        try {
            if (mode === 'clone') {
                const newId = newLabelId();
                await csvRepo.put(cloneCsvRecord(record, newId));
                if (token !== opTokenRef.current) return;
                onPick(newId, record.name);
            } else {
                if (token !== opTokenRef.current) return;
                onPick(record.id, record.name);
            }
            onClose();
        } catch {
            if (token !== opTokenRef.current) return;
            setError(t('csvs.saveFailed'));
        } finally {
            if (token === opTokenRef.current) {
                busyRef.current = false;
                setBusy(false);
            }
        }
    };

    const handleClose = () => {
        if (busy) return;
        onClose();
    };

    const visible = filterCsvs(records, query);
    const canConfirm = selectedId !== null && !busy;

    return (
        <Modal
            open={open}
            onClose={handleClose}
            closeDisabled={busy}
            title={t('dataSource.useExisting')}
            size="sm"
            footer={
                <>
                    <button
                        type="button"
                        onClick={handleClose}
                        disabled={busy}
                        className="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                    >
                        {t('dialog.cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={() => void confirm('reference')}
                        disabled={!canConfirm}
                        title={t('dataSource.referenceHint')}
                        className="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                    >
                        {t('dataSource.reference')}
                    </button>
                    <button
                        type="button"
                        onClick={() => void confirm('clone')}
                        disabled={!canConfirm}
                        title={t('dataSource.cloneHint')}
                        className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                        {t('dataSource.clone')}
                    </button>
                </>
            }
        >
            <div className="space-y-2">
                <Input
                    value={query}
                    onChange={setQuery}
                    placeholder={t('csvs.searchPlaceholder')}
                    aria-label={t('dataSource.useExisting')}
                />
                {loading && <p className="text-xs text-gray-500">{t('dataSource.loading')}</p>}
                {!loading && visible.length === 0 && (
                    <p className="text-xs text-gray-500">
                        {records.length === 0 ? t('dataSource.noCsvs') : t('csvs.searchEmpty', { query })}
                    </p>
                )}
                {visible.length > 0 && (
                    <ul className="max-h-56 space-y-1 overflow-y-auto">
                        {visible.map((record) => {
                            const selected = selectedId === record.id;
                            return (
                                <li key={record.id}>
                                    <button
                                        type="button"
                                        aria-pressed={selected}
                                        onClick={() => setSelectedId(record.id)}
                                        className={
                                            selected
                                                ? 'flex w-full items-center gap-2 rounded border border-blue-500 bg-blue-600/20 px-2 py-1 text-left text-sm text-white'
                                                : 'flex w-full items-center gap-2 rounded border border-gray-700 px-2 py-1 text-left text-sm text-gray-200 hover:bg-gray-700'
                                        }
                                    >
                                        <span className="flex-1 truncate" title={record.name}>
                                            {record.name}
                                        </span>
                                        <span className="shrink-0 text-xs text-gray-400">
                                            {t('csvs.rowsCols', {
                                                rows: record.rows.length,
                                                cols: record.columns.length,
                                            })}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
                {selectedId !== null && (
                    <div className="space-y-0.5 text-xs text-gray-500">
                        <p>{t('dataSource.referenceHint')}</p>
                        <p>{t('dataSource.cloneHint')}</p>
                    </div>
                )}
                {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
        </Modal>
    );
};
