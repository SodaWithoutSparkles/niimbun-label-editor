import React from 'react';
import { useTranslation } from 'react-i18next';
import { MenuItem } from './MenuItem';
import { alert } from '../../common/dialogs';

interface HelpMenuProps {
    activeMenu: string | null;
    onToggle: (menu: string) => void;
    onCloseMenu: () => void;
    onShowHelp: () => void;
}

export const HelpMenu: React.FC<HelpMenuProps> = ({
    activeMenu,
    onToggle,
    onCloseMenu,
    onShowHelp
}) => {
    const { t } = useTranslation();
    return (
        <div className="relative">
            <div
                className={`px-3 hover:bg-gray-700 cursor-pointer h-full flex items-center ${activeMenu === 'help' ? 'bg-gray-700' : ''}`}
                onClick={() => onToggle('help')}
            >
                {t('helpMenu.title')}
            </div>
            {activeMenu === 'help' && (
                <div className="absolute top-full left-0 bg-gray-800 border border-gray-600 shadow-xl py-1 rounded-b-md min-w-[260px]">
                    <MenuItem label={t('helpMenu.openHelp')} onClick={() => { onShowHelp(); onCloseMenu(); }} />
                    <MenuItem label={t('about.title')} onClick={() => { void alert({ title: t('about.title'), message: t('about.message') }); onCloseMenu(); }} />
                </div>
            )}
        </div>
    );
};
