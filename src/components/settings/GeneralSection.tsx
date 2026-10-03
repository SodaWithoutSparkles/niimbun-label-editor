import React, { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { SUPPORTED_LANGUAGES } from '../../i18n/languages';
import { normalizeLanguage } from '../../store/preferenceValidation';
import { Input, Select, SettingRow, Toggle } from '../common/forms';
import { SCREEN_DPI_MAX, SCREEN_DPI_MIN } from '../../store/storeDefaults';

/**
 * Literal map so dynamic locale values keep i18next's typed-key union intact
 * (a computed `t('settings.languages.' + value)` collapses to `string`).
 */
const LANGUAGE_LABEL_KEYS = {
    en: 'settings.languages.en',
} as const satisfies Partial<Record<(typeof SUPPORTED_LANGUAGES)[number], string>>;

/**
 * General preferences: UI language and auto-save. Both write straight to the
 * settings store. The language action deliberately does not call
 * `i18n.changeLanguage` here -- a subscription applies the persisted value.
 */
export const GeneralSection: React.FC = () => {
    const { t } = useTranslation();
    const languageId = useId();
    const autoSaveId = useId();
    const screenDpiId = useId();
    const language = useStore((state) => state.language);
    const setLanguage = useStore((state) => state.setLanguage);
    const autoSave = useStore((state) => state.autoSave);
    const toggleAutoSave = useStore((state) => state.toggleAutoSave);
    const screenDpi = useStore((state) => state.screenDpi);
    const setScreenDpi = useStore((state) => state.setScreenDpi);

    // Data-driven off the runtime allow-list so it cannot drift from validation.
    const languageOptions = useMemo(
        () => SUPPORTED_LANGUAGES.map((value) => ({ value, label: t(LANGUAGE_LABEL_KEYS[value]) })),
        [t]
    );

    return (
        <div>
            <SettingRow label={t('settings.general.language')} htmlFor={languageId}>
                <Select
                    id={languageId}
                    value={language}
                    onChange={(value) => {
                        // Validate instead of casting: an unsupported tag must
                        // never reach Intl.RelativeTimeFormat via the store.
                        const next = normalizeLanguage(value);
                        if (next) setLanguage(next);
                    }}
                    options={languageOptions}
                />
            </SettingRow>
            <SettingRow label={t('settings.general.autoSave')} htmlFor={autoSaveId}>
                <Toggle id={autoSaveId} checked={autoSave} onChange={() => toggleAutoSave()} />
            </SettingRow>
            <SettingRow
                label={t('settings.general.screenDpi')}
                description={t('settings.general.screenDpiDescription')}
                htmlFor={screenDpiId}
            >
                <Input
                    id={screenDpiId}
                    type="number"
                    min={SCREEN_DPI_MIN}
                    max={SCREEN_DPI_MAX}
                    value={String(screenDpi)}
                    onChange={(value) => {
                        const parsed = Number.parseFloat(value);
                        if (Number.isFinite(parsed)) setScreenDpi(parsed);
                    }}
                    className="w-24"
                />
            </SettingRow>
        </div>
    );
};
