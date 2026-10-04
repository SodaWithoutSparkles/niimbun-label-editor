import { beforeAll, describe, expect, it } from 'vitest';
import Konva from 'konva';
import { installCanvasShim } from '../../test/canvasHarness';
import { createLabelDoc } from '../../core/doc/factory';
import { nodeLookup } from '../../core/doc/derive';
import type { LabelDoc, Node, Region } from '../../core/doc/types';
import {
    MonoColorSpace,
    floydSteinberg,
    quantizeRgba,
    rasterDimensions,
    threshold,
    type RgbaBuffer,
} from '../../core/render';
import { applyRegionClip } from './clip';
import { buildPolicyMask, renderLabelPage } from './renderLabelPage';
import { resolve } from './resolve';
import { rasterizeResolved } from './rasterize';

beforeAll(() => {
    installCanvasShim();
});

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const text = (id: string, x: number, y: number, value: string): Node =>
    node({
        id,
        parentId: null,
        type: 'text',
        visible: true,
        locked: false,
        transform: { x, y, rotDeg: 0, scaleX: 1, scaleY: 1 },
        text: { kind: 'static', value },
        size: { w: 2000, h: 600 },
        fontSize: 400,
    });

const rect = (id: string, x: number, y: number, w: number, h: number, hint?: string): Node =>
    node({
        id,
        parentId: null,
        type: 'shape',
        shape: 'rectangle',
        visible: true,
        locked: false,
        transform: { x, y, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w, h },
        ...(hint ? { quantizerHint: hint } : {}),
    });

const ellipse = (id: string, cx: number, cy: number, w: number, h: number): Node =>
    node({
        id,
        parentId: null,
        type: 'shape',
        shape: 'ellipse',
        visible: true,
        locked: false,
        transform: { x: cx, y: cy, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w, h },
    });

const smallDoc = (regions: Region[], nodes: Node[]): LabelDoc =>
    createLabelDoc({ backingW: 3000, backingH: 2000, dpi: 300, regions, nodes });

const leftHalfRegions: Region[] = [{ kind: 'rect', x: 0, y: 0, w: 1500, h: 2000 }];

const smallNodes = (): Node[] => [
    text('t', 100, 200, 'Hi'),
    rect('r', 200, 1000, 800, 600),
    ellipse('e', 700, 400, 800, 400),
];

const pixelAt = (rgba: RgbaBuffer, x: number, y: number): number[] => {
    const i = (y * rgba.width + x) * 4;
    return [rgba.data[i]!, rgba.data[i + 1]!, rgba.data[i + 2]!, rgba.data[i + 3]!];
};

const isWhite = (rgba: RgbaBuffer, x: number, y: number): boolean => {
    const p = pixelAt(rgba, x, y);
    return p[0] === 255 && p[1] === 255 && p[2] === 255 && p[3] === 255;
};

const grayGradient = (width: number, height: number): RgbaBuffer => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const v = Math.round((x / (width - 1)) * 255);
            const i = (y * width + x) * 4;
            data[i] = v;
            data[i + 1] = v;
            data[i + 2] = v;
            data[i + 3] = 255;
        }
    }
    return { data, width, height };
};

describe('renderLabelPage — shared preview/print path', () => {
    it('raster dimensions match rasterDimensions', async () => {
        const doc = smallDoc(leftHalfRegions, smallNodes());
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const page = await renderLabelPage(doc);
        expect(page.widthPx).toBe(dims.widthPx);
        expect(page.heightPx).toBe(dims.heightPx);
        expect(page.rgba.width).toBe(dims.widthPx);
        expect(page.rgba.height).toBe(dims.heightPx);
    });

    it('renders ink inside the union and blanks everything outside it', async () => {
        const doc = smallDoc(leftHalfRegions, smallNodes());
        const page = await renderLabelPage(doc);
        const sx = 300 / 2540;
        const unionRightPx = Math.round(1500 * sx); // 177

        const rectPixel = pixelAt(page.rgba, Math.round(600 * sx), Math.round(1300 * sx));
        expect(rectPixel[0], 'rect interior is black ink').toBe(0);

        let darkInside = 0;
        let darkOutside = 0;
        for (let y = 0; y < page.heightPx; y++) {
            for (let x = 0; x < page.widthPx; x++) {
                if (isWhite(page.rgba, x, y)) continue;
                if (x <= unionRightPx) darkInside++;
                else darkOutside++;
            }
        }
        expect(darkInside).toBeGreaterThan(100);
        expect(darkOutside, 'no ink outside the union').toBe(0);
    });

    // Preview ≡ print is met **by construction**: the print path
    // (`src/print/printLabel.ts`) consumes the same `renderLabelPage` Rasterized
    // page, there is no second render entry point. These pin determinism.
    it('is deterministic across calls', async () => {
        const doc = smallDoc(leftHalfRegions, smallNodes());
        const a = await renderLabelPage(doc);
        const b = await renderLabelPage(doc);
        expect(a.rgba.data).toEqual(b.rgba.data);
    });

    it('is deterministic across calls for a doc carrying policy hints', async () => {
        const doc = createLabelDoc({
            backingW: 4000,
            backingH: 2000,
            dpi: 254,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 4000, h: 2000 }],
            nodes: [rect('under', 0, 0, 3000, 2000, 'threshold'), rect('over', 1000, 0, 3000, 2000, 'floydSteinberg')],
        });
        const a = await renderLabelPage(doc);
        const b = await renderLabelPage(doc);
        expect(a.rgba.data).toEqual(b.rgba.data);
    });

    it('no hints ⇒ no policy mask and exactly one global pass', async () => {
        const doc = smallDoc(leftHalfRegions, [rect('r', 200, 1000, 800, 600), ellipse('e', 700, 400, 800, 400)]);
        const nodes = resolve(doc);
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        expect(await buildPolicyMask(nodes, nodeLookup(doc.nodes), dims, doc.label.dpi)).toBeUndefined();

        const page = await renderLabelPage(doc);

        // Independent global-only pass over the same raster (pre- and post-clip).
        const raster = await rasterizeResolved(nodes, { ...dims, dpi: doc.label.dpi });
        applyRegionClip(raster.imageData, dims, doc.label.regions, 2540 / doc.label.dpi);
        quantizeRgba(raster.imageData, { globalQuantizer: threshold, colorSpace: MonoColorSpace });
        applyRegionClip(raster.imageData, dims, doc.label.regions, 2540 / doc.label.dpi);

        expect(page.rgba.data).toEqual(raster.imageData.data);
    });

    it('policy mask resolves topmost-wins at an overlap', async () => {
        const doc = createLabelDoc({
            backingW: 4000,
            backingH: 2000,
            dpi: 254,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 4000, h: 2000 }],
            nodes: [rect('under', 0, 0, 3000, 2000, 'threshold'), rect('over', 1000, 0, 3000, 2000, 'floydSteinberg')],
        });
        const nodes = resolve(doc);
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const built = await buildPolicyMask(nodes, nodeLookup(doc.nodes), dims, doc.label.dpi);
        expect(built).toBeDefined();
        if (!built) return;

        const { mask } = built;
        const width = dims.widthPx;
        expect(mask.width).toBe(width);
        expect(mask.data[100 * width + 50], 'bottom only → index 1').toBe(1);
        expect(mask.data[100 * width + 200], 'overlap → topmost index 2').toBe(2);
        expect(mask.data[100 * width + 350], 'top only → index 2').toBe(2);

        // Apply the mask to a synthetic gray gradient. applyPolicy runs each
        // quantizer over the whole buffer then scatters masked pixels, so a
        // masked pixel equals that quantizer's full-pass result.
        const gradient = grayGradient(width, dims.heightPx);
        const clone = (s: RgbaBuffer): RgbaBuffer => ({
            data: new Uint8ClampedArray(s.data),
            width: s.width,
            height: s.height,
        });
        const fullThreshold = clone(gradient);
        quantizeRgba(fullThreshold, { globalQuantizer: threshold });
        const fullFloyd = clone(gradient);
        quantizeRgba(fullFloyd, { globalQuantizer: floydSteinberg });

        const out = clone(gradient);
        quantizeRgba(out, { globalQuantizer: threshold, policies: built.policies, mask, colorSpace: MonoColorSpace });

        // Find a contested overlap pixel where the two policies disagree.
        let overlapPixel = -1;
        for (let x = 100; x < 300 && overlapPixel < 0; x++) {
            for (let y = 0; y < dims.heightPx; y++) {
                const p = y * width + x;
                if (fullThreshold.data[p * 4] !== fullFloyd.data[p * 4]) {
                    overlapPixel = p;
                    break;
                }
            }
        }
        expect(overlapPixel, 'a disagreeing overlap pixel exists').toBeGreaterThanOrEqual(0);
        expect(out.data[overlapPixel * 4], 'overlap takes the topmost policy').toBe(
            fullFloyd.data[overlapPixel * 4],
        );

        // Find a bottom-only pixel where they disagree; it takes the bottom policy.
        let bottomPixel = -1;
        for (let x = 0; x < 100 && bottomPixel < 0; x++) {
            for (let y = 0; y < dims.heightPx; y++) {
                const p = y * width + x;
                if (fullThreshold.data[p * 4] !== fullFloyd.data[p * 4]) {
                    bottomPixel = p;
                    break;
                }
            }
        }
        expect(bottomPixel).toBeGreaterThanOrEqual(0);
        expect(out.data[bottomPixel * 4]).toBe(fullThreshold.data[bottomPixel * 4]);
    });

    it('paints a nested leaf with its absolute transform', async () => {
        const doc = createLabelDoc({
            backingW: 4000,
            backingH: 2000,
            dpi: 254,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 4000, h: 2000 }],
            nodes: [
                node({
                    id: 'g',
                    parentId: null,
                    type: 'group',
                    visible: true,
                    locked: false,
                    transform: { x: 1000, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                }),
                node({
                    id: 'child',
                    parentId: 'g',
                    type: 'shape',
                    shape: 'rectangle',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    size: { w: 2000, h: 2000 },
                    quantizerHint: 'threshold',
                }),
            ],
        });
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const built = await buildPolicyMask(resolve(doc), nodeLookup(doc.nodes), dims, doc.label.dpi);
        expect(built).toBeDefined();
        if (!built) return;

        const width = dims.widthPx;
        // Child absolute span is hm x 1000..3000 → px 100..300.
        expect(built.mask.data[100 * width + 250], 'absolute position is covered').toBe(1);
        expect(built.mask.data[100 * width + 50], 'group-local position is not covered').toBe(0);
    });

    it('does not mutate the document (invariant 2)', async () => {
        const doc = smallDoc(leftHalfRegions, smallNodes());
        const before = structuredClone(doc);
        await renderLabelPage(doc);
        expect(doc).toEqual(before);
    });

    it('returns a fresh encoder canvas with the quantized, clipped page (M1)', async () => {
        const doc = smallDoc(leftHalfRegions, smallNodes());
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const page = await renderLabelPage(doc);

        expect(page.canvas.width).toBe(dims.widthPx);
        expect(page.canvas.height).toBe(dims.heightPx);
        const ctx = page.canvas.getContext('2d');
        expect(ctx).toBeTruthy();
        if (!ctx) return;
        const data = ctx.getImageData(0, 0, dims.widthPx, dims.heightPx).data;
        expect(data).toEqual(page.rgba.data);

        let dark = 0;
        for (let i = 0; i < data.length; i += 4) {
            expect([0, 255], 'canvas is quantized to exact 1-bit channels').toContain(data[i]);
            if (data[i] === 0) dark++;
        }
        expect(dark, 'canvas is non-blank').toBeGreaterThan(0);
    });

    it('an unhinted topmost shape overrides a hinted leaf beneath (M2)', async () => {
        const doc = createLabelDoc({
            backingW: 4000,
            backingH: 2000,
            dpi: 254,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 4000, h: 2000 }],
            nodes: [
                text('t', 0, 0, 'XYZ'), // default policy threshold → index 1
                rect('cover', 0, 0, 3000, 2000), // unhinted → global 0, drawn on top
            ],
        });
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const built = await buildPolicyMask(resolve(doc), nodeLookup(doc.nodes), dims, doc.label.dpi);
        expect(built, 'text still makes a policy mask').toBeDefined();
        if (!built) return;
        expect(
            built.mask.data.every((value) => value === 0),
            'the unhinted rect footprint resolves to global, not the text policy',
        ).toBe(true);
    });

    it('re-clips after diffusion so no ink lands outside the union (M3)', async () => {
        // Region covers the left half; dark ink (rect + antialiased text) straddles it.
        const doc = smallDoc(leftHalfRegions, [
            rect('cross', 1000, 0, 2000, 2000),
            text('t', 1200, 300, 'HHHH'),
        ]);
        const page = await renderLabelPage(doc, {}, { quantizer: 'floydSteinberg' });
        const unionRightPx = Math.round(1500 * (300 / 2540)); // 177

        let inkOutside = 0;
        for (let y = 0; y < page.heightPx; y++) {
            for (let x = unionRightPx + 1; x < page.widthPx; x++) {
                if (!isWhite(page.rgba, x, y)) inkOutside++;
            }
        }
        expect(inkOutside, 'diffused ink outside the union is re-clipped to white').toBe(0);
    });

    it('refuses a raster above the pixel cap before allocating (invariant 9)', async () => {
        const doc = createLabelDoc({
            backingW: 100_000,
            backingH: 100_000,
            dpi: 300,
            regions: [],
            nodes: [],
        });
        await expect(renderLabelPage(doc)).rejects.toThrow(RangeError);
    });

    it('paints text glyph coverage, not its bounding box (real canvas)', async () => {
        const doc = createLabelDoc({
            backingW: 4000,
            backingH: 2000,
            dpi: 254,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 4000, h: 2000 }],
            nodes: [text('t', 0, 0, 'Wg')],
        });
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const resolved = resolve(doc);
        const built = await buildPolicyMask(resolved, nodeLookup(doc.nodes), dims, doc.label.dpi);
        expect(built).toBeDefined();
        if (!built) return;

        let covered = 0;
        for (const value of built.mask.data) {
            expect([0, 1], 'text is the only policy').toContain(value);
            if (value === 1) covered++;
        }
        // Text box is 2000×600 hm → 200×60 px at dpi 254; glyphs cover far less.
        const textNode = resolved[0];
        const bboxArea =
            textNode?.type === 'text'
                ? Math.round((textNode.w * 254) / 2540) * Math.round((textNode.h * 254) / 2540)
                : 0;
        expect(covered).toBeGreaterThan(0);
        expect(covered).toBeLessThan(bboxArea);
    });

    it('stays widthPx×heightPx and identical at devicePixelRatio 2 (A)', async () => {
        const doc = smallDoc(leftHalfRegions, smallNodes());
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const baseline = await renderLabelPage(doc);

        const previous = Konva.pixelRatio;
        Konva.pixelRatio = 2;
        try {
            const scaled = await renderLabelPage(doc);
            expect(scaled.widthPx).toBe(dims.widthPx);
            expect(scaled.canvas.width).toBe(dims.widthPx);
            expect(scaled.canvas.height).toBe(dims.heightPx);
            expect(scaled.rgba.data).toEqual(baseline.rgba.data);
        } finally {
            Konva.pixelRatio = previous;
        }
    });

    it('builds the policy mask at ratio 1 under HiDPI (A)', async () => {
        // A policy that only covers the right half: if the backing store were
        // widthPx*DPR we would read the top-left quadrant and see no coverage.
        const doc = createLabelDoc({
            backingW: 4000,
            backingH: 2000,
            dpi: 254,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 4000, h: 2000 }],
            nodes: [rect('right', 2000, 0, 2000, 2000, 'threshold')],
        });
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);

        const previous = Konva.pixelRatio;
        Konva.pixelRatio = 2;
        try {
            const built = await buildPolicyMask(resolve(doc), nodeLookup(doc.nodes), dims, doc.label.dpi);
            expect(built).toBeDefined();
            if (!built) return;
            const width = dims.widthPx;
            expect(built.mask.data[100 * width + 300], 'right-half policy survives HiDPI').toBe(1);
            expect(built.mask.data[100 * width + 50], 'left half is uncovered').toBe(0);
        } finally {
            Konva.pixelRatio = previous;
        }
    });

    it('validates its raster arguments (public entry)', async () => {
        const doc = smallDoc(leftHalfRegions, smallNodes());
        const nodes = resolve(doc);
        const byId = nodeLookup(doc.nodes);
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);

        await expect(buildPolicyMask(nodes, byId, { widthPx: 0, heightPx: 0 }, 300)).rejects.toThrow(RangeError);
        await expect(buildPolicyMask(nodes, byId, dims, 0)).rejects.toThrow(RangeError);
        await expect(
            buildPolicyMask(nodes, byId, { widthPx: 10.5, heightPx: 20 }, 300),
            'fractional widthPx',
        ).rejects.toThrow(RangeError);
        await expect(
            buildPolicyMask(nodes, byId, { widthPx: 10, heightPx: 20.25 }, 300),
            'fractional heightPx',
        ).rejects.toThrow(RangeError);
    });
});
