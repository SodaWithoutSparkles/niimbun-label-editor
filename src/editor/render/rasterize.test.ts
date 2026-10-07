// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import Konva from 'konva';
import { installCanvasShim } from '../../test/canvasHarness';
import { createLabelDoc } from '../../core/doc/factory';
import type { LabelDoc, Node } from '../../core/doc/types';
import { rasterDimensions } from '../../core/render';
import { resolve } from './resolve';
import { rasterizeResolved } from './rasterize';
import { createKonvaNode } from './konvaFactory';

beforeAll(() => {
    installCanvasShim();
});

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const smallDoc = (nodes?: Node[]): LabelDoc =>
    createLabelDoc({
        backingW: 3000,
        backingH: 2000,
        dpi: 300,
        regions: [{ kind: 'rect', x: 0, y: 0, w: 3000, h: 2000 }],
        nodes:
            nodes ??
            [
                node({
                    id: 't',
                    parentId: null,
                    type: 'text',
                    visible: true,
                    locked: false,
                    transform: { x: 100, y: 200, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    text: { kind: 'static', value: 'Hi' },
                    size: { w: 2000, h: 600 },
                    fontSize: 400,
                }),
                node({
                    id: 'r',
                    parentId: null,
                    type: 'shape',
                    shape: 'rectangle',
                    visible: true,
                    locked: false,
                    transform: { x: 200, y: 1000, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    size: { w: 800, h: 600 },
                    // Explicit black so this remains an ink source regardless of
                    // the (transparent) shape-style default.
                    fill: '#000000',
                }),
                node({
                    id: 'e',
                    parentId: null,
                    type: 'shape',
                    shape: 'ellipse',
                    visible: true,
                    locked: false,
                    transform: { x: 1600, y: 400, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    size: { w: 800, h: 400 },
                    fill: '#000000',
                }),
            ],
    });

const rgbaPixel = (data: Uint8ClampedArray, width: number, x: number, y: number): number[] => {
    const i = (y * width + x) * 4;
    return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
};

describe('rasterizeResolved — offscreen Konva on a real canvas', () => {
    it('sizes the raster exactly to rasterDimensions and paints a white background', async () => {
        const doc = smallDoc();
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const raster = await rasterizeResolved(resolve(doc), { ...dims, dpi: doc.label.dpi });

        expect(raster.imageData.width).toBe(dims.widthPx);
        expect(raster.imageData.height).toBe(dims.heightPx);
        expect(raster.widthPx).toBe(dims.widthPx);
        expect(raster.heightPx).toBe(dims.heightPx);
        expect(raster.imageData.data.length).toBe(dims.widthPx * dims.heightPx * 4);
        expect(rgbaPixel(raster.imageData.data, dims.widthPx, 1, 1)).toEqual([255, 255, 255, 255]);
    });

    it('renders real ink for rectangle, ellipse, and text', async () => {
        const doc = smallDoc();
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const { imageData } = await rasterizeResolved(resolve(doc), { ...dims, dpi: doc.label.dpi });

        // scale = 300/2540; rect spans hm x 200..1000, y 1000..1600.
        const sx = 300 / 2540;
        const rectX = Math.round(600 * sx);
        const rectY = Math.round(1300 * sx);
        const rectPixel = rgbaPixel(imageData.data, dims.widthPx, rectX, rectY);
        expect(rectPixel[0], 'rect interior is dark').toBeLessThan(64);

        const ellipseX = Math.round(1600 * sx);
        const ellipseY = Math.round(400 * sx);
        const ellipsePixel = rgbaPixel(imageData.data, dims.widthPx, ellipseX, ellipseY);
        expect(ellipsePixel[0], 'ellipse centre is dark').toBeLessThan(64);

        let dark = 0;
        for (let i = 0; i < imageData.data.length; i += 4) {
            if (imageData.data[i]! < 128) dark++;
        }
        expect(dark, 'text + shapes produce ink').toBeGreaterThan(100);
    });

    it('renders non-blank text headlessly', async () => {
        const doc = smallDoc([
            node({
                id: 't',
                parentId: null,
                type: 'text',
                visible: true,
                locked: false,
                transform: { x: 100, y: 200, rotDeg: 0, scaleX: 1, scaleY: 1 },
                text: { kind: 'static', value: 'W2 raster' },
                size: { w: 2500, h: 800 },
                fontSize: 500,
            }),
        ]);
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const { imageData } = await rasterizeResolved(resolve(doc), { ...dims, dpi: doc.label.dpi });

        let dark = 0;
        for (let i = 0; i < imageData.data.length; i += 4) {
            if (imageData.data[i]! < 128) dark++;
        }
        expect(dark).toBeGreaterThan(0);
    });

    it('renders a visible line from the resolved hm stroke width', async () => {
        const doc = smallDoc([
            node({
                id: 'l',
                parentId: null,
                type: 'shape',
                shape: 'line',
                visible: true,
                locked: false,
                transform: { x: 200, y: 300, rotDeg: 0, scaleX: 1, scaleY: 1 },
                points: [[0, 0], [2000, 1000]],
                closed: false,
            }),
        ]);
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const { imageData } = await rasterizeResolved(resolve(doc), { ...dims, dpi: doc.label.dpi });

        let dark = 0;
        for (let i = 0; i < imageData.data.length; i += 4) {
            if (imageData.data[i]! < 128) dark++;
        }
        expect(dark, 'the line rasterizes as real ink').toBeGreaterThan(20);
    });

    it('honours an explicit closed-shape stroke width at raster scale (#8)', async () => {
        const doc = smallDoc([
            node({
                id: 'r',
                parentId: null,
                type: 'shape',
                shape: 'rectangle',
                visible: true,
                locked: false,
                transform: { x: 500, y: 500, rotDeg: 0, scaleX: 1, scaleY: 1 },
                size: { w: 1000, h: 1000 },
                fill: '#ffffff',
                stroke: '#000000',
                strokeWidth: 100, // 1 mm — clearly visible
            }),
        ]);
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const { imageData } = await rasterizeResolved(resolve(doc), { ...dims, dpi: doc.label.dpi });

        let dark = 0;
        for (let i = 0; i < imageData.data.length; i += 4) {
            if (imageData.data[i]! < 128) dark++;
        }
        expect(dark, 'the explicit stroke rasterizes as ink').toBeGreaterThan(20);
    });

    it('prints an open line at the resolved hm stroke width (BLOCKER 1: preview ≡ print)', async () => {
        // A horizontal open line with an explicit 1 mm stroke. The print path
        // must interpret `strokeWidth` in hm and scale it by the raster scale
        // (`dpi / HM_PER_INCH`), exactly as the preview scales it by zoom — no
        // device-px override. The ink band height therefore ≈ scale × width px.
        const strokeWidth = 100; // 1 mm
        const doc = smallDoc([
            node({
                id: 'l',
                parentId: null,
                type: 'shape',
                shape: 'line',
                visible: true,
                locked: false,
                transform: { x: 100, y: 1000, rotDeg: 0, scaleX: 1, scaleY: 1 },
                points: [[0, 0], [2000, 0]],
                closed: false,
                stroke: '#000000',
                strokeWidth,
            }),
        ]);
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const resolved = resolve(doc);
        const { imageData } = await rasterizeResolved(resolved, { ...dims, dpi: doc.label.dpi });

        const scale = doc.label.dpi / 2540; // hm → px
        const expectedPx = scale * strokeWidth; // ≈ 11.8 px at 300 dpi
        const x = Math.round(1000 * scale); // mid-line, away from the caps

        let band = 0;
        for (let y = 0; y < dims.heightPx; y++) {
            const i = (y * dims.widthPx + x) * 4;
            if (imageData.data[i]! < 128) band++;
        }
        // Allow ±2 px for antialiasing at the band edges.
        expect(band, 'ink band height matches dpi/HM_PER_INCH × strokeWidth').toBeGreaterThanOrEqual(
            Math.floor(expectedPx) - 2,
        );
        expect(band).toBeLessThanOrEqual(Math.ceil(expectedPx) + 2);

        // Preview reads the same resolved value the print path scales.
        const printed = createKonvaNode(resolved[0]!) as Konva.Line;
        expect(printed.strokeWidth()).toBe(strokeWidth);
        expect(printed.strokeScaleEnabled(), 'no device-px override in print').toBe(true);
    });

    it('default 50 hm stroke is visible at 300 dpi (owner-flagged, #8)', async () => {
        // 50 hm = 0.5 mm → 300 × 0.5 / 25.4 ≈ 5.9 px. A default-styled closed
        // shape has `'transparent'` fill, so its stroke is the only ink; the
        // resolved default width must be large enough to deposit some.
        const doc = smallDoc([
            node({
                id: 'r',
                parentId: null,
                type: 'shape',
                shape: 'rectangle',
                visible: true,
                locked: false,
                transform: { x: 500, y: 500, rotDeg: 0, scaleX: 1, scaleY: 1 },
                size: { w: 1000, h: 1000 },
            }),
        ]);
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const { imageData } = await rasterizeResolved(resolve(doc), { ...dims, dpi: doc.label.dpi });

        let dark = 0;
        for (let i = 0; i < imageData.data.length; i += 4) {
            if (imageData.data[i]! < 128) dark++;
        }
        expect(dark, 'default 50 hm stroke deposits ink at 300 dpi').toBeGreaterThan(0);
    });

    it('stays widthPx×heightPx and identical at devicePixelRatio 2 (A)', async () => {
        const doc = smallDoc();
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const options = { ...dims, dpi: doc.label.dpi };
        const baseline = await rasterizeResolved(resolve(doc), options);

        const previous = Konva.pixelRatio;
        Konva.pixelRatio = 2;
        try {
            const scaled = await rasterizeResolved(resolve(doc), options);
            expect(scaled.imageData.width).toBe(dims.widthPx);
            expect(scaled.imageData.height).toBe(dims.heightPx);
            expect(scaled.imageData.data).toEqual(baseline.imageData.data);
        } finally {
            Konva.pixelRatio = previous;
        }
    });
});
