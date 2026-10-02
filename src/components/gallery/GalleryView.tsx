import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageOff } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { LabelCard } from './LabelCard';

/**
 * Gallery home surface — a grid of pseudo-cards. Art is never rendered from a
 * template and nothing is fetched; see `LabelCard` for the resolve order.
 */
export const GalleryView: React.FC = () => {
    const { t } = useTranslation();
    const gallery = useStore((state) => state.gallery);
    const galleryLoading = useStore((state) => state.galleryLoading);
    const storageError = useStore((state) => state.storageError);
    const openLabel = useStore((state) => state.openLabel);
    const addNotification = useStore((state) => state.addNotification);

    const handleOpen = useCallback(
        (id: string) => {
            void openLabel(id).then((doc) => {
                // A corrupt payload yields `null` instead of a silent no-op click.
                if (!doc) {
                    addNotification({ type: 'error', message: t('gallery.openFailed') });
                }
            });
        },
        [openLabel, addNotification, t],
    );

    if (galleryLoading) {
        return (
            <div className="flex flex-1 items-center justify-center bg-gray-900 text-sm text-gray-400">
                {t('gallery.loading')}
            </div>
        );
    }

    if (storageError) {
        return (
            <div
                role="alert"
                className="flex flex-1 flex-col items-center justify-center gap-2 bg-gray-900 p-8 text-center"
            >
                <ImageOff size={32} className="text-red-500" />
                <div className="text-base font-medium text-gray-200">
                    {t('gallery.storageUnavailableTitle')}
                </div>
                <div className="text-sm text-gray-400">{t('gallery.storageUnavailableHint')}</div>
            </div>
        );
    }

    if (gallery.length === 0) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-gray-900 p-8 text-center">
                <ImageOff size={32} className="text-gray-600" />
                <div className="text-base font-medium text-gray-200">{t('gallery.emptyTitle')}</div>
                <div className="text-sm text-gray-400">{t('gallery.emptyHint')}</div>
            </div>
        );
    }

    return (
        <div className="min-w-0 flex-1 overflow-y-auto bg-gray-900 p-6">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                {gallery.map((summary) => (
                    <LabelCard key={summary.id} summary={summary} onOpen={handleOpen} />
                ))}
            </div>
        </div>
    );
};
