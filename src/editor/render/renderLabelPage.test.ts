// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import Konva from 'konva';
import { loadImage } from '@napi-rs/canvas';
import { installCanvasShim } from '../../test/canvasHarness';
import { createLabelDoc } from '../../core/doc/factory';
import { nodeLookup } from '../../core/doc/derive';
import type { LabelDoc, Node, Region } from '../../core/doc/types';
import {
    DEFAULT_GAMMA_BY_STRATEGY,
    GAMMA_MAX,
    MonoColorSpace,
    floydSteinberg,
    quantizeRgba,
    rasterDimensions,
    threshold,
    type RgbaBuffer,
} from '../../core/render';
import { applyRegionClip } from './clip';
import type { PreparedAsset } from './assets';
import { buildPolicyMask, offsetRasterDimensions, renderLabelPage } from './renderLabelPage';
import { resolve } from './resolve';
import { rasterizeResolved } from './rasterize';

// Spy seam for the `assets.dpi` test: `renderLabelPage` imports
// `prepareResolvedAssets` by name, so wrap the module and pass arguments
// through unchanged (same technique as `renderLabelPage.assetDpi.test.ts`).
const prepareSpy = vi.hoisted(() => vi.fn());

vi.mock('./prepareAssets', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./prepareAssets')>();
    return {
        ...actual,
        prepareResolvedAssets: ((
            ...args: Parameters<typeof actual.prepareResolvedAssets>
        ) => {
            prepareSpy(...args);
            return actual.prepareResolvedAssets(...args);
        }) as typeof actual.prepareResolvedAssets,
    };
});

beforeAll(() => {
    installCanvasShim();
});

describe('offsetRasterDimensions (R12 pre-flight helper)', () => {
    it('keeps the base size for `inner` and grows it for `outer`', () => {
        expect(offsetRasterDimensions(100, 200, { x: 30, y: -40, type: 'inner' })).toEqual({
            widthPx: 100,
            heightPx: 200,
        });
        expect(offsetRasterDimensions(100, 200, { x: 30, y: -40, type: 'outer' })).toEqual({
            widthPx: 130,
            heightPx: 240,
        });
    });
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

// These helpers stand in for an **ink source**: they set an explicit black fill
// so the raster/clip/override tests below are independent of the shape style
// default (a shape with no fill resolves to `'transparent'`).
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
        fill: '#000000',
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
        fill: '#000000',
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

    it('deduplicates per-node params and reports palette overflow without failing the render', async () => {
        const nodes: Node[] = Array.from({ length: 10 }, (_, index) => ({
            id: `t${index}`,
            parentId: null,
            type: 'text',
            visible: true,
            locked: false,
            transform: { x: index * 10, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
            text: { kind: 'static', value: 'X' },
            size: { w: 500, h: 500 },
            fontSize: 400,
            quantizerParams: { threshold: index < 2 ? 100 : 100 + index },
        } as Node));
        const doc = smallDoc(fullRegions, nodes);
        const page = await renderLabelPage(doc);
        expect(page.policyOverflowCount).toBe(1);
    });

    it('caps the palette at 8 policies and degrades the excess node to the global key', async () => {
        // Nine rectangles, each with its own threshold → nine distinct policies.
        const nodes: Node[] = Array.from({ length: 9 }, (_, index) =>
            node({
                id: `r${index}`,
                parentId: null,
                type: 'shape',
                shape: 'rectangle',
                visible: true,
                locked: false,
                transform: { x: index * 300, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                size: { w: 200, h: 200 },
                fill: '#000000',
                quantizerHint: 'threshold',
                quantizerParams: { threshold: 10 * (index + 1) },
            }),
        );
        const doc = imageDoc(nodes); // 4000×2000 @254 dpi → 0.1 hm→px
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const built = await buildPolicyMask(resolve(doc), nodeLookup(doc.nodes), dims, doc.label.dpi);
        expect(built).toBeDefined();
        if (!built) return;
        expect(built.overflowCount).toBe(1);
        expect(built.policies.size).toBe(8);
        const width = dims.widthPx;
        // Rect i is 200×200 hm at x = i*300 hm → 20×20 px at x = i*30; sample its centre.
        for (let index = 0; index < 8; index++) {
            expect(
                built.mask.data[10 * width + index * 30 + 10],
                `node ${index} keeps its own policy index ${index + 1}`,
            ).toBe(index + 1);
        }
        expect(
            built.mask.data[10 * width + 8 * 30 + 10],
            'the ninth node fell back to the global key (0)',
        ).toBe(0);
    });

    it('routes node quantizerParams into the policy options (node → key → policies)', async () => {
        const doc = smallDoc(fullRegions, [
            node({
                id: 't', parentId: null, type: 'text', visible: true, locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                text: { kind: 'static', value: 'X' }, size: { w: 500, h: 500 }, fontSize: 400,
                quantizerParams: { threshold: 200, strength: 2 },
            }),
        ]);
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const built = await buildPolicyMask(resolve(doc), nodeLookup(doc.nodes), dims, doc.label.dpi);
        expect(built).toBeDefined();
        if (!built) return;
        const entry = built.policies.get(1);
        expect(entry).toBeDefined();
        if (!entry || typeof entry === 'function') return;
        // `serpentine` is now always explicit (fix 1), so the diffuser's actual
        // options carry the resolved `true` rather than inheriting the base's.
        // `gamma` is explicit for the same reason, resolved to this strategy's
        // own default (text → `threshold` → neutral 1).
        expect(entry.options).toEqual({ threshold: 200, strength: 2, serpentine: true, gamma: 1 });
    });

    it('gives two nodes differing only in serpentine distinct policy slots (D-57(b))', async () => {
        const mk = (id: string, x: number, params?: { serpentine: boolean }): Node =>
            node({
                id, parentId: null, type: 'text', visible: true, locked: false,
                transform: { x, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                text: { kind: 'static', value: 'X' }, size: { w: 500, h: 500 }, fontSize: 400,
                quantizerHint: 'floydSteinberg',
                ...(params ? { quantizerParams: params } : {}),
            });
        const doc = smallDoc(fullRegions, [mk('a', 0), mk('b', 600, { serpentine: false })]);
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const built = await buildPolicyMask(resolve(doc), nodeLookup(doc.nodes), dims, doc.label.dpi);
        expect(built).toBeDefined();
        if (!built) return;
        // Two distinct slots: the diffuser sees `serpentine: false` for the one
        // node, and the two do not silently share a mask entry.
        expect(built.policies.size).toBe(2);
        const slots = new Set<number>();
        for (const value of built.mask.data) if (value !== 0) slots.add(value);
        expect(slots.size).toBe(2);
        // Assert the **actual options**, not just distinct slots (the nit): the
        // param-less node's policy carries `true`, the explicit node's `false`.
        const optionsAt = (index: number) => {
            const entry = built.policies.get(index);
            return entry && typeof entry !== 'function' ? entry.options : undefined;
        };
        expect(optionsAt(1)?.serpentine).toBe(true);
        expect(optionsAt(2)?.serpentine).toBe(false);
    });

    it('a node whose effective serpentine is true ignores a false global base (fix 1)', async () => {
        const doc = createLabelDoc({
            backingW: 4000,
            backingH: 2000,
            dpi: 254,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 4000, h: 2000 }],
            nodes: [
                node({
                    id: 't',
                    parentId: null,
                    type: 'text',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    text: { kind: 'static', value: 'Wg' },
                    size: { w: 3000, h: 1500 },
                    fontSize: 600,
                    quantizerHint: 'floydSteinberg',
                    // Node explicitly wants serpentine on; the base resolves off.
                    quantizerParams: { serpentine: true },
                }),
            ],
        });
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const built = await buildPolicyMask(
            resolve(doc),
            nodeLookup(doc.nodes),
            dims,
            doc.label.dpi,
            undefined,
            { serpentine: false },
        );
        expect(built).toBeDefined();
        // The policy carries its own explicit `true`, so a `false` base cannot
        // leak into the diffuser by omission (the pre-fix bug).
        const entry = built?.policies.get(1);
        expect(entry && typeof entry !== 'function' ? entry.options?.serpentine : undefined).toBe(true);

        // End to end: the output is identical whether the base is false or true.
        const baseFalse = await renderLabelPage(doc, {}, { serpentine: false });
        const baseTrue = await renderLabelPage(doc, {}, { serpentine: true });
        expect(baseFalse.rgba.data).toEqual(baseTrue.rgba.data);
    });

    it('a per-strategy serpentine default reaches the global diffuser (fix 2)', async () => {
        // An unhinted gray shape resolves **no** policy, so the whole frame runs
        // through the global pass. Uniform gray emits diffusion error, so
        // serpentine actually changes the pattern.
        const doc = imageDoc([
            node({
                id: 'g',
                parentId: null,
                type: 'shape',
                shape: 'rectangle',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                size: { w: 3000, h: 1500 },
                fill: '#808080',
            }),
        ]);
        const off = await renderLabelPage(doc, {}, {
            quantizer: 'floydSteinberg',
            quantizerDefaults: { floydSteinberg: { serpentine: false } },
        });
        const on = await renderLabelPage(doc, {}, {
            quantizer: 'floydSteinberg',
            quantizerDefaults: { floydSteinberg: { serpentine: true } },
        });
        const unset = await renderLabelPage(doc, {}, { quantizer: 'floydSteinberg' });

        expect(off.rgba.data, 'the strategy default changes the global raster').not.toEqual(on.rgba.data);
        expect(unset.rgba.data, 'unset falls back to the engine default (true)').toEqual(on.rgba.data);
    });

    // A single grey shape (hinted to a diffuser) so the tile pattern is sensitive
    // to the tone curve; the union covers the whole page. Text/shapes with no
    // hint resolve no policy and run through the global pass instead.
    const gammaDoc = (hint?: string): LabelDoc =>
        imageDoc([
            node({
                id: 'g',
                parentId: null,
                type: 'shape',
                shape: 'rectangle',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                size: { w: 3000, h: 1500 },
                fill: '#808080',
                ...(hint ? { quantizerHint: hint } : {}),
            }),
        ]);

    /**
     * A 10×5 mm @254 dpi doc (100×50 px), same single grey shape as `gammaDoc`.
     *
     * The W1 guard lives in `normalizeGamma`, which builds the quantizer's tone
     * LUT — it is dpi- and label-size-independent, so this small raster proves
     * exactly the same thing as a full page for a fraction of the cost
     * (tech-debt D-23: heavy real-canvas files flake under parallel load).
     */
    const tinyGammaDoc = (): LabelDoc =>
        createLabelDoc({
            backingW: 1000,
            backingH: 500,
            dpi: 254,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 1000, h: 500 }],
            nodes: [
                node({
                    id: 'g',
                    parentId: null,
                    type: 'shape',
                    shape: 'rectangle',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    size: { w: 1000, h: 500 },
                    fill: '#808080',
                    quantizerHint: 'floydSteinberg',
                }),
            ],
        });

    const gammaOptionsAt = (
        built: Awaited<ReturnType<typeof buildPolicyMask>>,
        index: number,
    ): number | undefined => {
        const entry = built?.policies.get(index);
        return entry && typeof entry !== 'function' ? entry.options?.gamma : undefined;
    };

    it('a diffuser policy carries its own per-strategy gamma, never the global base (P14 R14-a)', async () => {
        const doc = gammaDoc('floydSteinberg');
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const byId = nodeLookup(doc.nodes);

        // No settings and no render-level gamma: the policy must still carry the
        // **policy-layer** default (1.3) rather than omitting the knob and
        // inheriting the global base's — which, unset, is the engine's neutral 1.
        const unset = await buildPolicyMask(resolve(doc), byId, dims, doc.label.dpi);
        expect(gammaOptionsAt(unset, 1)).toBe(DEFAULT_GAMMA_BY_STRATEGY.floydSteinberg);
        expect(DEFAULT_GAMMA_BY_STRATEGY.floydSteinberg).not.toBe(1);

        // A per-strategy settings default wins over the render-level fallback.
        const configured = await buildPolicyMask(resolve(doc), byId, dims, doc.label.dpi, undefined, {
            gamma: 0.5,
            quantizerDefaults: { floydSteinberg: { gamma: 1.6 } },
        });
        expect(gammaOptionsAt(configured, 1)).toBe(1.6);

        // With no settings value, the render-level fallback is the last resort.
        const fallback = await buildPolicyMask(resolve(doc), byId, dims, doc.label.dpi, undefined, {
            gamma: 0.5,
        });
        expect(gammaOptionsAt(fallback, 1)).toBe(0.5);
    });

    it('a per-strategy gamma reaches the masked pass end to end (P14)', async () => {
        const doc = gammaDoc('floydSteinberg');
        const neutral = await renderLabelPage(doc, {}, {
            quantizerDefaults: { floydSteinberg: { gamma: 1 } },
        });
        const lifted = await renderLabelPage(doc, {}, {
            quantizerDefaults: { floydSteinberg: { gamma: 1.6 } },
        });
        expect(lifted.rgba.data, 'the policy gamma changes the dithered region').not.toEqual(
            neutral.rgba.data,
        );
    });

    it('the global diffuser pass gets its per-strategy gamma too (P14)', async () => {
        // Unhinted shape → no policy mask → the whole frame runs one global pass.
        const doc = gammaDoc();
        const neutral = await renderLabelPage(doc, {}, { quantizer: 'floydSteinberg', gamma: 1 });
        const policyDefault = await renderLabelPage(doc, {}, { quantizer: 'floydSteinberg' });
        expect(
            policyDefault.rgba.data,
            'an absent gamma is the diffuser default (1.3), not the engine-neutral 1',
        ).not.toEqual(neutral.rgba.data);
        // An explicit render-level gamma wins over that default.
        const overridden = await renderLabelPage(doc, {}, {
            quantizer: 'floydSteinberg',
            gamma: 0.7,
        });
        expect(overridden.rgba.data).not.toEqual(neutral.rgba.data);
        expect(overridden.rgba.data).not.toEqual(policyDefault.rgba.data);
    });

    it('normalises a non-finite or out-of-range render gamma instead of blanking the page (W1)', async () => {
        // `opts.gamma` is an unvalidated render-level fallback: a NaN/Infinity
        // gamma used to build a NaN LUT, which lands in the `Uint8Array` as 0 and
        // blackens every pixel. It must now normalise to the neutral curve.
        // A tiny label is enough: the guard is about the LUT, not the output size.
        const doc = tinyGammaDoc();
        const neutral = await renderLabelPage(doc, {}, {
            quantizerDefaults: { floydSteinberg: { gamma: 1 } },
        });
        const nan = await renderLabelPage(doc, {}, { gamma: NaN });
        const infinity = await renderLabelPage(doc, {}, { gamma: Infinity });

        for (const [name, page] of [['NaN', nan], ['Infinity', infinity]] as const) {
            let dark = 0;
            for (let i = 0; i < page.rgba.data.length; i += 4) {
                if (page.rgba.data[i] === 0) dark++;
            }
            const pixels = page.rgba.width * page.rgba.height;
            expect(dark, `${name}: not an all-black raster`).toBeLessThan(pixels);
            expect(dark, `${name}: the page still has ink`).toBeGreaterThan(0);
            expect(
                page.rgba.data,
                `${name}: byte-identical to the neutral (gamma 1) render`,
            ).toEqual(neutral.rgba.data);
        }

        // A finite out-of-range gamma clamps to the max rather than blowing up.
        const huge = await renderLabelPage(doc, {}, { gamma: 1e9 });
        const clamped = await renderLabelPage(doc, {}, {
            quantizerDefaults: { floydSteinberg: { gamma: GAMMA_MAX } },
        });
        expect(huge.rgba.data, 'clamped to GAMMA_MAX').toEqual(clamped.rgba.data);
    });

    it('collapses absent, empty, and explicit-default params into one shared policy', async () => {
        const mk = (id: string, x: number, params?: Record<string, number>): Node =>
            node({
                id, parentId: null, type: 'text', visible: true, locked: false,
                transform: { x, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                text: { kind: 'static', value: 'X' }, size: { w: 500, h: 500 }, fontSize: 400,
                ...(params ? { quantizerParams: params } : {}),
            });
        const doc = smallDoc(fullRegions, [
            mk('a', 0),
            mk('b', 600, {}),
            mk('c', 1200, { threshold: 128, strength: 1 }),
            mk('d', 1800, { threshold: 128, strength: 1 }),
        ]);
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const built = await buildPolicyMask(resolve(doc), nodeLookup(doc.nodes), dims, doc.label.dpi);
        expect(built).toBeDefined();
        if (!built) return;
        // Absent, empty, explicit-default, and the resolved default all dedupe to
        // one policy; the two identical-param nodes share its index.
        expect(built.policies.size).toBe(1);
        expect(built.overflowCount).toBe(0);
        expect(built.mask.data.some((value) => value === 1)).toBe(true);
        expect(built.mask.data.every((value) => value <= 1)).toBe(true);
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
        // Two distinct policies are within the 8-policy cap, so the page reports
        // no overflow: `policyOverflowCount` is absent.
        expect(a.policyOverflowCount, 'distinct policies ≤ 8 ⇒ no overflow').toBeUndefined();
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
        // The masked `floydSteinberg` policy carries its own resolved tone curve,
        // so the reference pass must use the same per-strategy gamma.
        quantizeRgba(
            fullFloyd,
            { globalQuantizer: floydSteinberg },
            { gamma: DEFAULT_GAMMA_BY_STRATEGY.floydSteinberg },
        );

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
                    // Explicit fill so the leaf is an ink/coverage source (the
                    // default is transparent).
                    fill: '#000000',
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
        // A square **opaque** asset in a 2:1 box forces a `contain` letterbox.
        // The mask is built from the asset's visible ink (fix A), so the stub
        // must be a real drawable that fills the drawn rect — a bare
        // `{ image: {} }` is no longer acceptable.
        const assets = new Map<string, PreparedAsset>([['img', await solidAsset(100, 100)]]);
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

    it('a transparent-fill shape claims only its stroke band (mask == raster ink)', async () => {
        const doc = createLabelDoc({
            backingW: 4000,
            backingH: 2000,
            dpi: 254,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 4000, h: 2000 }],
            nodes: [
                node({
                    id: 'r',
                    parentId: null,
                    type: 'shape',
                    shape: 'rectangle',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    size: { w: 2000, h: 2000 },
                    // Explicit no-fill value: the mask must NOT treat it as ink.
                    fill: 'transparent',
                    stroke: '#000000',
                    strokeWidth: 100,
                    quantizerHint: 'threshold',
                }),
            ],
        });
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const resolved = resolve(doc);
        const built = await buildPolicyMask(resolved, nodeLookup(doc.nodes), dims, doc.label.dpi);
        expect(built).toBeDefined();
        if (!built) return;
        const width = dims.widthPx;
        // Rect 2000×2000 hm → 200×200 px at 254 dpi (scale 0.1); stroke 100 hm →
        // a 10 px band centred on the outline (≈5 px each side).
        expect(built.mask.data[100 * width + 100], 'interior of a transparent shape is uncovered').toBe(0);
        expect(built.mask.data[100 * width + 2], 'stroke band near the edge is covered').toBe(1);

        // The same shape deposits no interior ink: the mask footprint equals the
        // raster ink, so mask-topmost == raster-topmost (M2) still holds.
        const { imageData } = await rasterizeResolved(resolved, { ...dims, dpi: doc.label.dpi });
        // The raster paints an opaque white background, so alpha is 255
        // everywhere: a dark RGB channel is the only meaningful ink test.
        const inkAt = (x: number, y: number): boolean =>
            imageData.data[(y * width + x) * 4]! < 128;
        expect(inkAt(100, 100), 'transparent fill deposits no interior ink').toBe(false);
        expect(inkAt(2, 100), 'the stroke band is the only ink').toBe(true);
    });

    it('a transparent-stroke shape claims no mask band and deposits no ink', async () => {
        const doc = createLabelDoc({
            backingW: 4000,
            backingH: 2000,
            dpi: 254,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 4000, h: 2000 }],
            nodes: [
                node({
                    id: 'r',
                    parentId: null,
                    type: 'shape',
                    shape: 'rectangle',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    size: { w: 2000, h: 2000 },
                    // Both fill and stroke invisible: the mask must claim nothing.
                    fill: 'transparent',
                    stroke: 'transparent',
                    strokeWidth: 100,
                    quantizerHint: 'threshold',
                }),
            ],
        });
        const dims = rasterDimensions(doc.label.backingW, doc.label.backingH, doc.label.dpi);
        const resolved = resolve(doc);
        const built = await buildPolicyMask(resolved, nodeLookup(doc.nodes), dims, doc.label.dpi);
        // The shape resolves a policy, so a mask is built — it just stays empty.
        expect(built).toBeDefined();
        if (!built) return;
        const width = dims.widthPx;
        expect(built.mask.data[100 * width + 2], 'no stroke band near the edge').toBe(0);
        expect(built.mask.data[100 * width + 100], 'no interior coverage').toBe(0);

        const { imageData } = await rasterizeResolved(resolved, { ...dims, dpi: doc.label.dpi });
        const inkAt = (x: number, y: number): boolean =>
            imageData.data[(y * width + x) * 4]! < 128;
        expect(inkAt(2, 100), 'transparent stroke deposits no ink').toBe(false);
        expect(inkAt(100, 100), 'transparent fill deposits no interior ink').toBe(false);
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

/** A 4000×2000 @254dpi doc (400×200 px) with a black strip in the left 100px. */
const stripDoc = (): LabelDoc => imageDoc([rect('r', 0, 0, 1000, 2000)]);

describe('renderLabelPage — overrides (W2)', () => {
    it('dpi override drives rasterDimensions, rgba and canvas dims', async () => {
        const doc = smallDoc(leftHalfRegions, smallNodes());
        const base = await renderLabelPage(doc);
        const expected = rasterDimensions(doc.label.backingW, doc.label.backingH, 150);
        const page = await renderLabelPage(doc, {}, { dpi: 150 });

        expect(page.widthPx).toBe(expected.widthPx);
        expect(page.heightPx).toBe(expected.heightPx);
        expect(page.rgba.width).toBe(expected.widthPx);
        expect(page.rgba.height).toBe(expected.heightPx);
        expect(page.canvas.width).toBe(expected.widthPx);
        expect(page.canvas.height).toBe(expected.heightPx);
        expect(page.widthPx).not.toBe(base.widthPx);
    });

    it('no overrides (or an equal dpi) is byte-identical to the baseline', async () => {
        const doc = smallDoc(leftHalfRegions, smallNodes());
        const baseline = await renderLabelPage(doc);
        const implicit = await renderLabelPage(doc, {}, {});
        const explicit = await renderLabelPage(doc, {}, { dpi: doc.label.dpi });

        expect(implicit.rgba.data).toEqual(baseline.rgba.data);
        expect(explicit.rgba.data).toEqual(baseline.rgba.data);
        expect(implicit.widthPx).toBe(baseline.widthPx);
        expect(explicit.heightPx).toBe(baseline.heightPx);
        expect(implicit.canvas.width).toBe(baseline.canvas.width);
        expect(implicit.canvas.height).toBe(baseline.canvas.height);
    });

    it('honours a caller-supplied assets.dpi over doc.label.dpi', async () => {
        const doc = imageDoc([image('img', 0, 0, 2000, 1000)]);
        prepareSpy.mockClear();

        await renderLabelPage(doc, {}, { assets: { dpi: 63 } });

        expect(prepareSpy).toHaveBeenCalledTimes(1);
        const deps = prepareSpy.mock.calls[0]![2] as { dpi?: number } | undefined;
        expect(deps?.dpi, 'assets.dpi wins over doc.label.dpi').toBe(63);
    });

    it('invert flips a known black region to white and white to black', async () => {
        const doc = stripDoc();
        const base = await renderLabelPage(doc);
        const inverted = await renderLabelPage(doc, {}, { invert: true });

        expect(pixelAt(base.rgba, 50, 100).slice(0, 3)).toEqual([0, 0, 0]);
        expect(pixelAt(base.rgba, 300, 100).slice(0, 3)).toEqual([255, 255, 255]);

        expect(pixelAt(inverted.rgba, 50, 100).slice(0, 3)).toEqual([255, 255, 255]);
        expect(pixelAt(inverted.rgba, 300, 100).slice(0, 3)).toEqual([0, 0, 0]);
        // Alpha stays opaque; the buffer stays quantized to exact 1-bit channels.
        expect(pixelAt(inverted.rgba, 50, 100)[3]).toBe(255);
        expect(pixelAt(inverted.rgba, 300, 100)[3]).toBe(255);
    });

    it('mirror flips an asymmetric raster horizontally', async () => {
        const doc = stripDoc();
        const base = await renderLabelPage(doc);
        const mirrored = await renderLabelPage(doc, {}, { mirror: true });
        const width = base.widthPx;

        expect(pixelAt(base.rgba, 50, 100).slice(0, 3)).toEqual([0, 0, 0]);
        expect(pixelAt(base.rgba, 350, 100).slice(0, 3)).toEqual([255, 255, 255]);

        // x ↔ width - 1 - x.
        expect(pixelAt(mirrored.rgba, width - 1 - 50, 100).slice(0, 3)).toEqual([0, 0, 0]);
        expect(pixelAt(mirrored.rgba, width - 1 - 350, 100).slice(0, 3)).toEqual([255, 255, 255]);
    });

    it('offset inner keeps the size and shifts the raster onto a fresh canvas', async () => {
        const doc = stripDoc();
        const base = await renderLabelPage(doc);
        const shifted = await renderLabelPage(doc, {}, { offset: { x: 20, y: 0, type: 'inner' } });

        expect(shifted.widthPx).toBe(base.widthPx);
        expect(shifted.heightPx).toBe(base.heightPx);
        expect(shifted.rgba.width).toBe(base.widthPx);
        expect(shifted.canvas.width).toBe(base.widthPx);
        expect(shifted.canvas).not.toBe(base.canvas);

        // A 20px white gutter; content is the base raster shifted right.
        for (let x = 0; x < 20; x++) expect(isWhite(shifted.rgba, x, 100)).toBe(true);
        expect(pixelAt(shifted.rgba, 20 + 50, 100).slice(0, 3)).toEqual([0, 0, 0]);
        expect(pixelAt(shifted.rgba, 20 + 300, 100).slice(0, 3)).toEqual([255, 255, 255]);
    });

    it('offset outer expands the raster and places the image at max(x,0)/max(y,0)', async () => {
        const doc = stripDoc();
        const base = await renderLabelPage(doc);
        const shifted = await renderLabelPage(doc, {}, { offset: { x: 20, y: 10, type: 'outer' } });

        expect(shifted.widthPx).toBe(base.widthPx + 20);
        expect(shifted.heightPx).toBe(base.heightPx + 10);
        expect(shifted.rgba.width).toBe(shifted.widthPx);
        expect(shifted.rgba.height).toBe(shifted.heightPx);
        expect(shifted.canvas.width).toBe(shifted.widthPx);

        // White margins on the top/left; the image lands at (20,10).
        expect(isWhite(shifted.rgba, 10, 10)).toBe(true);
        expect(isWhite(shifted.rgba, 300, 5)).toBe(true);
        expect(pixelAt(shifted.rgba, 20 + 50, 10 + 100).slice(0, 3)).toEqual([0, 0, 0]);
        expect(pixelAt(shifted.rgba, 20 + 300, 10 + 100).slice(0, 3)).toEqual([255, 255, 255]);
    });

    it('offset outer keeps the whole image when x/y are negative', async () => {
        const doc = stripDoc();
        const base = await renderLabelPage(doc);
        const shifted = await renderLabelPage(doc, {}, { offset: { x: -15, y: -5, type: 'outer' } });

        expect(shifted.widthPx).toBe(base.widthPx + 15);
        expect(shifted.heightPx).toBe(base.heightPx + 5);
        // Image at (0,0); the extra size is white on the right/bottom.
        expect(pixelAt(shifted.rgba, 50, 100).slice(0, 3)).toEqual([0, 0, 0]);
        expect(isWhite(shifted.rgba, shifted.widthPx - 1, 100)).toBe(true);
        expect(isWhite(shifted.rgba, 50, shifted.heightPx - 1)).toBe(true);
    });

    it('does not mutate the document with overrides (invariant 2)', async () => {
        const doc = stripDoc();
        const before = structuredClone(doc);
        await renderLabelPage(doc, {}, {
            dpi: 150,
            invert: true,
            mirror: true,
            offset: { x: 5, y: 5, type: 'outer' },
        });
        expect(doc).toEqual(before);
    });
});

describe('renderLabelPage — override/clip ordering (W2 review)', () => {
    /** A 4000×2000 @254dpi doc (400×200 px): a printable left half (px 0..150). */
    const partiallyPrintableDoc = (): LabelDoc =>
        createLabelDoc({
            backingW: 4000,
            backingH: 2000,
            dpi: 254,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 1500, h: 2000 }],
            // Black ink px 0..100, fully inside the 0..150 union.
            nodes: [rect('r', 0, 0, 1000, 2000)],
        });

    it('invert cannot blacken the guaranteed-white margin outside the union', async () => {
        const doc = partiallyPrintableDoc();
        const inverted = await renderLabelPage(doc, {}, { invert: true });

        // Inside the union: generic ink (px 0..100) inverts to white; the blank
        // band (px 100..150) inverts to black.
        expect(pixelAt(inverted.rgba, 50, 100).slice(0, 3)).toEqual([255, 255, 255]);
        expect(pixelAt(inverted.rgba, 120, 100).slice(0, 3)).toEqual([0, 0, 0]);

        // Outside the union (x > 150) is re-clipped to white despite invert.
        for (let x = 200; x < inverted.widthPx; x += 17) {
            expect(isWhite(inverted.rgba, x, 100), `x=${x} outside the union is white`).toBe(true);
        }
    });

    it('mirror cannot move ink outside the union (post-clip after mirror)', async () => {
        const doc = partiallyPrintableDoc();
        const base = await renderLabelPage(doc);
        expect(pixelAt(base.rgba, 50, 100).slice(0, 3)).toEqual([0, 0, 0]);

        const mirrored = await renderLabelPage(doc, {}, { mirror: true });

        // Mirroring across the full 400px width sends the px 0..100 ink to
        // px 299..399, outside the 0..150 union, so it must be clipped to white.
        let dark = 0;
        for (let i = 0; i < mirrored.rgba.data.length; i += 4) {
            if (mirrored.rgba.data[i]! < 128) dark++;
        }
        expect(dark, 'mirrored ink outside the union is clipped to white').toBe(0);
    });

    it('rejects a non-integer / non-finite offset (device px)', async () => {
        const doc = stripDoc();
        await expect(
            renderLabelPage(doc, {}, { offset: { x: 1.5, y: 0, type: 'inner' } }),
        ).rejects.toThrow(RangeError);
        await expect(
            renderLabelPage(doc, {}, { offset: { x: 0, y: Number.NaN, type: 'inner' } }),
        ).rejects.toThrow(RangeError);
        await expect(
            renderLabelPage(doc, {}, { offset: { x: 0, y: Number.POSITIVE_INFINITY, type: 'outer' } }),
        ).rejects.toThrow(RangeError);
    });

    it('rejects an outer offset whose expanded raster exceeds the pixel cap (invariant 9)', async () => {
        const doc = stripDoc();
        // Base 400×200 px; (400 + 100000) × 200 ≈ 20.1M > 16M.
        await expect(
            renderLabelPage(doc, {}, { offset: { x: 100_000, y: 0, type: 'outer' } }),
        ).rejects.toThrow(RangeError);
    });

    it('treats a {x:0,y:0} offset as a no-op that skips the extra canvas allocation', async () => {
        const doc = stripDoc();
        const spy = vi.spyOn(document, 'createElement');
        const canvasesCreated = (): HTMLCanvasElement[] =>
            spy.mock.results
                .filter((_result, index) => spy.mock.calls[index]![0] === 'canvas')
                .map((result) => result.value as HTMLCanvasElement);
        try {
            spy.mockClear();
            const zero = await renderLabelPage(doc, {}, { offset: { x: 0, y: 0, type: 'inner' } });
            const zeroCanvases = canvasesCreated();
            // Base path: the encoder canvas is the last canvas allocated.
            expect(zeroCanvases[zeroCanvases.length - 1]).toBe(zero.canvas);

            spy.mockClear();
            const shifted = await renderLabelPage(doc, {}, { offset: { x: 0, y: 5, type: 'outer' } });
            const shiftedCanvases = canvasesCreated();
            // Offset path: one extra (offset) canvas, and it is the returned one.
            expect(shiftedCanvases.length).toBe(zeroCanvases.length + 1);
            expect(shiftedCanvases[shiftedCanvases.length - 1]).toBe(shifted.canvas);

            // …and `{0,0}` is byte-identical to the no-offset base render.
            const baseline = await renderLabelPage(doc);
            expect(zero.rgba.data).toEqual(baseline.rgba.data);
        } finally {
            spy.mockRestore();
        }
    });

    it('validates opts.dpi before resolve (no full resolve/template pass)', async () => {
        const doc = partiallyPrintableDoc();
        await expect(renderLabelPage(doc, {}, { dpi: 0 })).rejects.toThrow(RangeError);
        await expect(renderLabelPage(doc, {}, { dpi: Number.NaN })).rejects.toThrow(RangeError);
        await expect(renderLabelPage(doc, {}, { dpi: -5 })).rejects.toThrow(RangeError);
    });
});

describe('renderLabelPage — mirror clip notice (W2 review, round A)', () => {
    /** A 4000×2000 @254dpi doc (400×200 px): printable left half (px 0..150). */
    const asymUnionDoc = (): LabelDoc =>
        createLabelDoc({
            backingW: 4000,
            backingH: 2000,
            dpi: 254,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 1500, h: 2000 }],
            // Black ink px 0..100, fully inside the 0..150 union before the flip.
            nodes: [rect('r', 0, 0, 1000, 2000)],
        });

    it('reports mirror-clipped-ink (lostPx > 0) when the flip pushes ink outside the union', async () => {
        const doc = asymUnionDoc();
        const base = await renderLabelPage(doc);
        expect(base.notices, 'no mirror ⇒ no notice').toBeUndefined();

        const mirrored = await renderLabelPage(doc, {}, { mirror: true });

        expect(mirrored.notices).toHaveLength(1);
        const notice = mirrored.notices?.[0];
        expect(notice?.kind).toBe('mirror-clipped-ink');
        expect(notice?.lostPx, 'mirroring destroyed ink outside the union').toBeGreaterThan(0);
    });

    it('does not emit a notice when the mirrored ink still fits the union', async () => {
        // Full-backing union: the strip mirrors into the other half, still inside.
        const doc = stripDoc();
        const mirrored = await renderLabelPage(doc, {}, { mirror: true });

        // Sanity: the flip really moved the strip (and the render is non-blank).
        expect(pixelAt(mirrored.rgba, mirrored.widthPx - 1 - 50, 100).slice(0, 3)).toEqual([0, 0, 0]);
        expect(mirrored.notices ?? [], 'nothing clipped ⇒ no notice').toEqual([]);
    });
});
