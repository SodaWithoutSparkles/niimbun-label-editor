import { describe, expect, it } from 'vitest';
import {
    normalizeBoolean,
    normalizeKeyboardShortcuts,
    normalizeLanguage,
    normalizeToolSettings,
    pickPersistedKeys,
    validatePersistedSettings,
    type PersistedSettings,
} from './preferenceValidation';
import {
    DEFAULT_SCREEN_DPI,
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

const defaults: PersistedSettings = {
    autoSave: defaultAutoSave,
    keyboardShortcuts: defaultKeyboardShortcuts,
    toolSettings: defaultToolSettings,
    language: defaultLanguage,
    screenDpi: DEFAULT_SCREEN_DPI,
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
});
