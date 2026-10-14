import React from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, Pencil, Table2, Trash2 } from 'lucide-react';
import type { CsvRecord } from '../../data/csvRepo';

/**
 * One CSV card in the gallery's CSV grid (phase 9, W1b). A dumb presentational
 * card — the section owns the repo mutations, the confirm step and the dialogs —
 * mirroring `PaperTypeCard`'s chrome (art area, name, meta line, icon actions).
 *
 * The art area stands in for the paper preview: a table glyph plus the joined
 * column names, so a wide table is truncated rather than overflowing.
 */
interface CsvCardProps {
    record: CsvRecord;
    /** True when no document references this table (orphan sweep, W4). */
    isOrphan?: boolean;
    onView: () => void;
    onRename: () => void;
    onDelete: () => void;
}

export const CsvCard: React.FC<CsvCardProps> = ({ record, isOrphan = false, onView, onRename, onDelete }) => {
    const { t } = useTranslation();
    const name = record.name.length > 0 ? record.name : t('csvs.emptyName');

    return (
        <div className="group flex flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-800 transition-colors hover:border-gray-500">
            <div className="flex h-40 flex-col justify-center gap-2 overflow-hidden bg-gray-900 p-3">
                <Table2 size={28} className="mx-auto shrink-0 text-gray-600" />
                {record.columns.length > 0 && (
                    <p className="truncate text-center text-xs text-gray-500" title={record.columns.join(', ')}>
                        {record.columns.join(', ')}
                    </p>
                )}
            </div>

            <div className="space-y-0.5 px-3 pt-3">
                <div className="flex items-center gap-2">
                    <div className="truncate text-sm font-medium text-gray-100" title={name}>
                        {name}
                    </div>
                    {isOrphan && (
                        <span className="shrink-0 rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                            {t('csvs.unused')}
                        </span>
                    )}
                </div>
                <div className="text-xs text-gray-400">
                    {t('csvs.rowsCols', { rows: record.rows.length, cols: record.columns.length })}
                </div>
            </div>

            <div className="mt-auto flex items-center justify-end gap-1 px-3 pb-3 pt-2">
                <button
                    type="button"
                    onClick={onView}
                    aria-label={t('csvs.view')}
                    title={t('csvs.view')}
                    className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-100"
                >
                    <Eye size={16} />
                </button>
                <button
                    type="button"
                    onClick={onRename}
                    aria-label={t('csvs.rename')}
                    title={t('csvs.rename')}
                    className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-100"
                >
                    <Pencil size={16} />
                </button>
                <button
                    type="button"
                    onClick={onDelete}
                    aria-label={t('csvs.delete')}
                    title={t('csvs.delete')}
                    className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-red-300"
                >
                    <Trash2 size={16} />
                </button>
            </div>
        </div>
    );
};
