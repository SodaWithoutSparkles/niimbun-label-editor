import { beforeAll, describe, expect, it } from 'vitest';
import Konva from 'konva';
import { loadImage } from '@napi-rs/canvas';
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
import type { PreparedAsset } from './assets';
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

const image = (id: string, x: number, y: number, w: number, h: number): Node =>
    node({
        id,
        parentId: null,
        type: 'image',
        visible: true,
        locked: false,
        transform: { x, y, rotDeg: 0, scaleX: 1, scaleY: 1 },
        imageId: 'i1',
        size: { w, h },
    });

const smallDoc = (regions: Region[], nodes: Node[]): LabelDoc =>
    createLabelDoc({ backingW: 3000, backingH: 2000, dpi: 300, regions, nodes });

/** A solid-black `w`×`h` asset drawable by the canvas shim. */
const solidAsset = async (w: number, h: number): Promise<PreparedAsset> => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, w, h);
    const image = (await loadImage(canvas.toDataURL('image/png'))) as unknown as CanvasImageSource;
    return { image, widthPx: w, heightPx: h };
};

const fullRegions: Region[] = [{ kind: 'rect', x: 0, y: 0, w: 4000, h: 2000 }];

/** A 4000×2000 @254dpi doc (scale 0.1) so hm → px is a clean /10. */
const imageDoc = (nodes: Node[]): LabelDoc =>
    createLabelDoc({ backingW: 4000, backingH: 2000, dpi: 254, regions: fullRegions, nodes });

/**
 * Assert the image leaf's mask footprint is byte-for-byte the raster ink: for
 * every pixel, "policy mask covers it" == "raster has opaque dark ink".
 */
const expectMaskEqualsRaster = async (doc: LabelDoc): Promise<void> => {
    const nodes = resolve(doc);
    const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
    const asset = await solidAsset(100, 100);
    const assets = new Map<string, PreparedAsset>([['img', asset]]);
    const built = await buildPolicyMask(nodes, nodeLookup(doc.nodes), dims, doc.label.dpi, assets);
    expect(built).toBeDefined();
    if (!built) return;
    const { imageData } = await rasterizeResolved(nodes, { ...dims, dpi: doc.label.dpi }, assets);

    let mismatches = 0;
    for (let p = 0; p < built.mask.data.length; p++) {
        const i = p * 4;
        const rasterInk = imageData.data[i]! < 128 && imageData.data[i + 3]! > 0;
        if ((built.mask.data[p]! > 0) !== rasterInk) mismatches++;
    }
    expect(mismatches, 'mask footprint matches the raster ink exactly').toBe(0);
};

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

    it('a missing image asset does not override a lower node’s mask policy', async () => {
        const regions: Region[] = [{ kind: 'rect', x: 0, y: 0, w: 4000, h: 2000 }];
        const withImage = createLabelDoc({
            backingW: 4000,
            backingH: 2000,
            dpi: 254,
            regions,
            nodes: [text('t', 100, 100, 'XYZ'), image('img', 100, 100, 2000, 1000)],
        });
        const withoutImage = createLabelDoc({
            backingW: 4000,
            backingH: 2000,
            dpi: 254,
            regions,
            nodes: [text('t', 100, 100, 'XYZ')],
        });
        const dims = rasterDimensions(4000, 2000, 254);
        const a = await buildPolicyMask(resolve(withImage), nodeLookup(withImage.nodes), dims, 254, new Map());
        const b = await buildPolicyMask(resolve(withoutImage), nodeLookup(withoutImage.nodes), dims, 254, new Map());
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        if (!a || !b) return;
        // The missing topmost image contributes no coverage, so it cannot
        // override the lower text's policy.
        expect(a.mask.data).toEqual(b.mask.data);
        expect(a.mask.data.some((value) => value !== 0)).toBe(true);
    });

    it('a contain image masks only its drawn rect, not the letterbox', async () => {
        const regions: Region[] = [{ kind: 'rect', x: 0, y: 0, w: 4000, h: 2000 }];
        const doc = createLabelDoc({
            backingW: 4000,
            backingH: 2000,
            dpi: 254,
            regions,
            nodes: [
                rect('under', 0, 0, 4000, 2000, 'threshold'),
                image('img', 0, 0, 2000, 1000),
            ],
        });
        const dims = rasterDimensions(4000, 2000, 254);
        // A square asset in a 2:1 box forces a `contain` letterbox.
        const assets = new Map<string, PreparedAsset>([
            ['img', { image: {} as CanvasImageSource, widthPx: 100, heightPx: 100 }],
        ]);
        const built = await buildPolicyMask(resolve(doc), nodeLookup(doc.nodes), dims, 254, assets);
        expect(built).toBeDefined();
        if (!built) return;
        const width = dims.widthPx;
        // Image box 2000×1000 hm → 200×100 px; a 100×100 asset `contain`s to
        // 100×100 at x=50, so px 0..50 and 150..200 are letterbox.
        expect(built.mask.data[50 * width + 10], 'letterbox keeps the lower policy').toBe(1);
        expect(built.mask.data[50 * width + 100], 'drawn rect takes the image policy').toBe(2);
    });

    it('a contain image raster keeps the centred fit offset (letterbox blank on both sides)', async () => {
        const doc = imageDoc([image('img', 0, 0, 2000, 1000)]);
        const nodes = resolve(doc);
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const asset = await solidAsset(100, 100);
        const assets = new Map<string, PreparedAsset>([['img', asset]]);
        const { imageData } = await rasterizeResolved(nodes, { ...dims, dpi: doc.label.dpi }, assets);

        const dark = (x: number, y: number): boolean => {
            const i = (y * imageData.width + x) * 4;
            return imageData.data[i]! < 128 && imageData.data[i + 3]! > 0;
        };
        // Box 2000×1000 hm → 200×100 px; a square asset contains to 100×100 at x=50.
        expect(dark(100, 50), 'centred drawn rect has ink').toBe(true);
        expect(dark(10, 50), 'left letterbox is blank').toBe(false);
        expect(dark(190, 50), 'right letterbox is blank').toBe(false);
    });

    it('a contain image mask covers exactly the raster drawn rect at the origin', async () => {
        await expectMaskEqualsRaster(imageDoc([image('img', 0, 0, 2000, 1000)]));
    });

    it('a contain image mask covers exactly the raster drawn rect at a non-zero transform', async () => {
        await expectMaskEqualsRaster(imageDoc([image('img', 1000, 500, 2000, 1000)]));
    });

    it('a contain image mask covers exactly the raster drawn rect nested in a translated group', async () => {
        const doc = imageDoc([
            node({
                id: 'g',
                parentId: null,
                type: 'group',
                visible: true,
                locked: false,
                transform: { x: 1000, y: 500, rotDeg: 0, scaleX: 1, scaleY: 1 },
            }),
            node({
                id: 'img',
                parentId: 'g',
                type: 'image',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                imageId: 'i1',
                size: { w: 2000, h: 1000 },
            }),
        ]);
        await expectMaskEqualsRaster(doc);
    });

    it('degrades to fallback fonts when the font provider rejects', async () => {
        const doc = smallDoc(leftHalfRegions, [text('t', 100, 200, 'Hi')]);
        const page = await renderLabelPage(doc, {}, {
            assets: { fonts: { ensureFonts: () => Promise.reject(new Error('no fonts')) } },
        });
        let dark = 0;
        for (let i = 0; i < page.rgba.data.length; i += 4) {
            if (page.rgba.data[i]! < 128) dark++;
        }
        expect(dark, 'text still renders with fallback fonts').toBeGreaterThan(0);
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
