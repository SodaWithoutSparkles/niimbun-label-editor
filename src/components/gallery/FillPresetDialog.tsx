import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../common/dialogs/Modal';
import { Input } from '../common/forms';
import { useStore } from '../../store/useStore';
import type { LabelDoc } from '../../core/doc/types';
import { presetFields } from '../../editor/presetFields';
import { renderDocPreview } from '../../editor/render/docThumbnail';
import { getAppJobRunner } from '../../print/appTransport';
import { PrintDialog } from '../print/PrintDialog';
import { usePrintJob } from '../print/usePrintJob';
import { formatCardMm } from './cardFormat';

/**
 * Fill & print dialog for a saved label preset (P5).
 *
 * Opens from a preset card and manages the owner workflow end-to-end: type one
 * value per distinct field, watch the live colour preview, then Print or copy
 * the preset into a normal label ("Open in editor").
 *
 * ## One content path
 *
 * Preview and print both come from the dialog's single {@link usePrintJob}
 * instance: the preview calls `prepareRow(doc.data.sampleRowIndex)` and renders
 * the resulting context with `renderDocPreview`, while `PrintDialog` receives
 * that same `prepareRow`/`assets`/CSV deps. There is no second resolver, so
 * "preview ≡ print" holds by construction (trust prompts, serial-use engine and
 * globals prefetch included).
 *
 * ## Transient state
 *
 * `values` is local React state only — never written to the document, the store
 * or storage. The preset document is loaded with `labelRepo.get` and is never
 * made `currentDoc`; "Open in editor" persists a `kind: 'label'` copy and opens
 * that instead, bindings intact and unfilled.
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

export const FillPresetDialog: React.FC<FillPresetDialogProps> = ({
    open,
    presetId,
    onClose,
}) => {
    const { t } = useTranslation();
    const labelRepo = useStore((state) => state.labelRepo);
    const saveCopy = useStore((state) => state.saveCopy);
    const openLabel = useStore((state) => state.openLabel);
    const addNotification = useStore((state) => state.addNotification);
    const printerStatus = useStore((state) => state.printerStatus);

    const [loaded, setLoaded] = useState<LoadedPreset>({
        status: 'idle',
        id: null,
        doc: null,
    });
    const [values, setValues] = useState<Record<string, string>>({});
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

    const fields = useMemo(
        () => (presetDoc === null ? [] : presetFields(presetDoc)),
        [presetDoc],
    );

    // One content source for the preview and PrintDialog. Called
    // unconditionally; `null` until the record loads keeps it inert.
    const job = usePrintJob({
        open: open && presetDoc !== null,
        doc: presetDoc,
        fields: values,
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
    // preset switch, newer keystroke) is dropped by the token guard.
    useEffect(() => {
        if (!open || presetDoc === null) {
            setPreviewUrl(null);
            return;
        }
        let cancelled = false;
        void (async () => {
            const ctx = await job.prepareRow(presetDoc.data.sampleRowIndex);
            if (cancelled) return;
            const preview = await renderDocPreview(presetDoc, job.assets, ctx);
            if (cancelled) return;
            setPreviewUrl(preview?.metaThumb?.dataUrl ?? null);
        })();
        return () => {
            cancelled = true;
        };
    }, [open, presetDoc, job.prepareRow, job.assets, valuesKey]);

    const handleValueChange = useCallback((name: string, value: string) => {
        setValues((previous) => ({ ...previous, [name]: value }));
    }, []);

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
                <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-3">
                        {fields.length === 0 ? (
                            <p className="text-sm text-gray-400">{t('presets.noFields')}</p>
                        ) : (
                            fields.map((field, index) => {
                                const inputId = `${inputIdBase}-${index}`;
                                return (
                                    <label
                                        key={field.name}
                                        htmlFor={inputId}
                                        className="block space-y-1"
                                    >
                                        <span className="text-sm text-gray-300">
                                            {field.name}
                                        </span>
                                        <Input
                                            id={inputId}
                                            value={values[field.name] ?? ''}
                                            placeholder={field.fallback}
                                            onChange={(value) =>
                                                handleValueChange(field.name, value)
                                            }
                                        />
                                    </label>
                                );
                            })
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
                            disabled={!ready || opening}
                            className="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                        >
                            {t('presets.openInEditor')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setPrinting(true)}
                            disabled={!ready}
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
