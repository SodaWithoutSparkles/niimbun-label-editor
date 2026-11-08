// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import '../../i18n';
import { createLabelDoc } from '../../core/doc/factory';
import type {
    RenderedLabelPage,
    RenderLabelPageOptions,
    RenderNotice,
    ResolveContext,
} from '../../editor/render';
import { THUMBNAIL_DPI, usePrintThumbnails } from './usePrintThumbnails';

afterEach(cleanup);

const doc = createLabelDoc({ backingW: 2500, backingH: 7800, dpi: 300 });

const fakePage = (notices?: RenderNotice[], policyOverflowCount?: number): RenderedLabelPage =>
    ({
        rgba: { data: new Uint8ClampedArray(4), width: 1, height: 1 },
        widthPx: 1,
        heightPx: 1,
        canvas: {
            toDataURL: () => 'data:image/png;base64,stub',
        } as unknown as HTMLCanvasElement,
        ...(notices ? { notices } : {}),
        ...(policyOverflowCount ? { policyOverflowCount } : {}),
    }) as RenderedLabelPage;

const makeRender = (page: RenderedLabelPage) =>
    vi.fn(
        async (
            _doc: unknown,
            _ctx: ResolveContext,
            _opts: RenderLabelPageOptions,
        ): Promise<RenderedLabelPage> => page,
    );

describe('usePrintThumbnails', () => {
    it('renders a row through the shared path at THUMBNAIL_DPI and resolves its data URL', async () => {
        const renderPage = makeRender(fakePage());
        const prepareRow = vi.fn(async (_rowIndex: number): Promise<ResolveContext> => ({}));

        const { result } = renderHook(() =>
            usePrintThumbnails({ doc, csv: null, prepareRow, renderPage }),
        );

        await waitFor(() =>
            expect(result.current.urlFor(0)).toBe('data:image/png;base64,stub'),
        );
        expect(prepareRow).toHaveBeenCalledWith(0);
        expect(renderPage.mock.calls[0]![2]).toMatchObject({ dpi: THUMBNAIL_DPI });
    });

    it('applies the current invert/mirror/offset overrides to the render', async () => {
        const renderPage = makeRender(fakePage());
        const overrides = {
            invert: true,
            mirror: true,
            offset: { x: 4, y: -2, type: 'outer' as const },
        };

        const { result } = renderHook(() =>
            usePrintThumbnails({ doc, csv: null, overrides, renderPage }),
        );

        await waitFor(() =>
            expect(result.current.urlFor(3)).toBe('data:image/png;base64,stub'),
        );
        expect(renderPage.mock.calls[0]![2]).toMatchObject({
            dpi: THUMBNAIL_DPI,
            invert: true,
            mirror: true,
            offset: { x: 4, y: -2, type: 'outer' },
        });
    });

    it('surfaces mirror-clipped-ink notices from a thumbnail render', async () => {
        const renderPage = makeRender(
            fakePage([{ kind: 'mirror-clipped-ink', lostPx: 11 }]),
        );

        const { result } = renderHook(() =>
            usePrintThumbnails({ doc, csv: null, renderPage }),
        );

        act(() => {
            result.current.urlFor(0);
        });
        await waitFor(() => expect(result.current.notices).toHaveLength(1));
        expect(result.current.notices[0]).toEqual({ kind: 'mirror-clipped-ink', lostPx: 11 });
    });

    it('surfaces the per-page policy-overflow count and resets it when the doc changes', async () => {
        const renderPage = makeRender(fakePage(undefined, 3));
        const otherDoc = createLabelDoc({ backingW: 1000, backingH: 2000, dpi: 300 });
        const { result, rerender } = renderHook(
            ({ current }: { current: typeof doc }) =>
                usePrintThumbnails({ doc: current, csv: null, renderPage }),
            { initialProps: { current: doc } },
        );

        act(() => {
            result.current.urlFor(0);
        });
        await waitFor(() => expect(result.current.policyOverflowCount).toBe(3));

        // A new doc rebuilds the cache and clears the stale verdict.
        rerender({ current: otherDoc });
        expect(result.current.policyOverflowCount).toBe(0);
        act(() => {
            result.current.urlFor(0);
        });
        await waitFor(() => expect(result.current.policyOverflowCount).toBe(3));
    });

    it('resets the policy-overflow count when disabled', async () => {
        const renderPage = makeRender(fakePage(undefined, 3));
        const { result, rerender } = renderHook(
            ({ enabled }: { enabled: boolean }) =>
                usePrintThumbnails({ doc, csv: null, renderPage, enabled }),
            { initialProps: { enabled: true } },
        );

        act(() => {
            result.current.urlFor(0);
        });
        await waitFor(() => expect(result.current.policyOverflowCount).toBe(3));

        rerender({ enabled: false });
        expect(result.current.policyOverflowCount).toBe(0);
    });

    it('stays inert while disabled (no cache, no render, no prefetch)', () => {
        const renderPage = makeRender(fakePage());
        const prepareRow = vi.fn(async (_rowIndex: number): Promise<ResolveContext> => ({}));
        const { result } = renderHook(() =>
            usePrintThumbnails({ doc, csv: null, prepareRow, renderPage, enabled: false }),
        );

        act(() => result.current.prefetch(0, 2));
        expect(result.current.urlFor(0)).toBeUndefined();
        expect(result.current.size).toBe(0);
        expect(renderPage).not.toHaveBeenCalled();
        expect(prepareRow).not.toHaveBeenCalled();
    });

    it('renders once enabled flips false → true', async () => {
        const renderPage = makeRender(fakePage());
        const { result, rerender } = renderHook(
            ({ enabled }: { enabled: boolean }) =>
                usePrintThumbnails({ doc, csv: null, renderPage, enabled }),
            { initialProps: { enabled: false } },
        );

        expect(renderPage).not.toHaveBeenCalled();
        rerender({ enabled: true });
        await waitFor(() =>
            expect(result.current.urlFor(0)).toBe('data:image/png;base64,stub'),
        );
        expect(renderPage).toHaveBeenCalledTimes(1);
    });

    it('warms the requested prefetch window', async () => {
        const renderPage = makeRender(fakePage());
        const prepareRow = vi.fn(async (_rowIndex: number): Promise<ResolveContext> => ({}));
        const { result } = renderHook(() =>
            usePrintThumbnails({ doc, csv: null, prepareRow, renderPage }),
        );

        act(() => result.current.prefetch(5, 1));

        await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(3));
        const rendered = prepareRow.mock.calls
            .map((call) => call[0])
            .sort((a, b) => a - b);
        expect(rendered).toEqual([4, 5, 6]);
    });

    // Regression (real headed bug): callers may pass a fresh `prepareRow` and a
    // fresh `overrides` object each render. Keying the cache on their identity
    // rebuilt (and disposed) it on every render, so each `urlFor` promise was
    // disposed before resolving — every row stuck on the "Rendering…"
    // placeholder forever, with no error.
    it('keeps one cache when prepareRow/overrides identities change every render', async () => {
        const renderPage = makeRender(fakePage());
        const { result, rerender } = renderHook(
            ({ tick }: { tick: number }) => {
                void tick;
                // Deliberately unstable identities, as an unmemoized caller.
                const prepareRow = async (_rowIndex: number): Promise<ResolveContext> => ({});
                const overrides = { invert: tick >= 0 };
                return usePrintThumbnails({
                    doc,
                    csv: null,
                    prepareRow,
                    overrides,
                    renderPage,
                });
            },
            { initialProps: { tick: 0 } },
        );

        act(() => {
            result.current.urlFor(0);
        });
        rerender({ tick: 1 });
        rerender({ tick: 2 });

        await waitFor(() =>
            expect(result.current.urlFor(0)).toBe('data:image/png;base64,stub'),
        );
        // No per-render rebuild: the row rendered exactly once, and the resolved
        // preview survived the identity churn.
        expect(renderPage).toHaveBeenCalledTimes(1);
        expect(result.current.size).toBe(1);
    });

    // Regression (why the unit tests missed it): the headed check runs under
    // React.StrictMode, whose effect replay ran the mount cleanup once without a
    // matching `mountedRef = true`, so every resolved thumbnail was dropped.
    it('resolves thumbnails under StrictMode effect replay', async () => {
        const renderPage = makeRender(fakePage());
        const { result } = renderHook(
            () => usePrintThumbnails({ doc, csv: null, renderPage }),
            { wrapper: StrictMode },
        );

        await waitFor(() =>
            expect(result.current.urlFor(0)).toBe('data:image/png;base64,stub'),
        );
    });

    it('rebuilds the cache and drops previews when the doc changes', async () => {
        const renderPage = makeRender(fakePage());
        const otherDoc = createLabelDoc({ backingW: 1000, backingH: 2000, dpi: 300 });
        const { result, rerender } = renderHook(
            ({ current }: { current: typeof doc }) =>
                usePrintThumbnails({ doc: current, csv: null, renderPage }),
            { initialProps: { current: doc } },
        );

        await waitFor(() =>
            expect(result.current.urlFor(0)).toBe('data:image/png;base64,stub'),
        );
        rerender({ current: otherDoc });
        expect(result.current.urlFor(0)).toBeUndefined();
        await waitFor(() =>
            expect(result.current.urlFor(0)).toBe('data:image/png;base64,stub'),
        );
        expect(renderPage).toHaveBeenCalledTimes(2);
        expect(renderPage.mock.calls[1]![0]).toBe(otherDoc);
    });

    it('rebuilds only when override values change, not on object identity', async () => {
        const renderPage = makeRender(fakePage());
        const { result, rerender } = renderHook(
            ({ invert }: { invert: boolean }) =>
                usePrintThumbnails({ doc, csv: null, renderPage, overrides: { invert } }),
            { initialProps: { invert: false } },
        );

        await waitFor(() =>
            expect(result.current.urlFor(0)).toBe('data:image/png;base64,stub'),
        );
        rerender({ invert: true });
        expect(result.current.urlFor(0)).toBeUndefined();
        await waitFor(() =>
            expect(result.current.urlFor(0)).toBe('data:image/png;base64,stub'),
        );
        expect(renderPage).toHaveBeenCalledTimes(2);
        expect(renderPage.mock.calls[1]![2]).toMatchObject({ invert: true });
    });

    it('forwards a grayscale page colour to the render seam', async () => {
        const renderPage = makeRender(fakePage());

        const { result } = renderHook(() =>
            usePrintThumbnails({
                doc,
                csv: null,
                overrides: { pageColor: 'grayscale' },
                renderPage,
            }),
        );

        await waitFor(() =>
            expect(result.current.urlFor(0)).toBe('data:image/png;base64,stub'),
        );
        expect(renderPage.mock.calls[0]![2]).toMatchObject({ pageColor: 'grayscale' });
    });

    it('rebuilds the cache when the page colour changes, but not for mono', async () => {
        const renderPage = makeRender(fakePage());
        const { result, rerender } = renderHook(
            ({ pageColor }: { pageColor?: 'mono' | 'grayscale' }) =>
                usePrintThumbnails({
                    doc,
                    csv: null,
                    overrides: { ...(pageColor !== undefined ? { pageColor } : {}) },
                    renderPage,
                }),
            { initialProps: {} as { pageColor?: 'mono' | 'grayscale' } },
        );

        await waitFor(() =>
            expect(result.current.urlFor(0)).toBe('data:image/png;base64,stub'),
        );

        // Absent and explicit mono append nothing to the key: the cache and its
        // resolved thumbnail survive.
        rerender({ pageColor: 'mono' });
        expect(result.current.urlFor(0)).toBe('data:image/png;base64,stub');
        expect(renderPage).toHaveBeenCalledTimes(1);

        // A real mode change drops the stale mono thumbnail and re-renders.
        rerender({ pageColor: 'grayscale' });
        expect(result.current.urlFor(0)).toBeUndefined();
        await waitFor(() =>
            expect(result.current.urlFor(0)).toBe('data:image/png;base64,stub'),
        );
        expect(renderPage).toHaveBeenCalledTimes(2);
        expect(renderPage.mock.calls[1]![2]).toMatchObject({ pageColor: 'grayscale' });
    });

    it('forwards the head clamp to the render seam', async () => {
        const renderPage = makeRender(fakePage());

        const { result } = renderHook(() =>
            usePrintThumbnails({
                doc,
                csv: null,
                overrides: { maxHeadHm: 4800 },
                renderPage,
            }),
        );

        await waitFor(() =>
            expect(result.current.urlFor(0)).toBe('data:image/png;base64,stub'),
        );
        expect(renderPage.mock.calls[0]![2]).toMatchObject({ maxHeadHm: 4800 });
        // An absent clamp is an absent key, not `undefined`.
        expect(renderPage.mock.calls[0]![2]).toHaveProperty('maxHeadHm', 4800);
    });

    it('forwards red/black tuning and rebuilds the cache when a knob changes', async () => {
        const renderPage = makeRender(fakePage());
        const { result, rerender } = renderHook(
            ({ redIntensity }: { redIntensity: number }) =>
                usePrintThumbnails({
                    doc,
                    csv: null,
                    renderPage,
                    overrides: { pageColor: 'redBlack', redBlack: { redIntensity, blackDepth: 0.5 } },
                }),
            { initialProps: { redIntensity: 1 } },
        );

        await waitFor(() =>
            expect(result.current.urlFor(0)).toBe('data:image/png;base64,stub'),
        );
        expect(renderPage.mock.calls[0]![2]).toMatchObject({
            pageColor: 'redBlack',
            redBlack: { redIntensity: 1, blackDepth: 0.5 },
        });

        // A changed knob re-renders with the new value.
        rerender({ redIntensity: 1.2 });
        expect(result.current.urlFor(0)).toBeUndefined();
        await waitFor(() =>
            expect(result.current.urlFor(0)).toBe('data:image/png;base64,stub'),
        );
        expect(renderPage).toHaveBeenCalledTimes(2);
        expect(renderPage.mock.calls[1]![2]).toMatchObject({
            redBlack: { redIntensity: 1.2, blackDepth: 0.5 },
        });

        // A fresh-but-equal overrides object keeps the cache.
        rerender({ redIntensity: 1.2 });
        expect(renderPage).toHaveBeenCalledTimes(2);
    });

    it('rebuilds the cache when the head clamp changes', async () => {
        const renderPage = makeRender(fakePage());
        const { result, rerender } = renderHook(
            ({ maxHeadHm }: { maxHeadHm?: number }) =>
                usePrintThumbnails({
                    doc,
                    csv: null,
                    overrides: { ...(maxHeadHm !== undefined ? { maxHeadHm } : {}) },
                    renderPage,
                }),
            { initialProps: {} as { maxHeadHm?: number } },
        );

        await waitFor(() =>
            expect(result.current.urlFor(0)).toBe('data:image/png;base64,stub'),
        );

        // A set clamp changes the raster: drop the stale thumbnail and re-render.
        rerender({ maxHeadHm: 4800 });
        expect(result.current.urlFor(0)).toBeUndefined();
        await waitFor(() =>
            expect(result.current.urlFor(0)).toBe('data:image/png;base64,stub'),
        );
        expect(renderPage).toHaveBeenCalledTimes(2);
        expect(renderPage.mock.calls[1]![2]).toMatchObject({ maxHeadHm: 4800 });

        // A fresh-but-equal overrides object still keeps the cache.
        rerender({ maxHeadHm: 4800 });
        expect(result.current.urlFor(0)).toBe('data:image/png;base64,stub');
        expect(renderPage).toHaveBeenCalledTimes(2);
    });
});
