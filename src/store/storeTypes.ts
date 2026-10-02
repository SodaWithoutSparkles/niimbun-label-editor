import type { StateCreator } from 'zustand';
import type { CanvasItem, HistoryEntry, SaveFile } from '../types';
import type { SupportedLanguage } from '../i18n/languages';
import type { hm } from '../core/hm';
import type { LabelDoc, Region } from '../core/doc/types';
import type { LabelPresetId } from '../core/doc/label-presets';
import type { LabelRepo, LabelSummary } from '../data/labelRepo';
import type { PrinterStatus } from '../print/transport';

/** Input for the `createLabel` store action — forwarded to `createLabelDoc`. */
export interface CreateLabelSpec {
    name?: string;
    preset?: LabelPresetId;
    backingW?: hm;
    backingH?: hm;
    dpi?: number;
    regions?: Region[];
    printDirection?: LabelDoc['label']['printDirection'];
}

export interface ColorPreset {
    stroke: string;
    fill: string;
}

export type ModifierKey = 'ctrl' | 'alt' | 'shift';
export type TextSaveModifier = ModifierKey | 'none';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
    id: string;
    type: NotificationType;
    title?: string;
    message: string;
    detail?: string;
    timeout?: number;
}

export interface KeyboardShortcutConfig {
    modifyKey: ModifierKey;
    cancelKey: string;
    textSave: {
        modifier: TextSaveModifier;
        key: string;
    };
    tools: {
        select: string;
        rectangle: string;
        ellipse: string;
        line: string;
        arrow: string;
        callout: string;
        star: string;
        text: string;
        dropper: string;
    };
}

export interface AppState {
    // Project Data
    projectName: string;
    setProjectName: (name: string) => void;
    createdAt: number | null;
    setCreatedAt: (timestamp: number | null) => void;
    saveFileName: string | null;
    setSaveFileName: (name: string | null) => void;
    fileHandle: FileSystemFileHandle | null;
    setFileHandle: (handle: FileSystemFileHandle | null) => void;
    lastSavedAt: number | null;
    setLastSavedAt: (timestamp: number | null) => void;
    version: string;

    // Canvas Objects
    objects: CanvasItem[];
    addItem: (item: CanvasItem) => void;
    updateItem: (id: string, updates: Partial<CanvasItem>) => void;
    updateItems: (ids: string[], updates: Partial<CanvasItem>) => void;
    moveItemsByDelta: (ids: string[], delta: { x: number; y: number }) => void;
    moveItemsByDeltaTransient: (ids: string[], delta: { x: number; y: number }) => void;
    commitHistory: (snapshot: CanvasItem[]) => void;
    removeItem: (id: string) => void;
    deleteSelected: () => void;
    deleteAllItems: () => void;
    hasPerformedClearAll: boolean; // flag to guard against accidental massive data loss on save
    selectedIds: string[];
    selectItem: (id: string | null) => void;
    toggleSelectItem: (id: string) => void;
    selectAllItems: () => void;
    clearSelection: () => void;

    // History (Undo/Redo)
    past: CanvasItem[][];
    future: CanvasItem[][];
    undo: () => void;
    redo: () => void;

    // Edit Operations
    cloneSelected: () => void;
    moveSelectedLayer: (direction: 'up' | 'down') => void;

    // Tool State
    activeTool: 'select' | 'rectangle' | 'ellipse' | 'line' | 'star' | 'arrow' | 'text' | 'callout';
    setActiveTool: (tool: AppState['activeTool']) => void;
    toolSettings: {
        lineWidth: number;
        fontSize: number;
        fontFamily: string;
        fontWeight: 'normal' | 'bold';
        fontStyle: 'normal' | 'italic';
        textAlign: 'left' | 'center' | 'right';
        textColor: string;
    };
    setToolSettings: (settings: Partial<AppState['toolSettings']>) => void;
    showToolSettings: boolean;
    setShowToolSettings: (show: boolean) => void;

    // Color State
    colors: { stroke: string; fill: string; active: 'stroke' | 'fill' };
    setColors: (colors: Partial<AppState['colors']>) => void;
    selectionColorSnapshot: { stroke: string; fill: string; active: 'stroke' | 'fill' } | null;
    // Saved Color Presets (Max 8) - stores both stroke and fill
    colorPresets: ColorPreset[];
    addColorPreset: (preset: ColorPreset) => void;
    updateColorPreset: (index: number, updates: Partial<ColorPreset>) => void;
    selectColorPreset: (index: number) => void;
    removeColorPreset: (index: number) => void;
    selectedPresetIndex: number | null;

    isDropperActive: boolean;
    setDropperActive: (active: boolean) => void;
    pickedColor: string | null;
    setPickedColor: (color: string | null) => void;

    // Log History
    history: HistoryEntry[];
    historyUndoCount: number;
    addToHistory: (action: HistoryEntry) => void;

    // Actions
    loadProject: (data: SaveFile) => void;
    resetProject: () => void;

    // AutoSave
    autoSave: boolean;
    toggleAutoSave: () => void;
    lastAutoSaveAt: number | null;
    setLastAutoSaveAt: (timestamp: number | null) => void;

    // Export
    isExportModalOpen: boolean;
    openExportModal: () => void;
    closeExportModal: () => void;

    // Keyboard Shortcuts
    keyboardShortcuts: KeyboardShortcutConfig;
    setModifyKey: (key: ModifierKey) => void;
    setCancelKey: (key: string) => void;
    setTextSaveShortcut: (modifier: TextSaveModifier, key: string) => void;
    setToolShortcut: (tool: keyof KeyboardShortcutConfig['tools'], key: string) => void;

    // Settings / Preferences
    language: SupportedLanguage;
    setLanguage: (language: SupportedLanguage) => void;
    resetSettings: () => void;

    // Settings window (shared so the global Ctrl/Cmd+, binding can open it)
    isSettingsOpen: boolean;
    openSettings: () => void;
    closeSettings: () => void;

    // Notifications
    notifications: Notification[];
    addNotification: (notification: Omit<Notification, 'id'> & { id?: string }) => string;
    removeNotification: (id: string) => void;
    clearNotifications: () => void;

    // Canvas Navigation
    canvasPosition: { x: number; y: number; scale: number };
    setCanvasPosition: (pos: { x: number; y: number; scale: number }) => void;
    homeViewTrigger: number;
    triggerHomeView: () => void;

    // Document library / shell (docSlice) — never persisted
    view: 'gallery' | 'editor';
    setView: (view: AppState['view']) => void;
    currentDoc: LabelDoc | null;
    gallery: LabelSummary[];
    galleryLoading: boolean;
    /** Storage boot failed; distinct from a genuinely empty library. */
    storageError: boolean;
    labelRepo: LabelRepo | null;
    setLabelRepo: (repo: LabelRepo | null) => void;
    refreshGallery: () => Promise<void>;
    createLabel: (spec: CreateLabelSpec) => Promise<LabelDoc | null>;
    openLabel: (id: string) => Promise<LabelDoc | null>;
    deleteLabel: (id: string) => Promise<void>;
    printerStatus: PrinterStatus;
    setPrinterStatus: (status: PrinterStatus) => void;
    initPersistence: () => Promise<void>;
}

export type StoreSlice = StateCreator<AppState, [], [], Partial<AppState>>;
