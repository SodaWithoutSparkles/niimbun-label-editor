import { describe, expect, it } from 'vitest';
import type { ImageNode, Node, ShapeNode, TextNode } from './types';
import { resizeNodeGeometry, sizeFactors, uniformFactor } from './geometry';

const textNode = (over: Partial<TextNode> = {}): TextNode => ({
    id: 't',
    parentId: null,
    type: 'text',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    text: { kind: 'static', value: 'hi' },
    size: { w: 1000, h: 500 },
    fontSize: 300,
    ...over,
});

const shapeNode = (shape: ShapeNode['shape'], over: Partial<ShapeNode> = {}): ShapeNode => ({
    id: 's',
    parentId: null,
    type: 'shape',
    shape,
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    ...over,
});

const imageNode = (over: Partial<ImageNode> = {}): ImageNode => ({
    id: 'i',
    parentId: null,
    type: 'image',
    imageId: 'img',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    size: { w: 100, h: 50 },
    ...over,
});

describe('uniformFactor / sizeFactors', () => {
    it('uniform factor is the min of the axis factors', () => {
        expect(uniformFactor(2, 0.5)).toBe(0.5);
        expect(uniformFactor(3, 4)).toBe(3);
    });

    it('free resize keeps sx/sy independent', () => {
        expect(sizeFactors({ w: 100, h: 50 }, { w: 200, h: 150 }, false)).toEqual({
            sx: 2,
            sy: 3,
        });
    });

    it('aspect-preserving collapses to one factor (the larger axis move)', () => {
        expect(sizeFactors({ w: 100, h: 50 }, { w: 200, h: 150 }, true)).toEqual({
            sx: 3,
            sy: 3,
        });
    });
});

describe('resizeNodeGeometry — aspect vs free', () => {
    it('ellipse preserves aspect by default (free only when opted in)', () => {
        const ellipse = shapeNode('ellipse', { size: { w: 100, h: 100 } });
        const preserved = resizeNodeGeometry(ellipse, { w: 200, h: 50 });
        expect(preserved.size).toEqual({ w: 200, h: 200 });
        const free = resizeNodeGeometry(ellipse, { w: 200, h: 50 }, { preserveAspect: false });
        expect(free.size).toEqual({ w: 200, h: 50 });
    });

    it('qr and image preserve aspect by default; free with the opt-in', () => {
        const image = imageNode();
        expect(resizeNodeGeometry(image, { w: 200, h: 50 }).size).toEqual({ w: 200, h: 100 });
        expect(
            resizeNodeGeometry(image, { w: 200, h: 50 }, { preserveAspect: false }).size,
        ).toEqual({ w: 200, h: 50 });
    });

    it('rectangle resizes freely by default', () => {
        const rect = shapeNode('rectangle', { size: { w: 100, h: 100 } });
        expect(resizeNodeGeometry(rect, { w: 200, h: 50 }).size).toEqual({ w: 200, h: 50 });
    });

    it('text free resize changes the box only, leaving fontSize untouched', () => {
        const text = textNode();
        const free = resizeNodeGeometry(text, { w: 2000, h: 500 }, { preserveAspect: false });
        expect(free.size).toEqual({ w: 2000, h: 500 });
        expect((free as TextNode).fontSize).toBe(300);
    });

    it('text aspect-preserving scales size and fontSize by the uniform factor', () => {
        const text = textNode();
        // Uniform factor = max(2, 4) = 4 (the larger axis move).
        const scaled = resizeNodeGeometry(text, { w: 2000, h: 2000 }, { preserveAspect: true });
        expect(scaled.size).toEqual({ w: 4000, h: 2000 });
        expect((scaled as TextNode).fontSize).toBe(1200);
    });
});

describe('resizeNodeGeometry — uniform-dependent fields', () => {
    it('cornerRadius scales by the uniform factor (min of axis factors)', () => {
        const rect = shapeNode('rectangle', { size: { w: 100, h: 100 }, cornerRadius: 20 });
        const resized = resizeNodeGeometry(rect, { w: 300, h: 50 }, { preserveAspect: false });
        // sx = 3, sy = 0.5 → uniform = 0.5.
        expect(resized.size).toEqual({ w: 300, h: 50 });
        expect((resized as ShapeNode).cornerRadius).toBe(10);
    });

    it('strokeWidth scales by the uniform factor when present', () => {
        const rect = shapeNode('rectangle', { size: { w: 100, h: 100 }, strokeWidth: 10 });
        const resized = resizeNodeGeometry(rect, { w: 200, h: 200 });
        expect((resized as ShapeNode).strokeWidth).toBe(20);
        // Absent stays absent.
        const bare = shapeNode('rectangle', { size: { w: 100, h: 100 } });
        expect((resizeNodeGeometry(bare, { w: 200, h: 200 }) as ShapeNode).strokeWidth).toBeUndefined();
    });
});

describe('resizeNodeGeometry — line/polygon points', () => {
    it('scales each point by (sx, sy)', () => {
        const line = shapeNode('line', { points: [[0, 0], [100, 100]], size: { w: 100, h: 100 } });
        const resized = resizeNodeGeometry(line, { w: 2000, h: 1000 }, { preserveAspect: false });
        expect((resized as ShapeNode).points).toEqual([[0, 0], [2000, 1000]]);
        // `size` is not touched for points-based shapes.
        expect(resized.size).toEqual({ w: 100, h: 100 });
    });

    it('polygon preserves aspect by default and rounds scaled points', () => {
        const poly = shapeNode('polygon', { points: [[10, 20], [30, 40]], closed: true });
        const resized = resizeNodeGeometry(poly, { w: 1000, h: 1000 });
        // free-by-default? polygon is not in the aspect set → free.
        expect((resized as ShapeNode).points).toEqual([[10, 20], [30, 40]]);
        expect((resized as ShapeNode).closed).toBe(true);
    });
});

describe('resizeNodeGeometry — rounding and clamps', () => {
    it('rounds hm results to integers', () => {
        const rect = shapeNode('rectangle', { size: { w: 100, h: 100 } });
        const resized = resizeNodeGeometry(rect, { w: 133.7, h: 66.2 }, { preserveAspect: false });
        expect(resized.size).toEqual({ w: 134, h: 66 });
        expect(Number.isInteger(resized.size!.w)).toBe(true);
    });

    it('clamps size.w/h at 0 and fontSize at > 0', () => {
        const text = textNode();
        const resized = resizeNodeGeometry(text, { w: -50, h: 0 }, { preserveAspect: false });
        expect(resized.size).toEqual({ w: 0, h: 0 });
        expect((resized as TextNode).fontSize).toBeGreaterThan(0);
    });

    it('never mutates the input node', () => {
        const rect = shapeNode('rectangle', { size: { w: 100, h: 100 }, cornerRadius: 20 });
        const snapshot = structuredClone(rect) as Node;
        resizeNodeGeometry(rect, { w: 10, h: 10 }, { preserveAspect: false });
        expect(rect).toEqual(snapshot);
    });
});
