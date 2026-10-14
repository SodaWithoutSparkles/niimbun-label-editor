import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CsvRecord } from '../../data/csvRepo';
import { Modal } from '../common/dialogs/Modal';
import { Input } from '../common/forms';

/**
 * Rename a CSV table (phase 9, W1b; plan decision **D3** — "edit" is a rename).
 *
 * The form re-seeds on the `open` transition only (mirroring `PaperTypeDialog`),
 * so StrictMode's effect replay is idempotent and a language change cannot wipe
 * in-progress edits. An empty/whitespace name disables Save — the record's name
 * is user-facing, so blank is blocked rather than persisted.
 *
 * The write itself lives in the section (`useCatalogue.save`); `onSave` resolves
 * `false` on failure (already notified) so the dialog stays open for a retry.
 */

export interface CsvRenameDialogProps {
    open: boolean;
    /** Record being renamed; `null` while closed. */
    record: CsvRecord | null;
    onClose: () => void;
    /** Persist the new name; `true` closes the dialog. */
    onSave: (name: string) => Promise<boolean>;
}

export const CsvRenameDialog = ({ open, record, onClose, onSave }: CsvRenameDialogProps) => {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);

    // Re-seed each time the dialog opens (or targets another record).
    useEffect(() => {
        if (!open) return;
        setName(record?.name ?? '');
        setSaving(false);
    }, [open, record]);

    const valid = name.trim().length > 0;

    const handleSave = async () => {
        if (!valid || saving) return;
        setSaving(true);
        const ok = await onSave(name.trim());
        setSaving(false);
        if (ok) onClose();
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={t('csvs.renameTitle')}
            closeDisabled={saving}
            footer={
                <>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded bg-gray-700 px-4 py-2 text-sm hover:bg-gray-600"
                    >
                        {t('dialog.cancel')}
                    </button>
                    <button
                        type="button"
                        disabled={!valid || saving}
                        onClick={() => {
                            void handleSave();
                        }}
                        className="rounded bg-blue-600 px-4 py-2 text-sm hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {t('csvs.save')}
                    </button>
                </>
            }
        >
            <label className="flex flex-col gap-1 text-xs text-gray-400">
                {t('csvs.name')}
                <Input
                    value={name}
                    onChange={setName}
                    placeholder={t('csvs.namePlaceholder')}
                    aria-label={t('csvs.name')}
                />
            </label>
        </Modal>
    );
};
