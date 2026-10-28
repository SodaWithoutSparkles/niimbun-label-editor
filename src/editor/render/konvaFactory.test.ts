// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import Konva from 'konva';
import type { LabelDoc, Node } from '../../core/doc/types';
import { createLabelDoc } from '../../core/doc/factory';
import type { Mat2D } from '../../core/doc/derive';
import { resolve } from './resolve';
import type { PreparedAsset } from './assets';
import {
    createKonvaNode,
    matrixToKonvaAttrs,
    shapeStyleAttrs,
    symbolSceneFunc,
    type ResolvedShapeNode,
} from './konvaFactory';

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const doc = (): LabelDoc =>
    createLabelDoc({
        backingW: 3000,
        backingH: 2000,
        regions: [{ kind: 'rect', x: 0, y: 0, w: 3000, h: 2000 }],
        nodes: [
            node({
                id: 't',
                parentId: null,
                type: 'text',
                visible: true,
                locked: false,
                transform: { x: 10, y: 20, rotDeg: 0, scaleX: 1, scaleY: 1 },
                text: { kind: 'static', value: 'hi' },
                size: { w: 100, h: 40 },
            }),
            node({
                id: 'r',
                parentId: null,
                type: 'shape',
                shape: 'rectangle',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                size: { w: 50, h: 60 },
            }),
            node({
                id: 'e',
                parentId: null,
                type: 'shape',
                shape: 'ellipse',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                size: { w: 80, h: 40 },
            }),
            node({
                id: 'l',
                parentId: null,
                type: 'shape',
                shape: 'line',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                points: [[0, 0], [10, 10]],
                closed: false,
            }),
            node({
                id: 'g',
                parentId: null,
                type: 'group',
                visible: true,
                locked: false,
                transform: { x: 100, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
            }),
            node({
                id: 'gc',
                parentId: 'g',
                type: 'text',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                text: { kind: 'static', value: 'child' },
                size: { w: 30, h: 30 },
            }),
            node({
                id: 'p',
                parentId: null,
                type: 'shape',
                shape: 'polygon',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                points: [[0, 0], [10, 0], [10, 10]],
                closed: true,
            }),
        ],
    });

const resolved = () => resolve(doc());
const byId = (id: string) => {
    const found = resolved().find((n) => n.id === id);
    if (!found) throw new Error(`missing resolved node ${id}`);
    return found;
};

beforeAll(() => {
    // happy-dom has no 2D canvas implementation. Konva's Shape constructor probes
    // canvas farbling and its Text layout measures via a dummy context; give both
    // a minimal stub so plain-Konva nodes can be constructed headless.
    (Konva.Util as unknown as { isCanvasFarblingActive: () => boolean }).isCanvasFarblingActive =
        () => false;
    const fakeContext = {
        font: '',
        measureText: (text: string) => ({ width: text.length * 10 }),
        clearRect: () => undefined,
        fillRect: () => undefined,
        getImageData: () => ({ data: new Uint8ClampedArray(400) }),
    };
    HTMLCanvasElement.prototype.getContext = (() =>
        fakeContext) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

describe('createKonvaNode — plain Konva, no react-konva', () => {
    it('maps each resolved kind to the matching Konva class', () => {
        expect(createKonvaNode(byId('t'))).toBeInstanceOf(Konva.Text);
        expect(createKonvaNode(byId('r'))).toBeInstanceOf(Konva.Rect);
        expect(createKonvaNode(byId('e'))).toBeInstanceOf(Konva.Ellipse);
        expect(createKonvaNode(byId('l'))).toBeInstanceOf(Konva.Line);
        expect(createKonvaNode(byId('p'))).toBeInstanceOf(Konva.Line);
        expect(createKonvaNode(byId('g'))).toBeInstanceOf(Konva.Group);
    });

    it('carries resolved geometry onto the Konva node', () => {
        const text = createKonvaNode(byId('t')) as Konva.Text;
        expect(text.text()).toBe('hi');
        expect(text.width()).toBe(100);
        const rect = createKonvaNode(byId('r')) as Konva.Rect;
        expect(rect.width()).toBe(50);
        expect(rect.height()).toBe(60);
        const ellipse = createKonvaNode(byId('e')) as Konva.Ellipse;
        expect(ellipse.radiusX()).toBe(40);
        expect(ellipse.radiusY()).toBe(20);
        const polygon = createKonvaNode(byId('p')) as Konva.Line;
        expect(polygon.closed()).toBe(true);
        expect(polygon.points()).toEqual([0, 0, 10, 0, 10, 10]);
    });

    it('nests group children', () => {
        const group = createKonvaNode(byId('g')) as Konva.Group;
        expect(group.getChildren()).toHaveLength(1);
        expect(group.getChildren()[0]).toBeInstanceOf(Konva.Text);
    });

    it('keeps the fit offset on the image and the node transform on a wrapping group', () => {
        const doc = createLabelDoc({
            backingW: 3000,
            backingH: 2000,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 3000, h: 2000 }],
            nodes: [
                node({
                    id: 'img',
                    parentId: null,
                    type: 'image',
                    visible: true,
                    locked: false,
                    transform: { x: 100, y: 50, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    imageId: 'i1',
                    size: { w: 2000, h: 1000 },
                }),
            ],
        });
        const asset: PreparedAsset = {
            image: {} as CanvasImageSource,
            widthPx: 100,
            heightPx: 100,
        };
        const konva = createKonvaNode(resolve(doc)[0]!, new Map([['img', asset]]));

        expect(konva).toBeInstanceOf(Konva.Group);
        const group = konva as Konva.Group;
        expect(group.x(), 'node transform lives on the group').toBe(100);
        expect(group.y()).toBe(50);
        expect(group.getChildren()).toHaveLength(1);
        const img = group.getChildren()[0] as Konva.Image;
        expect(img).toBeInstanceOf(Konva.Image);
        // contain: 2000×1000 box, 100×100 asset → 1000×1000 centred at x=500.
        expect(img.x(), 'centred fit offset survives on the image').toBe(500);
        expect(img.y()).toBe(0);
        expect(img.width()).toBe(1000);
        expect(img.height()).toBe(1000);
    });

    it('stretches a barcode across the whole box with no crop; qr stays contain', () => {
        const fitDoc = createLabelDoc({
            backingW: 3000,
            backingH: 2000,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 3000, h: 2000 }],
            nodes: [
                node({
                    id: 'bc',
                    parentId: null,
                    type: 'barcode',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    data: { kind: 'static', value: '123456789012' },
                    size: { w: 1000, h: 300 },
                }),
                node({
                    id: 'q',
                    parentId: null,
                    type: 'qr',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    data: { kind: 'static', value: 'hello' },
                    size: { w: 1000, h: 300 },
                }),
            ],
        });
        // A non-matching 4:1 raster in a 10:3 box: `contain` would letterbox it,
        // `cover` would crop it, so the fit choice is observable on every attr.
        const assets = new Map<string, PreparedAsset>([
            ['bc', { image: {} as CanvasImageSource, widthPx: 400, heightPx: 100 }],
            ['q', { image: {} as CanvasImageSource, widthPx: 100, heightPx: 100 }],
        ]);
        const imageOf = (id: string): Konva.Image => {
            const found = resolve(fitDoc).find((n) => n.id === id);
            if (!found) throw new Error(`missing node ${id}`);
            return (createKonvaNode(found, assets) as Konva.Group).getChildren()[0] as Konva.Image;
        };

        const bc = imageOf('bc');
        expect(bc.x(), 'barcode draws from the box origin').toBe(0);
        expect(bc.y()).toBe(0);
        expect(bc.width(), 'barcode fills the box width').toBe(1000);
        expect(bc.height(), 'barcode fills the box height').toBe(300);
        expect(bc.crop(), 'barcode never crops its quiet zone/end bars').toEqual({
            x: 0,
            y: 0,
            width: 0,
            height: 0,
        });

        // Regression guard for scope creep: 2D `qr` keeps the centre-containment.
        // 100×100 square in a 1000×300 box → 300×300 at x=350.
        const qr = imageOf('q');
        expect(qr.x()).toBe(350);
        expect(qr.y()).toBe(0);
        expect(qr.width()).toBe(300);
        expect(qr.height()).toBe(300);
        expect(qr.crop(), 'contain never crops').toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });
});

describe('symbol draw — nearest-neighbour sceneFunc (option D)', () => {
    it('attaches the symbol sceneFunc to qr/barcode images but not photos', () => {
        const localDoc = createLabelDoc({
            backingW: 3000,
            backingH: 2000,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 3000, h: 2000 }],
            nodes: [
                node({
                    id: 'img',
                    parentId: null,
                    type: 'image',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    imageId: 'i1',
                    size: { w: 100, h: 100 },
                }),
                node({
                    id: 'q',
                    parentId: null,
                    type: 'qr',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    data: { kind: 'static', value: 'hello' },
                    size: { w: 100, h: 100 },
                }),
                node({
                    id: 'bc',
                    parentId: null,
                    type: 'barcode',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    data: { kind: 'static', value: '123456789012' },
                    size: { w: 100, h: 100 },
                }),
            ],
        });
        const nodes = resolve(localDoc);
        const assets = new Map<string, PreparedAsset>([
            ['img', { image: {} as CanvasImageSource, widthPx: 100, heightPx: 100 }],
            ['q', { image: {} as CanvasImageSource, widthPx: 100, heightPx: 100 }],
            ['bc', { image: {} as CanvasImageSource, widthPx: 100, heightPx: 100 }],
        ]);
        const imageOf = (id: string): Konva.Image => {
            const found = nodes.find((n) => n.id === id);
            if (!found) throw new Error(`missing node ${id}`);
            const group = createKonvaNode(found, assets) as Konva.Group;
            return group.getChildren()[0] as Konva.Image;
        };

        // Photos keep Konva's default `_sceneFunc` (smoothing on).
        expect(imageOf('img').getSceneFunc()).not.toBe(symbolSceneFunc);
        expect(imageOf('q').getSceneFunc()).toBe(symbolSceneFunc);
        expect(imageOf('bc').getSceneFunc()).toBe(symbolSceneFunc);
    });

    const fakeShape = (attrs: Record<string, unknown>, size: { w: number; h: number }) =>
        ({
            attrs,
            width: () => size.w,
            height: () => size.h,
            hasFill: () => false,
            hasStroke: () => false,
            cornerRadius: () => 0,
            cropX: () => 0,
            cropY: () => 0,
        }) as unknown as Konva.Shape;

    const fakeContext = (raw: { imageSmoothingEnabled: boolean; drawImage: () => void }) =>
        ({
            _context: raw,
            drawImage: () => raw.drawImage(),
            beginPath: () => undefined,
            rect: () => undefined,
            closePath: () => undefined,
            fillStrokeShape: () => undefined,
        }) as unknown as Konva.Context;

    it('disables smoothing during the draw and restores it in finally', () => {
        let duringDraw: boolean | undefined;
        const raw = {
            imageSmoothingEnabled: true,
            drawImage: () => {
                duringDraw = raw.imageSmoothingEnabled;
            },
        };
        symbolSceneFunc(fakeContext(raw), fakeShape({ image: {} }, { w: 20, h: 10 }));

        expect(duringDraw, 'smoothing off for the symbol draw').toBe(false);
        expect(raw.imageSmoothingEnabled, 'context state restored').toBe(true);
    });

    it('restores smoothing even when the draw throws', () => {
        const raw = {
            imageSmoothingEnabled: true,
            drawImage: () => {
                throw new Error('boom');
            },
        };
        expect(() =>
            symbolSceneFunc(fakeContext(raw), fakeShape({ image: {} }, { w: 20, h: 10 })),
        ).toThrow('boom');
        expect(raw.imageSmoothingEnabled).toBe(true);
    });

    it('draws a cropped (cover) asset through the source-rect path', () => {
        let drawCalls = 0;
        const raw = {
            imageSmoothingEnabled: true,
            drawImage: () => {
                drawCalls++;
            },
        };
        const shape = fakeShape({ image: {}, cropWidth: 5, cropHeight: 5 }, { w: 40, h: 20 });
        symbolSceneFunc(fakeContext(raw), shape);

        expect(drawCalls).toBe(1);
        expect(raw.imageSmoothingEnabled).toBe(true);
    });
});

describe('shape static style — preview ≡ print (#8)', () => {
    it('createKonvaNode reads the resolved fill/stroke/strokeWidth/cornerRadius', () => {
        const rect = createKonvaNode(byId('r')) as Konva.Rect;
        expect(rect.fill(), 'no fill resolves to the explicit transparent string').toBe('transparent');
        expect(rect.stroke()).toBe('#374151');
        expect(rect.strokeWidth()).toBe(50);
        expect(rect.cornerRadius()).toBe(0);

        const ellipse = createKonvaNode(byId('e')) as Konva.Ellipse;
        expect(ellipse.fill()).toBe('transparent');
        expect(ellipse.stroke()).toBe('#374151');
        expect(ellipse.strokeWidth()).toBe(50);

        const line = createKonvaNode(byId('l')) as Konva.Line;
        expect(line.fill(), 'open line has transparent fill').toBe('transparent');
        expect(line.stroke()).toBe('#374151');
        expect(line.strokeWidth()).toBe(50);

        const polygon = createKonvaNode(byId('p')) as Konva.Line;
        expect(polygon.fill(), 'closed polygon has transparent fill by default').toBe('transparent');
        expect(polygon.closed()).toBe(true);
    });

    it('shapeStyleAttrs is the single source both renderers read', () => {
        // The preview (`ResolvedShape.tsx`) and the print factory both call this,
        // so the two renderers cannot diverge on style. `fill` is always a real
        // string; `'transparent'` is the no-fill value.
        const rect = byId('r') as ResolvedShapeNode;
        expect(shapeStyleAttrs(rect)).toStrictEqual({
            fill: 'transparent',
            stroke: '#374151',
            strokeWidth: 50,
            cornerRadius: 0,
        });
        const line = byId('l') as ResolvedShapeNode;
        expect(shapeStyleAttrs(line)).toStrictEqual({
            fill: 'transparent',
            stroke: '#374151',
            strokeWidth: 50,
        });
    });
});

describe('matrixToKonvaAttrs — exact affine decomposition', () => {
    const matrices: Mat2D[] = [
        { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 },
        { a: 0, b: 1, c: -1, d: 0, e: 5, f: 6 },
        { a: 2, b: 0, c: 0, d: 3, e: 0, f: 0 },
        { a: 1, b: 0, c: 0.5, d: 1, e: 0, f: 0 },
        { a: 2, b: 1, c: 0.3, d: 3, e: 4, f: 5 },
    ];

    it('reproduces the source matrix through a real Konva node', () => {
        for (const m of matrices) {
            const konvaNode = new Konva.Rect({ width: 1, height: 1 });
            konvaNode.setAttrs(matrixToKonvaAttrs(m));
            const got = konvaNode.getTransform().getMatrix();
            expect(got[0], `a for ${JSON.stringify(m)}`).toBeCloseTo(m.a, 8);
            expect(got[1], `b for ${JSON.stringify(m)}`).toBeCloseTo(m.b, 8);
            expect(got[2], `c for ${JSON.stringify(m)}`).toBeCloseTo(m.c, 8);
            expect(got[3], `d for ${JSON.stringify(m)}`).toBeCloseTo(m.d, 8);
            expect(got[4], `e for ${JSON.stringify(m)}`).toBeCloseTo(m.e, 8);
            expect(got[5], `f for ${JSON.stringify(m)}`).toBeCloseTo(m.f, 8);
        }
    });
});

describe('createKonvaNode — text wrap (P5 D1/D2a)', () => {
    // The fake 2D context in `beforeAll` measures every glyph at 10px, which
    // makes the shrink math deterministic without a font dependency.
    const buildNode = (over: Record<string, unknown> = {}): Konva.Group | Konva.Shape => {
        const doc = createLabelDoc({
            id: 'doc-wrap',
            now: 1_700_000_000,
            backingW: 3000,
            backingH: 2000,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 3000, h: 2000 }],
            nodes: [
                node({
                    id: 'tw',
                    parentId: null,
                    type: 'text',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    text: { kind: 'static', value: 'hi' },
                    size: { w: 100, h: 40 },
                    ...over,
                }),
            ],
        });
        return createKonvaNode(resolve(doc)[0]!);
    };
    const buildText = (over: Record<string, unknown> = {}): Konva.Text =>
        buildNode(over) as Konva.Text;

    it("defaults to Konva's word wrap and lineHeight 1", () => {
        const text = buildText();
        expect(text).toBeInstanceOf(Konva.Text);
        expect(text.wrap()).toBe('word');
        expect(text.lineHeight()).toBe(1);
    });

    it('maps each wrap mode to the Konva wrap prop', () => {
        expect(buildText({ wrap: 'word' }).wrap()).toBe('word');
        expect(buildText({ wrap: 'char' }).wrap()).toBe('char');
        // clip wraps at words (Konva then hides lines past the box height).
        expect(buildText({ wrap: 'clip' }).wrap()).toBe('word');
        expect(buildText({ wrap: 'shrink' }).wrap()).toBe('word');
        // cut never wraps: Konva `wrap: 'none'` (the clip group does the cutting).
        expect(buildNode({ wrap: 'cut' })).toBeInstanceOf(Konva.Group);
        const cutGroup = buildNode({ wrap: 'cut' }) as Konva.Group;
        expect(cutGroup.getChildren().some((child) => child instanceof Konva.Text)).toBe(true);
    });

    it('passes an explicit lineHeight through', () => {
        expect(buildText({ lineHeight: 1.5 }).lineHeight()).toBe(1.5);
    });

    it('defaults letterSpacing to 0 and passes an explicit value through', () => {
        expect(buildText({}).letterSpacing()).toBe(0);
        expect(buildText({ letterSpacing: 2 }).letterSpacing()).toBe(2);
    });

    it('preserves a combined bold+italic fontStyle for the print/raster path', () => {
        // Print builds `new Konva.Text({ fontStyle })` from the resolved string;
        // Konva composes the canvas font as `fontStyle + size + family`, so
        // `'bold italic'` must survive verbatim to render a bold glyph.
        expect(buildText().fontStyle()).toBe('normal');
        expect(buildText({ fontStyle: 'bold' }).fontStyle()).toBe('bold');
        expect(buildText({ fontStyle: 'italic' }).fontStyle()).toBe('italic');
        expect(buildText({ fontStyle: 'bold italic' }).fontStyle()).toBe('bold italic');
    });

    it('does not upscale a short string in shrink mode', () => {
        const text = buildText({
            text: { kind: 'static', value: 'hi' },
            size: { w: 100, h: 40 },
            fontSize: 10,
            lineHeight: 1,
            wrap: 'shrink',
        });
        expect(text.scaleX()).toBe(1);
        expect(text.scaleY()).toBe(1);
    });

    it('uniformly downscales an overflowing string in shrink mode to fit the box', () => {
        const w = 100;
        const h = 40;
        const text = buildText({
            text: { kind: 'static', value: 'a'.repeat(26) },
            size: { w, h },
            fontSize: 100,
            lineHeight: 1,
            wrap: 'shrink',
        });
        expect(text.scaleX()).toBe(text.scaleY());
        expect(text.scaleX()).toBeGreaterThan(0);
        expect(text.scaleX()).toBeLessThanOrEqual(1);
        // The measured wrapped width, scaled, still fits the box.
        expect(text.getTextWidth() * text.scaleX()).toBeLessThanOrEqual(w + 1);
    });

    it('includes letterSpacing in the shrink-to-fit measurement', () => {
        const overflow = {
            text: { kind: 'static' as const, value: 'a'.repeat(26) },
            size: { w: 100, h: 40 },
            fontSize: 100,
            lineHeight: 1,
            wrap: 'shrink' as const,
        };
        const plain = buildText(overflow);
        const spaced = buildText({ ...overflow, letterSpacing: 20 });
        // Wider glyph run ⇒ a smaller uniform scale; missing this in
        // `measureKonvaText` would overflow the box.
        expect(spaced.scaleX()).toBeLessThan(plain.scaleX());
        expect(spaced.getTextWidth() * spaced.scaleX()).toBeLessThanOrEqual(101);
    });

    it('keeps every wrapped line when shrink scales the box', () => {
        // At the fake context's 10px per glyph, 26 chars in a 100px box wrap to
        // 3 natural lines (10 + 10 + 6), i.e. a 300px natural height. The 40px
        // box only fits them *after* the ~0.133 uniform scale.
        const value = 'a'.repeat(26);
        const text = buildText({
            text: { kind: 'static', value },
            size: { w: 100, h: 40 },
            fontSize: 100,
            lineHeight: 1,
            wrap: 'shrink',
        });
        const scale = text.scaleX();
        expect(scale).toBeLessThan(1);
        // Laying the node out at `height: node.h` (the pre-fix order) makes
        // Konva's fixed-height break drop 2 of the 3 lines before the scale is
        // ever applied — the printed text loss this phase fixes.
        expect(text.textArr).toHaveLength(3);
        expect(text.textArr.map((line) => line.text).join('')).toBe(value);
        // The layout box is the **unscaled** one (`node.h / scale`), so the
        // scaled height is exactly the node box.
        expect(text.height()).toBeCloseTo(40 / scale, 6);
        expect(text.height() * scale).toBeCloseTo(40, 6);
    });

    it('still drops lines past the box height for a non-shrink wrap', () => {
        // The fixed-height behaviour is unchanged for every other wrap: only
        // `shrink` gets the relaxed box.
        const text = buildText({
            text: { kind: 'static', value: 'a'.repeat(26) },
            size: { w: 100, h: 40 },
            fontSize: 100,
            lineHeight: 1,
            wrap: 'word',
        });
        expect(text.height()).toBe(40);
        expect(text.textArr).toHaveLength(1);
    });

    it('never divides by a zero shrink (degenerate box) and still builds the node', () => {
        // A zero-height box measures to `scale === 0` (zero-width lays out no
        // glyphs, so Konva reports a 0×0 measurement and `measureKonvaText`'s own
        // guard keeps scale 1). The relaxed height must never divide by zero for
        // either: no `NaN`, no `Infinity`, and the node must still be built.
        for (const size of [
            { w: 0, h: 40 },
            { w: 100, h: 0 },
        ]) {
            const text = buildText({
                text: { kind: 'static', value: 'a'.repeat(26) },
                size,
                fontSize: 100,
                lineHeight: 1,
                wrap: 'shrink',
            });
            expect(text, JSON.stringify(size)).toBeInstanceOf(Konva.Text);
            expect(Number.isFinite(text.scaleX()), `scaleX for ${JSON.stringify(size)}`).toBe(true);
            expect(Number.isFinite(text.scaleY()), `scaleY for ${JSON.stringify(size)}`).toBe(true);
            expect(Number.isFinite(text.height()), `height for ${JSON.stringify(size)}`).toBe(true);
            expect(Number.isFinite(text.width()), `width for ${JSON.stringify(size)}`).toBe(true);
            // The fallback is the real box (`node.h`), not `node.h / 0`.
            expect(text.height()).toBe(size.h);
            // Built and laid out: a drawable node, not a throwing one.
            expect(Array.isArray(text.textArr)).toBe(true);
        }

        // The exact zero-scale case: a zero-height box. The scale math is
        // untouched (0 stays 0), only the layout height falls back.
        const zeroHeight = buildText({
            text: { kind: 'static', value: 'a'.repeat(26) },
            size: { w: 100, h: 0 },
            fontSize: 100,
            lineHeight: 1,
            wrap: 'shrink',
        });
        expect(zeroHeight.scaleX()).toBe(0);
        expect(zeroHeight.scaleY()).toBe(0);
        expect(zeroHeight.height()).toBe(0);
    });
});

describe('createKonvaNode — cut wrap (P17)', () => {
    // Same 10px-per-glyph fake context as the wrap block above: 26 chars in a
    // 100hm box measure to 260hm, so an un-wrapped line overflows deterministically.
    const buildNode = (over: Record<string, unknown> = {}): Konva.Group | Konva.Shape => {
        const doc = createLabelDoc({
            id: 'doc-cut',
            now: 1_700_000_000,
            backingW: 3000,
            backingH: 2000,
            regions: [{ kind: 'rect', x: 0, y: 0, w: 3000, h: 2000 }],
            nodes: [
                node({
                    id: 'cw',
                    parentId: null,
                    type: 'text',
                    visible: true,
                    locked: false,
                    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                    text: { kind: 'static', value: 'hi' },
                    size: { w: 100, h: 40 },
                    ...over,
                }),
            ],
        });
        return createKonvaNode(resolve(doc)[0]!);
    };

    it('wraps the Text in a clip group bounded by the node box', () => {
        const built = buildNode({ wrap: 'cut' });
        expect(built).toBeInstanceOf(Konva.Group);
        const group = built as Konva.Group;
        expect(group.clipX()).toBe(0);
        expect(group.clipY()).toBe(0);
        expect(group.clipWidth()).toBe(100);
        expect(group.clipHeight()).toBe(40);
        expect(group.getChildren()).toHaveLength(1);

        const text = group.getChildren()[0] as Konva.Text;
        expect(text).toBeInstanceOf(Konva.Text);
        expect(text.wrap()).toBe('none');
        // The fixed width stays: Konva never emits a continuation line under
        // `wrap: 'none'` (it truncates each hard line at the box instead).
        expect(text.width()).toBe(100);
        expect(text.height()).toBe(40);
        // The Text is untransformed: the node transform lives on the clip group,
        // so the clip rect is the node's local box.
        expect(text.x()).toBe(0);
        expect(text.y()).toBe(0);
        expect(text.scaleX()).toBe(1);
        expect(text.scaleY()).toBe(1);
    });

    it('keeps the node transform on the clip group, not the Text', () => {
        const group = buildNode({
            wrap: 'cut',
            transform: { x: 15, y: 25, rotDeg: 90, scaleX: 2, scaleY: 3 },
        }) as Konva.Group;
        const text = group.getChildren()[0] as Konva.Text;
        expect(group.x()).toBe(15);
        expect(group.y()).toBe(25);
        expect(group.rotation()).toBe(90);
        expect(group.scaleX()).toBe(2);
        expect(group.scaleY()).toBe(3);
        expect(text.x()).toBe(0);
        expect(text.rotation()).toBe(0);
        expect(text.scaleX()).toBe(1);
    });

    it('leaves clip as a bare word-wrapping Text (no group)', () => {
        const built = buildNode({ wrap: 'clip' });
        expect(built).toBeInstanceOf(Konva.Text);
        expect((built as Konva.Text).wrap()).toBe('word');
    });

    it('never shrinks a cut text: one hard line, cut at the box width', () => {
        const group = buildNode({
            text: { kind: 'static', value: 'a'.repeat(26) },
            fontSize: 100,
            lineHeight: 1,
            wrap: 'cut',
        }) as Konva.Group;
        const text = group.getChildren()[0] as Konva.Text;
        // No shrink scale anywhere: the node is 1:1 and the clip is the invariant.
        expect(group.scaleX()).toBe(1);
        expect(group.scaleY()).toBe(1);
        expect(text.scaleX()).toBe(1);
        expect(text.scaleY()).toBe(1);
        // No continuation line: the 26-glyph line is cut where the 10px-per-glyph
        // fake context stops fitting the 100hm box, and the remainder is gone.
        expect(text.textArr.map((line) => line.text)).toEqual(['a'.repeat(10)]);
        expect(text.getTextWidth()).toBeLessThanOrEqual(100);
    });

    it('breaks only on hard newlines in cut mode', () => {
        const text = (buildNode({
            wrap: 'cut',
            text: { kind: 'static', value: 'a'.repeat(15) + '\nb' },
            // Two 100hm lines fit the box, so Konva's fixed-height break does not
            // interfere: the only break under test is the hard one.
            size: { w: 100, h: 200 },
            fontSize: 100,
            lineHeight: 1,
        }) as Konva.Group).getChildren()[0] as Konva.Text;
        // The first hard line is cut at the box width (10 glyphs), the second
        // starts a new line: there is no soft continuation line.
        expect(text.textArr.map((line) => line.text)).toEqual(['a'.repeat(10), 'b']);
    });
});
