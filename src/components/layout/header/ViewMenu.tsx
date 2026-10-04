import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../utils/cn';
import type { AppState } from '../../../store/storeTypes';
import type { ZoomMode } from '../../../store/slices/viewSlice';
import { MenuItem } from './MenuItem';

interface ViewMenuProps {
    activeMenu: string | null;
    onToggle: (menu: string) => void;
    onCloseMenu: () => void;
    gridVisible: boolean;
    snapEnabled: boolean;
    rulersVisible: boolean;
    zoomMode: ZoomMode;
    viewRotation: AppState['viewRotation'];
    onToggleGrid: () => void;
    onToggleSnap: () => void;
    onToggleRulers: () => void;
    onFit: () => void;
    onRealSize: () => void;
    onRotate: () => void;
}

/**
 * View menu (ui-spec.md §3). Wired to the existing `viewSlice` toggles; all
 * items are view-only and never mutate the document.
 */
export const ViewMenu: React.FC<ViewMenuProps> = ({
    activeMenu,
    onToggle,
    onCloseMenu,
    gridVisible,
    snapEnabled,
    rulersVisible,
    zoomMode,
    viewRotation,
    onToggleGrid,
    onToggleSnap,
    onToggleRulers,
    onFit,
    onRealSize,
    onRotate
}) => {
    const { t } = useTranslation();
    return (
        <div className="relative">
            <div
                className={cn(
                    'px-3 hover:bg-gray-700 cursor-pointer h-full flex items-center',
                    activeMenu === 'view' && 'bg-gray-700',
                )}
                onClick={() => onToggle('view')}
            >
                {t('editor.view.title')}
            </div>
            {activeMenu === 'view' && (
                <div className="absolute top-full left-0 bg-gray-800 border border-gray-600 shadow-xl py-1 rounded-b-md min-w-[220px]">
                    <MenuItem label={t('editor.view.grid')} checked={gridVisible} onClick={() => { onToggleGrid(); onCloseMenu(); }} />
                    <MenuItem label={t('editor.view.snap')} checked={snapEnabled} onClick={() => { onToggleSnap(); onCloseMenu(); }} />
                    <MenuItem label={t('editor.view.rulers')} checked={rulersVisible} onClick={() => { onToggleRulers(); onCloseMenu(); }} />
                    <div className="h-px bg-gray-700 my-1" />
                    <MenuItem label={t('editor.view.fit')} checked={zoomMode === 'fit'} onClick={() => { onFit(); onCloseMenu(); }} />
                    <MenuItem label={t('editor.view.real')} checked={zoomMode === 'real'} onClick={() => { onRealSize(); onCloseMenu(); }} />
                    <div className="h-px bg-gray-700 my-1" />
                    <MenuItem label={t('editor.view.rotate')} checked={viewRotation === 90} onClick={() => { onRotate(); onCloseMenu(); }} />
                </div>
            )}
        </div>
    );
};
