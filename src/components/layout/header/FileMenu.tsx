import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../utils/cn';
import { MenuItem } from './MenuItem';

interface FileMenuProps {
    activeMenu: string | null;
    onToggle: (menu: string) => void;
    onCloseMenu: () => void;
    autoSave: boolean;
    onSave: () => void;
    onToggleAutoSave: () => void;
    onPrint: () => void;
    /** Save writes the open document; disabled while the gallery is showing. */
    saveDisabled: boolean;
    /** Print needs an open document in the editor. */
    printDisabled: boolean;
    /** Returns to the gallery home surface. */
    onHome: () => void;
    /** Opens the hidden file picker for a label bundle import. */
    onImport: () => void;
    /** Downloads the open document as a bundle. */
    onExportCurrent: () => void;
    /** Downloads every stored label as one bundle. */
    onExportAll: () => void;
    /** Export needs an open document (and no transfer already running). */
    exportDisabled: boolean;
    /** Export all needs at least one stored label. */
    exportAllDisabled: boolean;
    /** An import/export is running: every transfer item is disabled. */
    transferBusy: boolean;
}

/**
 * File menu (ui-spec.md §3). Save writes the live document through
 * `saveCurrentLabel`; import/export go through `useLabelTransfer` (P8b), whose
 * work runs while the menu closes. The former "Save Project As" item was a
 * byte-identical duplicate of Save once the Save-As UI was stripped, so it was
 * removed rather than shipped as a second dead control.
 */
export const FileMenu: React.FC<FileMenuProps> = ({
    activeMenu,
    onToggle,
    onCloseMenu,
    autoSave,
    onSave,
    onToggleAutoSave,
    onPrint,
    saveDisabled,
    printDisabled,
    onHome,
    onImport,
    onExportCurrent,
    onExportAll,
    exportDisabled,
    exportAllDisabled,
    transferBusy,
}) => {
    const { t } = useTranslation();
    return (
        <div className="relative">
            <div
                className={cn(
                    'px-3 hover:bg-gray-700 cursor-pointer h-full flex items-center',
                    activeMenu === 'file' && 'bg-gray-700',
                )}
                onClick={() => onToggle('file')}
            >
                {t('fileMenu.title')}
            </div>
            {activeMenu === 'file' && (
                <div className="absolute top-full left-0 bg-gray-800 border border-gray-600 shadow-xl py-1 rounded-b-md min-w-[260px]">
                    <MenuItem
                        label={t('fileMenu.home')}
                        onClick={() => { onHome(); onCloseMenu(); }}
                    />
                    <MenuItem
                        label={t('fileMenu.saveProject')}
                        disabled={saveDisabled}
                        onClick={() => { onSave(); onCloseMenu(); }}
                    />
                    <MenuItem
                        label={t('fileMenu.importLabels')}
                        disabled={transferBusy}
                        onClick={() => { onImport(); onCloseMenu(); }}
                    />
                    <MenuItem
                        label={t('fileMenu.exportCurrent')}
                        disabled={exportDisabled || transferBusy}
                        onClick={() => { onExportCurrent(); onCloseMenu(); }}
                    />
                    <MenuItem
                        label={t('fileMenu.exportAll')}
                        disabled={exportAllDisabled || transferBusy}
                        onClick={() => { onExportAll(); onCloseMenu(); }}
                    />
                    <MenuItem
                        label={t('fileMenu.print')}
                        shortcut="Ctrl+P"
                        disabled={printDisabled}
                        onClick={() => { onPrint(); onCloseMenu(); }}
                    />
                    <MenuItem
                        label={t('fileMenu.autoSave')}
                        onClick={() => { onToggleAutoSave(); onCloseMenu(); }}
                        checked={autoSave}
                    />
                </div>
            )}
        </div>
    );
};
