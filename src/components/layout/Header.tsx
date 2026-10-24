import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import { FileMenu } from './header/FileMenu';
import { useLabelTransfer } from './useLabelTransfer';
import { EditMenu } from './header/EditMenu';
import { ViewMenu } from './header/ViewMenu';
import { OptionsMenu } from './header/OptionsMenu';
import { HelpMenu } from './header/HelpMenu';
import { HelpModal } from '../help/HelpModal';
import { SettingsModal } from '../settings/SettingsModal';
import { ConnectionChip } from '../common/ConnectionChip';
import i18n from '../../i18n';

export const Header: React.FC = () => {
    const { t } = useTranslation();
    const [activeMenu, setActiveMenu] = useState<string | null>(null);
    const [showHelp, setShowHelp] = useState(false);
    const [isEditingName, setIsEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState('');

    // Store actions
    const view = useStore(state => state.view);
    const setView = useStore(state => state.setView);
    const isEditor = view === 'editor';
    // The centre title is the open document's name — the only name the app
    // actually persists. Hidden in the gallery (there is no document to name).
    const docName = useStore(state => state.currentDoc?.meta.name ?? '');
    const hasDoc = useStore(state => state.currentDoc !== null);
    const openPrint = useStore(state => state.openPrint);
    const renameDoc = useStore(state => state.renameDoc);
    const saveCurrentLabel = useStore(state => state.saveCurrentLabel);
    const autoSave = useStore(state => state.autoSave);
    const toggleAutoSave = useStore(state => state.toggleAutoSave);
    const galleryLength = useStore(state => state.gallery.length);

    // Import/export (P8b). The picker itself is a hidden input rendered once
    // below; the hook owns the untrusted-file boundary and the notifications.
    const transfer = useLabelTransfer();
    const importRef = useRef<HTMLInputElement>(null);

    // Editor document selection + ops (ui-spec.md §3). Shortcuts in
    // `EditorKeyboardShortcuts` mirror these; both are no-ops in the gallery.
    const selectedNodeIds = useStore(state => state.selectedNodeIds);
    const undoDoc = useStore(state => state.undoDoc);
    const redoDoc = useStore(state => state.redoDoc);
    const cloneNode = useStore(state => state.cloneNode);
    const selectNodes = useStore(state => state.selectNodes);
    const removeNode = useStore(state => state.removeNode);
    const moveNodeZ = useStore(state => state.moveNodeZ);
    const groupNodes = useStore(state => state.groupNodes);
    const ungroupNode = useStore(state => state.ungroupNode);

    // View state (View menu) — view-only, never touches the document.
    const gridVisible = useStore(state => state.gridVisible);
    const toggleGrid = useStore(state => state.toggleGrid);
    const snapEnabled = useStore(state => state.snapEnabled);
    const toggleSnap = useStore(state => state.toggleSnap);
    const rulersVisible = useStore(state => state.rulersVisible);
    const toggleRulers = useStore(state => state.toggleRulers);
    const zoomMode = useStore(state => state.zoomMode);
    const setZoomMode = useStore(state => state.setZoomMode);
    const viewRotation = useStore(state => state.viewRotation);
    const toggleViewRotation = useStore(state => state.toggleViewRotation);

    // Duplicate every selected root, then select the clones (H2): selecting
    // replaces the selection, so the sources are deselected automatically.
    const editClone = () => {
        const clonedIds = selectedNodeIds
            .map((id) => cloneNode(id))
            .filter((id): id is string => id !== null);
        if (clonedIds.length > 0) selectNodes(clonedIds);
    };
    const editDelete = () => selectedNodeIds.forEach((id) => removeNode(id));
    const editMoveLayer = (direction: 'up' | 'down') =>
        selectedNodeIds.forEach((id) => moveNodeZ(id, direction));
    const editGroup = () => groupNodes([...selectedNodeIds]);
    const editUngroup = () => selectedNodeIds.forEach((id) => ungroupNode(id));

    const language = useStore(state => state.language);
    const isSettingsOpen = useStore(state => state.isSettingsOpen);
    const openSettings = useStore(state => state.openSettings);
    const closeSettings = useStore(state => state.closeSettings);

    useEffect(() => {
        if (!isEditingName) {
            setNameDraft(docName);
        }
    }, [docName, isEditingName]);

    // Keep i18next in step with the settings store's `language`. Guarded so the
    // store's initial value (already applied at i18n init) does not re-fire.
    useEffect(() => {
        if (i18n.language !== language) {
            void i18n.changeLanguage(language);
        }
    }, [language]);

    // Save writes the live document. The explicit store action stamps
    // `updatedAt`, sets `lastSavedAt` and surfaces a failure notification; the
    // header simply awaits it and closes the menu. Disabled in the gallery
    // (`saveDisabled`), where there is no open document to write.
    const handleSave = async () => {
        setActiveMenu(null);
        await saveCurrentLabel();
    };

    // Pick one file, hand it to the transfer hook, then clear the input's
    // value: without the reset a second pick of the *same* file fires no
    // `change` event and the import silently never happens.
    const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0] ?? null;
        event.target.value = '';
        if (file) void transfer.importFile(file);
    };

    const toggleMenu = (menu: string) => {
        setActiveMenu(activeMenu === menu ? null : menu);
    };

    // Close the open header dropdown on Escape, and consume the event so it
    // does not also reach the window-level Escape handlers (editor cancel).
    // Uses capture so it runs before those window listeners regardless of order.
    // When a modal is open, don't consume Escape (let the Modal handle it) and
    // drop the menu so it isn't left rendered behind the backdrop.
    useEffect(() => {
        if (!activeMenu) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (document.querySelector('dialog[open]')) {
                setActiveMenu(null);
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            setActiveMenu(null);
        };
        window.addEventListener('keydown', handleKeyDown, true);
        // A modal can open while the menu is up (e.g. Ctrl+, opens Settings)
        // without any Escape press; drop the menu so it isn't rendered behind
        // the backdrop. Watch `[open]` attribute flips on dialogs.
        const observer = new MutationObserver(() => {
            if (document.querySelector('dialog[open]')) setActiveMenu(null);
        });
        observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
            observer.disconnect();
        };
    }, [activeMenu]);

    const commitDocName = () => {
        // `renameDoc` ignores an empty name and keeps the current one, so a
        // cleared field never erases the gallery title. Re-seed the draft from
        // the store's resulting name either way.
        renameDoc(nameDraft);
        setIsEditingName(false);
    };

    const cancelDocName = () => {
        setIsEditingName(false);
        setNameDraft(docName);
    };

    return (
        <div className="h-8 bg-gray-900 border-b border-gray-700 flex items-center px-2 text-sm text-gray-300 select-none relative z-50">
            {/* Menus */}
            <FileMenu
                activeMenu={activeMenu}
                onToggle={toggleMenu}
                onCloseMenu={() => setActiveMenu(null)}
                autoSave={autoSave}
                onSave={handleSave}
                onToggleAutoSave={toggleAutoSave}
                onPrint={openPrint}
                saveDisabled={!isEditor}
                printDisabled={!isEditor || !hasDoc}
                onHome={() => setView('gallery')}
                onImport={() => importRef.current?.click()}
                onExportCurrent={() => void transfer.exportCurrent()}
                onExportAll={() => void transfer.exportAll()}
                exportDisabled={!hasDoc || transfer.busy}
                exportAllDisabled={galleryLength === 0 || transfer.busy}
                transferBusy={transfer.busy}
            />

            {/* One hidden picker for the whole header. The bundle is validated
                by the hook; this element only supplies the file. */}
            <input
                ref={importRef}
                type="file"
                accept=".json,.gz,application/json,application/gzip"
                className="hidden"
                onChange={handleImportFile}
            />

            <div className="absolute left-1/2 top-0 h-full -translate-x-1/2 flex items-center max-w-[480px] w-full justify-center px-4">
                {isEditingName ? (
                    <input
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onBlur={commitDocName}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                commitDocName();
                            }
                            if (e.key === 'Escape') {
                                cancelDocName();
                            }
                        }}
                        className={cn(
                            'bg-gray-800 border border-gray-600 text-gray-100 text-sm px-2 py-1 rounded',
                            'focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[240px]',
                        )}
                        autoFocus
                        aria-label={t('header.labelNameAria')}
                    />
                ) : isEditor ? (
                    <button
                        type="button"
                        onClick={() => setIsEditingName(true)}
                        className={cn(
                            'px-3 py-1 rounded text-gray-200 hover:bg-gray-800 transition-colors',
                            'truncate max-w-full',
                        )}
                        title={t('header.renameLabelTitle')}
                    >
                        {docName}
                    </button>
                ) : null}
            </div>

            {isEditor && (
                <EditMenu
                    activeMenu={activeMenu}
                    onToggle={toggleMenu}
                    onCloseMenu={() => setActiveMenu(null)}
                    onUndo={undoDoc}
                    onRedo={redoDoc}
                    onCloneSelected={editClone}
                    onDeleteSelected={editDelete}
                    onMoveSelectedLayer={editMoveLayer}
                    onGroup={editGroup}
                    onUngroup={editUngroup}
                />
            )}

            {isEditor && (
                <ViewMenu
                    activeMenu={activeMenu}
                    onToggle={toggleMenu}
                    onCloseMenu={() => setActiveMenu(null)}
                    gridVisible={gridVisible}
                    snapEnabled={snapEnabled}
                    rulersVisible={rulersVisible}
                    zoomMode={zoomMode}
                    viewRotation={viewRotation}
                    onToggleGrid={toggleGrid}
                    onToggleSnap={toggleSnap}
                    onToggleRulers={toggleRulers}
                    onFit={() => setZoomMode('fit')}
                    onRealSize={() => setZoomMode('real')}
                    onRotate={toggleViewRotation}
                />
            )}

            <OptionsMenu
                activeMenu={activeMenu}
                onToggle={toggleMenu}
                onCloseMenu={() => setActiveMenu(null)}
                onShowSettings={openSettings}
            />

            <HelpMenu
                activeMenu={activeMenu}
                onToggle={toggleMenu}
                onCloseMenu={() => setActiveMenu(null)}
                onShowHelp={() => setShowHelp(true)}
            />

            {/* Connection status stays top-right in both gallery and editor. */}
            <div className="ml-auto pl-3">
                <ConnectionChip />
            </div>

            {/* Click backdrop to close menu */}
            {activeMenu && (
                <div className="fixed inset-0 z-[-1]" onClick={() => setActiveMenu(null)} />
            )}
            <SettingsModal
                open={isSettingsOpen}
                onClose={closeSettings}
            />
            <HelpModal
                isOpen={showHelp}
                onClose={() => setShowHelp(false)}
            />
        </div>
    );
};
