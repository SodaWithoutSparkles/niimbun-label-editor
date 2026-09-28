import React from 'react';
import { MenuItem } from './MenuItem';

interface FileMenuProps {
    activeMenu: string | null;
    onToggle: (menu: string) => void;
    onCloseMenu: () => void;
    supportsFileSystemAccess: boolean;
    hasNameChanged: boolean;
    autoSave: boolean;
    onNewProject: () => void;
    onOpenProject: () => void;
    onSave: () => void;
    onSaveAs: () => void;
    onToggleAutoSave: () => void;
    onExport: () => void;
}

export const FileMenu: React.FC<FileMenuProps> = ({
    activeMenu,
    onToggle,
    onCloseMenu,
    supportsFileSystemAccess,
    hasNameChanged,
    autoSave,
    onNewProject,
    onOpenProject,
    onSave,
    onSaveAs,
    onToggleAutoSave,
    onExport
}) => {
    return (
        <div className="relative">
            <div
                className={`px-3 hover:bg-gray-700 cursor-pointer h-full flex items-center ${activeMenu === 'file' ? 'bg-gray-700' : ''}`}
                onClick={() => onToggle('file')}
            >
                File
            </div>
            {activeMenu === 'file' && (
                <div className="absolute top-full left-0 bg-gray-800 border border-gray-600 shadow-xl py-1 rounded-b-md min-w-[260px]">
                    <MenuItem label="New Project" onClick={() => { onNewProject(); onCloseMenu(); }} />
                    <MenuItem label="Open Project" onClick={() => { onOpenProject(); onCloseMenu(); }} />
                    <MenuItem
                        label={supportsFileSystemAccess ? 'Save Project (in-place)' : 'Save Project'}
                        onClick={() => { onSave(); onCloseMenu(); }}
                        disabled={!hasNameChanged}
                    />
                    <MenuItem label="Save Project As..." onClick={() => { onSaveAs(); onCloseMenu(); }} />
                    <MenuItem
                        label="Auto-save"
                        onClick={() => { onToggleAutoSave(); onCloseMenu(); }}
                        checked={autoSave}
                    />
                    <div className="h-px bg-gray-700 my-1" />
                    <MenuItem label="Export as Image..." onClick={() => { onExport(); onCloseMenu(); }} />
                </div>
            )}
        </div>
    );
};
