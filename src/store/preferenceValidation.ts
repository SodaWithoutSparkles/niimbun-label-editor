import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n/languages';
import { GRID_SPACING_MAX_HM, GRID_SPACING_MIN_HM, SCREEN_DPI_MAX, SCREEN_DPI_MIN } from './storeDefaults';
import type {
    AppState,
    KeyboardShortcutConfig,
    ModifierKey,
    TextSaveModifier,
} from './storeTypes';

/** The only state that belongs in localStorage. Everything else is runtime. */
export type PersistedSettings = Pick<
    AppState,
    'autoSave' | 'keyboardShortcuts' | 'toolSettings' | 'language' | 'screenDpi' | 'gridSpacingHm'
>;

/**
 * Shape validation for every preference read out of storage.
 *
 * A present-but-wrong-typed value used to pass the old `readLegacyJSON` and its
 * `isObject` guard, then poison state (e.g. `tools.select = null` crashed the
 * sidebar at boot). These validators accept a value only when it has the exact
 * expected shape; anything else is reported as "missing" so the caller falls
 * back to the default.
 *
 * They are shared by both storage paths — the legacy reader (`legacyStorage.ts`)
 * and the `persist` merge (`useStore.ts`) — so a corrupt or partial blob cannot
 * poison state on either.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

export const TOOL_SHORTCUT_KEYS = [
    'select',
    'rectangle',
    'ellipse',
    'line',
    'text',
] as const;

const MODIFIER_KEYS: readonly ModifierKey[] = ['ctrl', 'alt', 'shift'];
const TEXT_SAVE_MODIFIERS: readonly TextSaveModifier[] = ['ctrl', 'alt', 'shift', 'none'];
const FONT_WEIGHTS = ['normal', 'bold'] as const;
const FONT_STYLES = ['normal', 'italic'] as const;
const TEXT_ALIGNS = ['left', 'center', 'right'] as const;

const isOneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
    isString(value) && (allowed as readonly string[]).includes(value);

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

/**
 * Returns a fully-repaired `KeyboardShortcutConfig`, or `undefined` when the
 * value is not usable at all (not an object). Missing/wrong-typed nested fields
 * always fall back to their defaults, so a partial config keeps the other eight
 * tool shortcuts.
 */
export const normalizeKeyboardShortcuts = (
    value: unknown,
    fallback: KeyboardShortcutConfig,
): KeyboardShortcutConfig | undefined => {
    if (!isRecord(value)) return undefined;

    const textSave = isRecord(value.textSave) ? value.textSave : {};
    const tools = isRecord(value.tools) ? value.tools : {};

    const normalizedTools = { ...fallback.tools };
    for (const tool of TOOL_SHORTCUT_KEYS) {
        const candidate = tools[tool];
        if (isString(candidate)) normalizedTools[tool] = candidate;
    }

    return {
        modifyKey: isOneOf(value.modifyKey, MODIFIER_KEYS) ? value.modifyKey : fallback.modifyKey,
        cancelKey: isString(value.cancelKey) ? value.cancelKey : fallback.cancelKey,
        textSave: {
            modifier: isOneOf(textSave.modifier, TEXT_SAVE_MODIFIERS)
                ? textSave.modifier
                : fallback.textSave.modifier,
            key: isString(textSave.key) ? textSave.key : fallback.textSave.key,
        },
        tools: normalizedTools,
    };
};

/** Returns a fully-repaired `toolSettings`, or `undefined` when unusable. */
export const normalizeToolSettings = (
    value: unknown,
    fallback: AppState['toolSettings'],
): AppState['toolSettings'] | undefined => {
    if (!isRecord(value)) return undefined;

    const normalized = { ...fallback };
    if (isFiniteNumber(value.lineWidth)) normalized.lineWidth = value.lineWidth;
    if (isFiniteNumber(value.fontSize)) normalized.fontSize = value.fontSize;
    if (isString(value.fontFamily)) normalized.fontFamily = value.fontFamily;
    if (isOneOf(value.fontWeight, FONT_WEIGHTS)) normalized.fontWeight = value.fontWeight;
    if (isOneOf(value.fontStyle, FONT_STYLES)) normalized.fontStyle = value.fontStyle;
    if (isOneOf(value.textAlign, TEXT_ALIGNS)) normalized.textAlign = value.textAlign;
    if (isString(value.textColor)) normalized.textColor = value.textColor;
    return normalized;
};

/** Returns the boolean when it is one, otherwise `undefined`. */
export const normalizeBoolean = (value: unknown): boolean | undefined =>
    typeof value === 'boolean' ? value : undefined;

/**
 * Returns a supported locale, or `undefined` when the value is missing or is
 * not one of `SUPPORTED_LANGUAGES`. Guards against unsupported BCP-47 tags
 * reaching `Intl.RelativeTimeFormat`.
 */
export const normalizeLanguage = (value: unknown): SupportedLanguage | undefined =>
    isOneOf(value, SUPPORTED_LANGUAGES) ? value : undefined;

/**
 * Returns a finite screen-DPI calibration clamped to a sane range, or
 * `undefined` when the persisted value is unusable. Keeps a corrupt blob from
 * reaching `realZoom` as `0`/`NaN`.
 */
export const normalizeScreenDpi = (
    value: unknown,
    min: number,
    max: number,
): number | undefined => {
    if (!isFiniteNumber(value)) return undefined;
    return Math.min(max, Math.max(min, Math.round(value)));
};

/**
 * Returns a finite grid-spacing (hm) clamped to a sane range, or `undefined`
 * when the persisted value is unusable. Keeps a corrupt blob from reaching the
 * preview as `0`/`NaN` (a collapsing grid or infinite snap candidates).
 */
export const normalizeGridSpacingHm = (
    value: unknown,
    min: number,
    max: number,
): number | undefined => {
    if (!isFiniteNumber(value)) return undefined;
    return Math.min(max, Math.max(min, Math.round(value)));
};

/**
 * Validates the `ui_settings` payload and returns a complete
 * `PersistedSettings`, filling anything absent or malformed from `defaults`.
 */
export const validatePersistedSettings = (
    persisted: unknown,
    defaults: PersistedSettings,
): PersistedSettings => {
    if (!isRecord(persisted)) return defaults;

    return {
        autoSave: normalizeBoolean(persisted.autoSave) ?? defaults.autoSave,
        keyboardShortcuts:
            normalizeKeyboardShortcuts(persisted.keyboardShortcuts, defaults.keyboardShortcuts) ??
            defaults.keyboardShortcuts,
        toolSettings:
            normalizeToolSettings(persisted.toolSettings, defaults.toolSettings) ??
            defaults.toolSettings,
        language: normalizeLanguage(persisted.language) ?? defaults.language,
        screenDpi:
            normalizeScreenDpi(persisted.screenDpi, SCREEN_DPI_MIN, SCREEN_DPI_MAX) ??
            defaults.screenDpi,
        gridSpacingHm:
            normalizeGridSpacingHm(persisted.gridSpacingHm, GRID_SPACING_MIN_HM, GRID_SPACING_MAX_HM) ??
            defaults.gridSpacingHm,
    };
};

/**
 * Returns the repaired preferences for the keys `persisted` actually carries.
 * A key absent from the blob is omitted entirely so the caller's `merge` lets
 * it fall through to the seed state (e.g. a legacy value), rather than being
 * reset to the default.
 */
export const pickPersistedKeys = (
    persisted: unknown,
    defaults: PersistedSettings,
): Partial<PersistedSettings> => {
    if (!isRecord(persisted)) return {};

    const repaired = validatePersistedSettings(persisted, defaults);
    const picked: Partial<PersistedSettings> = {};
    if ('autoSave' in persisted) picked.autoSave = repaired.autoSave;
    if ('keyboardShortcuts' in persisted) picked.keyboardShortcuts = repaired.keyboardShortcuts;
    if ('toolSettings' in persisted) picked.toolSettings = repaired.toolSettings;
    if ('language' in persisted) picked.language = repaired.language;
    if ('screenDpi' in persisted) picked.screenDpi = repaired.screenDpi;
    if ('gridSpacingHm' in persisted) picked.gridSpacingHm = repaired.gridSpacingHm;
    return picked;
};
