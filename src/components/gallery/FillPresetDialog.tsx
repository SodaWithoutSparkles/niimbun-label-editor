import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../common/dialogs/Modal';
import { Input, Select } from '../common/forms';
import { useStore } from '../../store/useStore';
import type { LabelDoc } from '../../core/doc/types';
import { CSV_ROW_FIELD_ID, isReservedFieldId } from '../../core/doc/fieldDefs';
import { findCsvRow, singleRowCsv } from '../../editor/csvKey';
import { presetFields } from '../../editor/presetFields';
import { renderDocPreview } from '../../editor/render/docThumbnail';
import { getAppJobRunner } from '../../print/appTransport';
import type { CsvRecord } from '../../data/csvRepo';
import { PrintDialog } from '../print/PrintDialog';
import { usePrintJob, type CsvJobSource } from '../print/usePrintJob';
import { formatCardMm } from './cardFormat';

/**
 * Fill & print dialog for a saved label preset (P5, extended in P6b).
 *
 * Opens from a preset card and manages the owner workflow end-to-end: fill one
 * value per declared field (plus bound-but-undeclared leftovers), watch the live
 * colour preview, then Print or copy the preset into a normal label ("Open in
 * editor").
 *
 * ## One content path
 *
 * Preview and print both come from the dialog's single {@link usePrintJob}
 * instance: the preview calls `prepareRow(...)` and renders the resulting
 * context with `renderDocPreview`, while `PrintDialog` receives that same
 * `prepareRow`/`assets`/CSV deps. There is no second resolver, so
 * "preview ≡ print" holds by construction (trust prompts, serial-use engine and
 * globals prefetch included).
 *
 * ## Form rows (P6b)
 *
 * The default rows are the document's declarations in document order (skipping
 * `hidden` reserved ids) followed by bound-but-undeclared names in node order.
 * Declarations prefill `default`; required rows block Print and "Open in
 * editor" while empty. Hidden declarations are absent from the default list but
 * can be added through "Add field", which is also how a hidden required id is
 * satisfied.
 *
 * ## CSV row lookup (P6b)
 *
 * When the preset declares `csv.row` and its attached table reads successfully,
 * the dialog offers a key-column select and a key input. The resulting
 * {@link singleRowCsv} table is handed to the same `usePrintJob` instance, so
 * the preview and the printed page are exactly one record: the matched row, the
 * stored sample row when no key is typed, or one all-empty row when the key
 * misses. A miss is explicit in the status line; nothing silently prints a
 * different record.
 *
 * ## Transient state
 *
 * `values`, `addedIds`, `keyColumn` and `key` are local React state only — never
 * written to the document, the store or storage. The preset document is loaded
 * with `labelRepo.get` and is never made `currentDoc`; "Open in editor" persists
 * a `kind: 'label'` copy and opens that instead, bindings intact and unfilled.
 */
export interface FillPresetDialogProps {
    open: boolean;
    /** Record to load when opened; `null` keeps the dialog inert. */
    presetId: string | null;
    onClose: () => void;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * A load result bound to the preset it belongs to.
 *
 * The id is what keeps the actions honest across a preset switch: React keeps
 * the previous document in state until the new read commits, so `ready` must
 * mean "loaded **for the current `presetId`**", never merely "a document
 * arrived at some point".
 */
interface LoadedPreset {
    readonly status: LoadState;
    readonly id: string | null;
    readonly doc: LabelDoc | null;
}

/** The attached CSV, keyed by the attachment it was read for. */
interface LoadedCsv {
    readonly status: LoadState;
    readonly id: string | null;
    readonly record: CsvRecord | null;
}

/** One text row of the fill form. */
interface FillRow {
    readonly id: string;
    /** Binding fallback, used as the input placeholder. */
    readonly fallback: string;
    readonly required: boolean;
}

/** Seed the fill form: declaration defaults (hidden included) + empty leftovers. */
const initialValues = (doc: LabelDoc): Record<string, string> => {
    const values: Record<string, string> = {};
    for (const declaration of doc.data.fields ?? []) {
        values[declaration.id] = declaration.default ?? '';
    }
    for (const binding of presetFields(doc)) {
        if (!Object.hasOwn(values, binding.name)) values[binding.name] = '';
    }
    return values;
};

export const FillPresetDialog: React.FC<FillPresetDialogProps> = ({
    open,
    presetId,
    onClose,
}) => {
    const { t } = useTranslation();
    const labelRepo = useStore((state) => state.labelRepo);
    const csvRepo = useStore((state) => state.csvRepo);
    const saveCopy = useStore((state) => state.saveCopy);
    const openLabel = useStore((state) => state.openLabel);
    const addNotification = useStore((state) => state.addNotification);
    const printerStatus = useStore((state) => state.printerStatus);

    const [loaded, setLoaded] = useState<LoadedPreset>({
        status: 'idle',
        id: null,
        doc: null,
    });
    const [loadedCsv, setLoadedCsv] = useState<LoadedCsv>({
        status: 'idle',
        id: null,
        record: null,
    });
    const [values, setValues] = useState<Record<string, string>>({});
    const [addedIds, setAddedIds] = useState<string[]>([]);
    const [addId, setAddId] = useState('');
    const [addValue, setAddValue] = useState('');
    const [keyColumn, setKeyColumn] = useState('');
    const [key, setKey] = useState('');
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [printing, setPrinting] = useState(false);
    const [opening, setOpening] = useState(false);
    // Dialog-session token: every session end bumps it — `onClose`, an unmount,
    // and the controlled `open` prop going false or a preset switch — so an
    // async copy/open already in flight can never notify, close or set state
    // after the user left the dialog.
    const sessionRef = useRef(0);
    const inputIdBase = useId();

    // Load the full record when the dialog opens. Token-guarded so a close, a
    // different preset or StrictMode's effect replay can never apply a stale
    // read; a throw and a missing record both mean "could not load".
    useEffect(() => {
        // Every open starts with a fresh form and no preview from a previous
        // preset (the state updates below are batched with this render).
        setValues({});
        setAddedIds([]);
        setAddId('');
        setAddValue('');
        setKey('');
        setKeyColumn('');
        setPreviewUrl(null);
        setPrinting(false);
        setOpening(false);
        if (!open || presetId === null) {
            setLoaded({ status: 'idle', id: null, doc: null });
            return;
        }
        if (!labelRepo) {
            setLoaded({ status: 'error', id: presetId, doc: null });
            return;
        }
        setLoaded({ status: 'loading', id: presetId, doc: null });
        let cancelled = false;
        void (async () => {
            let loadedDoc: LabelDoc | null = null;
            try {
                loadedDoc = await labelRepo.get(presetId);
            } catch {
                loadedDoc = null;
            }
            if (cancelled) return;
            setLoaded({
                status: loadedDoc === null ? 'error' : 'ready',
                id: presetId,
                doc: loadedDoc,
            });
            // Seed the form in the same batch as the document, so a row never
            // renders empty for a frame before its default lands.
            if (loadedDoc !== null) {
                setValues(initialValues(loadedDoc));
                setAddedIds([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [open, presetId, labelRepo]);

    // An unmount is a session end too: nothing queued may act afterwards.
    useEffect(() => () => {
        sessionRef.current += 1;
    }, []);

    // The controlled `open` prop (and a preset switch) end the session too:
    // `onClose` is not the only way out. Bumping after render is enough — any
    // in-flight handler re-checks `stale()` after every await.
    useEffect(() => {
        sessionRef.current += 1;
    }, [open, presetId]);

    // Never expose a document loaded for another preset: until the new read
    // commits, the old one stays in state but is neither `ready` nor usable by
    // Print / Open in editor.
    const presetDoc = loaded.id === presetId ? loaded.doc : null;
    const loadState: LoadState =
        !open || presetId === null
            ? 'idle'
            : loaded.id !== presetId
              ? 'loading'
              : loaded.status;

    const bindings = useMemo(
        () => (presetDoc === null ? [] : presetFields(presetDoc)),
        [presetDoc],
    );
    const declarations = useMemo(() => presetDoc?.data.fields ?? [], [presetDoc]);
    const declaredIds = useMemo(
        () => new Set(declarations.map((declaration) => declaration.id)),
        [declarations],
    );

    // Default rows: visible declarations in document order, then leftovers
    // (bound but undeclared) in node order. Hidden declarations stay out until
    // the user adds them; reserved ids are filled by the app, not typed here.
    const formRows = useMemo<FillRow[]>(() => {
        if (presetDoc === null) return [];
        const fallbacks = new Map(bindings.map((binding) => [binding.name, binding.fallback]));
        const rows: FillRow[] = [];
        const listed = new Set<string>();
        for (const declaration of presetDoc.data.fields ?? []) {
            if (declaration.hidden === true) continue;
            if (isReservedFieldId(declaration.id)) continue;
            rows.push({
                id: declaration.id,
                fallback: fallbacks.get(declaration.id) ?? '',
                required: declaration.required === true,
            });
            listed.add(declaration.id);
        }
        for (const binding of bindings) {
            if (listed.has(binding.name)) continue;
            if (declaredIds.has(binding.name)) continue;
            rows.push({ id: binding.name, fallback: binding.fallback, required: false });
            listed.add(binding.name);
        }
        for (const id of addedIds) {
            if (listed.has(id)) continue;
            const declaration = (presetDoc.data.fields ?? []).find((def) => def.id === id);
            rows.push({
                id,
                fallback: fallbacks.get(id) ?? '',
                required: declaration?.required === true,
            });
            listed.add(id);
        }
        return rows;
    }, [presetDoc, bindings, declaredIds, addedIds]);

    // Only hidden declarations are addable; a visible one is already listed and
    // a reserved one is filled by the app.
    const addCandidates = useMemo(() => {
        if (presetDoc === null) return [];
        const listed = new Set(formRows.map((row) => row.id));
        return (presetDoc.data.fields ?? [])
            .filter(
                (declaration) =>
                    declaration.hidden === true &&
                    !isReservedFieldId(declaration.id) &&
                    !listed.has(declaration.id),
            )
            .map((declaration) => declaration.id);
    }, [presetDoc, formRows]);

    // Required gating is declaration-based, so a hidden required id blocks until
    // the user adds it (or its default already satisfies it). Reserved ids are
    // excluded: the app fills them, and an unfillable requirement would be a
    // dead end.
    const missingRequired = useMemo(() => {
        if (presetDoc === null) return [];
        const missing: string[] = [];
        const seen = new Set<string>();
        for (const declaration of presetDoc.data.fields ?? []) {
            if (declaration.required !== true) continue;
            if (isReservedFieldId(declaration.id)) continue;
            if (seen.has(declaration.id)) continue;
            if ((values[declaration.id] ?? '').trim().length > 0) continue;
            seen.add(declaration.id);
            missing.push(declaration.id);
        }
        return missing;
    }, [presetDoc, values]);

    // Load the attached table alongside the document. Token-guarded like the
    // document read; a failure degrades to "no row selector" (and no override).
    const csvId = presetDoc?.data.csv?.csvId ?? null;
    useEffect(() => {
        if (!open || presetDoc === null || csvId === null) {
            setLoadedCsv({ status: 'idle', id: null, record: null });
            return;
        }
        if (!csvRepo) {
            setLoadedCsv({ status: 'error', id: csvId, record: null });
            return;
        }
        setLoadedCsv({ status: 'loading', id: csvId, record: null });
        let cancelled = false;
        void (async () => {
            let record: CsvRecord | null = null;
            try {
                record = await csvRepo.get(csvId);
            } catch {
                record = null;
            }
            if (cancelled) return;
            setLoadedCsv({
                status: record === null ? 'error' : 'ready',
                id: csvId,
                record,
            });
        })();
        return () => {
            cancelled = true;
        };
    }, [open, presetDoc, csvId, csvRepo]);

    const csvRecord = loadedCsv.id === csvId ? loadedCsv.record : null;
    const csvLoadState: LoadState =
        !open || presetDoc === null || csvId === null
            ? 'idle'
            : loadedCsv.id !== csvId
              ? 'loading'
              : loadedCsv.status;
    const csvAttached = presetDoc?.data.csv !== undefined;
    const rowSelectorDeclared = declaredIds.has(CSV_ROW_FIELD_ID);

    // A preset/CSV switch resets the key state; the first column is the default.
    useEffect(() => {
        setKey('');
        setKeyColumn(csvRecord?.columns[0] ?? '');
    }, [csvRecord]);

    // One content source for the preview and PrintDialog. The source is total:
    // "no attachment", "my read is pending" and "my read failed" are all
    // explicit states, so the hook never falls back to reading the document's
    // full table while this dialog's own read is in flight or broken.
    const sampleRowIndex = presetDoc?.data.sampleRowIndex ?? 0;
    const keyTrimmed = key.trim();
    const matchedIndex =
        csvRecord === null || keyTrimmed.length === 0
            ? -1
            : findCsvRow(csvRecord, keyColumn, key);
    const csvSource = useMemo<CsvJobSource>(() => {
        if (!csvAttached) return { kind: 'none' };
        if (csvRecord === null)
            return csvLoadState === 'loading' ? { kind: 'loading' } : { kind: 'error' };
        return {
            kind: 'ready',
            record: singleRowCsv(
                csvRecord,
                keyTrimmed.length === 0 ? sampleRowIndex : matchedIndex,
            ),
        };
    }, [csvAttached, csvRecord, csvLoadState, keyTrimmed, matchedIndex, sampleRowIndex]);
    // A ready source always has exactly one row, so it is always row 0.
    const previewRowIndex = csvSource.kind === 'ready' ? 0 : sampleRowIndex;

    const job = usePrintJob({
        open: open && presetDoc !== null,
        doc: presetDoc,
        fields: values,
        csv: csvSource,
    });

    // Field values only affect the async pass through this stable, key-order
    // insensitive string, so a re-render with the same map does not re-render
    // the preview.
    const valuesKey = useMemo(
        () =>
            JSON.stringify(
                Object.keys(values)
                    .sort()
                    .map((name) => [name, values[name]]),
            ),
        [values],
    );

    // Live colour preview through the editor's own render path. The previous
    // image stays up while the next one renders; a superseded result (close,
    // preset switch, newer keystroke, newer key) is dropped by the token guard.
    useEffect(() => {
        if (!open || presetDoc === null) {
            setPreviewUrl(null);
            return;
        }
        let cancelled = false;
        void (async () => {
            const ctx = await job.prepareRow(previewRowIndex);
            if (cancelled) return;
            const preview = await renderDocPreview(presetDoc, job.assets, ctx);
            if (cancelled) return;
            setPreviewUrl(preview?.metaThumb?.dataUrl ?? null);
        })();
        return () => {
            cancelled = true;
        };
    }, [
        open,
        presetDoc,
        job.prepareRow,
        job.assets,
        valuesKey,
        previewRowIndex,
        csvSource,
    ]);

    const handleValueChange = useCallback((name: string, value: string) => {
        setValues((previous) => ({ ...previous, [name]: value }));
    }, []);

    const handleAddField = useCallback(() => {
        if (addId.length === 0) return;
        setAddedIds((previous) => (previous.includes(addId) ? previous : [...previous, addId]));
        setValues((previous) => ({ ...previous, [addId]: addValue }));
        setAddId('');
        setAddValue('');
    }, [addId, addValue]);

    const handleClose = useCallback(() => {
        // Invalidate anything already awaiting: its results must not notify,
        // close again or touch state after this session ends.
        sessionRef.current += 1;
        setPrinting(false);
        onClose();
    }, [onClose]);

    const handleOpenInEditor = useCallback(async () => {
        if (presetDoc === null) return;
        const session = sessionRef.current;
        const stale = () => session !== sessionRef.current;
        setOpening(true);
        try {
            const copy = await saveCopy(presetDoc, {
                kind: 'label',
                name: presetDoc.meta.name,
            });
            if (stale()) return;
            if (copy === null) {
                addNotification({ type: 'error', message: t('presets.openCopyFailed') });
                return;
            }
            // `openLabel` is not contractually non-throwing (it awaits the
            // autosave flush), so a rejection is a user-visible failure too.
            const opened = await openLabel(copy.meta.id);
            if (stale()) return;
            if (opened === null) {
                addNotification({ type: 'error', message: t('presets.openCopyFailed') });
                return;
            }
            handleClose();
        } catch {
            if (stale()) return;
            addNotification({ type: 'error', message: t('presets.openCopyFailed') });
        } finally {
            if (!stale()) setOpening(false);
        }
    }, [presetDoc, saveCopy, openLabel, addNotification, t, handleClose]);

    const ready = loadState === 'ready' && presetDoc !== null;
    const canPrint = ready && missingRequired.length === 0;
    const name =
        presetDoc !== null && presetDoc.meta.name.length > 0
            ? presetDoc.meta.name
            : t('presets.title');
    const size = presetDoc
        ? t('gallery.size', {
              w: formatCardMm(presetDoc.label.backingW),
              h: formatCardMm(presetDoc.label.backingH),
          })
        : undefined;

    const rowSelectorVisible = rowSelectorDeclared && csvRecord !== null;
    const rowSelectorUnavailable =
        rowSelectorDeclared && csvAttached && csvRecord === null && csvLoadState === 'error';
    const showNoFields =
        formRows.length === 0 &&
        addCandidates.length === 0 &&
        !(rowSelectorDeclared && csvAttached);
    const rowStatus =
        keyTrimmed.length === 0
            ? t('presets.row.noKey')
            : matchedIndex >= 0
              ? t('presets.row.matched', { row: matchedIndex + 1 })
              : t('presets.row.noMatch');

    const body =
        loadState === 'error' ? (
            <p
                role="alert"
                data-testid="preset-load-failed"
                className="rounded border border-red-500 bg-red-900/40 px-3 py-2 text-sm text-red-100"
            >
                {t('presets.loadFailed')}
            </p>
        ) : !ready ? (
            <p
                role="status"
                data-testid="preset-loading"
                className="rounded border border-gray-700 bg-gray-900 px-2 py-3 text-center text-sm text-gray-400"
            >
                {t('presets.loading')}
            </p>
        ) : (
            <div className="space-y-4">
                <p className="text-sm text-gray-400">{t('presets.fillHint')}</p>

                {missingRequired.length > 0 && (
                    <p
                        role="alert"
                        data-testid="preset-required-missing"
                        className="rounded border border-amber-600 bg-amber-900/30 px-3 py-2 text-sm text-amber-100"
                    >
                        {t('presets.requiredMissing', {
                            fields: missingRequired.join(', '),
                        })}
                    </p>
                )}

                {rowSelectorUnavailable && (
                    <p
                        role="alert"
                        data-testid="preset-row-unavailable"
                        className="rounded border border-amber-600 bg-amber-900/30 px-3 py-2 text-sm text-amber-100"
                    >
                        {t('presets.row.csvUnavailable')}
                    </p>
                )}

                {rowSelectorVisible && (
                    <section
                        aria-label={t('presets.row.label')}
                        data-testid="preset-row-selector"
                        className="space-y-2 rounded border border-gray-700 bg-gray-900 p-3"
                    >
                        <div className="grid gap-3 sm:grid-cols-2">
                            <label
                                htmlFor={`${inputIdBase}-key-column`}
                                className="block space-y-1"
                            >
                                <span className="text-sm text-gray-300">
                                    {t('presets.row.column')}
                                </span>
                                <Select
                                    id={`${inputIdBase}-key-column`}
                                    value={keyColumn}
                                    onChange={setKeyColumn}
                                    options={csvRecord.columns.map((column) => ({
                                        value: column,
                                        label: column,
                                    }))}
                                    className="w-full"
                                />
                            </label>
                            <label htmlFor={`${inputIdBase}-key`} className="block space-y-1">
                                <span className="text-sm text-gray-300">
                                    {t('presets.row.key')}
                                </span>
                                <Input
                                    id={`${inputIdBase}-key`}
                                    value={key}
                                    onChange={setKey}
                                    placeholder={t('presets.row.keyPlaceholder')}
                                />
                            </label>
                        </div>
                        <p
                            role="status"
                            data-testid="preset-row-status"
                            className="text-xs text-gray-400"
                        >
                            {rowStatus}
                        </p>
                    </section>
                )}

                <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-3">
                        {showNoFields && (
                            <p className="text-sm text-gray-400">{t('presets.noFields')}</p>
                        )}

                        {formRows.map((row, index) => {
                            const inputId = `${inputIdBase}-${index}`;
                            return (
                                <label
                                    key={row.id}
                                    htmlFor={inputId}
                                    className="block space-y-1"
                                >
                                    <span className="text-sm text-gray-300">{row.id}</span>
                                    <Input
                                        id={inputId}
                                        value={values[row.id] ?? ''}
                                        placeholder={row.fallback}
                                        aria-required={row.required || undefined}
                                        onChange={(value) => handleValueChange(row.id, value)}
                                    />
                                </label>
                            );
                        })}

                        {addCandidates.length > 0 && (
                            <div className="flex flex-wrap items-end gap-2 rounded border border-gray-700 bg-gray-900 p-2">
                                <label
                                    htmlFor={`${inputIdBase}-add-id`}
                                    className="block space-y-1"
                                >
                                    <span className="text-xs text-gray-400">
                                        {t('presets.fieldId')}
                                    </span>
                                    <Select
                                        id={`${inputIdBase}-add-id`}
                                        value={addId}
                                        onChange={setAddId}
                                        options={[
                                            { value: '', label: '—' },
                                            ...addCandidates.map((id) => ({
                                                value: id,
                                                label: id,
                                            })),
                                        ]}
                                        className="min-w-40"
                                    />
                                </label>
                                <label
                                    htmlFor={`${inputIdBase}-add-value`}
                                    className="block flex-1 space-y-1"
                                >
                                    <span className="text-xs text-gray-400">
                                        {t('presets.fieldValue')}
                                    </span>
                                    <Input
                                        id={`${inputIdBase}-add-value`}
                                        value={addValue}
                                        onChange={setAddValue}
                                    />
                                </label>
                                <button
                                    type="button"
                                    onClick={handleAddField}
                                    disabled={addId.length === 0}
                                    className="shrink-0 rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {t('presets.addField')}
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="space-y-2">
                        <div className="text-sm font-medium text-gray-300">
                            {t('presets.preview')}
                        </div>
                        <div className="flex min-h-40 items-center justify-center overflow-hidden rounded border border-gray-700 bg-white p-2">
                            {previewUrl !== null ? (
                                <img
                                    data-testid="preset-live-preview"
                                    src={previewUrl}
                                    alt={t('gallery.previewAlt', { name })}
                                    className="max-h-64 max-w-full object-contain"
                                />
                            ) : (
                                <span className="text-xs text-gray-500">
                                    {t('presets.preview')}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );

    return (
        <>
            <Modal
                open={open}
                onClose={handleClose}
                title={name}
                size="lg"
                closeDisabled={opening}
                headerActions={
                    size !== undefined ? (
                        <span className="text-xs text-gray-400">{size}</span>
                    ) : undefined
                }
                footer={
                    <>
                        <button
                            type="button"
                            onClick={handleClose}
                            disabled={opening}
                            className="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                        >
                            {t('presets.cancel')}
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleOpenInEditor()}
                            disabled={!canPrint || opening}
                            className="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                        >
                            {t('presets.openInEditor')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setPrinting(true)}
                            disabled={!canPrint}
                            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
                        >
                            {t('presets.print')}
                        </button>
                    </>
                }
            >
                {body}
            </Modal>
            {printing && presetDoc !== null && (
                <PrintDialog
                    open
                    onClose={() => setPrinting(false)}
                    doc={presetDoc}
                    csv={job.csv}
                    csvStatus={job.csvStatus}
                    csvRevision={job.csvRevision}
                    prepareRow={job.prepareRow}
                    assets={job.assets}
                    runner={getAppJobRunner()}
                    printerStatus={printerStatus}
                />
            )}
        </>
    );
};
