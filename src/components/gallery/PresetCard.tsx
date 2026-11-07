import React from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import type { LabelSummary } from '../../data/labelRepo';
import { CardArt } from './CardArt';
import { formatCardMm } from './cardFormat';

/**
 * One preset card in the gallery's Label presets pane (P3).
 *
 * Presentational only, mirroring `LabelCard`'s frame and art: the section owns
 * the confirm step and the `deleteLabel` store contract. The art block is the
 * open affordance (P5 opens the fill dialog) and delete is a **sibling**
 * button, never nested inside it.
 */
interface PresetCardProps {
    summary: LabelSummary;
    onOpen: (id: string) => void;
    onDelete: (id: string) => void;
}

export const PresetCard: React.FC<PresetCardProps> = ({ summary, onOpen, onDelete }) => {
    const { t } = useTranslation();

    const name = summary.name.length > 0 ? summary.name : t('nav.newLabel');
    const size = t('gallery.size', {
        w: formatCardMm(summary.backingW),
        h: formatCardMm(summary.backingH),
    });

    return (
        <div className="group flex flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-800 transition-colors hover:border-gray-500">
            <button
                type="button"
                onClick={() => onOpen(summary.id)}
                aria-label={t('presets.open', { name })}
                className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
                <CardArt
                    thumb={summary.thumb}
                    backingW={summary.backingW}
                    backingH={summary.backingH}
                    name={name}
                />
                <div className="space-y-0.5 px-3 pt-3">
                    <div className="truncate text-sm font-medium text-gray-100" title={name}>
                        {name}
                    </div>
                </div>
            </button>
            <div className="flex items-center justify-between px-3 pb-3 pt-1">
                <span className="text-xs text-gray-400">{size}</span>
                <div className="flex items-center gap-1">
                    {/* Sibling of the open button, never nested: nested buttons are
                        invalid HTML and swallow the click. */}
                    <button
                        type="button"
                        onClick={() => onDelete(summary.id)}
                        title={t('gallery.delete')}
                        aria-label={t('gallery.delete')}
                        className="flex items-center rounded border border-gray-600 px-2 py-1 text-xs text-gray-400 transition-colors hover:border-red-500 hover:text-red-300"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>
        </div>
    );
};
