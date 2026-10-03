import React from 'react';
import { useTranslation } from 'react-i18next';
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
    onGroup?: () => void;
    onUngroup?: () => void;
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
    onGroup,
    onUngroup,
    onInsertLocalImage,
    onInsertRemoteImage
}) => {
    const { t } = useTranslation();
    return (
        <div className="relative">
            <div
                className={`px-3 hover:bg-gray-700 cursor-pointer h-full flex items-center ${activeMenu === 'edit' ? 'bg-gray-700' : ''}`}
                onClick={() => onToggle('edit')}
            >
                {t('editMenu.title')}
            </div>
            {activeMenu === 'edit' && (
                <div className="absolute top-full left-0 bg-gray-800 border border-gray-600 shadow-xl py-1 rounded-b-md min-w-[260px]">
                    <MenuItem label={t('editMenu.undo')} onClick={() => { onUndo(); onCloseMenu(); }} shortcut="Ctrl+Z" />
                    <MenuItem label={t('editMenu.redo')} onClick={() => { onRedo(); onCloseMenu(); }} shortcut="Ctrl+Y" />
                    <div className="h-px bg-gray-700 my-1" />
                    <MenuItem label={t('editMenu.cloneObject')} onClick={() => { onCloneSelected(); onCloseMenu(); }} shortcut="Ctrl+D" />
                    <MenuItem label={t('editMenu.deleteSelected')} onClick={() => { onDeleteSelected(); onCloseMenu(); }} shortcut="Del" />
                    <MenuItem label={t('editMenu.group')} onClick={() => { onGroup?.(); onCloseMenu(); }} shortcut="Ctrl+G" />
                    <MenuItem label={t('editMenu.ungroup')} onClick={() => { onUngroup?.(); onCloseMenu(); }} shortcut="Ctrl+Shift+G" />
                    <MenuItem label={t('editMenu.moveUp')} onClick={() => { onMoveSelectedLayer('up'); onCloseMenu(); }} shortcut="]" />
                    <MenuItem label={t('editMenu.moveDown')} onClick={() => { onMoveSelectedLayer('down'); onCloseMenu(); }} shortcut="[" />
                    <div className="h-px bg-gray-700 my-1" />
                    <MenuItem label={t('editMenu.insertLocalImage')} onClick={() => { onInsertLocalImage(); onCloseMenu(); }} />
                    <MenuItem label={t('editMenu.insertRemoteImage')} onClick={() => { void onInsertRemoteImage(); onCloseMenu(); }} />
                </div>
            )}
        </div>
    );
};
