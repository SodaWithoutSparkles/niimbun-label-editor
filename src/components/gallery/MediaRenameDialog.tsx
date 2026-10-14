import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResourceRecord } from '../../data/resourceRepo';
import { Modal } from '../common/dialogs/Modal';
import { Input } from '../common/forms';

/**
 * Rename a media resource (phase 9, W2), mirroring `CsvRenameDialog`.
 *
 * The form re-seeds on the `open` transition only, so StrictMode's effect replay
 * is idempotent and a language change cannot wipe in-progress edits. A
 * legacy record has no `name`, so the field seeds from the id (what the tile
 * already displays). An empty/whitespace name disables Save.
 *
 * The write itself lives in the section (`useCatalogue.save`); `onSave` resolves
 * `false` on failure (already notified) so the dialog stays open for a retry.
 */

export interface MediaRenameDialogProps {
    open: boolean;
    /** Record being renamed; `null` while closed. */
    record: ResourceRecord | null;
    onClose: () => void;
    /** Persist the new name; `true` closes the dialog. */
    onSave: (name: string) => Promise<boolean>;
}

export const MediaRenameDialog = ({ open, record, onClose, onSave }: MediaRenameDialogProps) => {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);

    // Re-seed each time the dialog opens (or targets another record).
    useEffect(() => {
        if (!open) return;
        setName(record?.name ?? record?.id ?? '');
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
            title={t('media.renameTitle')}
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
                        {t('media.save')}
                    </button>
                </>
            }
        >
            <label className="flex flex-col gap-1 text-xs text-gray-400">
                {t('media.name')}
                <Input
                    value={name}
                    onChange={setName}
                    placeholder={t('media.namePlaceholder')}
                    aria-label={t('media.name')}
                />
            </label>
        </Modal>
    );
};
