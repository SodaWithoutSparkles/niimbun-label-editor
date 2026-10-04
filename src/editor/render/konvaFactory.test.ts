import { beforeAll, describe, expect, it } from 'vitest';
import Konva from 'konva';
import type { LabelDoc, Node } from '../../core/doc/types';
import { createLabelDoc } from '../../core/doc/factory';
import type { Mat2D } from '../../core/doc/derive';
import { resolve } from './resolve';
import type { PreparedAsset } from './assets';
import { createKonvaNode, matrixToKonvaAttrs } from './konvaFactory';

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
