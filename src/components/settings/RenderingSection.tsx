import React, { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useStore } from '../../store/useStore';
import { Input, Select, SettingRow, Toggle } from '../common/forms';
import {
    DEFAULT_GAMMA_BY_STRATEGY,
    DEFAULT_POLICY_BY_TYPE,
    GAMMA_MAX,
    GAMMA_MIN,
    QUANTIZERS,
} from '../../core/render';
import type { QuantizerDefaultParams, QuantizerDefaults, QuantizerId } from '../../core/render';
import type { NodeType } from '../../core/doc/types';
import type { DefaultQuantizerByType } from '../../store/storeTypes';

/**
 * Rendering preferences — the configurable dithering (§P13 Track R, §P14 W1).
 *
 * Per strategy: `threshold` exposes a Threshold and a Tone curve (gamma) knob;
 * the diffusers expose an Error diffusion knob, a Tone curve (gamma) knob and a
 * Serpentine scan toggle. Below that, a per-object-type default quantizer select
 * for every type the module fallback map names (shapes deliberately have no
 * policy entry, so none is offered).
 *
 * Every write goes through the settings setters (never the document), and every
 * value is clamped here the way the persisted-settings validator would, since
 * `setQuantizerDefaults`/`setDefaultQuantizerByType` store the map verbatim.
 */

/** Engine clamps, mirrored from `core/doc/validate` and the inspector ranges. */
const THRESHOLD_MIN = 0;
const THRESHOLD_MAX = 255;
const STRENGTH_MIN = 0;
const STRENGTH_MAX = 4;

/** Engine defaults shown when a strategy has no stored value. */
const THRESHOLD_FALLBACK = 128;
const STRENGTH_FALLBACK = 1;

/** Integer threshold, clamped to `[0,255]` (matches `validate`/`setNumber`). */
const clampThreshold = (value: number): number =>
    Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, Math.round(value)));

/** Strength clamped to `[0,4]` and rounded to 2 dp (matches `validate`). */
const clampStrength = (value: number): number =>
    Math.round(Math.min(STRENGTH_MAX, Math.max(STRENGTH_MIN, value)) * 100) / 100;

/** Gamma clamped to `[0.1,4]` and rounded to 2 dp (the engine's own clamp). */
const clampGamma = (value: number): number =>
    Math.round(Math.min(GAMMA_MAX, Math.max(GAMMA_MIN, value)) * 100) / 100;

/** The diffusers, in registry order — they share the Error diffusion controls. */
const DIFFUSERS: readonly QuantizerId[] = (Object.keys(QUANTIZERS) as QuantizerId[]).filter(
    (id) => id !== 'threshold',
);

/** Strategy display names reuse the inspector's option labels. */
const STRATEGY_LABEL_KEYS = {
    threshold: 'editor.mfp.quantizerOptions.threshold',
    floydSteinberg: 'editor.mfp.quantizerOptions.floydSteinberg',
    stucki: 'editor.mfp.quantizerOptions.stucki',
    atkinson: 'editor.mfp.quantizerOptions.atkinson',
} as const satisfies Record<QuantizerId, string>;

/**
 * Per-object-type selects mirror `DEFAULT_POLICY_BY_TYPE` exactly, so they
 * cannot drift from the resolver. Shapes are absent on purpose.
 */
const POLICY_TYPES = Object.keys(DEFAULT_POLICY_BY_TYPE) as NodeType[];

/** Literal map so the dynamic locale keys keep i18next's typed-key union. */
const TYPE_LABEL_KEYS = {
    text: 'settings.rendering.typeLabels.text',
    image: 'settings.rendering.typeLabels.image',
    qr: 'settings.rendering.typeLabels.qr',
    barcode: 'settings.rendering.typeLabels.barcode',
    code: 'settings.rendering.typeLabels.code',
} as const;

const typeLabel = (type: string, t: TFunction): string =>
    type in TYPE_LABEL_KEYS ? t(TYPE_LABEL_KEYS[type as keyof typeof TYPE_LABEL_KEYS]) : type;

/** The `''` first option is the "theme/type default" sentinel (never stored). */
const QUANTIZER_OPTION_KEYS = {
    '': 'editor.mfp.quantizerOptions.auto',
    threshold: 'editor.mfp.quantizerOptions.threshold',
    floydSteinberg: 'editor.mfp.quantizerOptions.floydSteinberg',
    stucki: 'editor.mfp.quantizerOptions.stucki',
    atkinson: 'editor.mfp.quantizerOptions.atkinson',
} as const satisfies Record<QuantizerId | '', string>;

type QuantizerOptionValue = keyof typeof QUANTIZER_OPTION_KEYS;

const isQuantizerOptionValue = (value: string): value is QuantizerOptionValue =>
    value in QUANTIZER_OPTION_KEYS;

const QUANTIZER_OPTION_VALUES: readonly string[] = Object.keys(QUANTIZER_OPTION_KEYS);

interface QuantizerNumberFieldProps {
    id: string;
    label: string;
    description: string;
    ariaLabel: string;
    value: number | undefined;
    fallback: number;
    min: number;
    max: number;
    step: number;
    normalize: (value: number) => number;
    onCommit: (value: number) => void;
}

/**
 * A number field wired to a persisted setting: local draft state so typing never
 * hits the store, committed once on blur/Enter (the `GeneralSection` grid-spacing
 * pattern). An unparseable draft reverts to the committed value.
 */
const QuantizerNumberField: React.FC<QuantizerNumberFieldProps> = ({
    id,
    label,
    description,
    ariaLabel,
    value,
    fallback,
    min,
    max,
    step,
    normalize,
    onCommit,
}) => {
    const committed = value ?? fallback;
    const [draft, setDraft] = useState(String(committed));

    // Keep the draft in step with the committed value (external change / reset).
    useEffect(() => {
        setDraft(String(committed));
    }, [committed]);

    const commit = () => {
        const parsed = Number.parseFloat(draft);
        if (!Number.isFinite(parsed)) {
            setDraft(String(committed));
            return;
        }
        onCommit(normalize(parsed));
    };

    return (
        <SettingRow label={label} description={description} htmlFor={id}>
            <Input
                id={id}
                type="number"
                min={min}
                max={max}
                step={step}
                value={draft}
                onChange={setDraft}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        commit();
                    }
                }}
                aria-label={ariaLabel}
                className="w-24"
            />
        </SettingRow>
    );
};

interface DiffuserSettingsProps {
    name: string;
    strength: number | undefined;
    serpentine: boolean | undefined;
    gamma: number | undefined;
    /** This strategy's engine gamma default, shown when nothing is stored. */
    gammaFallback: number;
    onStrength: (value: number) => void;
    onSerpentine: (value: boolean) => void;
    onGamma: (value: number) => void;
}

/** One diffuser's Error diffusion number + Tone curve + Serpentine scan toggle. */
const DiffuserSettings: React.FC<DiffuserSettingsProps> = ({
    name,
    strength,
    serpentine,
    gamma,
    gammaFallback,
    onStrength,
    onSerpentine,
    onGamma,
}) => {
    const { t } = useTranslation();
    const strengthId = useId();
    const serpentineId = useId();
    const gammaId = useId();
    return (
        <div className="pt-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">{name}</h4>
            <QuantizerNumberField
                id={strengthId}
                label={t('settings.rendering.errorDiffusion')}
                description={t('settings.rendering.errorDiffusionDescription')}
                ariaLabel={t('settings.rendering.errorDiffusionAria', { strategy: name })}
                value={strength}
                fallback={STRENGTH_FALLBACK}
                min={STRENGTH_MIN}
                max={STRENGTH_MAX}
                step={0.1}
                normalize={clampStrength}
                onCommit={onStrength}
            />
            <QuantizerNumberField
                id={gammaId}
                label={t('settings.rendering.gamma')}
                description={t('settings.rendering.gammaDescription')}
                ariaLabel={t('settings.rendering.gammaAria', { strategy: name })}
                value={gamma}
                fallback={gammaFallback}
                min={GAMMA_MIN}
                max={GAMMA_MAX}
                step={0.1}
                normalize={clampGamma}
                onCommit={onGamma}
            />
            <SettingRow
                label={t('settings.rendering.serpentine')}
                description={t('settings.rendering.serpentineDescription')}
                htmlFor={serpentineId}
            >
                <Toggle
                    id={serpentineId}
                    aria-label={t('settings.rendering.serpentineAria', { strategy: name })}
                    checked={serpentine ?? true}
                    onChange={onSerpentine}
                />
            </SettingRow>
        </div>
    );
};

interface TypeDefaultSelectProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
}

/** One object type's default-quantizer select. */
const TypeDefaultSelect: React.FC<TypeDefaultSelectProps> = ({ label, value, onChange }) => {
    const { t } = useTranslation();
    const id = useId();
    const options = QUANTIZER_OPTION_VALUES.map((option) => ({
        value: option,
        label: isQuantizerOptionValue(option) ? t(QUANTIZER_OPTION_KEYS[option]) : option,
    }));
    return (
        <SettingRow label={label} htmlFor={id}>
            <Select id={id} value={value} onChange={onChange} options={options} className="w-40" />
        </SettingRow>
    );
};

/** Threshold strategy: the binary-cutoff knob plus a neutral-by-default tone curve. */
const ThresholdSettings: React.FC<{
    value: number | undefined;
    onCommit: (value: number) => void;
    gamma: number | undefined;
    onGamma: (value: number) => void;
}> = ({ value, onCommit, gamma, onGamma }) => {
    const { t } = useTranslation();
    const id = useId();
    const gammaId = useId();
    return (
        <>
            <QuantizerNumberField
                id={id}
                label={t('settings.rendering.threshold')}
                description={t('settings.rendering.thresholdDescription')}
                ariaLabel={t('settings.rendering.threshold')}
                value={value}
                fallback={THRESHOLD_FALLBACK}
                min={THRESHOLD_MIN}
                max={THRESHOLD_MAX}
                step={1}
                normalize={clampThreshold}
                onCommit={onCommit}
            />
            <QuantizerNumberField
                id={gammaId}
                label={t('settings.rendering.gamma')}
                description={t('settings.rendering.gammaDescription')}
                ariaLabel={t('settings.rendering.gammaAria', {
                    strategy: t('editor.mfp.quantizerOptions.threshold'),
                })}
                value={gamma}
                fallback={DEFAULT_GAMMA_BY_STRATEGY.threshold}
                min={GAMMA_MIN}
                max={GAMMA_MAX}
                step={0.1}
                normalize={clampGamma}
                onCommit={onGamma}
            />
        </>
    );
};

export const RenderingSection: React.FC = () => {
    const { t } = useTranslation();
    const quantizerDefaults = useStore((state) => state.quantizerDefaults);
    const setQuantizerDefaults = useStore((state) => state.setQuantizerDefaults);
    const defaultQuantizerByType = useStore((state) => state.defaultQuantizerByType);
    const setDefaultQuantizerByType = useStore((state) => state.setDefaultQuantizerByType);

    /** Merge one strategy's knobs, leaving the others untouched. */
    const setStrategyParam = (id: QuantizerId, patch: QuantizerDefaultParams) => {
        const next: QuantizerDefaults = { ...quantizerDefaults, [id]: { ...quantizerDefaults[id], ...patch } };
        setQuantizerDefaults(next);
    };

    /** `''` clears the type override so `DEFAULT_POLICY_BY_TYPE` falls through. */
    const setTypeDefault = (type: NodeType, value: string) => {
        const next: DefaultQuantizerByType = { ...defaultQuantizerByType };
        if (value === '') delete next[type];
        else if (isQuantizerOptionValue(value) && value !== '') next[type] = value;
        setDefaultQuantizerByType(next);
    };

    return (
        <div>
            <section className="mb-5">
                <h3 className="text-sm font-semibold text-gray-300">
                    {t('settings.rendering.strategyDefaults')}
                </h3>
                <p className="mt-0.5 mb-2 text-xs text-gray-500">
                    {t('settings.rendering.strategyDefaultsDescription')}
                </p>
                <ThresholdSettings
                    value={quantizerDefaults.threshold?.threshold}
                    onCommit={(value) => setStrategyParam('threshold', { threshold: value })}
                    gamma={quantizerDefaults.threshold?.gamma}
                    onGamma={(value) => setStrategyParam('threshold', { gamma: value })}
                />
                {DIFFUSERS.map((id) => (
                    <DiffuserSettings
                        key={id}
                        name={t(STRATEGY_LABEL_KEYS[id])}
                        strength={quantizerDefaults[id]?.strength}
                        serpentine={quantizerDefaults[id]?.serpentine}
                        gamma={quantizerDefaults[id]?.gamma}
                        gammaFallback={DEFAULT_GAMMA_BY_STRATEGY[id]}
                        onStrength={(value) => setStrategyParam(id, { strength: value })}
                        onSerpentine={(value) => setStrategyParam(id, { serpentine: value })}
                        onGamma={(value) => setStrategyParam(id, { gamma: value })}
                    />
                ))}
            </section>

            <section>
                <h3 className="text-sm font-semibold text-gray-300">
                    {t('settings.rendering.defaultByType')}
                </h3>
                <p className="mt-0.5 mb-2 text-xs text-gray-500">
                    {t('settings.rendering.defaultByTypeDescription')}
                </p>
                {POLICY_TYPES.map((type) => (
                    <TypeDefaultSelect
                        key={type}
                        label={typeLabel(type, t)}
                        value={defaultQuantizerByType[type] ?? ''}
                        onChange={(value) => setTypeDefault(type, value)}
                    />
                ))}
            </section>
        </div>
    );
};
