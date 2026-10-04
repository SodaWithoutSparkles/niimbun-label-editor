import { describe, expect, it } from 'vitest';
import type { ImageNode, ShapeNode, TextNode } from '../core/doc/types';
import { dragOriginOf, movePatch, preserveAspectFor, transformEndPatch, transformerTargetSize } from './transformGesture';

const image = (over: Partial<ImageNode> = {}): ImageNode => ({
    id: 'i',
    parentId: null,
    type: 'image',
    imageId: 'img',
    visible: true,
    locked: false,
    transform: { x: 10, y: 20, rotDeg: 45, scaleX: 1.5, scaleY: 0.5 },
    size: { w: 100, h: 50 },
    ...over,
});

const ellipse = (): ShapeNode => ({
    id: 'e',
    parentId: null,
    type: 'shape',
    shape: 'ellipse',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    size: { w: 100, h: 50 },
});

const rect = (): ShapeNode => ({ ...ellipse(), id: 'r', shape: 'rectangle' });

const text = (): TextNode => ({
    id: 't',
    parentId: null,
    type: 'text',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    text: { kind: 'static', value: 'hi' },
    size: { w: 100, h: 50 },
    fontSize: 300,
});

describe('movePatch (drag preserves rot/scale)', () => {
    it('carries the node own rotDeg/scaleX/scaleY unchanged', () => {
        const origin = dragOriginOf(image());
        const patch = movePatch(origin, 5, -3);
        expect(patch.transform).toEqual({ x: 15, y: 17, rotDeg: 45, scaleX: 1.5, scaleY: 0.5 });
    });

    it('rounds only the moved x/y', () => {
        const patch = movePatch(dragOriginOf(image()), 0.4, -0.6);
        expect(patch.transform.x).toBe(10);
        expect(patch.transform.y).toBe(19);
    });
});

describe('transformEndPatch (one-op transform)', () => {
    it('commits the live decomposed x/y/rotation and bakes the size', () => {
        // A top/left-anchor resize leaves the opposite corner fixed by moving the
        // node's x/y; those MUST be committed or the node jumps on release.
        const patch = transformEndPatch(rect(), { w: 200, h: 100 }, false, {
            x: -50,
            y: -25,
            rotDeg: 30,
        });
        expect((patch as { size?: { w: number; h: number } }).size).toEqual({ w: 200, h: 100 });
        expect(patch.transform).toEqual({ x: -50, y: -25, rotDeg: 30, scaleX: 1, scaleY: 1 });
    });

    it('rounds the live translation to integer hm', () => {
        const patch = transformEndPatch(rect(), { w: 200, h: 100 }, false, {
            x: 10.6,
            y: -3.5,
            rotDeg: 0,
        });
        expect(patch.transform?.x).toBe(11);
        expect(patch.transform?.y).toBe(-3);
    });

    it('a rotate-only gesture keeps x/y at their live values', () => {
        const source = rect();
        // Konva may leave x/y unchanged for a pure rotate about the node origin.
        const patch = transformEndPatch(source, { w: 100, h: 50 }, false, {
            x: source.transform.x,
            y: source.transform.y,
            rotDeg: 45,
        });
        expect(patch.transform).toEqual({ x: 0, y: 0, rotDeg: 45, scaleX: 1, scaleY: 1 });
    });

    it('aspect-preserving image keeps proportion through the combined op', () => {
        const patch = transformEndPatch(image(), { w: 200, h: 50 }, true, { x: 10, y: 20, rotDeg: 0 });
        // sizeFactors(100x50 → 200x50, preserve) collapses to f=2.
        expect((patch as { size?: { w: number; h: number } }).size).toEqual({ w: 200, h: 100 });
        expect(patch.transform).toEqual({ x: 10, y: 20, rotDeg: 0, scaleX: 1, scaleY: 1 });
    });

    it('free resize leaves the box independent', () => {
        const patch = transformEndPatch(rect(), { w: 200, h: 150 }, false, { x: 0, y: 0, rotDeg: 0 });
        expect((patch as { size?: { w: number; h: number } }).size).toEqual({ w: 200, h: 150 });
    });
});

describe('preserveAspectFor', () => {
    it('defaults to aspect-preserving for ellipse/image/QR and free otherwise', () => {
        expect(preserveAspectFor(ellipse(), false)).toBe(true);
        expect(preserveAspectFor(image(), false)).toBe(true);
        expect(preserveAspectFor(rect(), false)).toBe(false);
        expect(preserveAspectFor(text(), false)).toBe(false);
    });

    it('inverts the default when the gesture modifier is held', () => {
        expect(preserveAspectFor(ellipse(), true)).toBe(false);
        expect(preserveAspectFor(rect(), true)).toBe(true);
    });
});

describe('transformerTargetSize (must-fix #2)', () => {
    it('scales the real base extent by the live Transformer scale', () => {
        expect(transformerTargetSize({ w: 100, h: 50 }, 2, 3)).toEqual({ w: 200, h: 150 });
        // A negative (flipped) scale uses its magnitude.
        expect(transformerTargetSize({ w: 100, h: 50 }, -2, -4)).toEqual({ w: 200, h: 200 });
        // A zero scale falls back to 1 (never collapses the geometry).
        expect(transformerTargetSize({ w: 100, h: 50 }, 0, 0)).toEqual({ w: 100, h: 50 });
    });

    it('resizes a line from its points extent, not a fixed box', () => {
        const line: ShapeNode = {
            id: 'l',
            parentId: null,
            type: 'shape',
            shape: 'line',
            visible: true,
            locked: false,
            transform: { x: 0, y: 0, rotDeg: 0, scaleX: 2, scaleY: 1 },
            points: [
                [0, 0],
                [1500, 0],
            ],
        };
        // pointsExtent([[0,0],[1500,0]]) = 1500 x 0; scaleX 2 doubles the line.
        const target = transformerTargetSize({ w: 1500, h: 0 }, line.transform.scaleX, line.transform.scaleY);
        const patch = transformEndPatch(line, { w: target.w, h: target.h }, false, { x: 0, y: 0, rotDeg: 0 });
        expect((patch as { points?: [number, number][] }).points).toEqual([
            [0, 0],
            [3000, 0],
        ]);
        // The transform scale is baked out, so the commit is one op.
        expect(patch.transform).toEqual({ x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 });
    });
});
