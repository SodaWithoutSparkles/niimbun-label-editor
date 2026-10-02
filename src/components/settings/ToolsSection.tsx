import React, { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { Input, Select, SettingRow } from '../common/forms';

interface ToolsSectionProps {
    tab: 'shape' | 'text';
}

/**
 * Tool defaults, split across the Shape and Text tabs. Writes the same
 * `toolSettings` fields the modeless `ToolSettingsModal` edits.
 */
export const ToolsSection: React.FC<ToolsSectionProps> = ({ tab }) => {
    const { t } = useTranslation();
    const ids = {
        lineWidth: useId(),
        fontSize: useId(),
        fontFamily: useId(),
        fontWeight: useId(),
        fontStyle: useId(),
        textAlign: useId(),
        textColor: useId(),
    };
    const toolSettings = useStore((state) => state.toolSettings);
    const setToolSettings = useStore((state) => state.setToolSettings);

    const fontFamilyOptions = useMemo(
        () => [
            { value: 'Arial', label: t('toolSettings.fontFamilyOptions.arial') },
            { value: 'Times New Roman', label: t('toolSettings.fontFamilyOptions.timesNewRoman') },
            { value: 'Courier New', label: t('toolSettings.fontFamilyOptions.courierNew') },
            { value: 'Georgia', label: t('toolSettings.fontFamilyOptions.georgia') },
            { value: 'Verdana', label: t('toolSettings.fontFamilyOptions.verdana') },
            { value: 'Comic Sans MS', label: t('toolSettings.fontFamilyOptions.comicSansMs') }
        ],
        [t]
    );

    const fontWeightOptions = useMemo(
        () => [
            { value: 'normal', label: t('toolSettings.fontWeightOptions.normal') },
            { value: 'bold', label: t('toolSettings.fontWeightOptions.bold') }
        ],
        [t]
    );

    const fontStyleOptions = useMemo(
        () => [
            { value: 'normal', label: t('toolSettings.fontStyleOptions.normal') },
            { value: 'italic', label: t('toolSettings.fontStyleOptions.italic') }
        ],
        [t]
    );

    const textAlignOptions = useMemo(
        () => [
            { value: 'left', label: t('toolSettings.textAlignOptions.left') },
            { value: 'center', label: t('toolSettings.textAlignOptions.center') },
            { value: 'right', label: t('toolSettings.textAlignOptions.right') }
        ],
        [t]
    );

    if (tab === 'shape') {
        return (
            <div>
                <SettingRow label={t('toolSettings.lineWidth')} htmlFor={ids.lineWidth}>
                    <Input
                        id={ids.lineWidth}
                        className="w-20"
                        type="number"
                        min={1}
                        max={20}
                        step={1}
                        value={String(toolSettings.lineWidth)}
                        onChange={(value) => {
                            const next = Number(value);
                            // Empty / non-numeric input yields NaN or 0 via Number('');
                            // ignore it so the previous value stays while editing.
                            if (value === '' || !Number.isFinite(next)) return;
                            // Clamp so an explicit out-of-range entry (0, -3) can
                            // never commit an invisible line width below `min`.
                            setToolSettings({ lineWidth: Math.min(20, Math.max(1, next)) });
                        }}
                    />
                </SettingRow>
            </div>
        );
    }

    return (
        <div>
            <SettingRow label={t('toolSettings.fontSize')} htmlFor={ids.fontSize}>
                <Input
                    id={ids.fontSize}
                    className="w-20"
                    type="number"
                    min={8}
                    max={72}
                    step={1}
                    value={String(toolSettings.fontSize)}
                    onChange={(value) => {
                        const next = Number(value);
                        // Ignore empty / non-numeric mid-edit, but clamp an
                        // explicit out-of-range commit to the field's bounds.
                        if (value === '' || !Number.isFinite(next)) return;
                        setToolSettings({ fontSize: Math.min(72, Math.max(8, next)) });
                    }}
                />
            </SettingRow>
            <SettingRow label={t('toolSettings.fontFamily')} htmlFor={ids.fontFamily}>
                <Select
                    id={ids.fontFamily}
                    value={toolSettings.fontFamily}
                    onChange={(value) => setToolSettings({ fontFamily: value })}
                    options={fontFamilyOptions}
                />
            </SettingRow>
            <SettingRow label={t('toolSettings.fontWeight')} htmlFor={ids.fontWeight}>
                <Select
                    id={ids.fontWeight}
                    value={toolSettings.fontWeight}
                    onChange={(value) =>
                        setToolSettings({ fontWeight: value as 'normal' | 'bold' })
                    }
                    options={fontWeightOptions}
                />
            </SettingRow>
            <SettingRow label={t('toolSettings.fontStyle')} htmlFor={ids.fontStyle}>
                <Select
                    id={ids.fontStyle}
                    value={toolSettings.fontStyle}
                    onChange={(value) =>
                        setToolSettings({ fontStyle: value as 'normal' | 'italic' })
                    }
                    options={fontStyleOptions}
                />
            </SettingRow>
            <SettingRow label={t('toolSettings.textAlign')} htmlFor={ids.textAlign}>
                <Select
                    id={ids.textAlign}
                    value={toolSettings.textAlign}
                    onChange={(value) =>
                        setToolSettings({ textAlign: value as 'left' | 'center' | 'right' })
                    }
                    options={textAlignOptions}
                />
            </SettingRow>
            <SettingRow label={t('toolSettings.textColor')} htmlFor={ids.textColor}>
                <Input
                    id={ids.textColor}
                    className="h-8 w-12 p-0.5"
                    type="color"
                    value={toolSettings.textColor}
                    onChange={(value) => setToolSettings({ textColor: value })}
                />
            </SettingRow>
        </div>
    );
};
