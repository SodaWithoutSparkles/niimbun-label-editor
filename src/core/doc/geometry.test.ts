import { describe, expect, it } from 'vitest';
import type { ImageNode, Node, ShapeNode, TextNode } from './types';
import { clampFontSize, resizeNodeGeometry, sizeFactors, uniformFactor } from './geometry';

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

    it('uses an explicit uniform scale verbatim (no max-collapse bias)', () => {
        // A corner gesture supplies its exact live factor, so a target box that
        // was rounded to a slightly non-uniform pair cannot bias the result.
        expect(sizeFactors({ w: 100, h: 33 }, { w: 150, h: 50 }, true, 1.5)).toEqual({
            sx: 1.5,
            sy: 1.5,
        });
        // The fallback (no explicit factor) still collapses a direct call.
        expect(sizeFactors({ w: 100, h: 33 }, { w: 150, h: 50 }, true)).toEqual({
            sx: 50 / 33,
            sy: 50 / 33,
        });
    });

    it('ignores uniformScale for a free (side-anchor) resize', () => {
        expect(sizeFactors({ w: 100, h: 50 }, { w: 200, h: 50 }, false, 2)).toEqual({
            sx: 2,
            sy: 1,
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

    it('text aspect-preserving seeds the default fontSize when absent', () => {
        const text = textNode({ fontSize: undefined });
        const scaled = resizeNodeGeometry(text, { w: 2000, h: 1000 }, { preserveAspect: true });
        // Uniform factor = max(2, 2) = 2; seed = DEFAULT_FONT_SIZE (300) → 600.
        expect((scaled as TextNode).fontSize).toBe(600);
    });

    it('aspect-lock one-axis shrink is a no-op (the identity factor wins)', () => {
        const image = imageNode({ size: { w: 100, h: 50 } });
        // Shrink x only: rawX = 0.5, rawY = 1 → uniform = max = 1 (unchanged).
        expect(resizeNodeGeometry(image, { w: 50, h: 50 }).size).toEqual({ w: 100, h: 50 });
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

    it('strokeWidth is invariant across resize (rect and line/polygon)', () => {
        // A resize changes geometry only — never the ink width.
        const rect = shapeNode('rectangle', { size: { w: 100, h: 100 }, strokeWidth: 10 });
        const resized = resizeNodeGeometry(rect, { w: 200, h: 200 });
        expect(resized.size).toEqual({ w: 200, h: 200 });
        expect((resized as ShapeNode).strokeWidth).toBe(10);

        // Absent stays absent.
        const bare = shapeNode('rectangle', { size: { w: 100, h: 100 } });
        expect((resizeNodeGeometry(bare, { w: 200, h: 200 }) as ShapeNode).strokeWidth).toBeUndefined();

        // Line/polygon: the points scale, the stroke width holds.
        const line = shapeNode('line', {
            points: [[0, 0], [100, 100]],
            size: { w: 100, h: 100 },
            strokeWidth: 7,
        });
        const resizedLine = resizeNodeGeometry(line, { w: 2000, h: 1000 }, { preserveAspect: false });
        expect((resizedLine as ShapeNode).points).toEqual([[0, 0], [2000, 1000]]);
        expect((resizedLine as ShapeNode).strokeWidth).toBe(7);

        // image/qr/barcode branch: the box scales, the stroke width holds. Cover
        // both a free and an aspect-preserving resize (the third `scaleStroke`
        // removal lived in this branch).
        const image = imageNode({ size: { w: 100, h: 50 }, strokeWidth: 5 });
        const freeImage = resizeNodeGeometry(image, { w: 200, h: 200 }, { preserveAspect: false });
        expect((freeImage as ImageNode).size).toEqual({ w: 200, h: 200 });
        expect((freeImage as ImageNode).strokeWidth).toBe(5);

        const aspectImage = resizeNodeGeometry(image, { w: 200, h: 200 }, { preserveAspect: true });
        expect((aspectImage as ImageNode).strokeWidth).toBe(5);

        // Absent stays absent for the image branch too.
        const bareImage = imageNode({ size: { w: 100, h: 50 } });
        expect((resizeNodeGeometry(bareImage, { w: 200, h: 200 }) as ImageNode).strokeWidth).toBeUndefined();
    });
});

describe('resizeNodeGeometry — line/polygon points', () => {
    it('scales each point by (sx, sy) relative to the points extent', () => {
        // Points extent is 100×100; target 2000×1000 → sx=20, sy=10 (free).
        const line = shapeNode('line', { points: [[0, 0], [100, 100]], size: { w: 100, h: 100 } });
        const resized = resizeNodeGeometry(line, { w: 2000, h: 1000 }, { preserveAspect: false });
        expect((resized as ShapeNode).points).toEqual([[0, 0], [2000, 1000]]);
        // `size` is not touched for points-based shapes.
        expect(resized.size).toEqual({ w: 100, h: 100 });
    });

    it('scales a non-square polygon by its own extent, not size/DEFAULT (fix 2)', () => {
        // Real extent: w=30, h=10. Target aspect differs from DEFAULT_CONTENT_SIZE
        // and from `size`, so only real-extent scaling gives these numbers.
        const poly = shapeNode('polygon', {
            points: [[0, 0], [30, 10]],
            size: { w: 1000, h: 1000 },
            closed: true,
        });
        const resized = resizeNodeGeometry(poly, { w: 300, h: 50 }, { preserveAspect: false });
        // sx = 300/30 = 10, sy = 50/10 = 5 → [[0,0],[300,50]].
        expect((resized as ShapeNode).points).toEqual([[0, 0], [300, 50]]);
        expect((resized as ShapeNode).closed).toBe(true);
    });

    it('line/polygon free-resize scales proportionally to real extent (fix 4)', () => {
        const poly = shapeNode('polygon', { points: [[10, 20], [30, 40]], closed: true });
        // Empty points? No: extent 20×20; target 1000×500 → free → sx=50, sy=25.
        const resized = resizeNodeGeometry(poly, { w: 1000, h: 500 }, { preserveAspect: false });
        expect((resized as ShapeNode).points).toEqual([[500, 500], [1500, 1000]]);
        expect((resized as ShapeNode).closed).toBe(true);
    });

    it('a point-less line falls back to its size as the base extent (fix 10 seed)', () => {
        const line = shapeNode('line', { size: { w: 200, h: 100 } });
        const resized = resizeNodeGeometry(line, { w: 400, h: 400 }, { preserveAspect: false });
        // No points → scaling cannot invent geometry, so points stay [].
        expect((resized as ShapeNode).points).toEqual([]);
    });
});

describe('resizeNodeGeometry — rounding and clamps', () => {
    it('rounds hm results to integers', () => {
        const rect = shapeNode('rectangle', { size: { w: 100, h: 100 } });
        const resized = resizeNodeGeometry(rect, { w: 133.7, h: 66.2 }, { preserveAspect: false });
        expect(resized.size).toEqual({ w: 134, h: 66 });
        expect(Number.isInteger(resized.size!.w)).toBe(true);
    });

    it('clamps size.w/h at 0 (free resize)', () => {
        const text = textNode();
        const resized = resizeNodeGeometry(text, { w: -50, h: 0 }, { preserveAspect: false });
        expect(resized.size).toEqual({ w: 0, h: 0 });
    });

    it('clampFontSize rounds first, then keeps the result strictly positive', () => {
        // A tiny positive value rounds to 0 and must become 1, not 0.
        expect(clampFontSize(0.4)).toBe(1);
        expect(clampFontSize(0)).toBe(1);
        expect(clampFontSize(-5)).toBe(1);
        expect(clampFontSize(0.5)).toBe(1);
        expect(clampFontSize(300)).toBe(300);
        expect(clampFontSize(123.4)).toBe(123);
    });

    it('never mutates the input node', () => {
        const rect = shapeNode('rectangle', { size: { w: 100, h: 100 }, cornerRadius: 20 });
        const snapshot = structuredClone(rect) as Node;
        resizeNodeGeometry(rect, { w: 10, h: 10 }, { preserveAspect: false });
        expect(rect).toEqual(snapshot);
    });
});
