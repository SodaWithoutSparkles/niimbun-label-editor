import { describe, expect, it } from 'vitest';
import {
    normalizeBoolean,
    normalizeConnectMethod,
    normalizeDefaultPaperTypeId,
    normalizeDefaultQuantizerByType,
    normalizeGridSpacingHm,
    normalizeKeyboardShortcuts,
    normalizeLanguage,
    normalizeQuantizerDefaults,
    normalizeToolSettings,
    pickPersistedKeys,
    validatePersistedSettings,
    type PersistedSettings,
} from './preferenceValidation';
import {
    DEFAULT_CONNECT_METHOD,
    DEFAULT_GRID_SPACING_HM,
    DEFAULT_QUANTIZER_BY_TYPE,
    DEFAULT_QUANTIZER_DEFAULTS,
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

describe('normalizeDefaultPaperTypeId', () => {
    it('returns a non-empty id verbatim', () => {
        expect(normalizeDefaultPaperTypeId('ftagSpare-25x78')).toBe('ftagSpare-25x78');
    });

    it('returns undefined for blank / junk values (unset is legitimate)', () => {
        expect(normalizeDefaultPaperTypeId('')).toBeUndefined();
        expect(normalizeDefaultPaperTypeId(42)).toBeUndefined();
        expect(normalizeDefaultPaperTypeId(null)).toBeUndefined();
        expect(normalizeDefaultPaperTypeId(undefined)).toBeUndefined();
    });
});

describe('normalizeQuantizerDefaults', () => {
    it('keeps valid per-strategy params and clamps threshold/strength', () => {
        expect(
            normalizeQuantizerDefaults({
                floydSteinberg: { threshold: 200.7, strength: 1.23456, serpentine: false },
            }),
        ).toEqual({ floydSteinberg: { threshold: 201, strength: 1.23, serpentine: false } });
        // Out-of-range values clamp rather than reject.
        expect(
            normalizeQuantizerDefaults({ threshold: { threshold: 999, strength: -2 } }),
        ).toEqual({ threshold: { threshold: 255, strength: 0 } });
    });

    it('drops unknown strategy keys and empty per-strategy objects', () => {
        expect(
            normalizeQuantizerDefaults({
                ostromoukhov: { threshold: 100 },
                floydSteinberg: {},
                stucki: { nonsense: true },
            }),
        ).toEqual({});
    });

    it('drops wrong-typed params but keeps the valid ones', () => {
        expect(
            normalizeQuantizerDefaults({ stucky: { threshold: 100 }, atkinson: { threshold: 'bad', serpentine: 'yes' } }),
        ).toEqual({});
        expect(
            normalizeQuantizerDefaults({ atkinson: { threshold: 'bad', serpentine: true } }),
        ).toEqual({ atkinson: { serpentine: true } });
    });

    it('clamps gamma to [0.1,4] and rounds it to 2 dp', () => {
        expect(normalizeQuantizerDefaults({ floydSteinberg: { gamma: 1.2345 } })).toEqual({
            floydSteinberg: { gamma: 1.23 },
        });
        expect(normalizeQuantizerDefaults({ floydSteinberg: { gamma: 9 } })).toEqual({
            floydSteinberg: { gamma: 4 },
        });
        expect(normalizeQuantizerDefaults({ threshold: { gamma: 0 } })).toEqual({
            threshold: { gamma: 0.1 },
        });
        // The default 1.3 round-trips unchanged.
        expect(normalizeQuantizerDefaults({ stucki: { gamma: 1.3 } })).toEqual({
            stucki: { gamma: 1.3 },
        });
    });

    it('drops a non-finite or wrong-typed gamma but keeps the valid params', () => {
        expect(normalizeQuantizerDefaults({ atkinson: { gamma: 'high' } })).toEqual({});
        expect(normalizeQuantizerDefaults({ atkinson: { gamma: Infinity } })).toEqual({});
        expect(normalizeQuantizerDefaults({ atkinson: { gamma: Number.NaN, strength: 2 } })).toEqual({
            atkinson: { strength: 2 },
        });
    });

    it('returns undefined only for a non-object value', () => {
        expect(normalizeQuantizerDefaults('nope')).toBeUndefined();
        expect(normalizeQuantizerDefaults(null)).toBeUndefined();
        expect(normalizeQuantizerDefaults(undefined)).toBeUndefined();
        expect(normalizeQuantizerDefaults([])).toBeUndefined();
    });
});

describe('normalizeDefaultQuantizerByType', () => {
    it('keeps known types with known quantizer ids', () => {
        expect(normalizeDefaultQuantizerByType({ image: 'stucki', text: 'threshold' })).toEqual({
            image: 'stucki',
            text: 'threshold',
        });
    });

    it('drops unknown types and unknown quantizer ids', () => {
        expect(
            normalizeDefaultQuantizerByType({ bogus: 'stucki', text: 'ostromoukhov', image: 42 }),
        ).toEqual({});
    });

    it('returns undefined only for a non-object value', () => {
        expect(normalizeDefaultQuantizerByType('text')).toBeUndefined();
        expect(normalizeDefaultQuantizerByType(null)).toBeUndefined();
        expect(normalizeDefaultQuantizerByType(undefined)).toBeUndefined();
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
    quantizerDefaults: DEFAULT_QUANTIZER_DEFAULTS,
    defaultQuantizerByType: DEFAULT_QUANTIZER_BY_TYPE,
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

    it('round-trips a non-empty defaultPaperTypeId and clears blank/invalid ones', () => {
        expect(
            validatePersistedSettings({ defaultPaperTypeId: 'ftagSpare-25x78' }, defaults)
                .defaultPaperTypeId,
        ).toBe('ftagSpare-25x78');
        // Blank / wrong-typed => unset (the preference is optional).
        expect(
            validatePersistedSettings({ defaultPaperTypeId: '' }, defaults).defaultPaperTypeId,
        ).toBeUndefined();
        expect(
            validatePersistedSettings({ defaultPaperTypeId: 7 }, defaults).defaultPaperTypeId,
        ).toBeUndefined();
        // Absent => the (undefined) default.
        expect(validatePersistedSettings({}, defaults).defaultPaperTypeId).toBeUndefined();
    });

    it('normalizes quantizerDefaults, falling back to the empty default', () => {
        expect(
            validatePersistedSettings(
                { quantizerDefaults: { stucki: { strength: 2.5076 }, bogus: { threshold: 1 } } },
                defaults,
            ).quantizerDefaults,
        ).toEqual({ stucki: { strength: 2.51 } });
        // Non-object / absent => the empty default (engine defaults).
        expect(validatePersistedSettings({ quantizerDefaults: 'x' }, defaults).quantizerDefaults).toEqual({});
        expect(validatePersistedSettings({}, defaults).quantizerDefaults).toEqual({});
    });

    it('normalizes defaultQuantizerByType, falling back to the empty default', () => {
        expect(
            validatePersistedSettings(
                { defaultQuantizerByType: { image: 'atkinson', bogus: 'stucki', text: 'nope' } },
                defaults,
            ).defaultQuantizerByType,
        ).toEqual({ image: 'atkinson' });
        expect(
            validatePersistedSettings({ defaultQuantizerByType: 5 }, defaults).defaultQuantizerByType,
        ).toEqual({});
        expect(validatePersistedSettings({}, defaults).defaultQuantizerByType).toEqual({});
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

    it('picks a validated defaultPaperTypeId only when present', () => {
        expect(pickPersistedKeys({ defaultPaperTypeId: 'p1' }, defaults)).toEqual({
            defaultPaperTypeId: 'p1',
        });
        expect('defaultPaperTypeId' in pickPersistedKeys({}, defaults)).toBe(false);
        // A present-but-blank value repairs to `undefined` and still overrides
        // the seed (`in` guard, not truthiness).
        const picked = pickPersistedKeys({ defaultPaperTypeId: '' }, defaults);
        expect('defaultPaperTypeId' in picked).toBe(true);
        expect(picked.defaultPaperTypeId).toBeUndefined();
    });

    it('picks the two dither settings only when present, and repairs bad entries', () => {
        expect(
            pickPersistedKeys(
                { quantizerDefaults: { floydSteinberg: { threshold: 200 } }, defaultQuantizerByType: { image: 'stucki' } },
                defaults,
            ),
        ).toEqual({
            quantizerDefaults: { floydSteinberg: { threshold: 200 } },
            defaultQuantizerByType: { image: 'stucki' },
        });
        // A present-but-garbage value repairs to the empty default and still
        // overrides the seed (`in` guard, not truthiness).
        const picked = pickPersistedKeys({ quantizerDefaults: 7 }, defaults);
        expect('quantizerDefaults' in picked).toBe(true);
        expect(picked.quantizerDefaults).toEqual({});
        expect('defaultQuantizerByType' in pickPersistedKeys({}, defaults)).toBe(false);
    });
});
