import type { GallerySection } from '../store/slices/viewSlice';

/**
 * Hash-routing URL grammar (backlog: "Fix navigation") — the **pure** half of
 * the feature; the store/DOM wiring lives in `components/layout/useUrlSync`.
 *
 * The app has no router dependency and, before this module, no addressable
 * state at all: a reload always landed on the gallery and the browser's
 * back/forward buttons did nothing meaningful. What this file owns is the
 * canonical address grammar, and nothing else — no React, no store instance, no
 * `window`.
 *
 * Grammar (canonical, minimal — `buildHash` never emits a redundant segment):
 *
 *   `#/gallery`               the gallery, default section (`recent`)
 *   `#/gallery/<section>`     the gallery on `recent|paper|templates|csv|media`
 *   `#/editor?doc=<meta.id>`  the editor, with the open document's id
 *   `#settings`               the settings modal open
 *
 * Anything else — no hash, `#`, `#nonsense`, an unknown section, an editor
 * without a `doc` — parses to `DEFAULT_URL_STATE`. `parseHash` is total: it
 * never throws, on any input.
 *
 * The single store touch point is the `GallerySection` **type** (erased at
 * compile time): the section vocabulary is owned by the store slice, and
 * re-declaring the union here is exactly how the URL and the sidebar would
 * drift apart. There is no runtime import, so the layer graph is unchanged.
 */

/** Gallery sections, in sidebar order. The URL segment maps 1:1 onto these. */
const GALLERY_SECTIONS: readonly GallerySection[] = ['recent', 'paper', 'templates', 'csv', 'media'];

const isGallerySection = (value: string): value is GallerySection =>
    (GALLERY_SECTIONS as readonly string[]).includes(value);

/** The addressable slice of the app: exactly the four fields the URL encodes. */
export interface UrlState {
    view: 'gallery' | 'editor';
    docId: string | null;
    section: GallerySection;
    settingsOpen: boolean;
}

/** No hash / unrecognised hash: the gallery on its default section. */
export const DEFAULT_URL_STATE: UrlState = {
    view: 'gallery',
    docId: null,
    section: 'recent',
    settingsOpen: false,
};

/**
 * Parse a URL hash into the app state it addresses. Total by construction:
 * every branch that is not recognised returns `DEFAULT_URL_STATE`, and the
 * input is never trusted (`undefined`, a bare `#`).
 *
 * The `doc` value is taken from `URLSearchParams`, which already percent-decodes
 * exactly once — the same single decode `buildHash`'s `encodeURIComponent`
 * mirrors. Decoding it a second time here would corrupt any id that legitimately
 * contains an escape-like sequence (`%2F`, `%25`) and make those documents
 * impossible to deep-link.
 */
export const parseHash = (hash: string): UrlState => {
    const raw = typeof hash === 'string' ? hash : '';
    // Tolerate a caller passing `location.hash` (leading `#`) or a bare path.
    const path = raw.startsWith('#') ? raw.slice(1) : raw;
    if (path.length === 0) return { ...DEFAULT_URL_STATE };
    if (path === 'settings') return { ...DEFAULT_URL_STATE, settingsOpen: true };
    if (!path.startsWith('/')) return { ...DEFAULT_URL_STATE };

    // Extra query params are ignored by construction: only `doc` is read.
    const queryAt = path.indexOf('?');
    const segments = (queryAt === -1 ? path : path.slice(0, queryAt)).split('/');
    const query = new URLSearchParams(queryAt === -1 ? '' : path.slice(queryAt + 1));

    // `/gallery/paper` → ['', 'gallery', 'paper'].
    const head = segments[1] ?? '';
    if (head === 'gallery') {
        const section = segments[2] ?? '';
        // An unknown/absent section degrades to the default pane, never a throw.
        return { ...DEFAULT_URL_STATE, section: isGallerySection(section) ? section : 'recent' };
    }
    if (head === 'editor') {
        const docId = query.get('doc');
        // The editor is only addressable *with* a document; `#/editor` or
        // `#/editor?doc=` cannot render anything, so it is not a valid address.
        if (docId === null || docId.length === 0) return { ...DEFAULT_URL_STATE };
        return { ...DEFAULT_URL_STATE, view: 'editor', docId };
    }
    return { ...DEFAULT_URL_STATE };
};

/**
 * The inverse of `parseHash`: the canonical, minimal hash for `state`.
 *
 * Minimal means the default section is not spelled out (`#/gallery`, never
 * `#/gallery/recent`) and the editor carries only its doc id. `settingsOpen`
 * wins: the scheme has a single `#settings` form, so an open modal is described
 * by it and the underlying view is left in the store (closing the modal writes
 * the view back).
 */
export const buildHash = (state: UrlState): string => {
    if (state.settingsOpen) return '#settings';
    if (state.view === 'editor' && state.docId !== null && state.docId.length > 0) {
        return `#/editor?doc=${encodeURIComponent(state.docId)}`;
    }
    return state.section !== 'recent' && isGallerySection(state.section)
        ? `#/gallery/${state.section}`
        : '#/gallery';
};
