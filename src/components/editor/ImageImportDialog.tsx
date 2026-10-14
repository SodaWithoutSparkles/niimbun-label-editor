import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { Modal } from '../common/dialogs/Modal';
import { Input } from '../common/forms/Input';
import {
    buildImageRefForExisting,
    cloneResourceRecord,
    importImageFile,
    importImageUrl,
    resolveResourceDimensions,
    type ExistingImportMode,
} from '../../editor/assetImport';
import { filterMedia } from '../gallery/MediaSection';
import type { ResourceRecord } from '../../data/resourceRepo';
import type { ImageRef } from '../../core/doc/types';

/**
 * Image import dialog (P5 W6, phase 9 W3): file upload, URL, **or** an existing
 * media-store record.
 *
 * File upload writes `local` bytes to the resource store and needs a
 * `resourceRepo`; a URL import records `remote` provenance and writes nothing,
 * so it works without storage. "Use existing" lists image records from the media
 * store and imports the chosen one either by **reference** (share the record) or
 * by **clone** (copy it to a fresh id). On success the caller registers the
 * `ImageRef` and places/assigns it.
 */

type ImportMode = 'file' | 'url' | 'existing';

/** A validation failure whose message is already localised by the caller. */
class ImportValidationError extends Error {}

/** Raw message of an unknown thrown value, for the localised detail line. */
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isImageRecord = (record: ResourceRecord): boolean => record.mediaType.startsWith('image/');

/**
 * Small preview tile for an existing image record. Bytes are a `Uint8Array`, so
 * a displayable URL is an object URL built from a `Blob`; it is created in an
 * effect keyed on the bytes and revoked on unmount/change (mirrors `MediaCard`,
 * R9e). `URL.createObjectURL` is guarded — where it is missing the tile falls
 * back to the name alone.
 */
const MediaThumbnail: React.FC<{ record: ResourceRecord }> = ({ record }) => {
    const [objectUrl, setObjectUrl] = useState<string | null>(null);

    useEffect(() => {
        if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
            setObjectUrl(null);
            return;
        }
        // `slice()` re-types the bytes as `Uint8Array<ArrayBuffer>` (a plain
        // `Uint8Array` is `ArrayBufferLike`-backed and not a `BlobPart`).
        const url = URL.createObjectURL(new Blob([record.bytes.slice()], { type: record.mediaType }));
        setObjectUrl(url);
        return () => {
            URL.revokeObjectURL(url);
        };
    }, [record.bytes, record.mediaType]);

    if (!objectUrl) return null;
    return <img src={objectUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />;
};

interface ImageImportDialogProps {
    open: boolean;
    onClose: () => void;
    onImported: (ref: ImageRef) => void;
    /**
     * `insert` (default) registers a fresh asset; `replace` re-uses this dialog
     * to source a replacement for an existing asset. The `onImported` contract is
     * identical — the caller decides whether to add or patch the ref — so the
     * variant only changes the localised title.
     */
    variant?: 'insert' | 'replace';
}

export const ImageImportDialog: React.FC<ImageImportDialogProps> = ({
    open,
    onClose,
    onImported,
    variant = 'insert',
}) => {
    const { t } = useTranslation();
    const resourceRepo = useStore((state) => state.resourceRepo);
    const [mode, setMode] = useState<ImportMode>('file');
    const [url, setUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);
    // "Use existing" state.
    const [media, setMedia] = useState<ResourceRecord[]>([]);
    const [mediaLoading, setMediaLoading] = useState(false);
    const [mediaQuery, setMediaQuery] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    // Synchronous in-flight guard: `runImport` is reachable from the picker's
    // `onChange`, so reading `busy` from the render closure could admit a second
    // concurrent import before React re-renders.
    const busyRef = useRef(false);
    /**
     * Per-operation generation token. Every async operation captures the value
     * it started with (`++opTokenRef.current`) and re-checks it after each
     * `await`. The token is bumped whenever the dialog closes and whenever a
     * session (re)opens, so an operation started before a close/reopen can never
     * match again (must-fix #5).
     *
     * A plain boolean is *not* enough: reopening resets it to "not cancelled",
     * which re-enables a continuation already in flight from the previous
     * session and lets it insert against the wrong (later) session.
     */
    const opTokenRef = useRef(0);

    // Fresh form each time the dialog opens; closing invalidates in-flight work.
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
        setMode('file');
        setUrl('');
        setBusy(false);
        busyRef.current = false;
        setError(undefined);
        setMedia([]);
        setMediaLoading(false);
        setMediaQuery('');
        setSelectedId(null);
        return () => {
            // Unmount (or the open → closed flip): invalidate all in-flight ops.
            opTokenRef.current += 1;
        };
    }, [open]);

    // Load the image records when "Use existing" is selected. Cancellation-
    // guarded so a resolve after a mode switch / dismissal never applies
    // (StrictMode replays this effect).
    useEffect(() => {
        if (!open || mode !== 'existing' || !resourceRepo) return;
        let cancelled = false;
        setMediaLoading(true);
        resourceRepo
            .list()
            .then((records) => {
                if (cancelled) return;
                setMedia(records.filter(isImageRecord));
            })
            .catch(() => {
                if (cancelled) return;
                setMedia([]);
                setError(t('imageImport.readFailed'));
            })
            .finally(() => {
                if (!cancelled) setMediaLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, mode, resourceRepo, t]);

    const runImport = async (selectedFile?: File) => {
        if (busyRef.current) return;
        const token = ++opTokenRef.current;
        busyRef.current = true;
        setBusy(true);
        setError(undefined);
        try {
            let ref: ImageRef;
            if (mode === 'file') {
                // File mode is only reached from the picker's `onChange`, which
                // always supplies a file.
                if (!selectedFile) return;
                if (!resourceRepo) throw new ImportValidationError(t('editor.insert.imageImportNeedsStorage'));
                ref = (await importImageFile(selectedFile, resourceRepo, {})).ref;
            } else {
                const trimmed = url.trim();
                if (!trimmed) throw new ImportValidationError(t('editor.insert.imageImportNoUrl'));
                ref = (await importImageUrl(trimmed, {})).ref;
            }
            // The dialog may have been dismissed (or closed and reopened) mid-
            // import; the captured token no longer matches in that case.
            if (token !== opTokenRef.current) return;
            onImported(ref);
            onClose();
        } catch (caught) {
            if (token !== opTokenRef.current) return;
            // Validation messages are already localised; an implementation error
            // is wrapped in a localised failure message (must-fix #4).
            setError(
                caught instanceof ImportValidationError
                    ? caught.message
                    : t('editor.insert.imageImportFailed', { detail: messageOf(caught) }),
            );
        } finally {
            if (token === opTokenRef.current) {
                busyRef.current = false;
                setBusy(false);
            }
        }
    };

    /**
     * Import a chosen existing record: `reference` points at the shared record
     * (no write), `clone` copies it to a fresh id first. Both then hand the ref
     * to the caller, exactly like a file/URL import.
     */
    const runExisting = async (importMode: ExistingImportMode) => {
        if (busyRef.current) return;
        const record = media.find((entry) => entry.id === selectedId);
        if (!record || !resourceRepo) return;
        const token = ++opTokenRef.current;
        busyRef.current = true;
        setBusy(true);
        setError(undefined);
        try {
            const dimensions = await resolveResourceDimensions(record);
            // Re-check before any side effect: a clone cancelled while the
            // dimensions resolved must not be persisted (it would leave an
            // unattached resource record behind).
            if (token !== opTokenRef.current) return;
            let ref: ImageRef;
            if (importMode === 'clone') {
                const clone = cloneResourceRecord(record);
                await resourceRepo.put(clone);
                if (token !== opTokenRef.current) return;
                ref = buildImageRefForExisting(record, dimensions, 'clone', clone.id);
            } else {
                ref = buildImageRefForExisting(record, dimensions, 'reference');
            }
            if (token !== opTokenRef.current) return;
            onImported(ref);
            onClose();
        } catch (caught) {
            if (token !== opTokenRef.current) return;
            setError(t('editor.insert.imageImportFailed', { detail: messageOf(caught) }));
        } finally {
            if (token === opTokenRef.current) {
                busyRef.current = false;
                setBusy(false);
            }
        }
    };

    // Block every dismissal path (X / Escape / backdrop) while an import is in
    // flight, so a completed import always reaches a still-open dialog.
    const handleClose = () => {
        if (busy) return;
        onClose();
    };

    const existingDisabled = !resourceRepo;
    const visibleMedia = filterMedia(media, mediaQuery);
    const canConfirmExisting = selectedId !== null && !busy;

    return (
        <Modal
            open={open}
            onClose={handleClose}
            closeDisabled={busy}
            title={t(
                variant === 'replace'
                    ? 'editor.insert.imageImportReplaceTitle'
                    : 'editor.insert.imageImportTitle',
            )}
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
                    {mode === 'existing' ? (
                        <>
                            <button
                                type="button"
                                onClick={() => void runExisting('reference')}
                                disabled={!canConfirmExisting}
                                title={t('imageImport.referenceHint')}
                                className="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
                            >
                                {t('imageImport.reference')}
                            </button>
                            <button
                                type="button"
                                onClick={() => void runExisting('clone')}
                                disabled={!canConfirmExisting}
                                title={t('imageImport.cloneHint')}
                                className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
                            >
                                {t('imageImport.clone')}
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            onClick={() => {
                                // File mode: open the OS picker; the chosen file is
                                // auto-imported from the input's `onChange`.
                                if (mode === 'file') {
                                    fileInputRef.current?.click();
                                    return;
                                }
                                void runImport();
                            }}
                            disabled={busy}
                            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
                        >
                            {busy ? t('editor.insert.imageImporting') : t('editor.insert.imageImportAction')}
                        </button>
                    )}
                </>
            }
        >
            <div className="space-y-4">
                <div role="tablist" className="flex gap-1">
                    {(['file', 'url', 'existing'] as const).map((id) => {
                        const disabled = id === 'existing' && existingDisabled;
                        return (
                            <button
                                key={id}
                                type="button"
                                role="tab"
                                aria-selected={mode === id}
                                disabled={disabled}
                                onClick={() => setMode(id)}
                                className={
                                    mode === id
                                        ? 'rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50'
                                        : 'rounded border border-gray-600 px-3 py-1 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-50'
                                }
                            >
                                {id === 'file'
                                    ? t('editor.insert.imageImportFile')
                                    : id === 'url'
                                      ? t('editor.insert.imageImportUrl')
                                      : t('imageImport.useExisting')}
                            </button>
                        );
                    })}
                </div>

                {mode === 'file' && (
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        aria-label={t('editor.insert.imageImportFile')}
                        className="hidden"
                        onChange={(event) => {
                            const selected = event.target.files?.[0];
                            // Reset so re-picking the same file fires `change` again.
                            event.target.value = '';
                            if (selected) void runImport(selected);
                        }}
                    />
                )}

                {mode === 'url' && (
                    <Input
                        value={url}
                        onChange={setUrl}
                        placeholder={t('editor.insert.imageImportUrlPlaceholder')}
                        aria-label={t('editor.insert.imageImportUrl')}
                    />
                )}

                {mode === 'existing' && (
                    <div className="space-y-2">
                        <Input
                            value={mediaQuery}
                            onChange={setMediaQuery}
                            placeholder={t('media.searchPlaceholder')}
                            aria-label={t('imageImport.useExisting')}
                        />
                        {mediaLoading && <p className="text-xs text-gray-500">{t('imageImport.loading')}</p>}
                        {!mediaLoading && visibleMedia.length === 0 && (
                            <p className="text-xs text-gray-500">
                                {media.length === 0 ? t('imageImport.noMedia') : t('media.searchEmpty', { query: mediaQuery })}
                            </p>
                        )}
                        {visibleMedia.length > 0 && (
                            <ul className="max-h-56 space-y-1 overflow-y-auto">
                                {visibleMedia.map((record) => {
                                    const selected = selectedId === record.id;
                                    const name = record.name ?? record.id;
                                    const hasDims =
                                        record.widthPx !== undefined && record.heightPx !== undefined;
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
                                                <MediaThumbnail record={record} />
                                                <span className="flex-1 truncate" title={name}>
                                                    {name}
                                                </span>
                                                {hasDims && (
                                                    <span className="shrink-0 text-xs text-gray-400">
                                                        {t('media.dimensions', {
                                                            w: record.widthPx,
                                                            h: record.heightPx,
                                                        })}
                                                    </span>
                                                )}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                        {selectedId !== null && (
                            <div className="space-y-0.5 text-xs text-gray-500">
                                <p>{t('imageImport.referenceHint')}</p>
                                <p>{t('imageImport.cloneHint')}</p>
                            </div>
                        )}
                    </div>
                )}

                {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
        </Modal>
    );
};
