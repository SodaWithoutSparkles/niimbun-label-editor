import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon, Pencil, Trash2, Type } from 'lucide-react';
import type { ResourceRecord } from '../../data/resourceRepo';

/**
 * One media tile in the gallery's media grid (phase 9, W2). A dumb
 * presentational card — the section owns the repo mutations, the confirm step
 * and the rename dialog — mirroring `CsvCard`/`PaperTypeCard`'s chrome.
 *
 * Preview (R9e): an image's bytes are a `Uint8Array`, so a displayable URL is an
 * **object URL** built from a `Blob`. It is created in an effect keyed on the
 * bytes and revoked on unmount or when the bytes/mediaType change, so a card
 * never leaks a URL. `URL.createObjectURL` is guarded — where it is missing the
 * tile falls back to the type icon + `previewUnavailable` instead of crashing.
 *
 * A font (or a legacy record with no metadata) shows a type icon + the name;
 * legacy rows fall back to the id.
 */

const isImage = (mediaType: string): boolean => mediaType.startsWith('image/');

interface MediaCardProps {
    record: ResourceRecord;
    /** True when no document references this resource (orphan sweep, W4). */
    isOrphan?: boolean;
    onRename: () => void;
    onDelete: () => void;
}

export const MediaCard: React.FC<MediaCardProps> = ({ record, isOrphan = false, onRename, onDelete }) => {
    const { t } = useTranslation();
    const name = record.name && record.name.length > 0 ? record.name : record.id;
    const image = isImage(record.mediaType);
    const [objectUrl, setObjectUrl] = useState<string | null>(null);

    // Build/revoke the preview URL for an image. Keyed on the bytes identity so
    // a different record (or a replaced byte payload) re-creates the URL.
    useEffect(() => {
        if (!image) {
            setObjectUrl(null);
            return;
        }
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
    }, [image, record.bytes, record.mediaType]);

    const typeLabel = image ? t('media.image') : t('media.font');
    const hasDims = record.widthPx !== undefined && record.heightPx !== undefined;

    return (
        <div className="group flex flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-800 transition-colors hover:border-gray-500">
            <div className="flex h-40 items-center justify-center overflow-hidden bg-gray-900 p-3">
                {image && objectUrl ? (
                    <img src={objectUrl} alt={name} className="h-full w-full object-contain" />
                ) : (
                    <div className="flex flex-col items-center gap-2 text-gray-600">
                        {image ? <ImageIcon size={28} /> : <Type size={28} />}
                        {image && (
                            <p className="text-center text-xs text-gray-500">
                                {t('media.previewUnavailable')}
                            </p>
                        )}
                    </div>
                )}
            </div>

            <div className="space-y-0.5 px-3 pt-3">
                <div className="flex items-center gap-2">
                    <div className="truncate text-sm font-medium text-gray-100" title={name}>
                        {name}
                    </div>
                    {isOrphan && (
                        <span className="shrink-0 rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                            {t('media.unused')}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-400">
                    <span>{typeLabel}</span>
                    {hasDims && (
                        <>
                            <span aria-hidden="true">·</span>
                            <span>{t('media.dimensions', { w: record.widthPx, h: record.heightPx })}</span>
                        </>
                    )}
                </div>
            </div>

            <div className="mt-auto flex items-center justify-end gap-1 px-3 pb-3 pt-2">
                <button
                    type="button"
                    onClick={onRename}
                    aria-label={t('media.rename')}
                    title={t('media.rename')}
                    className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-100"
                >
                    <Pencil size={16} />
                </button>
                <button
                    type="button"
                    onClick={onDelete}
                    aria-label={t('media.delete')}
                    title={t('media.delete')}
                    className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-red-300"
                >
                    <Trash2 size={16} />
                </button>
            </div>
        </div>
    );
};
