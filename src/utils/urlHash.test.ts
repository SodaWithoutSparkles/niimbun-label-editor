import { describe, expect, it } from 'vitest';
import type { GallerySection } from '../store/slices/viewSlice';
import { DEFAULT_URL_STATE, buildHash, parseHash, type UrlState } from './urlHash';

/** A `UrlState` literal, so the expectations below stay readable. */
const state = (patch: Partial<UrlState> = {}): UrlState => ({ ...DEFAULT_URL_STATE, ...patch });

describe('parseHash — total, never throws', () => {
    it('falls back to the gallery defaults for empty/malformed input', () => {
        const malformed = [
            '',
            '#',
            '   ',
            '#nonsense',
            '#/',
            '#/nonsense',
            'gallery',
            '#gallery',
            '#/gallery/bogus',
            '#settings/extra',
            '#/editor',
            '#/editor?doc=',
            '#/editor?doc',
        ];
        for (const input of malformed) {
            expect(parseHash(input), input).toEqual(DEFAULT_URL_STATE);
        }
        expect(parseHash(undefined as unknown as string)).toEqual(DEFAULT_URL_STATE);
    });

    it('reads every addressable form', () => {
        expect(parseHash('#/gallery')).toEqual(state());
        expect(parseHash('#/gallery/paper')).toEqual(state({ section: 'paper' }));
        expect(parseHash('#/gallery/templates?q=1')).toEqual(state({ section: 'templates' }));
        expect(parseHash('#/gallery/csv')).toEqual(state({ section: 'csv' }));
        expect(parseHash('#/gallery/media')).toEqual(state({ section: 'media' }));
        expect(parseHash('#/editor?doc=abc')).toEqual(state({ view: 'editor', docId: 'abc' }));
        expect(parseHash('#settings')).toEqual(state({ settingsOpen: true }));
        // The leading `#` is optional (a caller may pass `location.hash` or a path).
        expect(parseHash('/gallery/paper')).toEqual(state({ section: 'paper' }));
    });

    it('ignores extra query params', () => {
        expect(parseHash('#/editor?doc=abc&view=paper&section=media')).toEqual(
            state({ view: 'editor', docId: 'abc' }),
        );
    });

    it('decodes the doc id exactly once', () => {
        expect(parseHash('#/editor?doc=a%2Fb%20c')).toEqual(state({ view: 'editor', docId: 'a/b c' }));
        // `%2F` here is the *literal four characters* of the id, not a slash:
        // `URLSearchParams` already decoded once, so no second decode may run.
        expect(parseHash('#/editor?doc=lbl%252F%20x')?.docId).toBe('lbl%2F x');
        // A malformed escape must not throw; the raw value is kept.
        expect(parseHash('#/editor?doc=%').docId).toBe('%');
    });
});

describe('buildHash — canonical, minimal', () => {
    it('omits the default section', () => {
        expect(buildHash(state())).toBe('#/gallery');
        expect(buildHash(state({ section: 'recent' }))).toBe('#/gallery');
        expect(buildHash(state({ section: 'media' }))).toBe('#/gallery/media');
    });

    it('addresses the editor by doc id only', () => {
        expect(buildHash(state({ view: 'editor', docId: 'abc' }))).toBe('#/editor?doc=abc');
        expect(buildHash(state({ view: 'editor', docId: 'a b/c' }))).toBe('#/editor?doc=a%20b%2Fc');
        // The editor is not addressable without a document.
        expect(buildHash(state({ view: 'editor', docId: null }))).toBe('#/gallery');
        expect(buildHash(state({ view: 'editor', docId: '' }))).toBe('#/gallery');
    });

    it('emits `#settings` for the open modal', () => {
        expect(buildHash(state({ settingsOpen: true }))).toBe('#settings');
        expect(buildHash(state({ settingsOpen: true, view: 'editor', docId: 'x' }))).toBe('#settings');
    });

    it('falls back to the default section for an impossible section', () => {
        expect(buildHash(state({ section: 'bogus' as GallerySection }))).toBe('#/gallery');
    });
});

describe('parseHash ⇄ buildHash', () => {
    it('round-trips every canonical hash unchanged', () => {
        const canonical = [
            '#/gallery',
            '#/gallery/paper',
            '#/gallery/templates',
            '#/gallery/csv',
            '#/gallery/media',
            '#/editor?doc=abc',
            '#settings',
        ];
        for (const hash of canonical) {
            expect(buildHash(parseHash(hash)), hash).toBe(hash);
        }
    });

    it('normalises malformed input to a stable canonical form (idempotent)', () => {
        const noisy = [
            '',
            '#',
            '#nonsense',
            '#/gallery/bogus',
            '#/gallery/recent',
            '#/gallery/paper?extra=1&doc=x',
            '#/editor',
            '#/editor?doc=',
        ];
        for (const hash of noisy) {
            const once = buildHash(parseHash(hash));
            expect(buildHash(parseHash(once)), hash).toBe(once);
        }
        expect(buildHash(parseHash(''))).toBe('#/gallery');
        expect(buildHash(parseHash('#/gallery/recent'))).toBe('#/gallery');
        expect(buildHash(parseHash('#/gallery/paper?extra=1&doc=x'))).toBe('#/gallery/paper');
    });

    /**
     * Every character class that could be mangled by a second decode, a query
     * separator, or the fragment itself. A doc id is user-facing (`meta.id` from
     * an imported/duplicated label), so it can contain all of these.
     */
    const NASTY_IDS = [
        'plain',
        'lbl %2F %25', // escape-like text: the double-decode regression
        'a/b c',
        'a?b=c&d=e',
        'a#b',
        'a+b',
        "quote's and \"double\"",
        'ünïcøde — 中文 😀',
        'trailing%',
    ];

    it.each(NASTY_IDS)('round-trips a doc id through the URL: %s', (id) => {
        const hash = buildHash(state({ view: 'editor', docId: id }));
        expect(parseHash(hash)).toEqual(state({ view: 'editor', docId: id }));
        expect(buildHash(parseHash(hash))).toBe(hash); // canonical and stable
    });
});
