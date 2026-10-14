import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mmToHm } from '../../core/hm';
import { DEFAULT_BACKING_H, DEFAULT_BACKING_W } from '../../core/doc/factory';
import { finishPolygonPoints } from '../../editor/polygonDrawing';
import type { Guide, Region } from '../../core/doc/types';
import type { PaperRecord } from '../../data/paperRepo';
import type { CreateLabelSpec } from '../../store/storeTypes';
import { useStore } from '../../store/useStore';
import { mmString } from '../../utils/mm';
import { Modal } from '../common/dialogs';
import { Input, NumberField, Select, SettingRow } from '../common/forms';
import { RegionEditor } from '../paper/RegionEditor';

const DEFAULT_DPI = 300;

interface CreateLabelDialogProps {
    open: boolean;
    onClose: () => void;
}

/**
 * Shared create-label modal: a paper-type picker backed by the `papers`
 * catalogue (`paperRepo`), a custom fallback, and the shared `RegionEditor`
 * (boxed regions and polygons are both editable here, matching the paper-type
 * dialog). Submits through the store's `createLabel`, which builds via the
 * factory, saves to IDB and refreshes the gallery.
 *
 * The picker lists catalogue records only (owner decision: no synthetic "Custom
 * size" entry). The selected id is passed as provenance; the geometry
 * (`backingW`/`backingH`/`regions`/`guides`) is submitted explicitly, so a
 * paper type deleted between open and submit can never make creation throw.
 */
export const CreateLabelDialog: React.FC<CreateLabelDialogProps> = ({ open, onClose }) => {
    const { t } = useTranslation();
    const createLabel = useStore((state) => state.createLabel);
    // Subscribed (not just `getState()`d) so the catalogue load below retries when
    // `initPersistence` installs the repo after the dialog already opened.
    const paperRepo = useStore((state) => state.paperRepo);

    const [name, setName] = useState('');
    const [paperTypes, setPaperTypes] = useState<PaperRecord[]>([]);
    const [paperTypeId, setPaperTypeId] = useState('');
    const [backingW, setBackingW] = useState(mmString(DEFAULT_BACKING_W));
    const [backingH, setBackingH] = useState(mmString(DEFAULT_BACKING_H));
    const [dpi, setDpi] = useState(String(DEFAULT_DPI));
    const [regions, setRegions] = useState<Region[]>([]);
    const [guides, setGuides] = useState<Guide[]>([]);
    // `RegionEditor` re-reports on mount/change; the default suits an empty form.
    const [regionsValid, setRegionsValid] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // Re-seed the form each time the dialog opens (or the catalogue repo becomes
    // available) by resolving it (`paperRepo.list()` is async). Depending on
    // `paperRepo` retries a boot race where the dialog opens before
    // `initPersistence` installs the repo — otherwise the picker stays empty for
    // that opening. The `cancelled` flag makes this StrictMode-safe: the
    // replayed effect, or a stale resolve after a close, cannot clobber the
    // newer seed.
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        setSaving(false);

        const { defaultPaperTypeId } = useStore.getState();
        const load = async () => {
            let records: PaperRecord[] = [];
            if (paperRepo) {
                try {
                    records = await paperRepo.list();
                } catch {
                    // A catalogue read failure falls back to "no paper types";
                    // the dialog still works on the custom geometry.
                    records = [];
                }
            }
            if (cancelled) return;
            setPaperTypes(records);
            // Default resolution: the stored preference wins only when it
            // resolves to a catalogue record; otherwise fall back to `custom`
            // (no paper type, blank geometry). A dangling/deleted id must never
            // throw — it simply does not match.
            const record = defaultPaperTypeId
                ? records.find((entry) => entry.id === defaultPaperTypeId)
                : undefined;
            if (record) {
                setName(record.name);
                setPaperTypeId(record.id);
                setBackingW(mmString(record.backingW));
                setBackingH(mmString(record.backingH));
                setRegions(record.regions.map((region) => structuredClone(region)));
                setGuides(record.guides.map((guide) => structuredClone(guide)));
            } else {
                setName('');
                setPaperTypeId('');
                setBackingW(mmString(DEFAULT_BACKING_W));
                setBackingH(mmString(DEFAULT_BACKING_H));
                setRegions([]);
                setGuides([]);
            }
            setDpi(String(DEFAULT_DPI));
            setLoading(false);
        };
        void load();

        return () => {
            cancelled = true;
        };
    }, [open, paperRepo]);

    // Picking a record seeds its geometry (and guides). Editing W/H or the
    // region list afterwards does NOT clear the id: the id is provenance only,
    // and the explicit geometry is what gets submitted.
    const handlePaperTypeChange = (value: string) => {
        setPaperTypeId(value);
        const record = paperTypes.find((entry) => entry.id === value);
        if (!record) return;
        setName(record.name);
        setBackingW(mmString(record.backingW));
        setBackingH(mmString(record.backingH));
        setRegions(record.regions.map((region) => structuredClone(region)));
        setGuides(record.guides.map((guide) => structuredClone(guide)));
    };

    const handleSubmit = async () => {
        // A polygon the shared editor rejected must never be submitted. The
        // disabled Create button (`regionsValid`) is only a UX hint: it is
        // reported from `RegionEditor`'s passive effect, so right after an
        // invalid edit the handler can still observe a stale `true`. Validate
        // synchronously from the current `regions` here — the same predicate
        // `RegionEditor` uses — and bail. The editor already renders the inline
        // invalid-points hint, so no extra error is needed.
        const polygonsValid = regions.every(
            (region) => region.kind !== 'polygon' || finishPolygonPoints(region.points) !== null,
        );
        if (!polygonsValid) return;
        const mmW = Number(backingW);
        const mmH = Number(backingH);
        const w = Number.isFinite(mmW) ? mmToHm(mmW) : Number.NaN;
        const h = Number.isFinite(mmH) ? mmToHm(mmH) : Number.NaN;
        // Non-finite (e.g. `1e308` overflowing `mmToHm` to Infinity) must not pass.
        if (!Number.isFinite(mmW) || !Number.isFinite(mmH) || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
            setError(t('createLabel.invalidSize'));
            return;
        }
        const dpiValue = Number(dpi);
        const spec: CreateLabelSpec = {
            name: name.trim() || undefined,
            // Provenance only, and only when a catalogue record is selected.
            ...(paperTypeId ? { paperTypeId } : {}),
            backingW: w,
            backingH: h,
            dpi: Number.isFinite(dpiValue) && dpiValue > 0 ? Math.round(dpiValue) : DEFAULT_DPI,
            regions,
            guides,
        };

        setSaving(true);
        setError(null);
        let doc: Awaited<ReturnType<typeof createLabel>> = null;
        try {
            doc = await createLabel(spec);
        } catch {
            // `createLabel` is contractually non-throwing, but a future change (or
            // a rejection from an injected repo) must never leave the button
            // stuck on `saving`. Fall through to the visible error branch below.
            doc = null;
        } finally {
            setSaving(false);
        }
        if (!doc) {
            setError(t('errors.saveFailed'));
            return;
        }
        onClose();
    };

    const paperTypeOptions = paperTypes.map((record) => ({ value: record.id, label: record.name }));

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={t('createLabel.title')}
            size="lg"
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
                        disabled={saving || loading || !regionsValid}
                        onClick={() => {
                            void handleSubmit();
                        }}
                        className="rounded bg-blue-600 px-4 py-2 text-sm hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {t('createLabel.create')}
                    </button>
                </>
            }
        >
            <div className="space-y-1">
                <SettingRow label={t('createLabel.name')}>
                    <Input
                        value={name}
                        onChange={setName}
                        placeholder={t('createLabel.namePlaceholder')}
                        className="w-64"
                    />
                </SettingRow>

                <SettingRow label={t('createLabel.paperType')}>
                    <Select
                        value={paperTypeId}
                        onChange={handlePaperTypeChange}
                        options={paperTypeOptions}
                        disabled={loading}
                        aria-label={t('createLabel.paperType')}
                        className="w-64"
                    />
                </SettingRow>
                {loading && <p className="text-xs text-gray-500">{t('paperTypes.loading')}</p>}

                <div className="grid grid-cols-3 gap-4 py-2">
                    <NumberField label={t('createLabel.width')} value={backingW} onChange={setBackingW} />
                    <NumberField label={t('createLabel.height')} value={backingH} onChange={setBackingH} />
                    <NumberField label={t('createLabel.dpi')} value={dpi} onChange={setDpi} />
                </div>

                <div className="pt-2">
                    <RegionEditor
                        regions={regions}
                        onChange={setRegions}
                        onValidityChange={setRegionsValid}
                    />
                </div>

                {error && <p className="pt-2 text-sm text-red-400">{error}</p>}
            </div>
        </Modal>
    );
};
