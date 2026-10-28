// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createLabelDoc } from '../../core/doc/factory';
import type { LabelDoc, Node } from '../../core/doc/types';
import { rasterDimensions } from '../../core/render';
import { installCanvasShim } from '../../test/canvasHarness';
import type { RenderedLabelPage } from '../../editor/render';
import { useStore } from '../../store/useStore';
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

/** A fresh doc with one per-node screentone knob changed — what its slider writes. */
const withScreentone = (
    base: LabelDoc,
    params: NonNullable<Node['quantizerParams']>,
): LabelDoc => {
    const next = structuredClone(base);
    next.nodes[0]!.quantizerParams = params;
    return next;
};

/** A fresh doc with the node's per-node gamma changed — what the gamma knob writes. */
const withGamma = (base: LabelDoc, gamma: number): LabelDoc => {
    const next = structuredClone(base);
    next.nodes[0]!.quantizerParams = { gamma };
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
    // The base dpi resolution reads the store; seed its defaults so a test that
    // toggles the setting or the printer status cannot leak into the next one.
    useStore.setState({ usePrinterDpi: true, printerStatus: { state: 'disconnected' } });
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

describe('useQuantizedPreview — the base is the resolved print dpi', () => {
    const dpiOf = (call: number): number => (renderMock.mock.calls[call]![2] as Record<string, unknown>).dpi as number;

    it('renders at the printer-reported dpi when the setting is on and one is reported', async () => {
        // The document hints 300, the printer reports 203: the overlay is the
        // print raster, i.e. 203 dpi — and that is not an approximation.
        useStore.setState({ usePrinterDpi: true, printerStatus: { state: 'connected', dpi: 203 } });
        const doc = makeDoc();
        const { result, rerender } = mount(props(doc));
        await act(async () => {
            rerender(props(withThreshold(doc, 90)));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);

        expect(dpiOf(0)).toBe(203);
        expect(result.current.approximate).toBe(false);
    });

    it('falls back to the document dpi hint when the setting is off', async () => {
        useStore.setState({ usePrinterDpi: false, printerStatus: { state: 'connected', dpi: 203 } });
        const doc = makeDoc();
        const { rerender } = mount(props(doc));
        await act(async () => {
            rerender(props(withThreshold(doc, 90)));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);

        expect(dpiOf(0)).toBe(Math.floor(doc.label.dpi));
    });

    it('falls back to the document dpi hint when the printer reports nothing', async () => {
        // Setting on, but the connected printer has no usable dpi: use the hint.
        useStore.setState({ usePrinterDpi: true, printerStatus: { state: 'connected' } });
        const doc = makeDoc();
        const { rerender } = mount(props(doc));
        await act(async () => {
            rerender(props(withThreshold(doc, 90)));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);

        expect(dpiOf(0)).toBe(Math.floor(doc.label.dpi));
    });

    it('still applies the pixel-budget fallback below the printer base, flagged approximate', async () => {
        // Printer base 300 dpi, but 200 × 100 mm is ~2.8 M px — over the budget —
        // so the render must drop below the base and say so.
        useStore.setState({ usePrinterDpi: true, printerStatus: { state: 'connected', dpi: 300 } });
        const doc = makeDoc({ backingW: 20_000, backingH: 10_000 });
        const { result, rerender } = mount(props(doc));
        await act(async () => {
            rerender(props(withThreshold(doc, 90)));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);

        expect(dpiOf(0)).toBeLessThan(300);
        expect(result.current.approximate).toBe(true);
    });

    it('is not approximate when the rendered dpi equals a printer base below the hint', async () => {
        // The old comparison used `doc.label.dpi` (the 300 hint), so a 203 dpi
        // printer raster read as approximate even though it *is* the print raster.
        useStore.setState({ usePrinterDpi: true, printerStatus: { state: 'connected', dpi: 203 } });
        const doc = makeDoc();
        expect(doc.label.dpi).not.toBe(203);
        const { result, rerender } = mount(props(doc));
        await act(async () => {
            rerender(props(withThreshold(doc, 90)));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);

        expect(dpiOf(0)).toBe(203);
        expect(result.current.approximate).toBe(false);
    });

    it('renders at an exact fractional base without marking it approximate', async () => {
        // 203.4 must not be floored to 203 and then read as a degenerate raster:
        // the overlay is the print raster at 203.4 dpi, so `approximate` is false.
        useStore.setState({ usePrinterDpi: true, printerStatus: { state: 'connected', dpi: 203.4 } });
        const doc = makeDoc();
        const { result, rerender } = mount(props(doc));
        await act(async () => {
            rerender(props(withThreshold(doc, 90)));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);

        expect(dpiOf(0)).toBe(203.4);
        expect(result.current.approximate).toBe(false);
    });

    it('hides an overlay rendered at an old base when the resolved base changes', async () => {
        // A printer connect / `usePrinterDpi` toggle moves the base without
        // touching the document. The overlay already on screen was rendered at the
        // old base, so it must not stay up showing a stale raster.
        useStore.setState({ usePrinterDpi: true, printerStatus: { state: 'connected', dpi: 300 } });
        const doc = makeDoc();
        const { result, rerender } = mount(props(doc));
        await act(async () => {
            rerender(props(withThreshold(doc, 90)));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(result.current.active).toBe(true);
        expect(dpiOf(0)).toBe(300);

        await act(async () => {
            useStore.setState({ printerStatus: { state: 'connected', dpi: 203 } });
        });
        await flush(500);

        expect(result.current.active).toBe(false);
        // The base change alone starts no new render — it only drops the stale one.
        expect(renderMock).toHaveBeenCalledTimes(1);
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
        // D-59: the Rendering settings live behind a modal that covers the canvas,
        // so a settings edit must never *arm* a peek. The trigger key excludes the
        // settings, and a settings-only change leaves it unchanged — nothing is
        // painted here, so the changed dep only makes the non-trigger branch run.
        const doc = makeDoc();
        const { rerender } = mount(props(doc));
        await act(async () => {
            rerender(props(doc, { quantizerDefaults: { threshold: { gamma: 2 } } }));
        });
        await flush(500);
        expect(renderMock).not.toHaveBeenCalled();
    });

    it('hides a painted peek when the dither settings change, without re-rendering (D-59)', async () => {
        // A raster already on screen was planned from the previous defaults: it is
        // stale once they change. Hide it, but never start a new render (the modal
        // still covers the canvas — D-59).
        const doc = makeDoc();
        const tuned = withThreshold(doc, 90);
        const { result, rerender } = mount(props(doc));
        await act(async () => {
            rerender(props(tuned));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(result.current.active).toBe(true);

        await act(async () => {
            rerender(props(tuned, { quantizerDefaults: { threshold: { gamma: 2 } } }));
        });
        expect(result.current.active).toBe(false);
        expect(result.current.image).toBeUndefined();
        await flush(500);
        expect(result.current.active).toBe(false);
        expect(renderMock).toHaveBeenCalledTimes(1);
    });

    it('re-renders for each screentone knob (levels / pitch / angle)', async () => {
        // A screentone's screen *is* its quantization: a knob edit must re-plan.
        const knobs: NonNullable<Node['quantizerParams']>[] = [
            { screentoneLevels: 6 },
            { screentonePitchMm: 0.75 },
            { screentoneAngle: 27 },
        ];
        for (const knob of knobs) {
            renderMock.mockClear();
            const doc = makeDoc();
            const { rerender } = mount(props(doc));
            await act(async () => {
                rerender(props(withScreentone(doc, knob)));
            });
            await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
            expect(renderMock, JSON.stringify(knob)).toHaveBeenCalledTimes(1);
            cleanup();
        }
    });

    it('re-renders for a gamma-only inspector edit', async () => {
        // GitHub #3: a gamma edit leaves every other per-node field alone, so the
        // trigger key used to be unchanged and the hook took its "no tuning"
        // branch — the preview kept showing the previous dither.
        const doc = makeDoc();
        const { result, rerender } = mount(props(doc));
        await act(async () => {
            rerender(props(withGamma(doc, 1.5)));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(1);
        expect(result.current.active).toBe(true);
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

    it('does not paint a render whose dither settings changed in flight (options-key guard)', async () => {
        // The settings moved between plan and paint: the raster is from the old
        // defaults and must never replace what the canvas shows. This cannot
        // isolate `sameContent`'s `settingsKey` term — `previewOptionsKey` already
        // folds the settings in, so `latest.key !== plan.key` rejects first; the
        // term is a second line of defence (see `sameContent`).
        const doc = makeDoc();
        const tuned = withThreshold(doc, 90);
        let release: ((page: RenderedLabelPage) => void) | undefined;
        renderMock.mockImplementationOnce(
            () => new Promise<RenderedLabelPage>((resolve) => {
                release = resolve;
            }),
        );
        const { result, rerender } = mount(
            props(doc, { quantizerDefaults: { threshold: { gamma: 1 } } }),
        );
        await act(async () => {
            rerender(props(tuned, { quantizerDefaults: { threshold: { gamma: 1 } } }));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            rerender(props(tuned, { quantizerDefaults: { threshold: { gamma: 2 } } }));
        });
        const stale = makePage();
        await act(async () => {
            release?.(stale);
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(renderMock).toHaveBeenCalledTimes(1);
        expect(result.current.active).toBe(false);
        expect(result.current.image).not.toBe(stale.canvas);
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

describe('useQuantizedPreview — persistent dithered view (mode: quantized)', () => {
    const persistent = (
        doc: LabelDoc | null,
        over: Partial<UseQuantizedPreviewOptions> = {},
    ): UseQuantizedPreviewOptions => props(doc, { mode: 'quantized', ...over });

    it('renders with no selection and no inspector trigger', async () => {
        const { result } = mount(persistent(makeDoc(), { selectedNodeIds: [] }));
        expect(renderMock).not.toHaveBeenCalled();

        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(1);
        expect(result.current.active).toBe(true);
        expect(result.current.image).toBe(pages[0]!.canvas);
    });

    it('stays painted past the normal-mode idle window', async () => {
        const { result } = mount(persistent(makeDoc()));
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(result.current.active).toBe(true);

        await flush(QUANTIZED_PREVIEW_IDLE_MS * 3);
        expect(result.current.active).toBe(true);
        expect(result.current.image).toBe(pages[0]!.canvas);
        // No idle timer was ever armed, and nothing re-rendered.
        expect(renderMock).toHaveBeenCalledTimes(1);
    });

    it('re-renders on a document change', async () => {
        const doc = makeDoc();
        const edited = moved(doc);
        const { result, rerender } = mount(persistent(doc));
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            rerender(persistent(edited));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(2);
        expect(renderMock.mock.calls[1]![0]).toBe(edited);
        expect(result.current.image).toBe(pages[1]!.canvas);
    });

    it('re-renders when the dither settings change', async () => {
        // The persistent view paints at all times, so a Rendering-settings edit
        // must repaint (debounced) instead of leaving the old dither up.
        const doc = makeDoc();
        const { result, rerender } = mount(
            persistent(doc, { quantizerDefaults: { threshold: { gamma: 1 } } }),
        );
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(1);
        const optionsOf = (call: number): Record<string, unknown> =>
            renderMock.mock.calls[call]![2] as Record<string, unknown>;
        expect(optionsOf(0).quantizerDefaults).toEqual({ threshold: { gamma: 1 } });

        await act(async () => {
            rerender(persistent(doc, { quantizerDefaults: { threshold: { gamma: 2 } } }));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(2);
        expect(optionsOf(1).quantizerDefaults).toEqual({ threshold: { gamma: 2 } });
        expect(result.current.active).toBe(true);
        expect(result.current.image).toBe(pages[1]!.canvas);
    });

    it('supersedes an in-flight render when the dither settings change, then repaints once', async () => {
        // The settings change bumps the generation, so the raster planned from the
        // old defaults can never land; exactly one debounced repaint follows at the
        // new settings.
        const doc = makeDoc();
        let release: ((page: RenderedLabelPage) => void) | undefined;
        renderMock.mockImplementationOnce(
            () => new Promise<RenderedLabelPage>((resolve) => {
                release = resolve;
            }),
        );
        const { result, rerender } = mount(
            persistent(doc, { quantizerDefaults: { threshold: { gamma: 1 } } }),
        );
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(1);
        expect(result.current.active).toBe(false);

        await act(async () => {
            rerender(persistent(doc, { quantizerDefaults: { threshold: { gamma: 2 } } }));
        });
        const stale = makePage();
        await act(async () => {
            release?.(stale);
            await vi.advanceTimersByTimeAsync(0);
        });
        // Superseded mid-flight: the old raster is dropped.
        expect(result.current.image).not.toBe(stale.canvas);
        expect(result.current.active).toBe(false);

        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(2);
        const options = renderMock.mock.calls[1]![2] as Record<string, unknown>;
        expect(options.quantizerDefaults).toEqual({ threshold: { gamma: 2 } });
        expect(result.current.active).toBe(true);
        expect(result.current.image).toBe(pages[0]!.canvas);
    });

    it('does not re-render for a fresh-but-equal settings object', async () => {
        // `settingsKey` is a value: a new map literal with the same content must
        // not churn the effect (the store can re-commit an equal object).
        const doc = makeDoc();
        const { rerender } = mount(
            persistent(doc, {
                quantizerDefaults: { threshold: { gamma: 1.5 } },
                defaultQuantizerByType: { image: 'atkinson' },
            }),
        );
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            rerender(
                persistent(doc, {
                    quantizerDefaults: { threshold: { gamma: 1.5 } },
                    defaultQuantizerByType: { image: 'atkinson' },
                }),
            );
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(1);
    });

    it('hides on a document switch until the new raster lands', async () => {
        const first = makeDoc();
        const { result, rerender } = mount(persistent(first));
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(result.current.active).toBe(true);

        const second = makeDoc({ id: 'doc-2' });
        await act(async () => {
            rerender(persistent(second));
        });
        // The old document's raster must never stand in for the new one.
        expect(result.current.active).toBe(false);

        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(result.current.active).toBe(true);
        expect(renderMock.mock.calls[1]![0]).toBe(second);
        expect(result.current.image).toBe(pages[1]!.canvas);
    });

    it('does not dismiss on a tool change (revertOn)', async () => {
        const doc = makeDoc();
        const { result, rerender } = mount(persistent(doc));
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(result.current.active).toBe(true);

        await act(async () => {
            rerender(persistent(doc, { revertOn: 'shape:polygon' }));
        });
        expect(result.current.active).toBe(true);

        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        // A tool change is not content: it neither dismisses nor re-renders.
        expect(result.current.active).toBe(true);
        expect(renderMock).toHaveBeenCalledTimes(1);
    });

    it('keeps the pixel-budget approximation flag', async () => {
        // 200 × 100 mm is ~2.8 M px at 300 dpi — over the 1 M px budget.
        const { result } = mount(persistent(makeDoc({ backingW: 20_000, backingH: 10_000 })));
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(result.current.active).toBe(true);
        expect(result.current.approximate).toBe(true);
    });

    it('re-renders on a resolve-context change (the sample row moved)', async () => {
        const doc = makeDoc();
        const row = (text: string) => ({ overrides: new Map([['t1', { text, placeholder: false }]]) });
        const { result, rerender } = mount(
            persistent(doc, { selectedNodeIds: [], resolveContext: row('Ada') }),
        );
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(1);

        const next = row('Grace');
        await act(async () => {
            rerender(persistent(doc, { selectedNodeIds: [], resolveContext: next }));
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(2);
        // The latest row is what the overlay rendered.
        expect(renderMock.mock.calls[1]![1]).toBe(next);
        expect(result.current.active).toBe(true);
        expect(result.current.image).toBe(pages[1]!.canvas);
    });

    it('re-renders on a resolved base-dpi change (a printer connect)', async () => {
        useStore.setState({ usePrinterDpi: true, printerStatus: { state: 'connected', dpi: 300 } });
        const { result } = mount(persistent(makeDoc()));
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(1);
        const dpiOf = (call: number): number =>
            (renderMock.mock.calls[call]![2] as Record<string, unknown>).dpi as number;
        expect(dpiOf(0)).toBe(300);

        await act(async () => {
            useStore.setState({ printerStatus: { state: 'connected', dpi: 203 } });
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);

        // The persistent view re-plans at the new base instead of just hiding.
        expect(renderMock).toHaveBeenCalledTimes(2);
        expect(dpiOf(1)).toBe(203);
        expect(result.current.active).toBe(true);
        expect(result.current.image).toBe(pages[1]!.canvas);
    });

    it('is StrictMode-idempotent (one render per scheduling pass)', async () => {
        const { result } = renderHook(
            (p: UseQuantizedPreviewOptions) => useQuantizedPreview(p),
            { initialProps: persistent(makeDoc(), { selectedNodeIds: [] }), wrapper: StrictMode },
        );
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(renderMock).toHaveBeenCalledTimes(1);
        expect(result.current.active).toBe(true);
    });

    it('returns to normal-mode behaviour when the mode switches back', async () => {
        const doc = makeDoc();
        const { result, rerender } = mount(persistent(doc));
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 10);
        expect(result.current.active).toBe(true);

        // Normal mode with a tune trigger armed: the persistent raster is
        // dropped, and no knob change means nothing re-opens it.
        await act(async () => {
            rerender(props(doc));
        });
        expect(result.current.active).toBe(false);
        await flush(500);
        expect(result.current.active).toBe(false);
        expect(renderMock).toHaveBeenCalledTimes(1);
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
