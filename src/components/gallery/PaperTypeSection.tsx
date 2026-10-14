import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type { PaperRecord } from '../../data/paperRepo';
import { useStore } from '../../store/useStore';
import { mmString } from '../../utils/mm';
import { confirm } from '../common/dialogs/dialogService';
import { Input } from '../common/forms';
import { PaperTypeDialog } from '../paper/PaperTypeDialog';
import { usePaperTypes } from '../paper/usePaperTypes';
import { PaperTypeCard } from './PaperTypeCard';

/**
 * Gallery main pane for paper types (phase 8, W4b): a searchable card grid with
 * add / edit / delete / set-default. Modeled on `GalleryView`'s grid so the two
 * catalogue surfaces read the same (P9 reuses this shape for CSV + media).
 *
 * The search is a pure exported predicate ({@link filterPaperTypes}) so it is
 * unit-testable without a DOM.
 */

/** Normalize a mm dimension for both `25x78` and `25 × 78` style queries. */
const dimensionHaystack = (record: PaperRecord): string => {
    const w = mmString(record.backingW);
    const h = mmString(record.backingH);
    return [
        `${w}×${h}`,
        `${w} × ${h}`,
        `${w}x${h}`,
        `${w}×${h}mm`,
        `${w}x${h}mm`,
        `${w} × ${h} mm`,
    ].join(' ');
};

/**
 * Case-insensitive substring search over the paper type's **name** and its
 * **dimensions** (W×H in mm); an empty/whitespace query returns every item.
 */
export const filterPaperTypes = (items: readonly PaperRecord[], query: string): PaperRecord[] => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [...items];
    return items.filter(
        (item) => item.name.toLowerCase().includes(q) || dimensionHaystack(item).toLowerCase().includes(q),
    );
};

export const PaperTypeSection: React.FC = () => {
    const { t } = useTranslation();
    const { items, loading, error, reload, remove } = usePaperTypes();
    const defaultPaperTypeId = useStore((state) => state.defaultPaperTypeId);
    const setDefaultPaperTypeId = useStore((state) => state.setDefaultPaperTypeId);

    const [query, setQuery] = useState('');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<PaperRecord | null>(null);

    const visible = filterPaperTypes(items, query);

    const openAdd = () => {
        setEditing(null);
        setDialogOpen(true);
    };

    const openEdit = (record: PaperRecord) => {
        setEditing(record);
        setDialogOpen(true);
    };

    const handleDelete = async (record: PaperRecord) => {
        const ok = await confirm({
            danger: true,
            message: t('paperTypes.deleteConfirm', { name: record.name }),
        });
        if (!ok) return;
        const removed = await remove(record.id);
        // A deleted default is a dangling preference: clear it so a new label
        // falls back to the first catalogue entry instead of a missing id.
        if (removed && defaultPaperTypeId === record.id) {
            setDefaultPaperTypeId(undefined);
        }
    };

    const body = (() => {
        if (loading) {
            return (
                <p role="status" className="text-sm text-gray-400">
                    {t('paperTypes.loading')}
                </p>
            );
        }
        if (error) {
            return (
                <p role="alert" className="text-sm text-red-400">
                    {t('paperTypes.readError')}
                </p>
            );
        }
        if (items.length === 0) {
            return <p className="text-sm text-gray-500">{t('paperTypes.empty')}</p>;
        }
        if (visible.length === 0) {
            return <p className="text-sm text-gray-500">{t('paperTypes.searchEmpty', { query })}</p>;
        }
        return (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                {visible.map((record) => (
                    <PaperTypeCard
                        key={record.id}
                        record={record}
                        isDefault={defaultPaperTypeId === record.id}
                        onEdit={() => openEdit(record)}
                        onDelete={() => {
                            void handleDelete(record);
                        }}
                        onSetDefault={() => setDefaultPaperTypeId(record.id)}
                    />
                ))}
            </div>
        );
    })();

    return (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-gray-900">
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-700 px-6 py-4">
                <h1 className="text-lg font-semibold text-gray-100">{t('paperTypes.title')}</h1>
                <button
                    type="button"
                    onClick={openAdd}
                    className="flex items-center gap-2 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
                >
                    <Plus size={16} />
                    {t('paperTypes.add')}
                </button>
            </div>

            <div className="shrink-0 px-6 pt-4">
                <Input
                    value={query}
                    onChange={setQuery}
                    placeholder={t('paperTypes.searchPlaceholder')}
                    aria-label={t('paperTypes.searchPlaceholder')}
                    className="max-w-sm"
                />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-6">{body}</div>

            <PaperTypeDialog
                open={dialogOpen}
                initial={editing}
                onClose={() => setDialogOpen(false)}
                onSaved={() => {
                    void reload();
                }}
            />
        </div>
    );
};
