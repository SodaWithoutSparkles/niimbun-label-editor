import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { Modal } from '../common/dialogs/Modal';
import { Input } from '../common/forms/Input';
import { importImageFile, importImageUrl } from '../../editor/assetImport';
import type { ImageRef } from '../../core/doc/types';

/**
 * Image import dialog (P5 W6): file upload **or** URL.
 *
 * File upload writes `local` bytes to the resource store and needs a
 * `resourceRepo`; a URL import records `remote` provenance and writes nothing,
 * so it works without storage. On success the caller registers the `ImageRef`
 * and places/assigns it.
 */

type ImportMode = 'file' | 'url';

/** A validation failure whose message is already localised by the caller. */
class ImportValidationError extends Error {}

/** Raw message of an unknown thrown value, for the localised detail line. */
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

interface ImageImportDialogProps {
    open: boolean;
    onClose: () => void;
    onImported: (ref: ImageRef) => void;
}

export const ImageImportDialog: React.FC<ImageImportDialogProps> = ({ open, onClose, onImported }) => {
    const { t } = useTranslation();
    const resourceRepo = useStore((state) => state.resourceRepo);
    const [mode, setMode] = useState<ImportMode>('file');
    const [url, setUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);
    const fileInputRef = useRef<HTMLInputElement>(null);
    // Synchronous in-flight guard: `runImport` is reachable from the picker's
    // `onChange`, so reading `busy` from the render closure could admit a second
    // concurrent import before React re-renders.
    const busyRef = useRef(false);
    // Set once the dialog leaves the open state, so an import that settles after
    // dismissal can never insert/commit (must-fix #5).
    const cancelledRef = useRef(false);

    // Fresh form each time the dialog opens; mark a close as a cancellation.
    useEffect(() => {
        if (!open) {
            cancelledRef.current = true;
            return;
        }
        cancelledRef.current = false;
        setMode('file');
        setUrl('');
        setBusy(false);
        busyRef.current = false;
        setError(undefined);
    }, [open]);

    const runImport = async (selectedFile?: File) => {
        if (busyRef.current) return;
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
            // The dialog may have been dismissed (parent unmount) mid-import.
            if (cancelledRef.current) return;
            onImported(ref);
            onClose();
        } catch (caught) {
            // Validation messages are already localised; an implementation error
            // is wrapped in a localised failure message (must-fix #4).
            setError(
                caught instanceof ImportValidationError
                    ? caught.message
                    : t('editor.insert.imageImportFailed', { detail: messageOf(caught) }),
            );
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };

    // Block every dismissal path (X / Escape / backdrop) while an import is in
    // flight, so a completed import always reaches a still-open dialog.
    const handleClose = () => {
        if (busy) return;
        onClose();
    };

    return (
        <Modal
            open={open}
            onClose={handleClose}
            closeDisabled={busy}
            title={t('editor.insert.imageImportTitle')}
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
                </>
            }
        >
            <div className="space-y-4">
                <div role="tablist" className="flex gap-1">
                    {(['file', 'url'] as const).map((id) => (
                        <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={mode === id}
                            onClick={() => setMode(id)}
                            className={
                                mode === id
                                    ? 'rounded bg-blue-600 px-3 py-1 text-sm text-white'
                                    : 'rounded border border-gray-600 px-3 py-1 text-sm text-gray-300 hover:bg-gray-700'
                            }
                        >
                            {id === 'file' ? t('editor.insert.imageImportFile') : t('editor.insert.imageImportUrl')}
                        </button>
                    ))}
                </div>

                {mode === 'file' ? (
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
                ) : (
                    <Input
                        value={url}
                        onChange={setUrl}
                        placeholder={t('editor.insert.imageImportUrlPlaceholder')}
                        aria-label={t('editor.insert.imageImportUrl')}
                    />
                )}

                {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
        </Modal>
    );
};
