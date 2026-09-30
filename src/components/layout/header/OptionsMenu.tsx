import React from 'react';
import { useTranslation } from 'react-i18next';
import { MenuItem } from './MenuItem';
import { alert } from '../../common/dialogs';

interface OptionsMenuProps {
    activeMenu: string | null;
    onToggle: (menu: string) => void;
    onCloseMenu: () => void;
    onShowSettings: () => void;
}

export const OptionsMenu: React.FC<OptionsMenuProps> = ({
    activeMenu,
    onToggle,
    onCloseMenu,
    onShowSettings
}) => {
    const { t } = useTranslation();
    return (
        <div className="relative">
            <div
                className={`px-3 hover:bg-gray-700 cursor-pointer h-full flex items-center ${activeMenu === 'option' ? 'bg-gray-700' : ''}`}
                onClick={() => onToggle('option')}
            >
                {t('options.title')}
            </div>
            {activeMenu === 'option' && (
                <div className="absolute top-full left-0 bg-gray-800 border border-gray-600 shadow-xl py-1 rounded-b-md min-w-[260px]">
                    <MenuItem label={t('about.title')} onClick={() => { void alert({ title: t('about.title'), message: t('about.message') }); onCloseMenu(); }} />

                    <div className="h-px bg-gray-700 my-1" />
                    <MenuItem
                        label={t('settings.menuLabel')}
                        onClick={() => { onShowSettings(); onCloseMenu(); }}
                    />
                </div>
            )}
        </div>
    );
};
