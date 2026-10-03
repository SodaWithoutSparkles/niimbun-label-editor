import { describe, expect, it } from 'vitest';
import type { ImageNode, ShapeNode, TextNode } from '../core/doc/types';
import { dragOriginOf, movePatch, preserveAspectFor, transformEndPatch } from './transformGesture';

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
    it('bakes size and resets the live scale to 1, keeping the new rotation', () => {
        const patch = transformEndPatch(rect(), { w: 200, h: 100 }, false, 30);
        expect((patch as { size?: { w: number; h: number } }).size).toEqual({ w: 200, h: 100 });
        expect(patch.transform).toEqual({ x: 0, y: 0, rotDeg: 30, scaleX: 1, scaleY: 1 });
    });

    it('aspect-preserving image keeps proportion through the combined op', () => {
        const patch = transformEndPatch(image(), { w: 200, h: 50 }, true, 0);
        // sizeFactors(100x50 → 200x50, preserve) collapses to f=2.
        expect((patch as { size?: { w: number; h: number } }).size).toEqual({ w: 200, h: 100 });
    });

    it('free resize leaves the box independent', () => {
        const patch = transformEndPatch(rect(), { w: 200, h: 150 }, false, 0);
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
