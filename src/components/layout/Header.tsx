import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import type { SaveFile } from '../../types';
import { createDefaultProjectName } from '../../utils/projectName';
import { sanitizeFilename, ensureSaveExtension, buildDefaultSaveName, parseTimestamp, parseSaveFile, writeSaveFileToHandle, downloadSaveFile } from '../../utils/saveProject';
import { FileMenu } from './header/FileMenu';
import { EditMenu } from './header/EditMenu';
import { OptionsMenu } from './header/OptionsMenu';
import { HelpMenu } from './header/HelpMenu';
import { HelpModal } from '../help/HelpModal';
import { SettingsModal } from '../settings/SettingsModal';
import { Modal, confirm, promptText } from '../common/dialogs';
import { ConnectionChip } from '../common/ConnectionChip';
import i18n from '../../i18n';

export const Header: React.FC = () => {
    const { t } = useTranslation();
    const [activeMenu, setActiveMenu] = useState<string | null>(null);
    const [showHelp, setShowHelp] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const [isEditingName, setIsEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState('');
    const [showSaveAsModal, setShowSaveAsModal] = useState(false);
    const [saveAsProjectName, setSaveAsProjectName] = useState('');
    const [saveAsFileName, setSaveAsFileName] = useState('');

    // Store actions
    const resetProject = useStore(state => state.resetProject);
    const loadProject = useStore(state => state.loadProject);
    const undo = useStore(state => state.undo);
    const redo = useStore(state => state.redo);
    const cloneSelected = useStore(state => state.cloneSelected);
    const deleteSelected = useStore(state => state.deleteSelected);
    const moveSelectedLayer = useStore(state => state.moveSelectedLayer);
    const addItem = useStore(state => state.addItem);
    const projectName = useStore(state => state.projectName);
    const setProjectName = useStore(state => state.setProjectName);
    const saveFileName = useStore(state => state.saveFileName);
    const setSaveFileName = useStore(state => state.setSaveFileName);
    const fileHandle = useStore(state => state.fileHandle);
    const setFileHandle = useStore(state => state.setFileHandle);
    const setLastSavedAt = useStore(state => state.setLastSavedAt);
    const lastSavedAt = useStore(state => state.lastSavedAt);
    const autoSave = useStore(state => state.autoSave);
    const toggleAutoSave = useStore(state => state.toggleAutoSave);
    const openExportModal = useStore(state => state.openExportModal);
    const addNotification = useStore(state => state.addNotification);

    // Safety check for overwriting
    const hasPerformedClearAll = useStore(state => state.hasPerformedClearAll);

    // Store state getters for save - fetch individually to prevent re-render loops
    const objects = useStore(state => state.objects);

    // Editor-view edit commands (ui-spec.md §3): the Edit menu targets the
    // document selection when the editor is open, and the legacy canvas model
    // otherwise. Shortcuts in `EditorKeyboardShortcuts` mirror these.
    const view = useStore(state => state.view);
    const selectedNodeIds = useStore(state => state.selectedNodeIds);
    const undoDoc = useStore(state => state.undoDoc);
    const redoDoc = useStore(state => state.redoDoc);
    const cloneNode = useStore(state => state.cloneNode);
    const removeNode = useStore(state => state.removeNode);
    const moveNodeZ = useStore(state => state.moveNodeZ);
    const groupNodes = useStore(state => state.groupNodes);
    const ungroupNode = useStore(state => state.ungroupNode);
    const isEditor = view === 'editor';
    const editUndo = () => (isEditor ? undoDoc() : undo());
    const editRedo = () => (isEditor ? redoDoc() : redo());
    const editClone = () => {
        if (isEditor) selectedNodeIds.forEach((id) => cloneNode(id));
        else cloneSelected();
    };
    const editDelete = () => {
        if (isEditor) selectedNodeIds.forEach((id) => removeNode(id));
        else deleteSelected();
    };
    const editMoveLayer = (direction: 'up' | 'down') => {
        if (isEditor) selectedNodeIds.forEach((id) => moveNodeZ(id, direction));
        else moveSelectedLayer(direction);
    };
    const editGroup = () => {
        if (isEditor) groupNodes([...selectedNodeIds]);
    };
    const editUngroup = () => {
        if (isEditor) selectedNodeIds.forEach((id) => ungroupNode(id));
    };

    const language = useStore(state => state.language);
    const isSettingsOpen = useStore(state => state.isSettingsOpen);
    const openSettings = useStore(state => state.openSettings);
    const closeSettings = useStore(state => state.closeSettings);

    const supportsFileSystemAccess = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

    // Build a generic SaveFile from the current store state.
    const buildSaveFile = (): SaveFile => {
        const s = useStore.getState();
        return {
            version: s.version,
            projectName: s.projectName,
            saveFileName: s.saveFileName ?? undefined,
            createdAt: s.createdAt ?? undefined,
            timestamp: new Date(),
            canvas: {
                objects: s.objects,
                past: s.past,
                future: s.future,
                selectedIds: s.selectedIds,
                hasPerformedClearAll: s.hasPerformedClearAll
            },
            colors: {
                colors: s.colors,
                colorPresets: s.colorPresets,
                selectedPresetIndex: s.selectedPresetIndex,
                isDropperActive: s.isDropperActive,
                pickedColor: s.pickedColor
            },
            tools: {
                activeTool: s.activeTool,
                toolSettings: s.toolSettings,
                showToolSettings: s.showToolSettings
            },
            preferences: {
                history: s.history,
                historyUndoCount: s.historyUndoCount,
                autoSave: s.autoSave,
                keyboardShortcuts: s.keyboardShortcuts
            },
            navigation: {
                canvasPosition: s.canvasPosition
            }
        };
    };

    useEffect(() => {
        if (!isEditingName) {
            setNameDraft(projectName);
        }
    }, [projectName, isEditingName]);

    // Keep i18next in step with the settings store's `language`. Guarded so the
    // store's initial value (already applied at i18n init) does not re-fire.
    useEffect(() => {
        if (i18n.language !== language) {
            void i18n.changeLanguage(language);
        }
    }, [language]);

    // The template's `autosave_project` localStorage write was removed: it saved
    // the old canvas `SaveFile` (write-only, unreadable) and is superseded by
    // P3's IDB autosave. See `agent/2026-09-29_label-editor-v1/state.md`.


    const lastSavedProjectNameRef = useRef(projectName);

    useEffect(() => {
        // Update snapshot of the project name when the project is saved or loaded
        lastSavedProjectNameRef.current = projectName;
    }, [lastSavedAt]);

    const hasNameChanged = projectName.trim() !== (lastSavedProjectNameRef.current?.trim() ?? '');

    const handleSave = async () => {
        try {
            const saveFile = buildSaveFile();

            if (fileHandle) {
                // Safeguard 1: Saving empty canvas when it wasn't empty before?
                // Hard to track "wasn't empty before" without more state, but generally saving 0 objects is rare.
                // Safeguard 2: User wiped everything (Clear All) and is now saving in-place.
                if (hasPerformedClearAll) {
                    if (!(await confirm({ message: t('header.confirmOverwriteCleared') }))) return;
                } else if (objects.length === 0) {
                    // Still warn on empty, just in case they deleted manually one by one
                    if (!(await confirm({ message: t('header.confirmSaveEmpty') }))) return;
                }

                await writeSaveFileToHandle(fileHandle, saveFile);
                setSaveFileName((fileHandle as any).name);
                setLastSavedAt(Date.now());
                setActiveMenu(null);
                return;
            }

            if (supportsFileSystemAccess) {
                setActiveMenu(null);
                openSaveAsModal();
                return;
            }

            // No File System Access API — prefer the user's previously chosen filename if available
            const filename = saveFileName ? ensureSaveExtension(saveFileName) : ensureSaveExtension(sanitizeFilename(projectName.trim()) || buildDefaultSaveName(projectName));
            await downloadSaveFile(filename, saveFile);
            setFileHandle(null);
            setSaveFileName(filename);
            setLastSavedAt(Date.now());
            setActiveMenu(null);
        } catch (err) {
            console.error('Failed to save project', err);
            addNotification({ type: 'error', message: t('errors.saveFailed') });
        }
    };

    const handleSaveAs = async () => {
        try {
            setActiveMenu(null);
            openSaveAsModal();
        } catch (err) {
            console.error('Failed to save project as', err);
            addNotification({ type: 'error', message: t('errors.saveFailed') });
        }
    };

    const handleLoad = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const parsed = await parseSaveFile(file);
            loadProject(parsed);
            setFileHandle(null);
            const preferredName = parsed.saveFileName ?? file.name;
            setSaveFileName(preferredName);
            setProjectName(parsed.projectName ?? file.name.replace(/\.[^/.]+$/, '') ?? createDefaultProjectName());
            setLastSavedAt(parseTimestamp(parsed.timestamp));

            // If the File System Access API is available, prompt the user to pick a handle
            // so future saves can write in-place. This is optional — ignore cancellation.
            if (supportsFileSystemAccess) {
                try {
                    const handle = await (window as any).showSaveFilePicker({
                        suggestedName: preferredName,
                        types: [{ description: 'Drawing Project', accept: { 'application/json': ['.fsp', '.json'] } }]
                    });
                    if (handle) {
                        setFileHandle(handle);
                        setSaveFileName(handle.name);
                    }
                } catch (err) {
                    // user cancelled or permission denied — fine to ignore
                }
            }
        } catch (err) {
            console.error('Failed to load project file', err);
            addNotification({ type: 'error', message: t('errors.loadFailed') });
        }

        setActiveMenu(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleOpenProject = async () => {
        try {
            if (typeof window !== 'undefined' && 'showOpenFilePicker' in window) {
                const [handle] = await (window as any).showOpenFilePicker({
                    types: [{ description: 'Drawing Project', accept: { 'application/json': ['.fsp', '.json'] } }],
                    multiple: false
                });
                if (!handle) return;
                const file = await handle.getFile();
                const parsed = await parseSaveFile(file);
                loadProject(parsed);
                setFileHandle(handle);
                // prefer the internal preferred filename if present
                setSaveFileName(parsed.saveFileName ?? file.name);
                setProjectName(parsed.projectName ?? file.name.replace(/\.[^/.]+$/, '') ?? createDefaultProjectName());
                setLastSavedAt(parseTimestamp(parsed.timestamp));
                setActiveMenu(null);
                return;
            }
            fileInputRef.current?.click();
            setActiveMenu(null);
        } catch (err) {
            console.error('Failed to open project file', err);
            addNotification({ type: 'error', message: t('errors.openFailed') });
        }
    };

    const handleImageInsert = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const src = event.target?.result as string;
            addItem({
                id: Math.random().toString(36).slice(2, 11),
                type: 'image',
                x: 100,
                y: 100,
                rotation: 0,
                stroke: 'transparent',
                strokeWidth: 0,
                fill: 'transparent',
                opacity: 1,
                draggable: true,
                width: 200,
                height: 200,
                src
            });
        };
        reader.readAsDataURL(file);
        setActiveMenu(null);
        if (imageInputRef.current) imageInputRef.current.value = '';
    };

    const handleRemoteImageInsert = async () => {
        const url = await promptText({ message: t('header.promptImageUrl') });
        if (!url) return;

        addItem({
            id: Math.random().toString(36).slice(2, 11),
            type: 'image',
            x: 100,
            y: 100,
            rotation: 0,
            stroke: 'transparent',
            strokeWidth: 0,
            fill: 'transparent',
            opacity: 1,
            draggable: true,
            width: 200,
            height: 200,
            src: url.trim()
        });
        setActiveMenu(null);
    };

    const toggleMenu = (menu: string) => {
        setActiveMenu(activeMenu === menu ? null : menu);
    };

    // Close the open header dropdown on Escape, and consume the event so it
    // does not also reach the window-level Escape handlers (canvas cancel).
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

    const openSaveAsModal = () => {
        const suggestedName = saveFileName || buildDefaultSaveName(projectName);
        setSaveAsProjectName(projectName || createDefaultProjectName());
        setSaveAsFileName(suggestedName);
        setShowSaveAsModal(true);
    };

    const confirmSaveAs = async () => {
        const nextProjectName = saveAsProjectName.trim() || createDefaultProjectName();
        const nextFilename = ensureSaveExtension(sanitizeFilename(saveAsFileName.trim()) || buildDefaultSaveName(nextProjectName));
        setProjectName(nextProjectName);
        setSaveFileName(nextFilename);

        const saveFile = buildSaveFile();
        saveFile.projectName = nextProjectName;
        saveFile.saveFileName = nextFilename;

        try {
            if (supportsFileSystemAccess) {
                try {
                    const handle = await (window as any).showSaveFilePicker({
                        suggestedName: nextFilename,
                        types: [{ description: 'Drawing Project', accept: { 'application/json': ['.fsp', '.json'] } }]
                    });
                    await writeSaveFileToHandle(handle, saveFile);
                    setFileHandle(handle);
                    setSaveFileName(handle.name);
                    setLastSavedAt(Date.now());
                } catch (err) {
                    await downloadSaveFile(nextFilename, saveFile);
                    setFileHandle(null);
                    setLastSavedAt(Date.now());
                }
            } else {
                await downloadSaveFile(nextFilename, saveFile);
                setFileHandle(null);
                setLastSavedAt(Date.now());
            }
            setShowSaveAsModal(false);
        } catch (err) {
            console.error('Failed to save project', err);
            addNotification({ type: 'error', message: t('errors.saveFailed') });
        }
    };

    const commitProjectName = () => {
        const trimmed = nameDraft.trim();
        if (!trimmed) {
            const fallback = createDefaultProjectName();
            setProjectName(fallback);
            setNameDraft(fallback);
        } else {
            setProjectName(trimmed);
        }
        setIsEditingName(false);
    };

    const cancelProjectName = () => {
        setIsEditingName(false);
        setNameDraft(projectName);
    };

    return (
        <div className="h-8 bg-gray-900 border-b border-gray-700 flex items-center px-2 text-sm text-gray-300 select-none relative z-50">
            {/* Hidden Inputs */}
            <input type="file" ref={fileInputRef} className="hidden" accept=".json,.fsp" onChange={handleLoad} />
            <input type="file" ref={imageInputRef} className="hidden" accept="image/*" onChange={handleImageInsert} />

            {/* Menus */}
            <FileMenu
                activeMenu={activeMenu}
                onToggle={toggleMenu}
                onCloseMenu={() => setActiveMenu(null)}
                supportsFileSystemAccess={supportsFileSystemAccess}
                hasNameChanged={hasNameChanged}
                autoSave={autoSave}
                onNewProject={() => {
                    resetProject();
                    setActiveMenu(null);
                }}
                onOpenProject={handleOpenProject}
                onSave={handleSave}
                onSaveAs={handleSaveAs}
                onToggleAutoSave={toggleAutoSave}
                onExport={openExportModal}
            />

            <div className="absolute left-1/2 top-0 h-full -translate-x-1/2 flex items-center max-w-[480px] w-full justify-center px-4">
                {isEditingName ? (
                    <input
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onBlur={commitProjectName}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                commitProjectName();
                            }
                            if (e.key === 'Escape') {
                                cancelProjectName();
                            }
                        }}
                        className="bg-gray-800 border border-gray-600 text-gray-100 text-sm px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[240px]"
                        autoFocus
                        aria-label={t('header.projectNameAria')}
                    />
                ) : (
                    <button
                        type="button"
                        onClick={() => setIsEditingName(true)}
                        className="px-3 py-1 rounded text-gray-200 hover:bg-gray-800 transition-colors truncate max-w-full"
                        title={t('header.renameProjectTitle')}
                    >
                        {projectName}
                    </button>
                )}
            </div>

            <EditMenu
                activeMenu={activeMenu}
                onToggle={toggleMenu}
                onCloseMenu={() => setActiveMenu(null)}
                onUndo={editUndo}
                onRedo={editRedo}
                onCloneSelected={editClone}
                onDeleteSelected={editDelete}
                onMoveSelectedLayer={editMoveLayer}
                onGroup={editGroup}
                onUngroup={editUngroup}
                onInsertLocalImage={() => imageInputRef.current?.click()}
                onInsertRemoteImage={handleRemoteImageInsert}
            />

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
            <Modal
                open={showSaveAsModal}
                onClose={() => setShowSaveAsModal(false)}
                title={t('saveAs.title')}
                size="lg"
                footer={(
                    <>
                        <button
                            className="px-4 py-2 text-sm rounded bg-gray-700 hover:bg-gray-600"
                            onClick={() => setShowSaveAsModal(false)}
                        >
                            {t('dialog.cancel')}
                        </button>
                        <button
                            className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500"
                            onClick={() => { void confirmSaveAs(); }}
                        >
                            {t('saveAs.save')}
                        </button>
                    </>
                )}
            >
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm text-gray-300">{t('saveAs.projectName')}</label>
                        <input
                            value={saveAsProjectName}
                            onChange={(e) => setSaveAsProjectName(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 text-gray-100 px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder={t('saveAs.projectNamePlaceholder')}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm text-gray-300">{t('saveAs.fileName')}</label>
                        <input
                            value={saveAsFileName}
                            onChange={(e) => setSaveAsFileName(e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 text-gray-100 px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder={t('saveAs.fileNamePlaceholder')}
                        />
                        <p className="text-xs text-gray-400">{t('saveAs.hint')}</p>
                    </div>
                </div>
            </Modal>
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
