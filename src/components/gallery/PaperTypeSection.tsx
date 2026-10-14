import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PaperRecord } from '../../data/paperRepo';
import { useStore } from '../../store/useStore';
import { mmString } from '../../utils/mm';
import { confirm } from '../common/dialogs/dialogService';
import { PaperTypeDialog } from '../paper/PaperTypeDialog';
import { CatalogueLayout, type CatalogueStatus } from './CatalogueLayout';
import { PaperTypeCard } from './PaperTypeCard';
import { useCatalogue } from './useCatalogue';

/**
 * Gallery main pane for paper types (phase 8, W4b): a searchable card grid with
 * add / edit / delete / set-default. Since phase 9 (W1) the shell is the shared
 * {@link CatalogueLayout} and the load/mutation semantics come from
 * {@link useCatalogue}, so the CSV and media sections read the same.
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
    const paperRepo = useStore((state) => state.paperRepo);
    const { items, loading, error, reload, remove } = useCatalogue<PaperRecord>({
        repo: paperRepo,
        messages: {
            saveFailed: t('paperTypes.saveFailed'),
            deleteFailed: t('paperTypes.deleteFailed'),
        },
    });
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

    const status: CatalogueStatus = loading
        ? { kind: 'loading', message: t('paperTypes.loading') }
        : error
          ? { kind: 'error', message: t('paperTypes.readError') }
          : items.length === 0
            ? { kind: 'empty', message: t('paperTypes.empty') }
            : visible.length === 0
              ? { kind: 'searchEmpty', message: t('paperTypes.searchEmpty', { query }) }
              : { kind: 'ready' };

    return (
        <CatalogueLayout
            title={t('paperTypes.title')}
            addLabel={t('paperTypes.add')}
            onAdd={openAdd}
            search={{
                value: query,
                onChange: setQuery,
                placeholder: t('paperTypes.searchPlaceholder'),
            }}
            status={status}
            dialog={
                <PaperTypeDialog
                    open={dialogOpen}
                    initial={editing}
                    onClose={() => setDialogOpen(false)}
                    onSaved={() => {
                        void reload();
                    }}
                />
            }
        >
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
        </CatalogueLayout>
    );
};
