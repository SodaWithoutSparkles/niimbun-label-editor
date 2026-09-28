import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import type { SaveFile } from '../../types';
import { compressToBase64 } from '../../utils/compress';
import { createDefaultProjectName } from '../../utils/projectName';
import { sanitizeFilename, ensureSaveExtension, buildDefaultSaveName, parseTimestamp, parseSaveFile, writeSaveFileToHandle, downloadSaveFile } from '../../utils/saveProject';
import { ShortcutConfigModal } from '../common/ShortcutConfigModal';
import { FileMenu } from './header/FileMenu';
import { EditMenu } from './header/EditMenu';
import { OptionsMenu } from './header/OptionsMenu';
import { HelpMenu } from './header/HelpMenu';
import { HelpModal } from '../help/HelpModal';

export const Header: React.FC = () => {
    const [activeMenu, setActiveMenu] = useState<string | null>(null);
    const [showShortcutConfig, setShowShortcutConfig] = useState(false);
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
    const setLastAutoSaveAt = useStore(state => state.setLastAutoSaveAt);
    const triggerExport = useStore(state => state.triggerExport);

    // Safety check for overwriting
    const hasPerformedClearAll = useStore(state => state.hasPerformedClearAll);

    // Store state getters for save - fetch individually to prevent re-render loops
    const objects = useStore(state => state.objects);
    const version = useStore(state => state.version);

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

    // Auto-save effect
    useEffect(() => {
        if (autoSave) {
            const timer = setTimeout(async () => {
                const saveData = buildSaveFile();
                try {
                    const base64 = await compressToBase64(JSON.stringify(saveData));
                    localStorage.setItem('autosave_project', base64);
                    setLastAutoSaveAt(Date.now());
                    console.log('Auto-saved (compressed)'); // Optional confirmation
                } catch (err) {
                    console.error('Failed to compress autosave', err);
                }
            }, 5000); // Auto-save 5s debounce
            return () => clearTimeout(timer);
        }
    }, [objects, version, projectName, saveFileName, autoSave]);


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
                    const confirmed = window.confirm(
                        "WARNING: You have cleared all objects during this session.\n" +
                        "Saving now will OVERWRITE your existing file on disk with these changes.\n\n" +
                        "If you intended to start a new drawing based on this file, you should probably use 'Save As' instead to keep the old file intact.\n\n" +
                        "Click OK to overwrite the existing file.\n" +
                        "Click Cancel to abort (then use File > Save As)."
                    );
                    if (!confirmed) return;
                } else if (objects.length === 0) {
                    // Still warn on empty, just in case they deleted manually one by one
                    const confirmed = window.confirm(
                        "You are about to save an empty canvas to your existing file.\n" +
                        "This will overwrite your previous work with no objects.\n\n" +
                        "Click OK to overwrite in-place.\n" +
                        "Click Cancel to abort."
                    );
                    if (!confirmed) return;
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
            alert('Failed to save project');
        }
    };

    const handleSaveAs = async () => {
        try {
            setActiveMenu(null);
            openSaveAsModal();
        } catch (err) {
            console.error('Failed to save project as', err);
            alert('Failed to save project');
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
            alert('Failed to load project file');
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
            alert('Failed to open project file');
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

    const handleRemoteImageInsert = () => {
        const url = prompt('Paste an image URL');
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
            alert('Failed to save project');
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
                onExport={triggerExport}
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
                        aria-label="Project name"
                    />
                ) : (
                    <button
                        type="button"
                        onClick={() => setIsEditingName(true)}
                        className="px-3 py-1 rounded text-gray-200 hover:bg-gray-800 transition-colors truncate max-w-full"
                        title="Click to rename project"
                    >
                        {projectName}
                    </button>
                )}
            </div>

            <EditMenu
                activeMenu={activeMenu}
                onToggle={toggleMenu}
                onCloseMenu={() => setActiveMenu(null)}
                onUndo={undo}
                onRedo={redo}
                onCloneSelected={cloneSelected}
                onDeleteSelected={deleteSelected}
                onMoveSelectedLayer={moveSelectedLayer}
                onInsertLocalImage={() => imageInputRef.current?.click()}
                onInsertRemoteImage={handleRemoteImageInsert}
            />

            <OptionsMenu
                activeMenu={activeMenu}
                onToggle={toggleMenu}
                onCloseMenu={() => setActiveMenu(null)}
                onShowShortcutConfig={() => setShowShortcutConfig(true)}
            />

            <HelpMenu
                activeMenu={activeMenu}
                onToggle={toggleMenu}
                onCloseMenu={() => setActiveMenu(null)}
                onShowHelp={() => setShowHelp(true)}
            />

            {/* Click backdrop to close menu */}
            {activeMenu && (
                <div className="fixed inset-0 z-[-1]" onClick={() => setActiveMenu(null)} />
            )}
            {showSaveAsModal && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60">
                    <div className="bg-gray-900 text-white rounded-lg shadow-2xl w-full max-w-2xl overflow-hidden border border-gray-700">
                        <div className="px-6 py-4 border-b border-gray-700 flex justify-between items-center">
                            <h2 className="text-lg font-semibold">Save Project As</h2>
                            <button
                                className="text-gray-300 hover:text-white transition-colors"
                                onClick={() => setShowSaveAsModal(false)}
                                aria-label="Close save as"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm text-gray-300">Project name</label>
                                <input
                                    value={saveAsProjectName}
                                    onChange={(e) => setSaveAsProjectName(e.target.value)}
                                    className="w-full bg-gray-800 border border-gray-700 text-gray-100 px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder="Project name"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm text-gray-300">File name</label>
                                <input
                                    value={saveAsFileName}
                                    onChange={(e) => setSaveAsFileName(e.target.value)}
                                    className="w-full bg-gray-800 border border-gray-700 text-gray-100 px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder="filename.fsp"
                                />
                                <p className="text-xs text-gray-400">Use .fsp for compressed saves or .json for legacy format.</p>
                            </div>
                        </div>

                        <div className="px-6 py-4 border-t border-gray-700 flex justify-end space-x-2">
                            <button
                                className="px-4 py-2 text-sm rounded bg-gray-700 hover:bg-gray-600"
                                onClick={() => setShowSaveAsModal(false)}
                            >
                                Cancel
                            </button>
                            <button
                                className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500"
                                onClick={confirmSaveAs}
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <ShortcutConfigModal
                isOpen={showShortcutConfig}
                onClose={() => setShowShortcutConfig(false)}
            />
            <HelpModal
                isOpen={showHelp}
                onClose={() => setShowHelp(false)}
            />
        </div>
    );
};
