import { describe, expect, it } from 'vitest';
import {
    normalizeBoolean,
    normalizeConnectMethod,
    normalizeGridSpacingHm,
    normalizeKeyboardShortcuts,
    normalizeLanguage,
    normalizeToolSettings,
    pickPersistedKeys,
    validatePersistedSettings,
    type PersistedSettings,
} from './preferenceValidation';
import {
    DEFAULT_CONNECT_METHOD,
    DEFAULT_GRID_SPACING_HM,
    DEFAULT_SCREEN_DPI,
    GRID_SPACING_MAX_HM,
    GRID_SPACING_MIN_HM,
    defaultAutoSave,
    defaultKeyboardShortcuts,
    defaultLanguage,
    defaultToolSettings,
} from './storeDefaults';

describe('normalizeLanguage', () => {
    it('returns supported locales', () => {
        expect(normalizeLanguage('en')).toBe('en');
    });

    it('returns undefined for unsupported / junk values', () => {
        expect(normalizeLanguage('xx-YY')).toBeUndefined();
        expect(normalizeLanguage('')).toBeUndefined();
        expect(normalizeLanguage('de')).toBeUndefined();
        expect(normalizeLanguage(42)).toBeUndefined();
        expect(normalizeLanguage(null)).toBeUndefined();
        expect(normalizeLanguage(undefined)).toBeUndefined();
        expect(normalizeLanguage({})).toBeUndefined();
    });
});

describe('normalizeConnectMethod', () => {
    it('returns the known transports', () => {
        expect(normalizeConnectMethod('bluetooth')).toBe('bluetooth');
        expect(normalizeConnectMethod('serial')).toBe('serial');
    });

    it('returns undefined for unknown / junk values', () => {
        expect(normalizeConnectMethod('wifi')).toBeUndefined();
        expect(normalizeConnectMethod('capacitor-ble')).toBeUndefined();
        expect(normalizeConnectMethod('virtual')).toBeUndefined();
        expect(normalizeConnectMethod(42)).toBeUndefined();
        expect(normalizeConnectMethod(null)).toBeUndefined();
        expect(normalizeConnectMethod(undefined)).toBeUndefined();
    });
});

describe('normalizeBoolean', () => {
    it('returns booleans unchanged and undefined otherwise', () => {
        expect(normalizeBoolean(true)).toBe(true);
        expect(normalizeBoolean(false)).toBe(false);
        expect(normalizeBoolean('true')).toBeUndefined();
        expect(normalizeBoolean(1)).toBeUndefined();
        expect(normalizeBoolean(null)).toBeUndefined();
    });
});

describe('normalizeKeyboardShortcuts', () => {
    it('returns undefined when the value is not an object', () => {
        expect(normalizeKeyboardShortcuts(null, defaultKeyboardShortcuts)).toBeUndefined();
        expect(normalizeKeyboardShortcuts('nope', defaultKeyboardShortcuts)).toBeUndefined();
    });

    it('repairs bad nested fields from the fallback', () => {
        const result = normalizeKeyboardShortcuts(
            { modifyKey: 123, cancelKey: 5, textSave: { modifier: 'sideways', key: 9 }, tools: { select: null } },
            defaultKeyboardShortcuts,
        );
        expect(result).toEqual(defaultKeyboardShortcuts);
    });

    it('keeps valid fields and fills the rest', () => {
        const result = normalizeKeyboardShortcuts(
            { modifyKey: 'alt', tools: { select: 'z' } },
            defaultKeyboardShortcuts,
        );
        expect(result?.modifyKey).toBe('alt');
        expect(result?.tools.select).toBe('z');
        expect(result?.tools.rectangle).toBe(defaultKeyboardShortcuts.tools.rectangle);
        expect(result?.cancelKey).toBe(defaultKeyboardShortcuts.cancelKey);
    });
});

describe('normalizeToolSettings', () => {
    it('returns undefined for non-objects', () => {
        expect(normalizeToolSettings([], defaultToolSettings)).toBeUndefined();
    });

    it('repairs wrong types and keeps valid ones', () => {
        const result = normalizeToolSettings(
            { lineWidth: 'thick', fontSize: 40, fontWeight: 'heavy', textAlign: 'center' },
            defaultToolSettings,
        );
        expect(result?.lineWidth).toBe(defaultToolSettings.lineWidth);
        expect(result?.fontSize).toBe(40);
        expect(result?.fontWeight).toBe(defaultToolSettings.fontWeight);
        expect(result?.textAlign).toBe('center');
    });

    it('rejects non-finite numbers', () => {
        const result = normalizeToolSettings({ lineWidth: NaN }, defaultToolSettings);
        expect(result?.lineWidth).toBe(defaultToolSettings.lineWidth);
    });
});

describe('normalizeGridSpacingHm', () => {
    it('rounds and clamps to the range', () => {
        expect(normalizeGridSpacingHm(500, GRID_SPACING_MIN_HM, GRID_SPACING_MAX_HM)).toBe(500);
        expect(normalizeGridSpacingHm(250.6, GRID_SPACING_MIN_HM, GRID_SPACING_MAX_HM)).toBe(251);
        // Below the minimum / above the maximum clamp instead of rejecting.
        expect(normalizeGridSpacingHm(1, GRID_SPACING_MIN_HM, GRID_SPACING_MAX_HM)).toBe(GRID_SPACING_MIN_HM);
        expect(normalizeGridSpacingHm(1e9, GRID_SPACING_MIN_HM, GRID_SPACING_MAX_HM)).toBe(GRID_SPACING_MAX_HM);
    });

    it('returns undefined for non-finite / non-numeric values', () => {
        expect(normalizeGridSpacingHm(NaN, GRID_SPACING_MIN_HM, GRID_SPACING_MAX_HM)).toBeUndefined();
        expect(normalizeGridSpacingHm(Infinity, GRID_SPACING_MIN_HM, GRID_SPACING_MAX_HM)).toBeUndefined();
        expect(normalizeGridSpacingHm('500', GRID_SPACING_MIN_HM, GRID_SPACING_MAX_HM)).toBeUndefined();
        expect(normalizeGridSpacingHm(null, GRID_SPACING_MIN_HM, GRID_SPACING_MAX_HM)).toBeUndefined();
    });
});

const defaults: PersistedSettings = {
    autoSave: defaultAutoSave,
    keyboardShortcuts: defaultKeyboardShortcuts,
    toolSettings: defaultToolSettings,
    language: defaultLanguage,
    screenDpi: DEFAULT_SCREEN_DPI,
    gridSpacingHm: DEFAULT_GRID_SPACING_HM,
    connectMethod: DEFAULT_CONNECT_METHOD,
};

describe('validatePersistedSettings', () => {
    it('returns defaults for a non-object blob', () => {
        expect(validatePersistedSettings('garbage', defaults)).toEqual(defaults);
        expect(validatePersistedSettings(null, defaults)).toEqual(defaults);
    });

    it('repairs bad types back to defaults', () => {
        const result = validatePersistedSettings(
            { autoSave: 'yes', language: 'xx-YY', toolSettings: null, keyboardShortcuts: 'x' },
            defaults,
        );
        expect(result).toEqual(defaults);
    });

    it('keeps valid values', () => {
        const result = validatePersistedSettings(
            { autoSave: false, language: 'en' },
            defaults,
        );
        expect(result.autoSave).toBe(false);
        expect(result.language).toBe('en');
    });

    it('normalizes/clamps gridSpacingHm and falls back when unusable', () => {
        expect(validatePersistedSettings({ gridSpacingHm: 250.6 }, defaults).gridSpacingHm).toBe(251);
        expect(validatePersistedSettings({ gridSpacingHm: 1 }, defaults).gridSpacingHm).toBe(GRID_SPACING_MIN_HM);
        expect(validatePersistedSettings({ gridSpacingHm: 'x' }, defaults).gridSpacingHm).toBe(DEFAULT_GRID_SPACING_HM);
        // Absent => the default.
        expect(validatePersistedSettings({}, defaults).gridSpacingHm).toBe(DEFAULT_GRID_SPACING_HM);
    });

    it('round-trips a valid connectMethod and falls back to bluetooth otherwise', () => {
        // Both known transports survive.
        expect(validatePersistedSettings({ connectMethod: 'bluetooth' }, defaults).connectMethod).toBe('bluetooth');
        expect(validatePersistedSettings({ connectMethod: 'serial' }, defaults).connectMethod).toBe('serial');
        // Unknown / wrong-typed => the bluetooth default.
        expect(validatePersistedSettings({ connectMethod: 'wifi' }, defaults).connectMethod).toBe('bluetooth');
        expect(validatePersistedSettings({ connectMethod: null }, defaults).connectMethod).toBe('bluetooth');
        // Absent => the bluetooth default.
        expect(validatePersistedSettings({}, defaults).connectMethod).toBe('bluetooth');
    });
});

describe('pickPersistedKeys', () => {
    it('omits keys absent from the blob so they fall through to the seed', () => {
        expect(pickPersistedKeys({}, defaults)).toEqual({});
        expect(pickPersistedKeys({ autoSave: false }, defaults)).toEqual({ autoSave: false });
    });

    it('returns {} for non-objects', () => {
        expect(pickPersistedKeys('x', defaults)).toEqual({});
    });

    it('only includes explicitly present keys', () => {
        const picked = pickPersistedKeys({ language: 'en' }, defaults);
        expect(picked).toEqual({ language: 'en' });
        expect('autoSave' in picked).toBe(false);
    });

    it('picks a normalized gridSpacingHm only when present', () => {
        expect(pickPersistedKeys({ gridSpacingHm: 1234.7 }, defaults)).toEqual({ gridSpacingHm: 1235 });
        expect('gridSpacingHm' in pickPersistedKeys({}, defaults)).toBe(false);
    });

    it('picks a validated connectMethod only when present', () => {
        expect(pickPersistedKeys({ connectMethod: 'serial' }, defaults)).toEqual({ connectMethod: 'serial' });
        // An invalid value is repaired to the default, not dropped.
        expect(pickPersistedKeys({ connectMethod: 'wifi' }, defaults)).toEqual({ connectMethod: 'bluetooth' });
        expect('connectMethod' in pickPersistedKeys({}, defaults)).toBe(false);
    });
});
