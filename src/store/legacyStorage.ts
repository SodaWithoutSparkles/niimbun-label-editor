import type { AppState, KeyboardShortcutConfig } from './storeTypes';
import { defaultColors, defaultKeyboardShortcuts, defaultToolSettings } from './storeDefaults';
import {
    normalizeColors,
    normalizeKeyboardShortcuts,
    normalizeToolSettings,
} from './preferenceValidation';

/**
 * Keys used by the pre-`persist` store. `autosave_project` is listed for
 * completeness (it is a project autosave blob owned by `Header.tsx`, not a
 * preference), but only the four preference keys below are read/cleared here.
 */
export const LEGACY_KEYS = {
    keyboardShortcuts: 'ui_keyboard_shortcuts',
    autoSave: 'ui_auto_save',
    toolSettings: 'ui_tool_settings',
    colors: 'ui_colors',
    autosaveProject: 'autosave_project',
} as const;

/** The legacy keys whose data the new persisted store now owns. */
const PREFERENCE_KEYS = [
    LEGACY_KEYS.keyboardShortcuts,
    LEGACY_KEYS.autoSave,
    LEGACY_KEYS.toolSettings,
    LEGACY_KEYS.colors,
] as const;

export type LegacyPreferences = Partial<
    Pick<AppState, 'autoSave' | 'keyboardShortcuts' | 'toolSettings' | 'colors'>
>;

/** Reads a raw value from storage, swallowing access errors. */
const readRaw = (storage: Storage, key: string): string | null => {
    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
};

/** Mirrors the old `readBoolean`: accepts 'true'/'false' and JSON booleans. */
const readLegacyBoolean = (storage: Storage, key: string): boolean | undefined => {
    const raw = readRaw(storage, key);
    if (raw === null) return undefined;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'boolean' ? parsed : undefined;
    } catch {
        return undefined;
    }
};

/**
 * Parses a stored JSON value and returns it only when it is a plain JSON object.
 * Unparseable input, a bare number/boolean/array/null, or JSON representing a
 * primitive all yield `undefined` — the caller then uses the default.
 */
const readLegacyJSON = (storage: Storage, key: string): unknown => {
    const raw = readRaw(storage, key);
    if (raw === null) return undefined;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
        return parsed;
    } catch {
        return undefined;
    }
};

/**
 * Reads the legacy keyboard-shortcuts config. Validity is decided by the shape
 * validators, *not* by presence: a present-but-wrong-typed value (e.g.
 * `{"tools":{"select":null}}` or `{"modifyKey":123}`) is rejected field by
 * field and falls back to the default, so no malformed value can reach a
 * `.toUpperCase()`/`.toLowerCase()` call site.
 */
const readLegacyKeyboardShortcuts = (storage: Storage): KeyboardShortcutConfig | undefined =>
    normalizeKeyboardShortcuts(
        readLegacyJSON(storage, LEGACY_KEYS.keyboardShortcuts),
        defaultKeyboardShortcuts,
    );

/**
 * Reads the legacy preference keys and returns only what was present *and*
 * valid, each JSON value repaired over its default. Pure — no side effects,
 * never throws.
 */
export const readLegacyPreferences = (storage: Storage): LegacyPreferences => {
    const preferences: LegacyPreferences = {};

    const autoSave = readLegacyBoolean(storage, LEGACY_KEYS.autoSave);
    if (autoSave !== undefined) preferences.autoSave = autoSave;

    const keyboardShortcuts = readLegacyKeyboardShortcuts(storage);
    if (keyboardShortcuts !== undefined) preferences.keyboardShortcuts = keyboardShortcuts;

    const toolSettings = normalizeToolSettings(
        readLegacyJSON(storage, LEGACY_KEYS.toolSettings),
        defaultToolSettings,
    );
    if (toolSettings !== undefined) preferences.toolSettings = toolSettings;

    const colors = normalizeColors(readLegacyJSON(storage, LEGACY_KEYS.colors), defaultColors);
    if (colors !== undefined) preferences.colors = colors;

    return preferences;
};

/** Removes the legacy preference keys once the new store owns the data. */
export const clearLegacyPreferences = (storage: Storage): void => {
    for (const key of PREFERENCE_KEYS) {
        try {
            storage.removeItem(key);
        } catch {
            // ignore storage errors
        }
    }
};
