import type { StateCreator } from 'zustand';
import type { SupportedLanguage } from '../i18n/languages';
import type { InsertAction } from './slices/toolsSlice';
import type { ZoomMode } from './slices/viewSlice';
import type { hm } from '../core/hm';
import type { FontRef, ImageRef, LabelDoc, Node, Region, GlobalSpec } from '../core/doc/types';
import type { ResizeOptions, Size } from '../core/doc/geometry';
import type { LabelPresetId } from '../core/doc/label-presets';
import type { CsvRepo } from '../data/csvRepo';
import type { LabelRepo, LabelSummary } from '../data/labelRepo';
import type { ResourceRepo } from '../data/resourceRepo';
import type { TrustRepo } from '../data/trustRepo';
import type { TrustGate } from '../core/trust';
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
 * CSV attach input. The store builds the `CsvRef` itself so provenance cannot be
 * spoofed: `source` is always `local` and its `resourceId` always equals `csvId`
 * (the IDB `csvs` key). `name` is the original import filename.
 */
export interface DocCsvAttachment {
    csvId: string;
    name: string;
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
    /**
     * Print-dialog open flag. Lives in the store (not `EditorShell` local state)
     * so the header's File ▸ Print… action and the editor's Ctrl/Cmd+P handler
     * can both open it without prop-drilling. Only ever set while a document is
     * open in the editor.
     */
    isPrintOpen: boolean;
    openPrint: () => void;
    closePrint: () => void;
    currentDoc: LabelDoc | null;
    gallery: LabelSummary[];
    galleryLoading: boolean;
    /** Storage boot failed; distinct from a genuinely empty library. */
    storageError: boolean;
    labelRepo: LabelRepo | null;
    setLabelRepo: (repo: LabelRepo | null) => void;
    /** Binary asset storage (font/image bytes); shared adapter with `labelRepo`. */
    resourceRepo: ResourceRepo | null;
    setResourceRepo: (repo: ResourceRepo | null) => void;
    /** Parsed CSV table storage; shared adapter with `labelRepo`. */
    csvRepo: CsvRepo | null;
    setCsvRepo: (repo: CsvRepo | null) => void;
    /**
     * Template trust decisions (local state, never doc data); shared adapter
     * with `labelRepo`. The editor trust gate and Settings both read it.
     */
    trustRepo: TrustRepo | null;
    setTrustRepo: (repo: TrustRepo | null) => void;
    /**
     * The ONE trust gate (and session overlay) for `trustRepo`. Both the editor
     * sample-row pass and Settings' trust section resolve/revoke through this
     * instance, so a revoke lifts a session Allow immediately.
     */
    trustGate: TrustGate | null;
    /**
     * Monotonic counter bumped whenever a Settings trust revoke/reset changes
     * the shared gate's session overlay or persisted records. The editor's
     * sample-row pass includes it in its effect deps, so a revoke re-resolves
     * the open document instead of leaving stale executed output on screen.
     */
    trustRevision: number;
    /** Signal that the shared trust gate's decisions changed (see `trustRevision`). */
    bumpTrustRevision: () => void;
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
    /**
     * Register an image resource (one undo entry). Returns `false` (no-op) when
     * there is no open doc or an `imageId` collision.
     */
    addImageRef: (ref: ImageRef) => boolean;
    /**
     * Patch an existing image resource by `imageId` (one undo entry). `name`/
     * `alt` are editable without breaking node references; `widthPx`/`heightPx`
     * are rounded to non-negative integers.
     */
    updateImageRef: (imageId: string, patch: Partial<Omit<ImageRef, 'imageId'>>) => void;
    /** Register a font resource (one undo entry); `false` on no doc/collision. */
    addFontRef: (ref: FontRef) => boolean;
    /** Patch an existing font resource by `fontId` (one undo entry). */
    updateFontRef: (fontId: string, patch: Partial<Omit<FontRef, 'fontId'>>) => void;
    /** Rename the open document (`doc.meta.name`) as one undo entry. */
    renameDoc: (name: string) => void;
    /** Set the preview sample row (`doc.data.sampleRowIndex`) as one undo entry. */
    setSampleRowIndex: (index: number) => void;
    /**
     * Attach (`{ csvId, name }`) or clear (`null`) `doc.data.csv` as one undo
     * entry. The `CsvRef` is built here as `local` with `resourceId === csvId`,
     * so a caller cannot attach a non-local or mismatched source. A blank
     * `csvId` or a no-op (same ref, clearing when absent) creates no entry.
     */
    setDocCsv: (csv: DocCsvAttachment | null) => void;
    /**
     * Attach a CSV and reset the sample row to 0 in **one** undo entry (a fresh
     * table must not leave two undo steps and must not point past its data).
     * `null` clears the ref only. A re-attach of the identical ref with the row
     * already at 0 is a no-op.
     */
    attachCsv: (csv: DocCsvAttachment | null) => void;
    /**
     * Replace `doc.data.globals` as one undo entry. Blank-named specs are
     * dropped and `expiresAt` is floored to an integer probability epoch-second
     * value; an identical list is a no-op (no undo entry).
     */
    setDocGlobals: (globals: GlobalSpec[]) => void;
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
