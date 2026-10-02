import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { hmToMm, mmToHm } from '../../core/hm';
import { LABEL_PRESETS, type LabelPresetId } from '../../core/doc/factory';
import type { Region } from '../../core/doc/types';
import type { CreateLabelSpec } from '../../store/storeTypes';
import { useStore } from '../../store/useStore';
import { Modal } from '../common/dialogs';
import { Input, Select, SettingRow } from '../common/forms';

const PRESET_LABEL_KEYS = {
    'ftagSpare-25x78': 'presets.ftagSpare-25x78',
    custom: 'presets.custom',
} as const;

const REGION_KIND_KEYS = {
    rect: 'regionKinds.rect',
    roundedRect: 'regionKinds.roundedRect',
    circle: 'regionKinds.circle',
    polygon: 'regionKinds.polygon',
} as const;

type PresetChoice = LabelPresetId | 'custom';

const DEFAULT_PRESET: LabelPresetId = 'ftagSpare-25x78';
const DEFAULT_DPI = 300;

/** mm string for an hm value, without trailing `.0`. */
const mmString = (value: number): string => {
    const mm = hmToMm(value);
    return Number.isInteger(mm) ? String(mm) : mm.toFixed(1);
};

const parseMm = (value: string): number => {
    const mm = Number(value);
    return Number.isFinite(mm) ? mmToHm(mm) : 0;
};

const NumberField: React.FC<{ label: string; value: string; onChange: (value: string) => void }> = ({
    label,
    value,
    onChange,
}) => (
    <label className="flex flex-col gap-1 text-xs text-gray-400">
        {label}
        <Input type="number" min="0" step="0.1" value={value} onChange={onChange} />
    </label>
);

interface RegionRowProps {
    region: Region;
    onChange: (region: Region) => void;
    onRemove: () => void;
}

const RegionRow: React.FC<RegionRowProps> = ({ region, onChange, onRemove }) => {
    const { t } = useTranslation();
    return (
        <li className="rounded border border-gray-700 bg-gray-800/60 p-2">
            <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-300">{t(REGION_KIND_KEYS[region.kind])}</span>
                <button
                    type="button"
                    onClick={onRemove}
                    title={t('createLabel.removeRegion')}
                    aria-label={t('createLabel.removeRegion')}
                    className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-red-300"
                >
                    <Trash2 size={14} />
                </button>
            </div>

            {region.kind === 'polygon' ? (
                <>
                    <code className="block overflow-x-auto rounded bg-gray-900 p-2 text-xs text-gray-400">
                        {JSON.stringify(region.points)}
                    </code>
                    <p className="mt-1 text-xs text-gray-500">{t('createLabel.polygonReadonly')}</p>
                </>
            ) : (
                <div className="grid grid-cols-4 gap-2">
                    {region.kind === 'circle' ? (
                        <>
                            <NumberField label={t('regionFields.cx')} value={mmString(region.cx)} onChange={(v) => onChange({ ...region, cx: parseMm(v) })} />
                            <NumberField label={t('regionFields.cy')} value={mmString(region.cy)} onChange={(v) => onChange({ ...region, cy: parseMm(v) })} />
                            <NumberField label={t('regionFields.r')} value={mmString(region.r)} onChange={(v) => onChange({ ...region, r: parseMm(v) })} />
                        </>
                    ) : (
                        <>
                            <NumberField label={t('regionFields.x')} value={mmString(region.x)} onChange={(v) => onChange({ ...region, x: parseMm(v) })} />
                            <NumberField label={t('regionFields.y')} value={mmString(region.y)} onChange={(v) => onChange({ ...region, y: parseMm(v) })} />
                            <NumberField label={t('regionFields.w')} value={mmString(region.w)} onChange={(v) => onChange({ ...region, w: parseMm(v) })} />
                            <NumberField label={t('regionFields.h')} value={mmString(region.h)} onChange={(v) => onChange({ ...region, h: parseMm(v) })} />
                            {region.kind === 'roundedRect' && (
                                <NumberField label={t('regionFields.r')} value={mmString(region.r)} onChange={(v) => onChange({ ...region, r: parseMm(v) })} />
                            )}
                        </>
                    )}
                </div>
            )}
        </li>
    );
};

interface CreateLabelDialogProps {
    open: boolean;
    onClose: () => void;
}

/**
 * Shared create-label modal: preset picker (incl. the F-tag spare), custom size
 * and a minimal region list. Submits through the store's `createLabel`, which
 * builds via the factory, saves to IDB and refreshes the gallery.
 */
export const CreateLabelDialog: React.FC<CreateLabelDialogProps> = ({ open, onClose }) => {
    const { t } = useTranslation();
    const createLabel = useStore((state) => state.createLabel);

    const [name, setName] = useState('');
    const [presetChoice, setPresetChoice] = useState<PresetChoice>(DEFAULT_PRESET);
    const [backingW, setBackingW] = useState('0');
    const [backingH, setBackingH] = useState('0');
    const [dpi, setDpi] = useState(String(DEFAULT_DPI));
    const [regions, setRegions] = useState<Region[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // Keep the latest `t` without making it a re-seed trigger: a language change
    // must not wipe in-progress edits while the dialog is open.
    const tRef = React.useRef(t);
    tRef.current = t;

    // Re-seed the form each time the dialog opens. Idempotent under StrictMode.
    useEffect(() => {
        if (!open) return;
        const preset = LABEL_PRESETS[DEFAULT_PRESET];
        setName(tRef.current(PRESET_LABEL_KEYS[DEFAULT_PRESET]));
        setPresetChoice(DEFAULT_PRESET);
        setBackingW(mmString(preset.backingW));
        setBackingH(mmString(preset.backingH));
        setDpi(String(DEFAULT_DPI));
        setRegions(preset.regions.map((region) => structuredClone(region)));
        setError(null);
        setSaving(false);
    }, [open]);

    const handlePresetChange = (value: string) => {
        const choice = value as PresetChoice;
        setPresetChoice(choice);
        if (choice === 'custom') return;
        const preset = LABEL_PRESETS[choice];
        setName(t(PRESET_LABEL_KEYS[choice]));
        setBackingW(mmString(preset.backingW));
        setBackingH(mmString(preset.backingH));
        setRegions(preset.regions.map((region) => structuredClone(region)));
    };

    const addRegion = () => {
        setRegions((prev) => [...prev, { kind: 'rect', x: 0, y: 0, w: mmToHm(10), h: mmToHm(10) }]);
    };

    // Editing a preset's W/H promotes the choice to `custom`, so the typed
    // values are not silently dropped on submit.
    const editBackingW = (value: string) => {
        setBackingW(value);
        setPresetChoice('custom');
    };

    const editBackingH = (value: string) => {
        setBackingH(value);
        setPresetChoice('custom');
    };

    const updateRegion = (index: number, region: Region) => {
        setRegions((prev) => prev.map((entry, i) => (i === index ? region : entry)));
    };

    const removeRegion = (index: number) => {
        setRegions((prev) => prev.filter((_, i) => i !== index));
    };

    const handleSubmit = async () => {
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
            ...(presetChoice === 'custom' ? { backingW: w, backingH: h } : { preset: presetChoice }),
            dpi: Number.isFinite(dpiValue) && dpiValue > 0 ? Math.round(dpiValue) : DEFAULT_DPI,
            regions,
        };

        setSaving(true);
        setError(null);
        const doc = await createLabel(spec);
        setSaving(false);
        if (!doc) {
            setError(t('errors.saveFailed'));
            return;
        }
        onClose();
    };

    const presetOptions = [
        ...(Object.keys(LABEL_PRESETS) as LabelPresetId[]).map((id) => ({
            value: id,
            label: t(PRESET_LABEL_KEYS[id]),
        })),
        { value: 'custom' satisfies PresetChoice, label: t(PRESET_LABEL_KEYS.custom) },
    ];

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
                        disabled={saving}
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

                <SettingRow label={t('createLabel.preset')}>
                    <Select
                        value={presetChoice}
                        onChange={handlePresetChange}
                        options={presetOptions}
                        className="w-64"
                    />
                </SettingRow>

                <div className="grid grid-cols-3 gap-4 py-2">
                    <NumberField label={t('createLabel.width')} value={backingW} onChange={editBackingW} />
                    <NumberField label={t('createLabel.height')} value={backingH} onChange={editBackingH} />
                    <NumberField label={t('createLabel.dpi')} value={dpi} onChange={setDpi} />
                </div>

                <div className="pt-2">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm text-gray-300">{t('createLabel.regions')}</span>
                        <button
                            type="button"
                            onClick={addRegion}
                            className="flex items-center gap-1 rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
                        >
                            <Plus size={14} />
                            {t('createLabel.addRegion')}
                        </button>
                    </div>
                    {regions.length === 0 ? (
                        <p className="text-xs text-gray-500">{t('createLabel.noRegions')}</p>
                    ) : (
                        <ul className="space-y-2">
                            {regions.map((region, index) => (
                                <RegionRow
                                    key={index}
                                    region={region}
                                    onChange={(next) => updateRegion(index, next)}
                                    onRemove={() => removeRegion(index)}
                                />
                            ))}
                        </ul>
                    )}
                </div>

                {error && <p className="pt-2 text-sm text-red-400">{error}</p>}
            </div>
        </Modal>
    );
};
