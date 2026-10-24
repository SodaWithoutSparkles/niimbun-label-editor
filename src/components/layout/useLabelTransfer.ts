import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LabelDoc } from '../../core/doc/types';
import { MAX_IMPORT_BYTES, buildBundle, importBundle } from '../../data/bundle';
import { decompress } from '../../utils/compress';
import { useStore } from '../../store/useStore';

/**
 * File-menu import/export wiring (2026-10-22 storage-safety run, P8b).
 *
 * A hook rather than logic inside `Header` so the three operations can be
 * exercised without the whole shell. The data layer lives in `data/bundle.ts`
 * (P8a); this module only owns the untrusted-file boundary and the user
 * feedback:
 *
 *   - **never trust a picked file** — `file.size` guard first, then
 *     `JSON.parse`, then `importBundle`'s per-document validation,
 *   - every failure becomes a notification; nothing here throws at the caller,
 *   - one operation at a time: a second call while one is running is ignored,
 *     so the menu items stay honest even if a dialog is double-triggered,
 *   - the imported documents arrive under fresh ids (P8a), so importing can
 *     never inherit the exported label's template trust.
 */

export interface LabelTransfer {
    /** Parse + import a picked file. Never throws. */
    importFile: (file: File) => Promise<void>;
    /** Export the open document (no-op when none). */
    exportCurrent: () => Promise<void>;
    /** Export every stored label. */
    exportAll: () => Promise<void>;
    /** True while an import/export is running (disables the menu items). */
    busy: boolean;
}

const FALLBACK_FILE_NAME = 'label';

/**
 * `<label name>.json`, sanitised to a safe download name: anything outside
 * `[A-Za-z0-9_.-]` collapses to `-`, and leading/trailing separators are
 * dropped so a name made only of spaces or slashes still yields `label.json`.
 */
const labelFileName = (name: string): string => {
    const cleaned = name
        .replace(/[^\w.-]+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '');
    return `${cleaned.length > 0 ? cleaned : FALLBACK_FILE_NAME}.json`;
};

/** Local `YYYY-MM-DD` (not UTC: the user's "today" is the local one). */
const isoDate = (date: Date = new Date()): string => {
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * Hand a JSON value to the browser as a download.
 *
 * The object URL is revoked in a `finally`: the anchor click has already
 * handed the blob to the download machinery, and leaving the URL alive would
 * pin the whole bundle in memory for the life of the document. Returns `false`
 * when the environment has no download seam, so the caller can report it.
 */
export const downloadJson = (value: unknown, filename: string): boolean => {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
    if (typeof document === 'undefined') return false;

    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.rel = 'noopener';
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        return true;
    } finally {
        URL.revokeObjectURL(url);
    }
};

export const useLabelTransfer = (): LabelTransfer => {
    const { t } = useTranslation();
    const currentDoc = useStore((state) => state.currentDoc);
    const labelRepo = useStore((state) => state.labelRepo);
    const resourceRepo = useStore((state) => state.resourceRepo);
    const csvRepo = useStore((state) => state.csvRepo);
    const refreshGallery = useStore((state) => state.refreshGallery);
    const addNotification = useStore((state) => state.addNotification);

    const [busy, setBusy] = useState(false);
    /**
     * The re-entrancy guard is a ref, not `busy`: two calls can land in the
     * same tick, before React has re-rendered the disabled menu items.
     */
    const busyRef = useRef(false);

    /** Run one operation at a time, toggling `busy` around it. */
    const run = useCallback(async (operation: () => Promise<void>): Promise<void> => {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        try {
            await operation();
        } catch {
            // Operations report their own failures. This boundary exists so a
            // caller (Header uses `void`) can never see an unhandled rejection.
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }, []);

    const notifyError = useCallback(
        (message: string, detail?: string): void => {
            addNotification({
                type: 'error',
                message,
                ...(detail !== undefined ? { detail } : {}),
            });
        },
        [addNotification],
    );

    const importFile = useCallback(
        (file: File): Promise<void> =>
            run(async () => {
                const failed = t('importLabels.failed');

                // 1. Size guard BEFORE reading a single byte: a huge file must
                //    not be pulled into memory just to be rejected.
                if (file.size > MAX_IMPORT_BYTES) {
                    notifyError(t('importLabels.tooLarge'));
                    return;
                }

                // 2. Parse. Anything that is not JSON never reaches the importer.
                //    The picker also accepts `.gz`, so honour the gzip magic that
                //    `serializeDoc` writes for a single document.
                let raw: unknown;
                try {
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    const json =
                        bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
                            ? await decompress(bytes.buffer as ArrayBuffer, 'gzip')
                            : new TextDecoder().decode(bytes);
                    // The size guard only bounds the *compressed* bytes. Cap the
                    // decompressed JSON before parsing, so a small gzip bomb
                    // cannot expand into the parser.
                    if (json.length > MAX_IMPORT_BYTES) {
                        notifyError(t('importLabels.tooLarge'));
                        return;
                    }
                    raw = JSON.parse(json);
                } catch {
                    notifyError(failed);
                    return;
                }

                // 3. Validate + store, one document at a time (P8a never throws).
                if (!labelRepo) {
                    notifyError(failed);
                    return;
                }

                const result = await importBundle(raw, {
                    labelRepo,
                    resourceRepo,
                    csvRepo,
                }).catch(() => null);
                if (!result) {
                    notifyError(failed);
                    return;
                }

                // 4. The gallery reads the store, so it must be re-read after
                //    the writes landed (import does not go through the slices).
                await refreshGallery();

                // 5. Report. A file where nothing imported is a failure; some
                //    imported with rejections is partial; all clean is done.
                if (result.imported === 0) {
                    notifyError(failed, result.errors[0]);
                } else if (result.errors.length > 0) {
                    addNotification({
                        type: 'warning',
                        message: t('importLabels.partial', {
                            count: result.imported,
                            failed: result.errors.length,
                        }),
                    });
                } else {
                    addNotification({
                        type: 'success',
                        message: t('importLabels.done', { count: result.imported }),
                    });
                }
            }),
        [
            run,
            t,
            labelRepo,
            resourceRepo,
            csvRepo,
            refreshGallery,
            addNotification,
            notifyError,
        ],
    );

    const exportCurrent = useCallback(
        (): Promise<void> =>
            run(async () => {
                if (!currentDoc) return;
                try {
                    const { bundle } = await buildBundle([currentDoc], {
                        resourceRepo,
                        csvRepo,
                    });
                    if (!downloadJson(bundle, labelFileName(currentDoc.meta.name))) {
                        notifyError(t('exportLabels.failed'));
                    }
                } catch {
                    notifyError(t('exportLabels.failed'));
                }
            }),
        [run, currentDoc, resourceRepo, csvRepo, notifyError, t],
    );

    const exportAll = useCallback(
        (): Promise<void> =>
            run(async () => {
                const failedMessage = t('exportLabels.failed');
                if (!labelRepo) {
                    notifyError(failedMessage);
                    return;
                }

                try {
                    // `listDetailed` (not `list`) so an unreadable record is
                    // counted instead of silently vanishing from the export.
                    const { ok, errors } = await labelRepo.listDetailed();
                    let failed = errors.length;
                    const docs: LabelDoc[] = [];
                    for (const summary of ok) {
                        const doc = await labelRepo.get(summary.id);
                        if (doc) docs.push(doc);
                        else failed += 1;
                    }

                    // Nothing readable: do not hand the user an empty bundle.
                    if (docs.length === 0) {
                        notifyError(failedMessage);
                        return;
                    }

                    const { bundle } = await buildBundle(docs, { resourceRepo, csvRepo });
                    if (!downloadJson(bundle, `niimbun-labels-${isoDate()}.json`)) {
                        notifyError(failedMessage);
                        return;
                    }
                    addNotification({
                        type: failed > 0 ? 'warning' : 'success',
                        message:
                            failed > 0
                                ? t('exportLabels.partial', {
                                      count: docs.length,
                                      failed,
                                  })
                                : t('exportLabels.done', { count: docs.length }),
                    });
                } catch {
                    notifyError(failedMessage);
                }
            }),
        [run, labelRepo, resourceRepo, csvRepo, addNotification, notifyError, t],
    );

    return { importFile, exportCurrent, exportAll, busy };
};
