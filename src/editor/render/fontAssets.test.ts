// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLabelDoc } from '../../core/doc/factory';
import type { FontRef, LabelDoc } from '../../core/doc/types';
import {
    classifyFont,
    createFontProvider,
    fontBadges,
} from './fontAssets';

const systemFont = (id = 'sys'): FontRef => ({
    fontId: id,
    familyName: 'Atkinson Hyperlegible',
    name: 'Atkinson Hyperlegible',
    source: { kind: 'system', descriptor: 'Atkinson Hyperlegible' },
});

const importedFont = (id: string, resourceId = id): FontRef => ({
    fontId: id,
    familyName: `Family-${id}`,
    name: `Family-${id}`,
    source: {
        kind: 'imported',
        asset: { kind: 'local', mediaType: 'font/ttf', resourceId, fingerprint: 'fp' },
        fingerprint: 'fp',
    },
});

const docWithFonts = (fonts: FontRef[]): LabelDoc => {
    const doc = createLabelDoc({ id: 'doc-1', name: 'Fonts' });
    doc.resources.fonts.push(...fonts);
    return doc;
};

/** Overwrite `document.fonts` (absent in happy-dom) and restore it after. */
const setDocumentFonts = (value: unknown): void => {
    Object.defineProperty(document, 'fonts', { configurable: true, value });
};

afterEach(() => {
    Reflect.deleteProperty(document, 'fonts');
    vi.unstubAllGlobals();
});

describe('classifyFont', () => {
    it('maps a system font to system when available, missing otherwise', () => {
        const ref = systemFont();
        expect(classifyFont(ref, { bytesAvailable: false, systemAvailable: true })).toBe('system');
        expect(classifyFont(ref, { bytesAvailable: false, systemAvailable: false })).toBe('missing');
    });

    it('maps an imported font to imported when bytes resolve, missing otherwise', () => {
        const ref = importedFont('f1');
        expect(classifyFont(ref, { bytesAvailable: true, systemAvailable: false })).toBe('imported');
        expect(classifyFont(ref, { bytesAvailable: false, systemAvailable: true })).toBe('missing');
    });
});

describe('fontBadges', () => {
    it('badges system vs imported vs missing from provider bytes', async () => {
        const doc = docWithFonts([
            systemFont('sys'),
            importedFont('ok', 'r-ok'),
            importedFont('gone', 'r-gone'),
        ]);
        const getBytes = vi.fn(async (id: string) =>
            id === 'r-ok' ? new Uint8Array([1, 2, 3]) : null,
        );

        const badges = await fontBadges(doc, { getBytes });

        expect(badges.get('sys')).toBe('system');
        expect(badges.get('ok')).toBe('imported');
        expect(badges.get('gone')).toBe('missing');
    });

    it('degrades to missing when the bytes provider rejects, never throwing', async () => {
        const doc = docWithFonts([importedFont('boom', 'r-boom')]);
        const getBytes = vi.fn(async () => {
            throw new Error('idb down');
        });

        const badges = await fontBadges(doc, { getBytes });
        expect(badges.get('boom')).toBe('missing');
    });

    it('uses document.fonts.check for system fonts and treats a rejected family as missing', async () => {
        setDocumentFonts({
            check: (font: string) => font.includes('Installed'),
            add: () => undefined,
        });
        const installed = systemFont('a');
        installed.familyName = 'Installed';
        const absent = systemFont('b');
        absent.familyName = 'Absent';

        const badges = await fontBadges(docWithFonts([installed, absent]), { getBytes: async () => null });
        expect(badges.get('a')).toBe('system');
        expect(badges.get('b')).toBe('missing');
    });

    it('treats system availability as unknown (= available) without document.fonts', async () => {
        const badges = await fontBadges(docWithFonts([systemFont('sys')]), {
            getBytes: async () => null,
        });
        expect(badges.get('sys')).toBe('system');
    });
});

describe('createFontProvider.ensureFonts', () => {
    it('is a harmless no-op without a FontFace constructor', async () => {
        const getBytes = vi.fn(async () => new Uint8Array([1]));
        const provider = createFontProvider({ getBytes });

        await expect(provider.ensureFonts(docWithFonts([importedFont('f1')]))).resolves.toBeUndefined();
        // The guard short-circuits before touching the bytes provider.
        expect(getBytes).not.toHaveBeenCalled();
    });

    it('registers an imported local font and caches its fontId', async () => {
        const added: unknown[] = [];
        const load = vi.fn(async () => undefined);
        class FakeFontFace {
            family: string;
            source: Uint8Array;
            load = load;
            constructor(family: string, source: Uint8Array) {
                this.family = family;
                this.source = source;
            }
        }
        vi.stubGlobal('FontFace', FakeFontFace as unknown as typeof FontFace);
        setDocumentFonts({ add: (face: unknown) => added.push(face), check: () => true });

        const getBytes = vi.fn(async (id: string) => (id === 'r-f1' ? new Uint8Array([1]) : null));
        const provider = createFontProvider({ getBytes });
        const doc = docWithFonts([importedFont('f1', 'r-f1')]);

        await provider.ensureFonts(doc);
        await provider.ensureFonts(doc);

        expect(added).toHaveLength(1);
        expect(load).toHaveBeenCalledTimes(1);
        // Cached: the second call does not re-read bytes.
        expect(getBytes).toHaveBeenCalledTimes(1);
    });

    it('swallows a rejected FontFace.load and does not cache the font', async () => {
        let loadCalls = 0;
        class FakeFontFace {
            family: string;
            source: Uint8Array;
            constructor(family: string, source: Uint8Array) {
                this.family = family;
                this.source = source;
            }
            load = async (): Promise<void> => {
                loadCalls += 1;
                throw new Error('bad font');
            };
        }
        vi.stubGlobal('FontFace', FakeFontFace as unknown as typeof FontFace);
        setDocumentFonts({ add: () => undefined, check: () => true });

        const getBytes = vi.fn(async () => new Uint8Array([1]));
        const provider = createFontProvider({ getBytes });
        const doc = docWithFonts([importedFont('f1', 'r-f1')]);

        await expect(provider.ensureFonts(doc)).resolves.toBeUndefined();
        await provider.ensureFonts(doc);
        // Not cached: a second call retries (and fails again) rather than
        // silently treating a broken font as loaded.
        expect(loadCalls).toBe(2);
    });
});
