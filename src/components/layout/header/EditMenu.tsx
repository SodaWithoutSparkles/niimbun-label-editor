import React from 'react';
import { MenuItem } from './MenuItem';

interface EditMenuProps {
    activeMenu: string | null;
    onToggle: (menu: string) => void;
    onCloseMenu: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onCloneSelected: () => void;
    onDeleteSelected: () => void;
    onMoveSelectedLayer: (direction: 'up' | 'down') => void;
    onInsertLocalImage: () => void;
    onInsertRemoteImage: () => void;
}

export const EditMenu: React.FC<EditMenuProps> = ({
    activeMenu,
    onToggle,
    onCloseMenu,
    onUndo,
    onRedo,
    onCloneSelected,
    onDeleteSelected,
    onMoveSelectedLayer,
    onInsertLocalImage,
    onInsertRemoteImage
}) => {
    return (
        <div className="relative">
            <div
                className={`px-3 hover:bg-gray-700 cursor-pointer h-full flex items-center ${activeMenu === 'edit' ? 'bg-gray-700' : ''}`}
                onClick={() => onToggle('edit')}
            >
                Edit
            </div>
            {activeMenu === 'edit' && (
                <div className="absolute top-full left-0 bg-gray-800 border border-gray-600 shadow-xl py-1 rounded-b-md min-w-[260px]">
                    <MenuItem label="Undo" onClick={() => { onUndo(); onCloseMenu(); }} shortcut="Ctrl+Z" />
                    <MenuItem label="Redo" onClick={() => { onRedo(); onCloseMenu(); }} shortcut="Ctrl+Y" />
                    <div className="h-px bg-gray-700 my-1" />
                    <MenuItem label="Clone Object" onClick={() => { onCloneSelected(); onCloseMenu(); }} shortcut="Ctrl+D" />
                    <MenuItem label="Delete Selected" onClick={() => { onDeleteSelected(); onCloseMenu(); }} shortcut="Del" />
                    <MenuItem label="Move Up" onClick={() => { onMoveSelectedLayer('up'); onCloseMenu(); }} shortcut="]" />
                    <MenuItem label="Move Down" onClick={() => { onMoveSelectedLayer('down'); onCloseMenu(); }} shortcut="[" />
                    <div className="h-px bg-gray-700 my-1" />
                    <MenuItem label="Insert Local Image" onClick={() => { onInsertLocalImage(); onCloseMenu(); }} />
                    <MenuItem label="Insert Remote Image" onClick={() => { onInsertRemoteImage(); onCloseMenu(); }} />
                </div>
            )}
        </div>
    );
};
