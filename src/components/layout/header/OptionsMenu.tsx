import React from 'react';
import { MenuItem } from './MenuItem';

interface OptionsMenuProps {
    activeMenu: string | null;
    onToggle: (menu: string) => void;
    onCloseMenu: () => void;
    onShowShortcutConfig: () => void;
}

export const OptionsMenu: React.FC<OptionsMenuProps> = ({
    activeMenu,
    onToggle,
    onCloseMenu,
    onShowShortcutConfig
}) => {
    return (
        <div className="relative">
            <div
                className={`px-3 hover:bg-gray-700 cursor-pointer h-full flex items-center ${activeMenu === 'option' ? 'bg-gray-700' : ''}`}
                onClick={() => onToggle('option')}
            >
                Options
            </div>
            {activeMenu === 'option' && (
                <div className="absolute top-full left-0 bg-gray-800 border border-gray-600 shadow-xl py-1 rounded-b-md min-w-[260px]">
                    <MenuItem label="About" onClick={() => { alert('Drawing App v0.1.0\nBuilt with React & Vite'); onCloseMenu(); }} />

                    <div className="h-px bg-gray-700 my-1" />
                    <MenuItem
                        label="Keyboard Shortcuts..."
                        onClick={() => { onShowShortcutConfig(); onCloseMenu(); }}
                    />
                </div>
            )}
        </div>
    );
};
