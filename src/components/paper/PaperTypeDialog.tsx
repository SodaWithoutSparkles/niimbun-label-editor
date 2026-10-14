import { useEffect, useState, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import type { Guide, Region } from '../../core/doc/types';
import type { PaperRecord } from '../../data/paperRepo';
import { useStore } from '../../store/useStore';
import { mmString, parseMm } from '../../utils/mm';
import { Modal } from '../common/dialogs/Modal';
import { Input, NumberField } from '../common/forms';
import { GuideEditor } from './GuideEditor';
import { PaperTypePreview } from './PaperTypePreview';
import { RegionEditor } from './RegionEditor';

/**
 * Add / edit a paper type (phase 8, W4b).
 *
 * Two columns (`md:grid-cols-2`): the WYSIWYG preview (silhouette + guides)
 * on the left, the editable fields on the right. The form is re-seeded on the
 * `open` transition only, so StrictMode's effect replay is idempotent and a
 * language change cannot wipe in-progress edits.
 *
 * Validity comes from three sources: a non-empty trimmed name, positive finite
 * mm sizes, and `RegionEditor`'s polygon signal — an invalid polygon disables
 * Save instead of persisting a record `paperRepo.put` would reject.
 *
 * The preview unions overlapping contours (nonzero fill), so interior holes are
 * not representable; `paperTypes.noHolesHint` states that plainly (plan.md:187).
 */

export interface PaperTypeDialogProps {
    open: boolean;
    /** Record being edited; `null`/omitted means "add a new paper type". */
    initial?: PaperRecord | null;
    onClose: () => void;
    /** Called after a successful `put`, before `onClose`. */
    onSaved?: () => void;
}

/** `crypto.randomUUID` with a fallback for a DOM run without Web Crypto UUID. */
const mintPaperTypeId = (): string => {
    const randomUUID = globalThis.crypto?.randomUUID;
    if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto);
    return `paper-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const PaperTypeDialog: FC<PaperTypeDialogProps> = ({ open, initial, onClose, onSaved }) => {
    const { t } = useTranslation();
    const paperRepo = useStore((state) => state.paperRepo);

    const [name, setName] = useState('');
    const [backingW, setBackingW] = useState('');
    const [backingH, setBackingH] = useState('');
    const [regions, setRegions] = useState<Region[]>([]);
    const [guides, setGuides] = useState<Guide[]>([]);
    // `RegionEditor` re-reports on mount/change; the default suits the empty form.
    const [regionsValid, setRegionsValid] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Re-seed each time the dialog opens (or targets another record). Deliberately
    // leaves `regionsValid` alone: `RegionEditor` owns that signal and re-reports
    // when the seeded regions change its result, so resetting it here could only
    // clobber a correct `false` with a stale `true`.
    useEffect(() => {
        if (!open) return;
        setName(initial?.name ?? '');
        setBackingW(initial ? mmString(initial.backingW) : '');
        setBackingH(initial ? mmString(initial.backingH) : '');
        setRegions(initial ? initial.regions.map((region) => structuredClone(region)) : []);
        setGuides(initial ? initial.guides.map((guide) => structuredClone(guide)) : []);
        setSaving(false);
        setError(null);
    }, [open, initial]);

    // `parseMm` yields 0 for a blank/garbage entry and a non-finite hm for an
    // overflowing one; both must fail the positive-finite test.
    const w = parseMm(backingW);
    const h = parseMm(backingH);
    const sizeValid = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
    const valid = name.trim().length > 0 && sizeValid && regionsValid;

    const handleSave = async () => {
        if (!valid) return;
        setSaving(true);
        setError(null);
        const record: PaperRecord = {
            id: initial?.id ?? mintPaperTypeId(),
            name: name.trim(),
            backingW: w,
            backingH: h,
            regions,
            guides,
        };
        try {
            if (!paperRepo) throw new Error('paper storage unavailable');
            await paperRepo.put(record);
        } catch {
            // Keep the dialog open with the edits intact so the user can retry.
            setSaving(false);
            setError(t('paperTypes.saveFailed'));
            return;
        }
        setSaving(false);
        onSaved?.();
        onClose();
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={initial ? t('paperTypes.editTitle') : t('paperTypes.add')}
            size="xl"
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
                        {t('paperTypes.save')}
                    </button>
                </>
            }
        >
            <div className="grid gap-6 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                    <div className="flex h-64 items-center justify-center overflow-hidden rounded border border-gray-700 bg-white p-2">
                        <PaperTypePreview regions={regions} guides={guides} />
                    </div>
                    <p className="text-xs text-gray-500">{t('paperTypes.noHolesHint')}</p>
                </div>

                <div className="space-y-4">
                    <label className="flex flex-col gap-1 text-xs text-gray-400">
                        {t('paperTypes.name')}
                        <Input
                            value={name}
                            onChange={setName}
                            placeholder={t('paperTypes.namePlaceholder')}
                        />
                    </label>

                    <div className="grid grid-cols-2 gap-4">
                        <NumberField label={t('paperTypes.width')} value={backingW} onChange={setBackingW} />
                        <NumberField label={t('paperTypes.height')} value={backingH} onChange={setBackingH} />
                    </div>

                    <RegionEditor regions={regions} onChange={setRegions} onValidityChange={setRegionsValid} />
                    <GuideEditor guides={guides} onChange={setGuides} />

                    {error && <p className="text-sm text-red-400">{error}</p>}
                </div>
            </div>
        </Modal>
    );
};
