import { describe, expect, it } from 'vitest';
import type { ImageNode, ShapeNode, TextNode } from '../core/doc/types';
import {
    commitPreservesAspect,
    dragOriginOf,
    gesturePreservesAspect,
    isCornerAnchor,
    movePatch,
    preserveAspectFor,
    rotationOnlyPatch,
    transformEndPatch,
    transformerTargetSize,
} from './transformGesture';

/** Read the committed `size` off a patch (absent for point-based shapes). */
const sizeOf = (patch: ReturnType<typeof transformEndPatch>): { w: number; h: number } | undefined =>
    (patch as { size?: { w: number; h: number } }).size;

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

    it('corner gesture keeps aspect exactly (live uniform scale)', () => {
        // #13: Konva holds the ratio on a corner, so live scaleX == scaleY == 2.
        const patch = transformEndPatch(image(), { w: 200, h: 100 }, true, { x: 10, y: 20, rotDeg: 0 }, 2);
        expect(sizeOf(patch)).toEqual({ w: 200, h: 100 });
        expect(patch.transform).toEqual({ x: 10, y: 20, rotDeg: 0, scaleX: 1, scaleY: 1 });
    });

    it('side-anchor gesture free-stretches an aspect-default image (no snap)', () => {
        // #13 core: a side anchor free-stretches live, so the commit must stay
        // free. The old `Math.max` collapse turned {200,50} into {200,100} and
        // moved the anchored edge on release.
        const patch = transformEndPatch(image(), { w: 200, h: 50 }, false, { x: 50, y: 20, rotDeg: 0 });
        expect(sizeOf(patch)).toEqual({ w: 200, h: 50 });
        // The live origin (top-left for a rect/image box) is committed verbatim.
        expect(patch.transform).toEqual({ x: 50, y: 20, rotDeg: 0, scaleX: 1, scaleY: 1 });
    });

    it('uses the live uniform scale, not the rounded target, for a corner', () => {
        // Base 100x33 with live uniform scale 1.5 → target 150x49.5 (rounded to
        // 150x50 by the caller). Re-deriving from the rounded box would take
        // max(1.5, 50/33 ≈ 1.515) and drift the box off the live gesture; the
        // explicit factor keeps the commit uniform.
        const node = image({ size: { w: 100, h: 33 } });
        const exact = transformEndPatch(node, { w: 150, h: 50 }, true, { x: 0, y: 0, rotDeg: 0 }, 1.5);
        expect(sizeOf(exact)).toEqual({ w: 150, h: 50 }); // 100×1.5, 33×1.5→49.5→50
        const drifted = transformEndPatch(node, { w: 150, h: 50 }, true, { x: 0, y: 0, rotDeg: 0 });
        expect(sizeOf(drifted)).toEqual({ w: 152, h: 50 }); // 1.515 fallback
    });

    it('free resize leaves the box independent', () => {
        const patch = transformEndPatch(rect(), { w: 200, h: 150 }, false, { x: 0, y: 0, rotDeg: 0 });
        expect((patch as { size?: { w: number; h: number } }).size).toEqual({ w: 200, h: 150 });
    });

    it('preserves a mirrored (negative) live scale on commit (FLIP-1)', () => {
        // Dragging a handle past the opposite edge mirrors the node; Konva
        // reports a negative scale. The commit keeps the sign so the live mirror
        // does not revert on release, while the size is baked **positive**.
        const patch = transformEndPatch(rect(), { w: 200, h: 100 }, false, {
            x: 0,
            y: 0,
            rotDeg: 0,
            scaleX: -2,
            scaleY: 1,
        });
        expect(sizeOf(patch)).toEqual({ w: 200, h: 100 });
        expect(patch.transform).toEqual({ x: 0, y: 0, rotDeg: 0, scaleX: -1, scaleY: 1 });
    });

    it('normalizes the committed rotation to 0.1° and wraps past ±360 (bug 1)', () => {
        const wrapped = transformEndPatch(rect(), { w: 100, h: 50 }, false, {
            x: 0,
            y: 0,
            rotDeg: 400,
        });
        expect(wrapped.transform?.rotDeg).toBe(40);
        const rounded = transformEndPatch(rect(), { w: 100, h: 50 }, false, {
            x: 0,
            y: 0,
            rotDeg: -12.34,
        });
        expect(rounded.transform?.rotDeg).toBe(-12.3);
    });

    it('keeps a mirrored resize faithful and keeps the document’s scale pair', () => {
        // Finding A: Konva decomposes a mirrored gesture as the negation of the
        // doc pair (doc diag(−1,1) ≡ live diag(1,−1)); the commit keeps the doc
        // signs and adds 180°. A single-axis flip never triggers it.
        const mirrored: ShapeNode = {
            ...rect(),
            transform: { x: 0, y: 0, rotDeg: 0, scaleX: -1, scaleY: 1 },
        };
        // Konva's decomposition of a 1.5× stretch on the mirrored node.
        const patch = transformEndPatch(mirrored, { w: 150, h: 50 }, false, {
            x: 0,
            y: 0,
            rotDeg: -180,
            scaleX: 1.5,
            scaleY: -1,
        });
        expect(sizeOf(patch)).toEqual({ w: 150, h: 50 });
        // −180 + 180 = 0, with the document's own horizontal mirror kept.
        expect(patch.transform).toEqual({ x: 0, y: 0, rotDeg: 0, scaleX: -1, scaleY: 1 });
    });
});

describe('rotationOnlyPatch (bug 4)', () => {
    it('commits rotation + origin only, never a resize', () => {
        // A shrink text's live Konva scale holds its display scale; feeding it to
        // the resize path baked a wrong `size`/`fontSize`. The rotate-only patch
        // carries no geometry fields at all.
        const source = text();
        const patch = rotationOnlyPatch(source, { x: 12.4, y: -3.6, rotDeg: 30 });
        expect(patch as { size?: unknown }).not.toHaveProperty('size');
        expect(patch as { fontSize?: unknown }).not.toHaveProperty('fontSize');
        expect(patch as { points?: unknown }).not.toHaveProperty('points');
        // Konva pivots the rotater about the Transformer centre, so the live
        // origin moved; committing it keeps the node WYSIWYG on release.
        expect(patch.transform).toEqual({ x: 12, y: -4, rotDeg: 30, scaleX: 1, scaleY: 1 });
    });

    it('keeps a non-identity stored scale untouched', () => {
        const source: TextNode = {
            ...text(),
            transform: { x: 5, y: 6, rotDeg: 10, scaleX: 2, scaleY: -3 },
        };
        const patch = rotationOnlyPatch(source, { x: 5, y: 6, rotDeg: 90 });
        expect(patch.transform).toEqual({ x: 5, y: 6, rotDeg: 90, scaleX: 2, scaleY: -3 });
    });

    it('rounds to 0.1° and wraps an out-of-range rotation', () => {
        expect(rotationOnlyPatch(text(), { x: 0, y: 0, rotDeg: 400 }).transform?.rotDeg).toBe(40);
        expect(rotationOnlyPatch(text(), { x: 0, y: 0, rotDeg: 12.3456 }).transform?.rotDeg).toBe(12.3);
    });

    it('adds 180° when Konva decomposed the doc as its negated scale pair', () => {
        // Finding A: a horizontally mirrored doc (scaleX −1) is normalized by
        // Konva to the equivalent live pair (1, −1) plus a 180°-shifted angle.
        // Copying the live angle with the doc's scales would land 180° off; the
        // live −165° must commit +15°.
        const source: TextNode = {
            ...text(),
            transform: { x: 0, y: 0, rotDeg: 0, scaleX: -1, scaleY: 1 },
        };
        const patch = rotationOnlyPatch(source, { x: 0, y: 0, rotDeg: -165, scaleX: 1, scaleY: -1 });
        expect(patch.transform).toEqual({ x: 0, y: 0, rotDeg: 15, scaleX: -1, scaleY: 1 });
    });

    it('leaves a non-mirrored rotation unchanged', () => {
        expect(
            rotationOnlyPatch(text(), { x: 0, y: 0, rotDeg: -165, scaleX: 1, scaleY: 1 }).transform?.rotDeg,
        ).toBe(-165);
        // Same signs as the doc → no representation change either.
        const mirrored: TextNode = {
            ...text(),
            transform: { x: 0, y: 0, rotDeg: 0, scaleX: -1, scaleY: 1 },
        };
        expect(
            rotationOnlyPatch(mirrored, { x: 0, y: 0, rotDeg: -165, scaleX: -1, scaleY: 1 }).transform?.rotDeg,
        ).toBe(-165);
    });

    it('does not add the fix for a single-axis live flip', () => {
        // One axis flipped is a genuine mirror change, not Konva's
        // both-axes-negated representation: the angle stands.
        const source: TextNode = {
            ...text(),
            transform: { x: 0, y: 0, rotDeg: 0, scaleX: -1, scaleY: 1 },
        };
        expect(
            rotationOnlyPatch(source, { x: 0, y: 0, rotDeg: -165, scaleX: 1, scaleY: 1 }).transform?.rotDeg,
        ).toBe(-165);
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

describe('isCornerAnchor (#13 anchor policy)', () => {
    it('treats only the four diagonal handles as corners', () => {
        for (const anchor of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
            expect(isCornerAnchor(anchor)).toBe(true);
        }
        for (const anchor of [
            'top-center',
            'bottom-center',
            'middle-left',
            'middle-right',
            'rotater',
            '',
            null,
            undefined,
        ]) {
            expect(isCornerAnchor(anchor)).toBe(false);
        }
    });
});

describe('gesturePreservesAspect — live↔commit parity (#13)', () => {
    it('aspect node: corner locks, every side anchor free-stretches', () => {
        expect(gesturePreservesAspect(image(), 'bottom-right', false, true)).toBe(true);
        expect(gesturePreservesAspect(image(), 'top-left', false, true)).toBe(true);
        for (const side of ['top-center', 'bottom-center', 'middle-left', 'middle-right']) {
            expect(gesturePreservesAspect(image(), side, false, true)).toBe(false);
        }
        expect(gesturePreservesAspect(image(), 'rotater', false, true)).toBe(false);
    });

    it('non-aspect node: corner free unless a modifier forces the ratio', () => {
        expect(gesturePreservesAspect(rect(), 'bottom-right', false, false)).toBe(false);
        expect(gesturePreservesAspect(rect(), 'bottom-right', true, false)).toBe(true);
        // A modifier never locks a side anchor.
        expect(gesturePreservesAspect(rect(), 'middle-right', true, false)).toBe(false);
    });

    it('aspect node + modifier: ratio released, matching the live uniform target', () => {
        expect(gesturePreservesAspect(image(), 'bottom-right', true, true)).toBe(false);
    });

    it('mixed selection: live keepRatio is off, so a corner stays free', () => {
        // Regression: the per-node default alone would lock a multi-node corner
        // drag that Konva ran free (`keepRatio` is off for mixed selections).
        expect(gesturePreservesAspect(image(), 'bottom-right', false, false)).toBe(false);
        expect(gesturePreservesAspect(rect(), 'bottom-right', false, false)).toBe(false);
    });
});

describe('commitPreservesAspect — live↔commit parity with liveUniform (#13)', () => {
    it('aspect node: a corner commits uniform whenever Konva ran uniform', () => {
        // `keepRatio` is on for a single aspect-default node, so its corner is
        // uniform with or without a modifier; `liveUniform` is authoritative.
        expect(commitPreservesAspect(image(), 'bottom-right', false, true, true)).toBe(true);
        expect(commitPreservesAspect(image(), 'bottom-right', true, true, true)).toBe(true);
        // Side anchors and the rotater are never ratio-locked.
        expect(commitPreservesAspect(image(), 'middle-right', false, true, true)).toBe(false);
        expect(commitPreservesAspect(image(), 'rotater', false, true, true)).toBe(false);
    });

    it('non-aspect node: a corner locks only when a modifier forced it', () => {
        expect(commitPreservesAspect(rect(), 'bottom-right', false, false, false)).toBe(false);
        // Shift forces the ratio ⇒ Konva ran uniform.
        expect(commitPreservesAspect(rect(), 'bottom-right', true, false, true)).toBe(true);
        // Alt centres without forcing the ratio ⇒ live scales differ ⇒ free.
        expect(commitPreservesAspect(rect(), 'bottom-right', true, false, false)).toBe(false);
    });

    it('fixes the aspect node + modifier + corner case (SF2)', () => {
        // The old modifier-inverted policy released the ratio here...
        expect(gesturePreservesAspect(image(), 'bottom-right', true, true)).toBe(false);
        // ...but Konva's `keepRatio` on kept it uniform, so the commit must too.
        expect(commitPreservesAspect(image(), 'bottom-right', true, true, true)).toBe(true);
    });
});

// The ellipse centre-origin claim (`resolve.ts` bounds are centre-origin, so
// Konva's live `Ellipse.x()/y()` is the doc ellipse centre) is pinned against a
// real canvas in `transformGesture.konva.test.ts` — a pure `transformEndPatch`
// assertion cannot catch a wrong origin because the patch carries no rx/ry.

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
