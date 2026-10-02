import React from 'react';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { hmToMm } from '../../core/hm';
import { useStore } from '../../store/useStore';
import type { LabelSummary } from '../../data/labelRepo';

/** Format an hm dimension as millimetres for the card's size line. */
const formatMm = (value: number): string => {
    const mm = hmToMm(value);
    return Number.isInteger(mm) ? String(mm) : mm.toFixed(1);
};

/**
 * Generated placeholder art — backing outline only.
 *
 * Decision: P2 renders the cheap placeholder from the denormalized
 * `backingW/H` already on `LabelSummary`, with no per-card `repo.get`. The
 * region-union silhouette would require decompressing every thumbless doc,
 * defeating the backingW/H denormalization; denormalizing union bounds into
 * the record is a larger change deferred to P4 (real rendering).
 */
const PlaceholderArt: React.FC<{ backingW: number; backingH: number }> = ({
    backingW,
    backingH,
}) => {
    // NaN/Infinity in `viewBox`/`width`/`height` blanks the SVG silently. Fall
    // back to a small positive placeholder so a corrupt summary still renders.
    const safeW = Number.isFinite(backingW) && backingW > 0 ? backingW : 100;
    const safeH = Number.isFinite(backingH) && backingH > 0 ? backingH : 100;
    const strokeWidth = Math.max(1, Math.round(Math.min(safeW, safeH) * 0.01));
    return (
        <svg
            viewBox={`0 0 ${safeW} ${safeH}`}
            width={safeW}
            height={safeH}
            className="h-auto max-h-full w-auto max-w-full"
            role="img"
        >
            <rect x={0} y={0} width={safeW} height={safeH} fill="#ffffff" stroke="#9ca3af" strokeWidth={strokeWidth} />
        </svg>
    );
};

interface LabelCardProps {
    summary: LabelSummary;
    onOpen: (id: string) => void;
}

export const LabelCard: React.FC<LabelCardProps> = ({ summary, onOpen }) => {
    const { t } = useTranslation();
    const language = useStore((state) => state.language);

    const name = summary.name.length > 0 ? summary.name : t('nav.newLabel');
    const updated = new Date(summary.updatedAt * 1000).toLocaleDateString(language);
    const size = t('gallery.size', { w: formatMm(summary.backingW), h: formatMm(summary.backingH) });

    return (
        <div className="group flex flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-800 transition-colors hover:border-gray-500">
            <button
                type="button"
                onClick={() => onOpen(summary.id)}
                aria-label={t('gallery.openLabel', { name })}
                className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
                <div className="flex h-40 items-center justify-center overflow-hidden bg-white p-2">
                    {summary.thumb ? (
                        <img src={summary.thumb} alt={name} className="max-h-full max-w-full object-contain" />
                    ) : (
                        <PlaceholderArt backingW={summary.backingW} backingH={summary.backingH} />
                    )}
                </div>
                <div className="space-y-0.5 px-3 pt-3">
                    <div className="text-xs text-gray-400" title={t('gallery.updatedTitle')}>
                        {updated}
                    </div>
                    <div className="truncate text-sm font-medium text-gray-100" title={name}>
                        {name}
                    </div>
                </div>
            </button>
            <div className="flex items-center justify-between px-3 pb-3 pt-1">
                <span className="text-xs text-gray-400">{size}</span>
                <button
                    type="button"
                    disabled
                    title={t('gallery.quickPrintUnavailable')}
                    aria-label={t('gallery.quickPrint')}
                    className="flex cursor-not-allowed items-center gap-1 rounded border border-gray-600 px-2 py-1 text-xs text-gray-500"
                >
                    <Printer size={14} />
                    <span>{t('gallery.quickPrint')}</span>
                </button>
            </div>
        </div>
    );
};
