import type { StateCreator } from 'zustand';
import type { SupportedLanguage } from '../i18n/languages';
import type { InsertAction } from './slices/toolsSlice';
import type { ZoomMode } from './slices/viewSlice';
import type { hm } from '../core/hm';
import type { LabelDoc, Node, Region } from '../core/doc/types';
import type { ResizeOptions, Size } from '../core/doc/geometry';
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

/**
 * `Omit` that distributes over a union, so `Omit<Node, K>` keeps each member's
 * discriminant-specific fields (`text`, `shape`, `data`, `imageId`) instead of
 * collapsing to the shared `BaseNode` keys.
 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/**
 * Patch accepted by `updateNode`/`updateNodeTransient`. `id`, `parentId` and
 * `type` are deliberately excluded: `id` is the stable key, and `parentId`/`type`
 * are owned by `reparentNode`/`addNode`, whose cycle and parent-type guards a
 * patch must not be able to bypass.
 */
export type NodePatch = Partial<DistributiveOmit<Node, 'id' | 'parentId' | 'type'>>;

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
        text: string;
    };
}

export interface AppState {
    lastSavedAt: number | null;
    setLastSavedAt: (timestamp: number | null) => void;

    // Tool State (Editor insert rail — one-shot armed actions; see toolsSlice)
    activeTool: InsertAction;
    setActiveTool: (tool: InsertAction) => void;
    /** Return to the resting select state (after place, or Esc). */
    clearActiveTool: () => void;
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

    // AutoSave
    autoSave: boolean;
    toggleAutoSave: () => void;
    lastAutoSaveAt: number | null;
    setLastAutoSaveAt: (timestamp: number | null) => void;

    // Keyboard Shortcuts
    keyboardShortcuts: KeyboardShortcutConfig;
    setModifyKey: (key: ModifierKey) => void;
    setCancelKey: (key: string) => void;
    setTextSaveShortcut: (modifier: TextSaveModifier, key: string) => void;
    setToolShortcut: (tool: keyof KeyboardShortcutConfig['tools'], key: string) => void;

    // Settings / Preferences
    language: SupportedLanguage;
    setLanguage: (language: SupportedLanguage) => void;
    /** Screen-density calibration (CSS px per inch) for `real` zoom. */
    screenDpi: number;
    setScreenDpi: (dpi: number) => void;
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
    /** Persist the open document (no-op in the gallery); stamps `updatedAt`. */
    saveCurrentLabel: () => Promise<boolean>;
    deleteLabel: (id: string) => Promise<void>;
    printerStatus: PrinterStatus;
    setPrinterStatus: (status: PrinterStatus) => void;
    initPersistence: () => Promise<void>;

    // Editor document operations (editorSlice) — undo history never persisted.
    docPast: LabelDoc[];
    docFuture: LabelDoc[];
    /** Debounced autosave delay; injectable for tests. */
    docAutosaveDelayMs: number;
    setDocAutosaveDelay: (ms: number) => void;
    /** Adds a node with a fresh id; returns the new id, or null with no doc. */
    addNode: (node: Node) => string | null;
    updateNode: (id: string, patch: NodePatch) => void;
    /** Rename the open document (`doc.meta.name`) as one undo entry. */
    renameDoc: (name: string) => void;
    /** Set the preview sample row (`doc.data.sampleRowIndex`) as one undo entry. */
    setSampleRowIndex: (index: number) => void;
    /** Gesture seam: applies `patch` to `currentDoc` without history, `updatedAt`
     * or autosave. Pair N calls with one `commitDoc` for a single undo entry.
     */
    updateNodeTransient: (id: string, patch: NodePatch) => void;
    /**
     * Resize `id` to `target` via the core `resizeNodeGeometry` rule, as a single
     * committed op (one undo entry, rounded hm, `updatedAt` stamped).
     */
    resizeNode: (id: string, target: Size, opts?: ResizeOptions) => void;
    /** Ends a transient gesture: one `docPast` entry, clears `docFuture`, stamps `updatedAt`. */
    commitDoc: () => void;
    /** Abandons any in-progress transient gesture without touching history. */
    resetTransient: () => void;
    /**
     * Clears `docPast`/`docFuture` and the transient baseline. Called at the
     * doc-switch boundary so history from one document can never be applied to
     * another.
     */
    clearDocHistory: () => void;
    /**
     * Flushes a pending autosave immediately, saving the doc captured when the
     * debounce was scheduled, and resolves once the write has settled. Callers
     * that need deterministic ordering (explicit save, delete) must `await` it;
     * boundary callers may ignore the promise.
     */
    flushAutosave: () => Promise<void>;
    removeNode: (id: string) => void;
    /** Deep-clones the node subtree with fresh ids; returns the clone's root id. */
    cloneNode: (id: string) => string | null;
    reparentNode: (id: string, parentId: string | null, index: number) => void;
    moveNodeZ: (id: string, dir: 'up' | 'down') => void;
    groupNodes: (ids: string[]) => string | null;
    ungroupNode: (id: string) => void;
    undoDoc: () => void;
    redoDoc: () => void;

    // Document-editor selection (selectionSlice).
    selectedNodeIds: string[];
    selectNode: (id: string | null) => void;
    toggleSelectNode: (id: string) => void;
    selectNodes: (ids: string[]) => void;
    clearNodeSelection: () => void;

    // Editor view state (viewSlice) — view-only, never persisted, never doc data.
    gridVisible: boolean;
    toggleGrid: () => void;
    snapEnabled: boolean;
    toggleSnap: () => void;
    rulersVisible: boolean;
    toggleRulers: () => void;
    viewRotation: 0 | 90;
    /** True once the user manually toggled view rotation. */
    viewRotationUserSet: boolean;
    toggleViewRotation: () => void;
    /** Doc-open default orientation: long axis horizontal. View-only. */
    applyDefaultViewOrientation: (backingW: number, backingH: number) => void;
    /** Re-arm the auto-pick before it runs at a doc-open boundary. */
    resetViewOrientation: () => void;
    zoomMode: ZoomMode;
    manualZoom: number;
    setZoomMode: (mode: ZoomMode) => void;
    setManualZoom: (zoom: number) => void;
    /** Resolved CSS px per hm, kept in sync by the Preview. */
    effectiveZoom: number;
    setEffectiveZoom: (zoom: number) => void;
}

export type StoreSlice = StateCreator<AppState, [], [], Partial<AppState>>;
