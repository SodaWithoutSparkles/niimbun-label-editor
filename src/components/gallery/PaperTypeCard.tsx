import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Star, Trash2 } from 'lucide-react';
import type { PaperRecord } from '../../data/paperRepo';
import { cn } from '../../utils/cn';
import { mmString } from '../../utils/mm';
import { PaperTypePreview } from '../paper/PaperTypePreview';

/**
 * One paper-type card in the gallery's paper-type grid (phase 8, W4b). A dumb
 * presentational card — the section owns the repo mutations and the confirm
 * step — mirroring `LabelCard`'s shape (preview, name, meta line, actions).
 */
interface PaperTypeCardProps {
    record: PaperRecord;
    isDefault: boolean;
    onEdit: () => void;
    onDelete: () => void;
    onSetDefault: () => void;
}

export const PaperTypeCard: React.FC<PaperTypeCardProps> = ({
    record,
    isDefault,
    onEdit,
    onDelete,
    onSetDefault,
}) => {
    const { t } = useTranslation();
    const name = record.name.length > 0 ? record.name : t('paperTypes.emptyName');

    return (
        <div className="group flex flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-800 transition-colors hover:border-gray-500">
            <div className="flex h-40 items-center justify-center overflow-hidden bg-white p-2">
                <PaperTypePreview regions={record.regions} guides={record.guides} />
            </div>

            <div className="space-y-0.5 px-3 pt-3">
                <div className="flex items-start gap-2">
                    <div className="truncate text-sm font-medium text-gray-100" title={name}>
                        {name}
                    </div>
                    {isDefault && (
                        <span className="shrink-0 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            {t('paperTypes.defaultBadge')}
                        </span>
                    )}
                </div>
                <div className="text-xs text-gray-400">
                    {t('paperTypes.dimensions', { w: mmString(record.backingW), h: mmString(record.backingH) })}
                </div>
                <div className="text-xs text-gray-400">
                    {t('paperTypes.regionCount', { n: record.regions.length })}
                </div>
            </div>

            <div className="mt-auto flex items-center justify-between gap-2 px-3 pb-3 pt-2">
                <button
                    type="button"
                    onClick={onSetDefault}
                    disabled={isDefault}
                    aria-label={isDefault ? t('paperTypes.isDefault') : t('paperTypes.setDefault')}
                    title={isDefault ? t('paperTypes.isDefault') : t('paperTypes.setDefault')}
                    className={cn(
                        'flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors',
                        isDefault
                            ? 'cursor-default border-blue-600 bg-blue-600/20 text-blue-300'
                            : 'border-gray-600 text-gray-300 hover:bg-gray-700',
                    )}
                >
                    <Star size={14} />
                    <span>{isDefault ? t('paperTypes.isDefault') : t('paperTypes.setDefault')}</span>
                </button>

                <div className="flex shrink-0 items-center gap-1">
                    <button
                        type="button"
                        onClick={onEdit}
                        aria-label={t('paperTypes.edit')}
                        title={t('paperTypes.edit')}
                        className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-100"
                    >
                        <Pencil size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={onDelete}
                        aria-label={t('paperTypes.delete')}
                        title={t('paperTypes.delete')}
                        className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-red-300"
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
};
