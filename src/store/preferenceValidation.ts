import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n/languages';
import { GAMMA_MAX, GAMMA_MIN, QUANTIZERS, type QuantizerId } from '../core/render/quantize';
import type { QuantizerDefaultParams, QuantizerDefaults } from '../core/render/quantize';
import {
    isScreentoneAngle,
    SCREENTONE_LEVELS_MAX,
    SCREENTONE_LEVELS_MIN,
    SCREENTONE_PITCH_MM_MAX,
    SCREENTONE_PITCH_MM_MIN,
} from '../core/render/screentone';
import type { NodeType } from '../core/doc/types';
import {
    CONNECT_METHODS,
    GRID_SPACING_MAX_HM,
    GRID_SPACING_MIN_HM,
    SCREEN_DPI_MAX,
    SCREEN_DPI_MIN,
} from './storeDefaults';
import type {
    AppState,
    ConnectMethod,
    DefaultQuantizerByType,
    KeyboardShortcutConfig,
    ModifierKey,
    TextSaveModifier,
} from './storeTypes';

/** The only state that belongs in localStorage. Everything else is runtime. */
export type PersistedSettings = Pick<
    AppState,
    | 'autoSave'
    | 'usePrinterDpi'
    | 'keyboardShortcuts'
    | 'toolSettings'
    | 'language'
    | 'screenDpi'
    | 'gridSpacingHm'
    | 'connectMethod'
    | 'quantizerDefaults'
    | 'defaultQuantizerByType'
    | 'defaultPaperTypeId'
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

/**
 * Dithering allow-lists. `QUANTIZER_IDS` is derived from the registry (so a new
 * algorithm is accepted without a validator edit); `NODE_TYPES` mirrors the
 * document type union (there is no runtime registry to derive it from).
 */
const QUANTIZER_IDS = Object.keys(QUANTIZERS) as QuantizerId[];
const NODE_TYPES: readonly NodeType[] = ['group', 'text', 'image', 'shape', 'qr', 'barcode', 'code'];

/** Per-strategy param clamps, matched to `core/doc/validate` and `quantize.ts`. */
const QUANTIZER_THRESHOLD_MIN = 0;
const QUANTIZER_THRESHOLD_MAX = 255;
const QUANTIZER_STRENGTH_MIN = 0;
const QUANTIZER_STRENGTH_MAX = 4;

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
 * Returns a known connect method, or `undefined` when the value is missing or
 * not one of `CONNECT_METHODS`. Guards the persisted chooser preference against
 * a stale/unknown transport string in a corrupt blob.
 */
export const normalizeConnectMethod = (value: unknown): ConnectMethod | undefined =>
    isOneOf(value, CONNECT_METHODS) ? value : undefined;

/**
 * Returns a non-empty paper-type id, or `undefined` when the value is missing,
 * blank or not a string. `undefined` is a legitimate value (the preference is
 * optional), so a corrupt blob can only ever clear the preference, never
 * inject a bogus id.
 */
export const normalizeDefaultPaperTypeId = (value: unknown): string | undefined =>
    isString(value) && value.length > 0 ? value : undefined;

/**
 * Returns one strategy's repaired params, or `undefined` when nothing usable
 * remains (so an empty per-strategy object is dropped). `threshold` is clamped
 * to `[0,255]` as an integer; `strength` to `[0,4]` rounded to 2 dp (matching
 * `core/doc/validate`); `gamma` to `[0.1,4]` rounded to 2 dp (the `quantize.ts`
 * clamp); `serpentine` must be a boolean. The screentone knobs clamp like the
 * engine: `levels` to an integer `[2,8]`, `pitchMm` to `[0.3,2.0]` at 2 dp, and
 * `angle` must be one of the four supported values (a bad angle is dropped, not
 * defaulted, so the render default still applies downstream).
 */
const normalizeQuantizerDefaultParams = (value: unknown): QuantizerDefaultParams | undefined => {
    if (!isRecord(value)) return undefined;
    const params: QuantizerDefaultParams = {};
    if (isFiniteNumber(value.threshold)) {
        params.threshold = Math.min(
            QUANTIZER_THRESHOLD_MAX,
            Math.max(QUANTIZER_THRESHOLD_MIN, Math.round(value.threshold)),
        );
    }
    if (isFiniteNumber(value.strength)) {
        params.strength =
            Math.round(
                Math.min(QUANTIZER_STRENGTH_MAX, Math.max(QUANTIZER_STRENGTH_MIN, value.strength)) * 100,
            ) / 100;
    }
    if (isFiniteNumber(value.gamma)) {
        params.gamma =
            Math.round(Math.min(GAMMA_MAX, Math.max(GAMMA_MIN, value.gamma)) * 100) / 100;
    }
    if (isFiniteNumber(value.screentoneLevels)) {
        params.screentoneLevels = Math.min(
            SCREENTONE_LEVELS_MAX,
            Math.max(SCREENTONE_LEVELS_MIN, Math.round(value.screentoneLevels)),
        );
    }
    if (isFiniteNumber(value.screentonePitchMm)) {
        params.screentonePitchMm =
            Math.round(
                Math.min(
                    SCREENTONE_PITCH_MM_MAX,
                    Math.max(SCREENTONE_PITCH_MM_MIN, value.screentonePitchMm),
                ) * 100,
            ) / 100;
    }
    if (isScreentoneAngle(value.screentoneAngle)) {
        params.screentoneAngle = value.screentoneAngle;
    }
    if (typeof value.serpentine === 'boolean') params.serpentine = value.serpentine;
    return Object.keys(params).length > 0 ? params : undefined;
};

/**
 * Returns per-strategy dither defaults with unknown strategy keys dropped
 * (allow-listed against the `QUANTIZERS` registry) and each param clamped.
 * `undefined` only when the whole value is not an object; an object that cleans
 * to nothing repairs to `{}`.
 */
export const normalizeQuantizerDefaults = (value: unknown): QuantizerDefaults | undefined => {
    if (!isRecord(value)) return undefined;
    const out: QuantizerDefaults = {};
    for (const id of QUANTIZER_IDS) {
        const params = normalizeQuantizerDefaultParams(value[id]);
        if (params !== undefined) out[id] = params;
    }
    return out;
};

/**
 * Returns the per-object-type default-quantizer map with unknown types and
 * unknown quantizer ids dropped. `undefined` only when the whole value is not an
 * object; an object that cleans to nothing repairs to `{}`.
 */
export const normalizeDefaultQuantizerByType = (
    value: unknown,
): DefaultQuantizerByType | undefined => {
    if (!isRecord(value)) return undefined;
    const out: DefaultQuantizerByType = {};
    for (const type of NODE_TYPES) {
        const candidate = value[type];
        if (isOneOf(candidate, QUANTIZER_IDS)) out[type] = candidate;
    }
    return out;
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
        usePrinterDpi:
            normalizeBoolean(persisted.usePrinterDpi) ?? defaults.usePrinterDpi,
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
        connectMethod: normalizeConnectMethod(persisted.connectMethod) ?? defaults.connectMethod,
        // Absent (or a non-object) => the (empty) default. An object that cleans
        // to nothing also lands on the empty default: dropping bad keys can only
        // ever reset a preference, never inject a bogus one.
        quantizerDefaults:
            normalizeQuantizerDefaults(persisted.quantizerDefaults) ?? defaults.quantizerDefaults,
        defaultQuantizerByType:
            normalizeDefaultQuantizerByType(persisted.defaultQuantizerByType) ??
            defaults.defaultQuantizerByType,
        // Absent (or unusable) => the caller's default, which is `undefined`:
        // "no preference". Never coerced to an empty string.
        defaultPaperTypeId:
            normalizeDefaultPaperTypeId(persisted.defaultPaperTypeId) ??
            defaults.defaultPaperTypeId,
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
    if ('usePrinterDpi' in persisted) picked.usePrinterDpi = repaired.usePrinterDpi;
    if ('keyboardShortcuts' in persisted) picked.keyboardShortcuts = repaired.keyboardShortcuts;
    if ('toolSettings' in persisted) picked.toolSettings = repaired.toolSettings;
    if ('language' in persisted) picked.language = repaired.language;
    if ('screenDpi' in persisted) picked.screenDpi = repaired.screenDpi;
    if ('gridSpacingHm' in persisted) picked.gridSpacingHm = repaired.gridSpacingHm;
    if ('connectMethod' in persisted) picked.connectMethod = repaired.connectMethod;
    if ('quantizerDefaults' in persisted) picked.quantizerDefaults = repaired.quantizerDefaults;
    if ('defaultQuantizerByType' in persisted) {
        picked.defaultQuantizerByType = repaired.defaultQuantizerByType;
    }
    // The `in` guard (not a truthiness check) keeps a present-but-empty value
    // distinguishable from an absent key: the former repairs to `undefined`
    // and is allowed to override the seed, the latter falls through to it.
    if ('defaultPaperTypeId' in persisted) picked.defaultPaperTypeId = repaired.defaultPaperTypeId;
    return picked;
};
