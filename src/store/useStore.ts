import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AppState } from './storeTypes';
import { createNotificationsSlice } from './slices/notificationsSlice';
import { createPreferencesSlice } from './slices/preferencesSlice';
import { createSettingsSlice } from './slices/settingsSlice';
import { createToolsSlice } from './slices/toolsSlice';
import { createDocSlice } from './slices/docSlice';
import { createEditorSlice } from './slices/editorSlice';
import { createSelectionSlice } from './slices/selectionSlice';
import { createWarningsSlice } from './slices/warningsSlice';
import { createViewSlice } from './slices/viewSlice';
import {
    DEFAULT_CONNECT_METHOD,
    DEFAULT_GRID_SPACING_HM,
    DEFAULT_QUANTIZER_BY_TYPE,
    DEFAULT_QUANTIZER_DEFAULTS,
    DEFAULT_SCREEN_DPI,
    defaultAutoSave,
    defaultKeyboardShortcuts,
    defaultLanguage,
    defaultToolSettings,
} from './storeDefaults';
import { clearLegacyPreferencesIfMigrated, readLegacyPreferences } from './legacyStorage';
import {
    pickPersistedKeys,
    type PersistedSettings,
} from './preferenceValidation';

/** The preference defaults, used to repair whatever `ui_settings` holds. */
const persistedDefaults: PersistedSettings = {
    autoSave: defaultAutoSave,
    keyboardShortcuts: defaultKeyboardShortcuts,
    toolSettings: defaultToolSettings,
    language: defaultLanguage,
    screenDpi: DEFAULT_SCREEN_DPI,
    gridSpacingHm: DEFAULT_GRID_SPACING_HM,
    connectMethod: DEFAULT_CONNECT_METHOD,
    quantizerDefaults: DEFAULT_QUANTIZER_DEFAULTS,
    defaultQuantizerByType: DEFAULT_QUANTIZER_BY_TYPE,
    // Optional: `undefined` is the "no preference" default (see `storeTypes`).
    defaultPaperTypeId: undefined,
};

/**
 * Wraps a `Storage` so every *write* failure is swallowed while reads keep
 * behaving normally.
 *
 * `persist` funnels each write through `storage.setItem` at runtime (it patches
 * `api.setState`), so a quota-exceeded or private-mode `setItem` would throw out
 * of ordinary interaction. Containing it here — the single adapter every write
 * crosses — restores the containment the deleted `storage.ts` had, without
 * touching the store's public shape.
 *
 * Only `setItem` swallows. A read failure (`getItem`, `length`, `key`) must
 * surface as a genuine error, never silently become "no preferences".
 * `removeItem`/`clear` are deliberately NOT swallowed here: they are not on the
 * persist write path (`clearLegacyPreferences` already guards its own
 * `removeItem` calls), and a failed delete of an ignored legacy key is harmless
 * while hiding it would mask real adapter bugs.
 *
 * Methods are bound to the real storage explicitly so `this` is never lost —
 * `localStorage.getItem` must be called with `localStorage` as receiver.
 *
 * Returns the wrapper together with *its own* last-write flag, so the flag can
 * be unit-tested per instance. Exported for the same reason `createAppStore` is.
 */
export const createSafeStorage = (storage: Storage): { storage: Storage; lastWrite: { ok: boolean } } => {
    /**
     * Records the outcome of the last `setItem` through *this* wrapper. `persist`
     * swallows write failures, but the legacy migration must know whether the new
     * `ui_settings` write actually landed before it deletes the old keys — deleting
     * them after a failed write would erase the only copy of the preferences.
     * Reset before a flush, read after it.
     *
     * Per instance, never at module scope: `createAppStore` builds independent
     * stores, and one shared flag would let a store's flush result gate another
     * store's legacy-key deletion.
     */
    const lastWrite = { ok: false };

    return {
        lastWrite,
        storage: {
            getItem: (key: string) => storage.getItem(key),
            setItem(key: string, value: string) {
                try {
                    storage.setItem(key, value);
                    lastWrite.ok = true;
                } catch {
                    // quota exceeded / private mode: preferences just don't persist
                    lastWrite.ok = false;
                }
            },
            removeItem: (key: string) => storage.removeItem(key),
            clear: () => storage.clear(),
            key: (index: number) => storage.key(index),
            get length() {
                return storage.length;
            },
        },
    };
};

/**
 * Builds a store bound to `storage`. Exported so the legacy migration can be
 * exercised headlessly against a fake `Storage`; the app uses `useStore`.
 */
export const createAppStore = (storage?: Storage) => {
    const safe = storage ? createSafeStorage(storage) : undefined;
    const safeStorage = safe?.storage;
    // The last-write flag belongs to this store's wrapper, so two stores built
    // here never read each other's write result.
    const safeStorageLastWrite = safe?.lastWrite;
    const store = create<AppState>()(
        persist<AppState, [], [], PersistedSettings>(
            (set, get, api) => {
                // 1. Legacy values seed the initial state where present.
                const legacy = storage ? readLegacyPreferences(storage) : {};
                const state: Partial<AppState> = {
                    ...createToolsSlice(set, get, api),
                    ...createNotificationsSlice(set, get, api),
                    ...createPreferencesSlice(set, get, api),
                    ...createSettingsSlice(set, get, api),
                    ...createDocSlice(set, get, api),
                    ...createEditorSlice(set, get, api),
                    ...createSelectionSlice(set, get, api),
                    ...createWarningsSlice(set, get, api),
                    ...createViewSlice(set, get, api),
                };
                if (legacy.autoSave !== undefined) state.autoSave = legacy.autoSave;
                if (legacy.keyboardShortcuts !== undefined) state.keyboardShortcuts = legacy.keyboardShortcuts;
                if (legacy.toolSettings !== undefined) state.toolSettings = legacy.toolSettings;
                return state as AppState;
            },
            {
                name: 'ui_settings',
                version: 1,
                // Only hand persist a real storage. Passing a `createJSONStorage`
                // over `undefined` makes `options.storage` truthy while every
                // `setItem`/`getItem` throws, and persist takes no no-storage path.
                // When `storage` is absent we pass `undefined` so persist uses its
                // built-in degraded mode (a plain store; see zustand middleware
                // `if (!storage) return config(...)`).
                storage: safeStorage ? createJSONStorage(() => safeStorage) : undefined,
                // 2. `persist` rehydrates `ui_settings` over the seed — persisted wins.
                //    `partialize` is load-bearing: without it the whole flattened
                //    state (current document, undo history, notifications) would
                //    land in localStorage.
                partialize: (s) => ({
                    autoSave: s.autoSave,
                    keyboardShortcuts: s.keyboardShortcuts,
                    toolSettings: s.toolSettings,
                    language: s.language,
                    screenDpi: s.screenDpi,
                    gridSpacingHm: s.gridSpacingHm,
                    connectMethod: s.connectMethod,
                    quantizerDefaults: s.quantizerDefaults,
                    defaultQuantizerByType: s.defaultQuantizerByType,
                    defaultPaperTypeId: s.defaultPaperTypeId,
                }),
                migrate: (persisted) => persisted as PersistedSettings,
                // `persist`'s default merge is a *shallow* spread over the seed,
                // so a partial or wrong-typed `keyboardShortcuts` in the blob
                // would replace the whole default object and bypass the legacy
                // deep merge — hitting the exact crash sites this guards.
                //
                // Repair the persisted blob to a full, safe shape, but only
                // *override* keys the blob actually carries: a field that is
                // absent must fall through to `current` (the legacy seed), not
                // be reset to the default. `validatePersistedSettings` fills
                // gaps from `defaults`; `pickPersistedKeys` decides which of its
                // results are allowed to win.
                merge: (persisted, current) => ({
                    ...current,
                    ...pickPersistedKeys(persisted, persistedDefaults),
                }),
            },
        ),
    );

    // 3/4. Once rehydration is done, force `ui_settings` to be written (zustand
    // only writes on `set`) and only then drop the legacy keys. Without the
    // forced flush a first run that changes nothing would delete the legacy
    // keys without ever creating the new one.
    const finishMigration = () => {
        // A throwing `setItem` (quota exceeded / private mode) must never take
        // the app down: the old `storage.ts` swallowed storage errors, and a
        // failed preference write is not worth a boot failure. But a swallowed
        // failure must ALSO stop the legacy keys from being deleted: doing both
        // erases the migrated preferences. `safeStorageLastWrite` records
        // whether the flush actually landed so the clear can be gated on it.
        try {
            if (safeStorageLastWrite) safeStorageLastWrite.ok = false;
            store.setState({});
        } catch {
            // unexpected flush failure — treat as an unsuccessful write
        }
        // Only delete the legacy keys when the new settings were written.
        if (storage && safeStorageLastWrite) {
            clearLegacyPreferencesIfMigrated(storage, safeStorageLastWrite.ok);
        }
    };

    // `persist` does not install `api.persist` when it had no storage (it returns
    // the plain config early), so guard the hydration hookup too.
    if (storage && store.persist) {
        if (store.persist.hasHydrated()) finishMigration();
        else store.persist.onFinishHydration(finishMigration);
    }

    return store;
};

/**
 * Resolves the browser storage, tolerating environments where merely *touching*
 * `window.localStorage` throws `SecurityError` (sandboxed iframe, Firefox with
 * cookies/site-data blocked). That is evaluated at module import, before
 * `createSafeStorage` exists, so an unguarded access would white-screen the app
 * before any containment runs. On failure we return `undefined`, which routes
 * into the store's degraded no-storage path.
 */
const resolveStorage = (): Storage | undefined => {
    try {
        if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
        if (typeof localStorage !== 'undefined') return localStorage;
    } catch {
        // storage access denied — fall through to the no-storage path
    }
    return undefined;
};

export const useStore = createAppStore(resolveStorage());
