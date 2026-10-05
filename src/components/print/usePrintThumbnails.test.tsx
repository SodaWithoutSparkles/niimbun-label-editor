import { afterEach, describe, expect, it, vi } from 'vitest';
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

const fakePage = (notices?: RenderNotice[]): RenderedLabelPage =>
    ({
        rgba: { data: new Uint8ClampedArray(4), width: 1, height: 1 },
        widthPx: 1,
        heightPx: 1,
        canvas: {
            toDataURL: () => 'data:image/png;base64,stub',
        } as unknown as HTMLCanvasElement,
        ...(notices ? { notices } : {}),
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
    it('renders a row through the shared path at 50 dpi and resolves its data URL', async () => {
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
            dpi: 50,
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
});
