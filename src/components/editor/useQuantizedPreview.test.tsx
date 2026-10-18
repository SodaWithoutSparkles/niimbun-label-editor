// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createLabelDoc } from '../../core/doc/factory';
import type { LabelDoc, Node } from '../../core/doc/types';
import { rasterDimensions } from '../../core/render';
import { installCanvasShim } from '../../test/canvasHarness';
import type { RenderedLabelPage } from '../../editor/render';
import {
    QUANTIZED_PREVIEW_DEBOUNCE_MS,
    QUANTIZED_PREVIEW_IDLE_MS,
    useQuantizedPreview,
    type UseQuantizedPreviewOptions,
} from './useQuantizedPreview';

/**
 * P14 W3 lifecycle: a burst of inspector knob frames coalesces into ONE render,
 * the overlay reverts on idle, a superseded render never paints, and nothing
 * quantization-irrelevant (a selection change, an unrelated edit, a settings
 * change, no selection) may open the preview.
 *
 * The raster seam is injected (`renderPage`), so these tests exercise the
 * orchestration, not the pixels. The one exception is the last block, which
 * drives the **real** `renderLabelPage` on the canvas shim to prove the wiring.
 */

const transform = { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 };

const textNode = (over: Partial<Node> = {}): Node =>
    ({
        id: 't1',
        parentId: null,
        type: 'text',
        visible: true,
        locked: false,
        transform: { ...transform },
        size: { w: 1500, h: 800 },
        text: { kind: 'static', value: 'HI' },
        fontSize: 400,
        fontFamily: 'sans-serif',
        ...over,
    }) as Node;

const makeDoc = (over: { id?: string; nodes?: Node[]; backingW?: number; backingH?: number } = {}): LabelDoc =>
    createLabelDoc({
        id: over.id ?? 'doc-1',
        now: 1_700_000_000,
        backingW: over.backingW ?? 2000,
        backingH: over.backingH ?? 1000,
        nodes: over.nodes ?? [textNode()],
    });

/** A fresh doc with the node's per-node threshold changed — what a knob drag writes. */
const withThreshold = (base: LabelDoc, threshold: number): LabelDoc => {
    const next = structuredClone(base);
    next.nodes[0]!.quantizerParams = { threshold };
    return next;
};

/** A fresh doc with an unrelated node field changed (a move). */
const moved = (base: LabelDoc): LabelDoc => {
    const next = structuredClone(base);
    next.nodes[0]!.transform = { ...next.nodes[0]!.transform, x: 700 };
    return next;
};

let pages: RenderedLabelPage[];
let renderMock: ReturnType<typeof vi.fn>;

const makePage = (): RenderedLabelPage => ({
    rgba: { data: new Uint8ClampedArray(4), width: 1, height: 1 },
    widthPx: 1,
    heightPx: 1,
    canvas: document.createElement('canvas'),
});

/** The default seam: a fresh page per call, recorded in call order. */
const page = (): RenderedLabelPage => {
    const rendered = makePage();
    pages.push(rendered);
    return rendered;
};

const props = (
    doc: LabelDoc | null,
    over: Partial<UseQuantizedPreviewOptions> = {},
): UseQuantizedPreviewOptions => ({
    doc,
    selectedNodeIds: ['t1'],
    renderPage: renderMock as unknown as UseQuantizedPreviewOptions['renderPage'],
    ...over,
});

const flush = async (ms = 0): Promise<void> => {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
};

const mount = (initialProps: UseQuantizedPreviewOptions) =>
    renderHook((p: UseQuantizedPreviewOptions) => useQuantizedPreview(p), { initialProps });

beforeEach(() => {
    vi.useFakeTimers();
    pages = [];
    renderMock = vi.fn(async () => page());
});

afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe('useQuantizedPreview — debounce and idle revert', () => {
    it('coalesces a burst of knob frames into ONE render, then reverts on idle', async () => {
        const doc = makeDoc();
        const { result, rerender } = mount(props(doc));

        for (let i = 0; i < 5; i += 1) {
            await act(async () => {
                rerender(props(withThreshold(doc, 90 + i)));
            });
            await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS - 10);
            expect(renderMock).not.toHaveBeenCalled();
        }

        await flush(20);
        expect(renderMock).toHaveBeenCalledTimes(1);
        expect(result.current.active).toBe(true);
        expect(result.current.image).toBe(pages[0]!.canvas);

        await flush(QUANTIZED_PREVIEW_IDLE_MS - 100);
        expect(result.current.active).toBe(true);
        await flush(200);
        expect(result.current.active).toBe(false);
        expect(result.current.image).toBeUndefined();
        expect(result.current.approximate).toBe(false);
    });

    it('passes the document dpi and the store dither settings to the shared path', async () => {
        const doc = makeDoc();
        const { result, rerender } = mount(
            props(doc, { quantizerDefaults: { threshold: { gamma: 1.5 } }, defaultQuantizerByType: { image: 'atkinson' } }),
        );
        await act(async () => {
            rerender(props(withThreshold(doc, 90), { quantizerDefaults: { threshold: { gamma: 1.5 } }, defaultQuantizerByType: { image: 'atkinson' } }));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);

        const options = renderMock.mock.calls[0]![2] as Record<string, unknown>;
        expect(options.dpi).toBe(Math.floor(doc.label.dpi));
        expect(options.quantizerDefaults).toEqual({ threshold: { gamma: 1.5 } });
        expect(options.defaultQuantizerByType).toEqual({ image: 'atkinson' });
        // It fit the pixel budget, so this raster *is* the print raster.
        expect(result.current.approximate).toBe(false);
    });

    it('flags the raster as approximate when the pixel budget forces a lower dpi', async () => {
        // 200 × 100 mm at 300 dpi is ~2.8 M px — over the 1 M px budget.
        const doc = makeDoc({ backingW: 20_000, backingH: 10_000 });
        const { result, rerender } = mount(props(doc));
        await act(async () => {
            rerender(props(withThreshold(doc, 90)));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);

        const options = renderMock.mock.calls[0]![2] as Record<string, unknown>;
        expect(options.dpi).toBeLessThan(doc.label.dpi);
        expect(result.current.approximate).toBe(true);

        // The idle revert clears the flag with the overlay (`setPainted(null)`):
        // it must not stay `true` for a raster that is no longer painted.
        await flush(QUANTIZED_PREVIEW_IDLE_MS + 100);
        expect(result.current.active).toBe(false);
        expect(result.current.image).toBeUndefined();
        expect(result.current.approximate).toBe(false);
    });

    it("renders with the canvas's own resolve context (the sample-row overrides)", async () => {
        const doc = makeDoc();
        const resolveContext = { overrides: new Map([['t1', { text: 'Ada', placeholder: false }]]) };
        const { rerender } = mount(props(doc, { resolveContext }));
        await act(async () => {
            rerender(props(withThreshold(doc, 90), { resolveContext }));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);

        // The domain object itself, not a copy: the same row the canvas shows.
        expect(renderMock.mock.calls[0]![1]).toBe(resolveContext);
    });
});

describe('useQuantizedPreview — only quantization-relevant changes trigger', () => {
    it('does not render on mount with a selection alone', async () => {
        mount(props(makeDoc()));
        await flush(500);
        expect(renderMock).not.toHaveBeenCalled();
    });

    it('does not render when an unrelated node field changes', async () => {
        const doc = makeDoc();
        const { result, rerender } = mount(props(doc));
        await act(async () => {
            rerender(props(moved(doc)));
        });
        await flush(500);
        expect(renderMock).not.toHaveBeenCalled();
        expect(result.current.active).toBe(false);
    });

    it('does not render with no selection, or with a multi-node selection', async () => {
        const doc = makeDoc();
        const { rerender } = mount(props(doc, { selectedNodeIds: [] }));
        await act(async () => {
            rerender(props(withThreshold(doc, 90), { selectedNodeIds: [] }));
        });
        await flush(500);
        expect(renderMock).not.toHaveBeenCalled();

        await act(async () => {
            rerender(props(withThreshold(doc, 90), { selectedNodeIds: ['t1', 't2'] }));
        });
        await flush(500);
        expect(renderMock).not.toHaveBeenCalled();
    });

    it('does not render when the per-strategy settings change (the modal case)', async () => {
        const doc = makeDoc();
        const { rerender } = mount(props(doc));
        await act(async () => {
            rerender(props(doc, { quantizerDefaults: { threshold: { gamma: 2 } } }));
        });
        await flush(500);
        expect(renderMock).not.toHaveBeenCalled();
    });

    it('baselines a newly selected node without opening a preview', async () => {
        const doc = makeDoc({ nodes: [textNode(), textNode({ id: 't2', quantizerParams: { threshold: 40 } })] });
        const { result, rerender } = mount(props(doc, { selectedNodeIds: ['t1'] }));
        await act(async () => {
            // The knob already carries a non-default value on the new node: still
            // a selection change, not a tuning gesture.
            rerender(props(doc, { selectedNodeIds: ['t2'] }));
        });
        await flush(500);
        expect(renderMock).not.toHaveBeenCalled();
        expect(result.current.active).toBe(false);
    });

    it('re-baselines on a document switch that reuses the node id', async () => {
        // A duplicated label keeps its node ids, so the same id with different
        // params in another document must not read as a tune.
        const first = makeDoc({ nodes: [textNode({ quantizerParams: { threshold: 40 } })] });
        const second = makeDoc({ id: 'doc-2', nodes: [textNode({ quantizerParams: { threshold: 200 } })] });
        const { result, rerender } = mount(props(first));
        await act(async () => {
            rerender(props(second));
        });
        await flush(500);
        expect(renderMock).not.toHaveBeenCalled();
        expect(result.current.active).toBe(false);
    });
});

describe('useQuantizedPreview — cancellation', () => {
    it('never paints a superseded render', async () => {
        const doc = makeDoc();
        let releaseFirst: ((page: RenderedLabelPage) => void) | undefined;
        renderMock.mockImplementationOnce(
            () => new Promise<RenderedLabelPage>((resolve) => {
                releaseFirst = resolve;
            }),
        );
        const { result, rerender } = mount(props(doc));

        await act(async () => {
            rerender(props(withThreshold(doc, 90)));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(1);

        // A newer change supersedes the in-flight render.
        await act(async () => {
            rerender(props(withThreshold(doc, 200)));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(2);
        const painted = result.current.image;
        expect(painted).toBe(pages[0]!.canvas);

        // The stale render lands afterwards and must be dropped.
        const stale = makePage();
        await act(async () => {
            releaseFirst?.(stale);
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(result.current.image).toBe(painted);
        expect(result.current.image).not.toBe(stale.canvas);
    });

    it('reverts on a document switch and never renders for it', async () => {
        const doc = makeDoc();
        const { result, rerender } = mount(props(doc));
        await act(async () => {
            rerender(props(withThreshold(doc, 90)));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(result.current.active).toBe(true);

        // A duplicated label keeps its node ids, so the next document's node can
        // carry a *different* param under the same id: still not a tune.
        await act(async () => {
            rerender(props(withThreshold(makeDoc({ id: 'doc-2' }), 30)));
        });
        await flush(500);
        expect(result.current.active).toBe(false);
        expect(renderMock).toHaveBeenCalledTimes(1);
    });

    it('never paints an in-flight render whose document moved on', async () => {
        const doc = makeDoc();
        let release: ((page: RenderedLabelPage) => void) | undefined;
        renderMock.mockImplementationOnce(
            () => new Promise<RenderedLabelPage>((resolve) => {
                release = resolve;
            }),
        );
        const { result, rerender } = mount(props(doc));
        await act(async () => {
            rerender(props(withThreshold(doc, 90)));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(1);

        // An unrelated edit lands while the render is running: same node, same
        // quantizer key, different document.
        const edited = moved(withThreshold(doc, 90));
        await act(async () => {
            rerender(props(edited));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        const stale = makePage();
        await act(async () => {
            release?.(stale);
            await vi.advanceTimersByTimeAsync(0);
        });
        // Superseding a render never starts a new one.
        expect(renderMock).toHaveBeenCalledTimes(1);
        expect(result.current.active).toBe(false);
        expect(result.current.image).not.toBe(stale.canvas);
    });

    it('never paints an in-flight render whose sample row moved on', async () => {
        const doc = makeDoc();
        let release: ((page: RenderedLabelPage) => void) | undefined;
        renderMock.mockImplementationOnce(
            () => new Promise<RenderedLabelPage>((resolve) => {
                release = resolve;
            }),
        );
        const row = (text: string) => ({ overrides: new Map([['t1', { text, placeholder: false }]]) });
        const { result, rerender } = mount(props(doc, { resolveContext: row('Ada') }));
        await act(async () => {
            rerender(props(withThreshold(doc, 90), { resolveContext: row('Ada') }));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(1);

        // The sample row changes (same doc, same node, same key) while rendering.
        await act(async () => {
            rerender(props(withThreshold(doc, 90), { resolveContext: row('Grace') }));
        });
        const stale = makePage();
        await act(async () => {
            release?.(stale);
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(renderMock).toHaveBeenCalledTimes(1);
        expect(result.current.active).toBe(false);
    });

    it('hides a visible overlay when an unrelated edit lands, without re-rendering', async () => {
        const doc = makeDoc();
        const { result, rerender } = mount(props(doc));
        await act(async () => {
            rerender(props(withThreshold(doc, 90)));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(result.current.active).toBe(true);

        await act(async () => {
            rerender(props(moved(withThreshold(doc, 90))));
        });
        await flush(500);
        expect(result.current.active).toBe(false);
        expect(renderMock).toHaveBeenCalledTimes(1);
    });

    it('reverts on a tool change', async () => {
        const doc = makeDoc();
        const { result, rerender } = mount(props(doc));
        await act(async () => {
            rerender(props(withThreshold(doc, 120)));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(result.current.active).toBe(true);

        await act(async () => {
            rerender(props(withThreshold(doc, 120), { revertOn: 'shape:polygon' }));
        });
        expect(result.current.active).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('drops the timers and any late render on unmount', async () => {
        const doc = makeDoc();
        let release: ((page: RenderedLabelPage) => void) | undefined;
        renderMock.mockImplementationOnce(
            () => new Promise<RenderedLabelPage>((resolve) => {
                release = resolve;
            }),
        );
        const { result, rerender, unmount } = mount(props(doc));
        await act(async () => {
            rerender(props(withThreshold(doc, 90)));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(1);

        unmount();
        expect(vi.getTimerCount()).toBe(0);
        // A late resolve must not throw and must not resurrect state.
        await act(async () => {
            release?.(page());
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(result.current.active).toBe(false);
    });

    it('is StrictMode-idempotent (one render per burst, no dropped debounce)', async () => {
        const doc = makeDoc();
        const { result, rerender } = renderHook(
            (p: UseQuantizedPreviewOptions) => useQuantizedPreview(p),
            { initialProps: props(doc), wrapper: StrictMode },
        );
        await act(async () => {
            rerender(props(withThreshold(doc, 90)));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(1);
        expect(result.current.active).toBe(true);
    });
});

describe('useQuantizedPreview — degradation', () => {
    it('shows nothing when the render fails (RangeError from the pixel cap)', async () => {
        const doc = makeDoc();
        renderMock.mockRejectedValue(new RangeError('raster too large'));
        const { result, rerender } = mount(props(doc));
        await act(async () => {
            rerender(props(withThreshold(doc, 90)));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(1);
        expect(result.current.active).toBe(false);

        // …and it clears an overlay that was already up rather than leaving it stale.
        renderMock.mockImplementation(async () => page());
        await act(async () => {
            rerender(props(withThreshold(doc, 200)));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(result.current.active).toBe(true);
        renderMock.mockRejectedValue(new RangeError('raster too large'));
        await act(async () => {
            rerender(props(withThreshold(doc, 210)));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(result.current.active).toBe(false);
    });

    it('does not even call the render when no usable dpi exists', async () => {
        const doc = makeDoc({ backingW: 4_000_000, backingH: 4_000_000 });
        const { result, rerender } = mount(props(doc));
        await act(async () => {
            rerender(props(withThreshold(doc, 90)));
        });
        await flush(500);
        expect(renderMock).not.toHaveBeenCalled();
        expect(result.current.active).toBe(false);
    });
});

describe('useQuantizedPreview — real pipeline wiring', () => {
    beforeAll(() => {
        installCanvasShim();
    });

    it(
        'renders the whole page through renderLabelPage at the document dpi',
        async () => {
            const doc = makeDoc();
            // The factory normalizes dpi; a plain 300 dpi document fits the budget.
            doc.label.dpi = 300;
            const changed = withThreshold(doc, 90);
            const { result, rerender } = mount({ doc, selectedNodeIds: ['t1'] });
            await act(async () => {
                rerender({ doc: changed, selectedNodeIds: ['t1'] });
            });
            await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);

            const image = result.current.image as HTMLCanvasElement | undefined;
            expect(image).toBeInstanceOf(HTMLCanvasElement);
            // The overlay is the exact print raster: same dpi, no approximation.
            expect(result.current.approximate).toBe(false);
            const expected = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
            expect(image!.width).toBe(expected.widthPx);
            expect(image!.height).toBe(expected.heightPx);

            // Real quantized output: every RGB channel is exactly 0 or 255 **and**
            // the triple agrees, i.e. the raster is truly 1-bit greyscale.
            const data = image!.getContext('2d')!.getImageData(0, 0, image!.width, image!.height).data;
            let ink = 0;
            for (let i = 0; i < data.length; i += 4) {
                const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
                expect([0, 255]).toContain(r);
                expect([0, 255]).toContain(g);
                expect([0, 255]).toContain(b);
                expect(g).toBe(r);
                expect(b).toBe(r);
                if (r === 0) ink += 1;
            }
            expect(ink).toBeGreaterThan(0);
        },
        30_000,
    );

    it(
        'resolves the sample-row overrides the canvas shows, not the fallbacks',
        async () => {
            // A csv-backed text node: the fallback says "FB", the row says a long
            // string — so the resolved ink differs measurably between the two.
            const base = makeDoc({
                nodes: [textNode({ text: { kind: 'csv', column: 'name', fallback: 'FB' } })],
            });
            const tuned = structuredClone(base);
            tuned.nodes[0]!.quantizerParams = { threshold: 90 };
            const overrides = new Map([
                ['t1', { text: 'ADA LOVELACE 1815-1852', placeholder: false }],
            ]);

            const inkWith = async (resolveContext?: { overrides: typeof overrides }) => {
                const { result, rerender } = mount({ doc: base, selectedNodeIds: ['t1'], resolveContext });
                await act(async () => {
                    rerender({ doc: tuned, selectedNodeIds: ['t1'], resolveContext });
                });
                await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
                const image = result.current.image as HTMLCanvasElement;
                expect(image).toBeInstanceOf(HTMLCanvasElement);
                const data = image.getContext('2d')!.getImageData(0, 0, image.width, image.height).data;
                let ink = 0;
                for (let i = 0; i < data.length; i += 4) if (data[i] === 0) ink += 1;
                cleanup();
                return ink;
            };

            // The row the canvas is showing must change the raster; the fallback
            // path must not be what the overlay prints.
            const withRow = await inkWith({ overrides });
            const fallbackOnly = await inkWith(undefined);
            expect(withRow).not.toBe(fallbackOnly);
            expect(fallbackOnly).toBeGreaterThan(0);
        },
        60_000,
    );
});
