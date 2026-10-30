import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageOff } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { confirm } from '../common/dialogs/dialogService';
import { FillPresetDialog } from './FillPresetDialog';
import { PresetCard } from './PresetCard';
import { useThumbBackfill } from './useThumbBackfill';

/**
 * Gallery main pane for **Label presets** (`#/gallery/templates`, P3).
 *
 * Shows only `LabelSummary`s whose `kind` is `'preset'`, in the store's
 * newest-first order. The shell reuses the catalogue title bar's typography and
 * spacing but deliberately has **no add button and no search**: presets are
 * created from the editor (P4), and the pane is a small grid (owner decision,
 * 2026-10-30). Ordinary labels never appear here, and presets never appear in
 * `GalleryView`.
 *
 * Deleting goes through the store's `deleteLabel` (never a raw repo
 * `remove`): it owns the autosave flush, the in-flight open invalidation and
 * the gallery refresh. Failures surface through the store's own notification.
 * The section also owns which preset's fill dialog is open (P5), so the cards
 * stay presentational.
 */
export const PresetSection: React.FC = () => {
    const { t } = useTranslation();
    const gallery = useStore((state) => state.gallery);
    const galleryLoading = useStore((state) => state.galleryLoading);
    const storageError = useStore((state) => state.storageError);
    const deleteLabel = useStore((state) => state.deleteLabel);
    /** The preset whose fill dialog is open; `null` = closed. */
    const [fillId, setFillId] = useState<string | null>(null);

    // Presets saved before a thumb existed get one on this visit, same as the
    // Recent grid. Mounted above the early returns so the hook order is stable.
    useThumbBackfill();

    const presets = useMemo(
        () => gallery.filter((summary) => summary.kind === 'preset'),
        [gallery],
    );

    const handleDelete = useCallback(
        async (id: string) => {
            const summary = presets.find((item) => item.id === id);
            const name = summary?.name ? summary.name : t('nav.newLabel');
            const ok = await confirm({ danger: true, message: t('gallery.deleteConfirm', { name }) });
            if (!ok) return;
            await deleteLabel(id);
        },
        [presets, deleteLabel, t],
    );

    const body = galleryLoading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-gray-900 text-sm text-gray-400">
            {t('gallery.loading')}
        </div>
    ) : storageError ? (
        <div
            role="alert"
            className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-gray-900 p-8 text-center"
        >
            <ImageOff size={32} className="text-red-500" />
            <div className="text-base font-medium text-gray-200">
                {t('gallery.storageUnavailableTitle')}
            </div>
            <div className="text-sm text-gray-400">{t('gallery.storageUnavailableHint')}</div>
        </div>
    ) : presets.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-gray-900 p-8 text-center">
            <ImageOff size={32} className="text-gray-600" />
            <div className="text-base font-medium text-gray-200">{t('presets.emptyTitle')}</div>
            <div className="text-sm text-gray-400">{t('presets.emptyHint')}</div>
        </div>
    ) : (
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-gray-900 p-6 [scrollbar-gutter:stable]">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                {presets.map((summary) => (
                    <PresetCard
                        key={summary.id}
                        summary={summary}
                        onOpen={setFillId}
                        onDelete={(id) => {
                            void handleDelete(id);
                        }}
                    />
                ))}
            </div>
        </div>
    );

    return (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-gray-900">
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-700 px-6 py-4">
                <h1 className="text-lg font-semibold text-gray-100">{t('presets.title')}</h1>
            </div>
            {body}
            <FillPresetDialog
                open={fillId !== null}
                presetId={fillId}
                onClose={() => setFillId(null)}
            />
        </div>
    );
};
