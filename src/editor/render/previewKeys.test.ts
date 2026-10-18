// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { ResolvedContent } from './resolve';
import type { RenderLabelPageOptions } from './renderLabelPage';
import { previewOptionsKey, previewOverridesKey } from './previewKeys';

/**
 * The shared preview content keys (P14 W3 review, finding 3): the print page
 * preview and the editor's live quantized preview must agree on what makes a
 * raster stale. `previewOptionsKey` moved here out of
 * `components/print/PrintPagePreview` — its **format is pinned** so the move is
 * not a silent cache-invalidation change — and `previewOverridesKey` is the
 * override-map value key both sides can use.
 *
 * happy-dom (not node): `RenderLabelPageOptions` comes from the module that owns
 * the render pipeline, whose graph loads Konva. The type import is erased, but
 * the module graph is evaluated either way.
 */

const options = (over: Partial<RenderLabelPageOptions> = {}): RenderLabelPageOptions => ({
    dpi: 203,
    ...over,
});

const content = (text: string, placeholder = false): ResolvedContent => ({ text, placeholder });

const ctx = (overrides?: [string, ResolvedContent][]): { overrides?: ReadonlyMap<string, ResolvedContent> } =>
    overrides === undefined ? {} : { overrides: new Map(overrides) };

describe('previewOptionsKey', () => {
    it('keeps the pre-move format', () => {
        // dpi | invert | mirror | offset | quantizer settings (sorted, by value;
        // the settings part is `quantizerSettingsKey`'s `d[...]t[...]` form).
        expect(previewOptionsKey(options())).toBe('203|0|0|-|d[]t[]');
        expect(previewOptionsKey(options({ dpi: 100, invert: true, mirror: true }))).toBe('100|1|1|-|d[]t[]');
        expect(previewOptionsKey(options({ offset: { x: 3, y: -4, type: 'outer' } }))).toBe('203|0|0|3,-4,outer|d[]t[]');
        expect(previewOptionsKey(options({ quantizerDefaults: { threshold: { gamma: 1.5 } } }))).toBe(
            '203|0|0|-|d[threshold:gamma=1.5]t[]',
        );
        expect(previewOptionsKey(options({ defaultQuantizerByType: { image: 'atkinson' } }))).toBe(
            '203|0|0|-|d[]t[image=atkinson]',
        );
    });

    it('does not depend on key insertion order of the settings maps', () => {
        const a = previewOptionsKey(
            options({ quantizerDefaults: { threshold: { gamma: 2, threshold: 90 } } }),
        );
        const b = previewOptionsKey(
            options({ quantizerDefaults: { threshold: { threshold: 90, gamma: 2 } } }),
        );
        expect(a).toBe(b);
    });
});

describe('previewOverridesKey', () => {
    it('keys the same for a missing, empty or omitted override map', () => {
        const none = previewOverridesKey(undefined);
        expect(previewOverridesKey({})).toBe(none);
        expect(previewOverridesKey(ctx([]))).toBe(none);
    });

    it('is equal for equal content and different for a changed value', () => {
        const base = previewOverridesKey(ctx([['t1', content('Ada')]]));
        expect(previewOverridesKey(ctx([['t1', content('Ada')]]))).toBe(base);
        expect(previewOverridesKey(ctx([['t1', content('Grace')]]))).not.toBe(base);
        expect(previewOverridesKey(ctx([['t1', content('Ada', true)]]))).not.toBe(base);
        expect(previewOverridesKey(ctx([['t2', content('Ada')]]))).not.toBe(base);
    });

    it('is order-independent (a rebuilt map is the same content)', () => {
        const a = previewOverridesKey(
            ctx([
                ['t1', content('Ada')],
                ['t2', content('Grace')],
            ]),
        );
        const b = previewOverridesKey(
            ctx([
                ['t2', content('Grace')],
                ['t1', content('Ada')],
            ]),
        );
        expect(a).toBe(b);
    });

    it('cannot forge a field boundary with separator-bearing text', () => {
        // The exact collision a separator-joined encoding allows: this text ends
        // with what a `id\0text\0flag` + a separator + a second entry would look
        // like, so ONE entry could serialize identically to a two-entry map and
        // mask a real content change. Length-prefixed fields make it impossible.
        const forged = ['a', '\u0000', '0', '\u0001', 't2', '\u0000', 'b'].join('');
        const one = previewOverridesKey(ctx([['t1', content(forged)]]));
        const two = previewOverridesKey(
            ctx([
                ['t1', content('a')],
                ['t2', content('b')],
            ]),
        );
        expect(one).not.toBe(two);
    });

    it('cannot be confused by a separator inside a value', () => {
        const base = previewOverridesKey(ctx([['t1', content('a')]]));
        expect(previewOverridesKey(ctx([['t1', content('a\u0001b')]]))).not.toBe(base);
        expect(previewOverridesKey(ctx([['t1', content('a\u0000')]]))).not.toBe(base);
        // Length-prefixed: the id is not confusable with the text either.
        expect(previewOverridesKey(ctx([['a\u0000b', content('c')]]))).not.toBe(
            previewOverridesKey(ctx([['a', content('\u0000b\u0000c')]])),
        );
    });

    it('keys `emptyText`, which also changes what the resolver draws', () => {
        expect(previewOverridesKey({ emptyText: '{empty}' })).not.toBe(previewOverridesKey({}));
        expect(previewOverridesKey(ctx([['t1', content('a')]])).length).toBeGreaterThan(0);
    });
});
