import { useCallback, useEffect, useRef, useState } from 'react';
import type { LabelDoc } from '../../core/doc/types';
import { quantizerSettingsKey, type QuantizerByType, type QuantizerDefaults } from '../../core/render';
import type { CsvRecord } from '../../data/csvRepo';
import {
    renderLabelPage,
    type AssetDeps,
    type RenderedLabelPage,
    type RenderLabelPageOptions,
    type RenderNotice,
    type ResolveContext,
} from '../../editor/render';
import {
    createThumbnailCache,
    type ThumbnailCache,
} from '../../print/thumbnails';

/**
 * React wrapper around `createThumbnailCache` (W4, §3.5).
 *
 * Builds one LRU-32 / 2-concurrent cache per **content** identity — `enabled`,
 * `doc`, `csv` and the serialized override values — never per callback/object
 * identity. `prepareRow`/`assets`/`renderPage`/`overrides` are read through
 * refs updated each render, so a caller may hand over a fresh closure or a
 * fresh `overrides` object every render without churning (and disposing) the
 * cache mid-flight. The default `render(rowIndex)` goes through the **shared**
 * render path at ~100 dpi (`renderLabelPage`, invariant 7), applying the
 * dialog's current render overrides (`invert`/`mirror`/`offset`) so a
 * thumbnail matches the printed raster. The cache is disposed on unmount and
 * rebuilt only when content changes, so a stale doc/override can never serve a
 * wrong preview.
 *
 * `urlFor(rowIndex)` resolves a row's data URL and returns `undefined` while it
 * is still rendering (the list shows a placeholder). Resolved values live in a
 * stateful map, so the list re-renders as each thumbnail lands.
 */

/**
 * Thumbnails render at ~100 dpi (owner decision O1; raised from 50 in W5 so the
 * queue previews are sharp on 2× displays and for landscape labels, which 50 dpi
 * upscaled). The cache design (`rowIndex` key, LRU-32, 2 concurrent) is
 * unchanged: only the raster resolution moved, and render cost — dpi² — stays
 * far below the doc-dpi page preview.
 */
export const THUMBNAIL_DPI = 100;

/** Render-relevant subset of `PrintOverrides` (printer options do not change pixels). */
export interface PrintThumbnailOverrides {
    invert?: boolean;
    mirror?: boolean;
    offset?: { x: number; y: number; type: 'inner' | 'outer' };
    /**
     * Dither settings that change pixels. Part of the cache rebuild key and
     * forwarded to the shared render path, so a settings change cannot serve a
     * stale thumbnail.
     */
    quantizerDefaults?: QuantizerDefaults;
    defaultQuantizerByType?: QuantizerByType;
}

export interface UsePrintThumbnailsOptions {
    doc: LabelDoc;
    /** Included so a different table rebuilds the cache even if `prepareRow` is stable. */
    csv: CsvRecord | null;
    /** Per-row async content prep (csv/template). Absent = static/fallback only. */
    prepareRow?: (rowIndex: number) => Promise<ResolveContext>;
    /** Asset deps forwarded to the shared render path. */
    assets?: AssetDeps;
    /**
     * Current render overrides. Only the **values** participate in the cache
     * rebuild key (`invert`/`mirror`/`offset`), so callers may pass a fresh
     * object each render without churning the cache.
     */
    overrides?: PrintThumbnailOverrides;
    /**
     * When `false`, no cache is created and nothing renders (defense in depth:
     * a caller that mounts the dialog closed cannot prefetch). Defaults to
     * `true`, so an omitted option is a no-op for the existing open-dialog path.
     */
    enabled?: boolean;
    /** Raster seam; defaults to the shared `renderLabelPage` (invariant 7). */
    renderPage?: (
        doc: LabelDoc,
        ctx: ResolveContext,
        opts: RenderLabelPageOptions,
    ) => Promise<RenderedLabelPage>;
    capacity?: number;
    concurrency?: number;
}

export interface PrintThumbnails {
    /** The row's data URL, or `undefined` while it renders / after a failure. */
    urlFor(rowIndex: number): string | undefined;
    /** Best-effort warming around the visible window. */
    prefetch(center: number, radius: number): void;
    /** Non-fatal render notices observed so far (e.g. `mirror-clipped-ink`). */
    notices: readonly RenderNotice[];
    /** Worst per-page fallback count when the eight-policy palette is exceeded. */
    policyOverflowCount: number;
    /** Test/introspection: number of resolved thumbnails. */
    readonly size: number;
}

/**
 * Merge notices, keeping the worst `mirror-clipped-ink` loss seen so far.
 *
 * Exported so a caller with a **second** render source (the print dialog's
 * doc-dpi page preview) can fold its notices into the thumbnail hook's with
 * identical semantics, instead of letting one source overwrite the other.
 */
export const mergeNotices = (
    previous: readonly RenderNotice[],
    next: readonly RenderNotice[],
): readonly RenderNotice[] => {
    const merged = new Map<RenderNotice['kind'], RenderNotice>();
    for (const notice of previous) merged.set(notice.kind, notice);
    for (const notice of next) {
        const existing = merged.get(notice.kind);
        if (
            existing === undefined ||
            (notice.kind === 'mirror-clipped-ink' && notice.lostPx > existing.lostPx)
        ) {
            merged.set(notice.kind, notice);
        }
    }
    return [...merged.values()];
};

/**
 * Serialize the render-relevant override **values** into a primitive rebuild
 * key. The cache keys on this string rather than the `overrides` object
 * identity, so a caller passing a fresh (but value-equal) object every render
 * does not rebuild — and dispose — the cache on every render.
 */
const overridesContentKey = (overrides: PrintThumbnailOverrides | undefined): string => {
    if (overrides === undefined) return '';
    const invert = overrides.invert === true ? '1' : '0';
    const mirror = overrides.mirror === true ? '1' : '0';
    const offset =
        overrides.offset === undefined
            ? '-'
            : `${overrides.offset.x},${overrides.offset.y},${overrides.offset.type}`;
    // Serialize the dither settings by **value** with the shared,
    // order-independent key: a settings change (or a fresh but equal object)
    // must rebuild only when the values actually changed, so a settings edit can
    // never leave a stale thumbnail, and key-order churn cannot force a needless
    // rebuild.
    const quantizer = quantizerSettingsKey(
        overrides.quantizerDefaults,
        overrides.defaultQuantizerByType,
    );
    return `${invert}|${mirror}|${offset}|${quantizer}`;
};

export const usePrintThumbnails = (
    options: UsePrintThumbnailsOptions,
): PrintThumbnails => {
    const {
        doc,
        csv,
        prepareRow,
        assets,
        overrides,
        renderPage,
        capacity,
        concurrency,
        enabled = true,
    } = options;

    const [urls, setUrls] = useState<ReadonlyMap<number, string>>(() => new Map());
    const [notices, setNotices] = useState<readonly RenderNotice[]>([]);
    const [policyOverflowCount, setPolicyOverflowCount] = useState(0);

    const cacheRef = useRef<ThumbnailCache | null>(null);
    const generationRef = useRef(0);
    const mountedRef = useRef(true);

    // Latest callback/config inputs, read by the cache's `render` closure. They
    // are deliberately *not* effect dependencies: a caller passing a fresh
    // function or `overrides` object each render must not churn the cache.
    const prepareRowRef = useRef(prepareRow);
    prepareRowRef.current = prepareRow;
    const assetsRef = useRef(assets);
    assetsRef.current = assets;
    const renderPageRef = useRef(renderPage);
    renderPageRef.current = renderPage;
    const overridesRef = useRef(overrides);
    overridesRef.current = overrides;

    const overridesKey = overridesContentKey(overrides);

    useEffect(() => {
        // Reset on setup: StrictMode replays effects (setup → cleanup → setup),
        // and a cleanup that only latches `false` would leave every resolved
        // thumbnail silently dropped after the replay — visible as a permanent
        // "Rendering…" placeholder with no error.
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            cacheRef.current?.dispose();
            cacheRef.current = null;
        };
    }, []);

    // One cache per *content* identity (`enabled`/`doc`/`csv`/override values).
    // The render closure reads the latest callbacks through refs, so a new
    // function identity never rebuilds it.
    useEffect(() => {
        // Defense in depth: a disabled caller (e.g. a closed dialog) must hold no
        // cache and issue no renders/prefetches. `urlFor`/`prefetch` already
        // no-op when there is no cache.
        if (!enabled) {
            cacheRef.current?.dispose();
            cacheRef.current = null;
            setUrls(new Map());
            setNotices([]);
            setPolicyOverflowCount(0);
            return;
        }

        const generation = generationRef.current + 1;
        generationRef.current = generation;

        const render = async (rowIndex: number): Promise<string> => {
            const prepare = prepareRowRef.current;
            const ctx = prepare ? await prepare(rowIndex) : {};
            const currentAssets = assetsRef.current;
            const currentOverrides = overridesRef.current;
            // Preview convention: thumbnails show the **logical/label** orientation
            // (not the transport pre-rotation), matching niim.blue's preview. Only
            // the encoded/print page applies `orientForPrint` (the 180°/90° bake
            // plus encoder feed direction); do not rotate the preview here.
            const rendered = await (renderPageRef.current ?? renderLabelPage)(doc, ctx, {
                dpi: THUMBNAIL_DPI,
                ...(currentAssets !== undefined ? { assets: currentAssets } : {}),
                ...(currentOverrides?.invert ? { invert: true } : {}),
                ...(currentOverrides?.mirror ? { mirror: true } : {}),
                ...(currentOverrides?.offset ? { offset: currentOverrides.offset } : {}),
                ...(currentOverrides?.quantizerDefaults !== undefined
                    ? { quantizerDefaults: currentOverrides.quantizerDefaults }
                    : {}),
                ...(currentOverrides?.defaultQuantizerByType !== undefined
                    ? { defaultQuantizerByType: currentOverrides.defaultQuantizerByType }
                    : {}),
            });

            if (rendered.policyOverflowCount && generation === generationRef.current && mountedRef.current) {
                setPolicyOverflowCount((previous) => Math.max(previous, rendered.policyOverflowCount ?? 0));
            }
            const renderedNotices = rendered.notices;
            if (
                renderedNotices !== undefined &&
                renderedNotices.length > 0 &&
                generation === generationRef.current &&
                mountedRef.current
            ) {
                setNotices((previous) => mergeNotices(previous, renderedNotices));
            }
            return rendered.canvas.toDataURL('image/png');
        };

        const cache = createThumbnailCache({
            render,
            ...(capacity !== undefined ? { capacity } : {}),
            ...(concurrency !== undefined ? { concurrency } : {}),
        });
        cacheRef.current = cache;
        // Drop previews from the superseded cache; they no longer match the doc.
        setUrls(new Map());
        setNotices([]);
        setPolicyOverflowCount(0);

        return () => {
            cache.dispose();
            if (cacheRef.current === cache) cacheRef.current = null;
        };
    }, [enabled, doc, csv, overridesKey, capacity, concurrency]);

    const urlFor = useCallback(
        (rowIndex: number): string | undefined => {
            const cached = urls.get(rowIndex);
            if (cached !== undefined) return cached;

            const cache = cacheRef.current;
            if (cache === null) return undefined;
            const generation = generationRef.current;
            cache.get(rowIndex).then(
                (url) => {
                    if (
                        !mountedRef.current ||
                        generationRef.current !== generation ||
                        cacheRef.current !== cache
                    ) {
                        return;
                    }
                    setUrls((previous) => {
                        if (previous.get(rowIndex) === url) return previous;
                        const next = new Map(previous);
                        next.set(rowIndex, url);
                        return next;
                    });
                },
                // A render failure (or a dispose) leaves the placeholder; a later
                // render may retry, so never surface it as unhandled.
                () => undefined,
            );
            return undefined;
        },
        [urls],
    );

    const prefetch = useCallback((center: number, radius: number): void => {
        cacheRef.current?.prefetch(center, radius);
    }, []);

    return { urlFor, prefetch, notices, policyOverflowCount, size: urls.size };
};
