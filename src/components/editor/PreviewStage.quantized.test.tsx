// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import Konva from 'konva';
import '../../i18n';
import { installCanvasShim } from '../../test/canvasHarness';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import type { Node } from '../../core/doc/types';
import { SampleRowContext } from './sampleRowContext';
import { QUANTIZED_PREVIEW_DEBOUNCE_MS, QUANTIZED_PREVIEW_IDLE_MS } from './useQuantizedPreview';
import { PreviewStage } from './PreviewStage';

/**
 * P14 W3 wiring, mounted for real: tuning a per-node quantizer knob in the
 * inspector paints the printed raster over the label (a `listening={false}`
 * Konva layer, i.e. the editor stays interactive underneath) with an i18n'd
 * chip, and both revert after the idle timeout.
 *
 * The edit is driven exactly the way `ObjectTab`'s knobs drive it —
 * `updateNodeTransient` — so this covers the store → trigger → overlay path
 * end-to-end, including the "never mutate the document / never push undo" rule
 * (the transient patch is the *test's* edit, not the preview's).
 */

beforeAll(() => {
    installCanvasShim();
    // happy-dom has no layout: without a pane box the fit zoom collapses.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
});

const textNode = (over: Partial<Node> = {}): Node =>
    ({
        id: 't1',
        parentId: null,
        type: 'text',
        visible: true,
        locked: false,
        transform: { x: 100, y: 100, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 1500, h: 800 },
        text: { kind: 'static', value: 'HI' },
        fontSize: 400,
        fontFamily: 'sans-serif',
        ...over,
    }) as Node;

const makeDoc = (): ReturnType<typeof createLabelDoc> =>
    createLabelDoc({
        id: 'doc-1',
        now: 1_700_000_000,
        backingW: 2000,
        backingH: 1000,
        nodes: [textNode()],
    });

const mount = (): Konva.Stage => {
    useStore.setState({
        view: 'editor',
        currentDoc: makeDoc(),
        selectedNodeIds: ['t1'],
        activeTool: 'select',
        snapEnabled: false,
    });
    render(<PreviewStage />);
    const stage = Konva.stages[Konva.stages.length - 1];
    if (!stage) throw new Error('PreviewStage did not mount a Konva stage');
    return stage;
};

const flush = async (ms = 0): Promise<void> => {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
};

/** Type the way the inspector's threshold knob commits it. */
const tuneThreshold = (threshold: number): Promise<void> =>
    act(async () => {
        useStore.getState().updateNodeTransient('t1', { quantizerParams: { threshold } });
    });

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    useStore.setState({ currentDoc: null, selectedNodeIds: [], activeTool: 'select' });
});

describe('PreviewStage — live quantized preview', () => {
    it('paints the printed raster with a chip while tuning, and reverts on idle', async () => {
        const stage = mount();
        const baseLayers = stage.getLayers().length;
        expect(screen.queryByTestId('quantized-preview-chip')).toBeNull();

        await tuneThreshold(90);
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 50);

        const chip = screen.getByTestId('quantized-preview-chip');
        expect(chip).toHaveTextContent('Quantized preview');
        // Never a hit target: the editor stays fully interactive underneath.
        expect(chip.className).toContain('pointer-events-none');

        const layers = stage.getLayers();
        expect(layers.length).toBe(baseLayers + 1);
        const overlay = layers[layers.length - 1]!;
        expect(overlay.listening()).toBe(false);
        const image = overlay.findOne('Image');
        expect(image).not.toBeUndefined();
        expect(image!.width()).toBe(2000);
        expect(image!.height()).toBe(1000);

        await flush(QUANTIZED_PREVIEW_IDLE_MS + 100);
        expect(screen.queryByTestId('quantized-preview-chip')).toBeNull();
        expect(stage.getLayers().length).toBe(baseLayers);
    });

    it('never mutates the document and never pushes an undo entry', async () => {
        const stage = mount();
        const undoBefore = useStore.getState().docPast.length;

        await tuneThreshold(90);
        const docAfterEdit = useStore.getState().currentDoc;
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 50);
        expect(stage.getLayers().length).toBeGreaterThan(1); // the overlay is up
        await flush(QUANTIZED_PREVIEW_IDLE_MS + 100);

        // The preview only reads: no undo entry, no doc rewrite, params intact.
        expect(useStore.getState().docPast.length).toBe(undoBefore);
        expect(useStore.getState().currentDoc).toBe(docAfterEdit);
        expect(useStore.getState().currentDoc?.nodes[0]?.quantizerParams).toEqual({ threshold: 90 });
    });

    it('does not open the preview for an unrelated edit or a bare selection', async () => {
        const stage = mount();
        expect(stage.getLayers().length).toBe(2);

        await act(async () => {
            useStore.getState().updateNodeTransient('t1', { transform: { x: 500, y: 100, rotDeg: 0, scaleX: 1, scaleY: 1 } });
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 50);
        expect(screen.queryByTestId('quantized-preview-chip')).toBeNull();
        expect(stage.getLayers().length).toBe(2);

        await act(async () => {
            useStore.setState({ selectedNodeIds: [] });
        });
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 50);
        expect(screen.queryByTestId('quantized-preview-chip')).toBeNull();
    });

    it('reverts when the tool changes', async () => {
        const stage = mount();
        await tuneThreshold(90);
        await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 50);
        expect(screen.getByTestId('quantized-preview-chip')).toBeTruthy();

        await act(async () => {
            useStore.setState({ activeTool: 'shape:polygon' });
        });
        expect(screen.queryByTestId('quantized-preview-chip')).toBeNull();
        expect(stage.getLayers().length).toBe(2);
    });

    it('prints the sample row the canvas resolves, not the static fallback', async () => {
        // The node is csv-backed with fallback "FB": the row the canvas shows must
        // reach the overlay's render too, otherwise the overlay prints a page the
        // user is not looking at (review finding 1).
        const row = new Map([['t1', { text: 'ADA LOVELACE 1815-1852', placeholder: false }]]);

        const inkWith = async (withRow: boolean): Promise<number> => {
            useStore.setState({
                view: 'editor',
                currentDoc: createLabelDoc({
                    id: 'doc-1',
                    now: 1_700_000_000,
                    backingW: 2000,
                    backingH: 1000,
                    nodes: [textNode({ text: { kind: 'csv', column: 'name', fallback: 'FB' } })],
                }),
                selectedNodeIds: ['t1'],
                activeTool: 'select',
                snapEnabled: false,
            });
            const view = render(
                withRow ? (
                    <SampleRowContext.Provider
                        value={{
                            overrides: row,
                            trust: 'always',
                            blocked: false,
                            needsApproval: false,
                            globalWarnings: [],
                            templateErrors: new Map(),
                            rowCount: 1,
                            error: null,
                        }}
                    >
                        <PreviewStage />
                    </SampleRowContext.Provider>
                ) : (
                    <PreviewStage />
                ),
            );
            const stage = Konva.stages[Konva.stages.length - 1]!;
            await tuneThreshold(90);
            await flush(QUANTIZED_PREVIEW_DEBOUNCE_MS + 50);

            const layers = stage.getLayers();
            expect(layers.length).toBe(3); // overlays + content + the quantized overlay
            const image = layers[layers.length - 1]!.findOne('Image') as Konva.Image;
            const canvas = image.image() as HTMLCanvasElement;
            const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
            let ink = 0;
            for (let i = 0; i < data.length; i += 4) if (data[i] === 0) ink += 1;
            view.unmount();
            cleanup();
            return ink;
        };

        const withRow = await inkWith(true);
        const fallbackOnly = await inkWith(false);
        expect(fallbackOnly).toBeGreaterThan(0);
        expect(withRow).not.toBe(fallbackOnly);
    });
});
