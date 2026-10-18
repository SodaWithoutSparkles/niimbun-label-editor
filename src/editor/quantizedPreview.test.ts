// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createLabelDoc } from '../core/doc/factory';
import type { Node } from '../core/doc/types';
import { rasterDimensions } from '../core/render';
import { MAX_RASTER_PIXELS } from './render/renderLabelPage';
import {
    QUANTIZED_PREVIEW_DPI_CAP,
    QUANTIZED_PREVIEW_MAX_PIXELS,
    QUANTIZED_PREVIEW_MIN_DPI,
    quantizedPreviewDpi,
    quantizedPreviewOptions,
    quantizedPreviewTrigger,
} from './quantizedPreview';

/**
 * P14 W3 pure policy: what counts as "tuning" (the trigger key) and how much
 * raster the live preview may pay for (the dpi cap + the `MAX_RASTER_PIXELS`
 * degradation). The lifecycle — debounce, supersede, idle revert — is covered by
 * `components/editor/useQuantizedPreview.test.tsx`.
 *
 * happy-dom (not node): the module reads `MAX_RASTER_PIXELS` from
 * `renderLabelPage`, whose module graph loads Konva.
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
        size: { w: 1000, h: 500 },
        text: { kind: 'static', value: 'hi' },
        ...over,
    }) as Node;

const makeDoc = (over: { dpi?: number; backingW?: number; backingH?: number } = {}) => {
    const doc = createLabelDoc({
        id: 'doc-1',
        now: 1_700_000_000,
        backingW: over.backingW ?? 2000,
        backingH: over.backingH ?? 1000,
    });
    // The factory normalizes dpi (50 → 100, 0/NaN → a default), so a hostile
    // value is applied after it: the policy must stay defensive about whatever
    // reaches it from a parsed document.
    if (over.dpi !== undefined) doc.label.dpi = over.dpi;
    return doc;
};

describe('quantizedPreviewDpi — the cost cap', () => {
    it('caps a high document dpi at the preview cap', () => {
        expect(quantizedPreviewDpi(makeDoc({ dpi: 300 }))).toBe(QUANTIZED_PREVIEW_DPI_CAP);
        expect(quantizedPreviewDpi(makeDoc({ dpi: 203 }))).toBe(QUANTIZED_PREVIEW_DPI_CAP);
    });

    it('never raises a low document dpi', () => {
        expect(quantizedPreviewDpi(makeDoc({ dpi: 50 }))).toBe(50);
    });

    it('rejects a document dpi that cannot be rendered at all', () => {
        expect(quantizedPreviewDpi(makeDoc({ dpi: 0 }))).toBe(0);
        expect(quantizedPreviewDpi(makeDoc({ dpi: Number.NaN }))).toBe(0);
    });

    it('lowers the dpi until the raster fits the preview pixel budget', () => {
        // A 1 m × 1 m backing at the preview cap is ~35 M px — 35× the budget.
        const doc = makeDoc({ dpi: 300, backingW: 100_000, backingH: 100_000 });
        const dpi = quantizedPreviewDpi(doc);
        expect(dpi).toBeGreaterThan(0);
        expect(dpi).toBeLessThanOrEqual(QUANTIZED_PREVIEW_DPI_CAP);
        const { widthPx, heightPx } = rasterDimensions(doc.label.backingW, doc.label.backingH, dpi);
        // The whole point: the value handed to `renderLabelPage` fits the preview
        // budget (and therefore the pipeline's own `MAX_RASTER_PIXELS`).
        expect(widthPx * heightPx).toBeLessThanOrEqual(QUANTIZED_PREVIEW_MAX_PIXELS);
        expect(widthPx * heightPx).toBeLessThanOrEqual(MAX_RASTER_PIXELS);
    });

    it('keeps the full preview dpi for real label sizes', () => {
        // 40 × 30 mm (the default) and 100 × 150 mm both fit the budget at 150 dpi,
        // so the budget must not degrade the everyday case.
        for (const [w, h] of [
            [4000, 3000],
            [10_000, 15_000],
        ] as const) {
            expect(quantizedPreviewDpi(makeDoc({ dpi: 300, backingW: w, backingH: h }))).toBe(
                QUANTIZED_PREVIEW_DPI_CAP,
            );
        }
    });

    it('keeps going past four reductions instead of suppressing a renderable preview', () => {
        // A degenerate axis: the height rounds to a single pixel, so the raster is
        // ~linear in dpi rather than dpi² and the candidates converge one step at a
        // time — 150 → 122 → 110 → 104 → 101 → 100. A fixed attempt cap returned 0
        // here, i.e. it silently dropped a preview that *is* renderable.
        const backingW = 25_400_000;
        const backingH = 1;
        const doc = makeDoc({ dpi: 300, backingW, backingH });
        const pixelsAt = (dpi: number): number => {
            const { widthPx, heightPx } = rasterDimensions(backingW, backingH, dpi);
            return widthPx * heightPx;
        };

        // The fourth candidate still exceeds the budget: the old cap gave up here.
        expect(pixelsAt(101)).toBeGreaterThan(QUANTIZED_PREVIEW_MAX_PIXELS);

        const dpi = quantizedPreviewDpi(doc);
        expect(dpi).toBeGreaterThan(0);
        expect(dpi).toBeLessThanOrEqual(QUANTIZED_PREVIEW_DPI_CAP);
        expect(pixelsAt(dpi)).toBeLessThanOrEqual(QUANTIZED_PREVIEW_MAX_PIXELS);
    });

    it('gives up (0) rather than returning an unusable dpi', () => {
        // Even the minimum dpi blows the pixel cap at this size.
        const doc = makeDoc({ backingW: 4_000_000, backingH: 4_000_000 });
        const atMin = rasterDimensions(doc.label.backingW, doc.label.backingH, QUANTIZED_PREVIEW_MIN_DPI);
        expect(atMin.widthPx * atMin.heightPx).toBeGreaterThan(MAX_RASTER_PIXELS);
        expect(quantizedPreviewDpi(doc)).toBe(0);
    });
});

describe('quantizedPreviewTrigger — what counts as tuning', () => {
    it('is null without a node', () => {
        expect(quantizedPreviewTrigger(undefined)).toBeNull();
    });

    it('keys the hint and every per-node param', () => {
        const base = quantizedPreviewTrigger(textNode());
        expect(base).not.toBeNull();
        expect(quantizedPreviewTrigger(textNode({ quantizerHint: 'floydSteinberg' }))?.key).not.toBe(base?.key);
        expect(quantizedPreviewTrigger(textNode({ quantizerParams: { threshold: 90 } }))?.key).not.toBe(base?.key);
        expect(quantizedPreviewTrigger(textNode({ quantizerParams: { strength: 2 } }))?.key).not.toBe(base?.key);
        expect(quantizedPreviewTrigger(textNode({ quantizerParams: { serpentine: false } }))?.key).not.toBe(base?.key);
    });

    it('is stable when an unrelated node field changes', () => {
        const base = quantizedPreviewTrigger(textNode({ quantizerParams: { threshold: 90 } }));
        const moved = quantizedPreviewTrigger(
            textNode({
                quantizerParams: { threshold: 90 },
                transform: { x: 500, y: 900, rotDeg: 45, scaleX: 1, scaleY: 1 },
                visible: false,
            }),
        );
        expect(moved?.key).toBe(base?.key);
        expect(moved?.nodeId).toBe(base?.nodeId);
    });

    it('reports the node id so a selection change can be told from a tune', () => {
        expect(quantizedPreviewTrigger(textNode({ id: 'a' }))?.nodeId).toBe('a');
        expect(quantizedPreviewTrigger(textNode({ id: 'b' }))?.nodeId).toBe('b');
    });
});

describe('quantizedPreviewOptions', () => {
    it('returns null when the dpi cannot be rendered', () => {
        expect(quantizedPreviewOptions(makeDoc({ dpi: 0 }))).toBeNull();
    });

    it('threads the capped dpi and the store dither settings into the render options', () => {
        const doc = makeDoc({ dpi: 300 });
        const options = quantizedPreviewOptions(doc, undefined, { threshold: { gamma: 1.5 } }, { image: 'atkinson' });
        expect(options).not.toBeNull();
        expect(options?.dpi).toBe(QUANTIZED_PREVIEW_DPI_CAP);
        expect(options?.quantizerDefaults).toEqual({ threshold: { gamma: 1.5 } });
        expect(options?.defaultQuantizerByType).toEqual({ image: 'atkinson' });
        // The editor canvas shows the logical orientation: no print override may
        // leak into the preview.
        expect(options?.invert).toBeUndefined();
        expect(options?.mirror).toBeUndefined();
        expect(options?.offset).toBeUndefined();
    });
});
