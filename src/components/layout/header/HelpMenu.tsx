import React from 'react';
import { MenuItem } from './MenuItem';

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
    return (
        <div className="relative">
            <div
                className={`px-3 hover:bg-gray-700 cursor-pointer h-full flex items-center ${activeMenu === 'help' ? 'bg-gray-700' : ''}`}
                onClick={() => onToggle('help')}
            >
                Help
            </div>
            {activeMenu === 'help' && (
                <div className="absolute top-full left-0 bg-gray-800 border border-gray-600 shadow-xl py-1 rounded-b-md min-w-[260px]">
                    <MenuItem label="Open Help" onClick={() => { onShowHelp(); onCloseMenu(); }} />
                    <MenuItem label="About" onClick={() => { alert('Drawing App v0.1.0\nBuilt with React & Vite'); onCloseMenu(); }} />
                </div>
            )}
        </div>
    );
};
