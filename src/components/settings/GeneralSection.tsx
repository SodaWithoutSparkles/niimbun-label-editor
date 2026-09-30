import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { Select, SettingRow, Toggle } from '../common/forms';

/**
 * General preferences: UI language and auto-save. Both write straight to the
 * settings store. The language action deliberately does not call
 * `i18n.changeLanguage` here -- a subscription applies the persisted value.
 */
export const GeneralSection: React.FC = () => {
    const { t } = useTranslation();
    const language = useStore((state) => state.language);
    const setLanguage = useStore((state) => state.setLanguage);
    const autoSave = useStore((state) => state.autoSave);
    const toggleAutoSave = useStore((state) => state.toggleAutoSave);

    // Data-driven so adding a locale is a one-line change.
    const languageOptions = useMemo(
        () => [{ value: 'en', label: t('settings.languages.en') }],
        [t]
    );

    return (
        <div>
            <SettingRow label={t('settings.general.language')}>
                <Select
                    value={language}
                    onChange={(value) => setLanguage(value)}
                    options={languageOptions}
                />
            </SettingRow>
            <SettingRow label={t('settings.general.autoSave')}>
                <Toggle checked={autoSave} onChange={() => toggleAutoSave()} />
            </SettingRow>
        </div>
    );
};
