import { describe, expect, it } from 'vitest';
import { createAppStore } from '../store/useStore';
import { INSERT_ACTIONS, normalizeInsertAction } from '../store/slices/toolsSlice';
import { DEFAULT_CODE_FORMAT, DEFAULT_SYMBOL_FILL } from '../core/doc/objects';
import {
    createImageNodeForRef,
    createNodeForBox,
    createNodeForInsert,
    createPolygonNode,
    DEFAULT_BARCODE_PAYLOAD,
    DEFAULT_CODE_PAYLOAD,
    DEFAULT_QR_PAYLOAD,
    DRAW_SHAPE_ACTIONS,
    isDrawShapeAction,
    shapeKindForAction,
    SHAPE_ACTIONS,
} from './insertActions';

describe('createNodeForInsert', () => {
    it('places a default-size text node', () => {
        const node = createNodeForInsert('text', 100, 200);
        expect(node).toMatchObject({ type: 'text', transform: { x: 100, y: 200 } });
        expect(node?.type === 'text' && node.size).toEqual({ w: 2000, h: 800 });
    });

    it('maps shape actions to their shape kind', () => {
        expect(shapeKindForAction('shape:rectangle')).toBe('rectangle');
        const node = createNodeForInsert('shape:ellipse', 0, 0);
        expect(node?.type === 'shape' && node.shape).toBe('ellipse');
    });

    it('returns null for the resting select action', () => {
        expect(createNodeForInsert('select', 0, 0)).toBeNull();
    });

    it('covers every insert action except select with a node', () => {
        for (const action of INSERT_ACTIONS) {
            if (action === 'select' || action === 'shape:polygon') expect(createNodeForInsert(action, 0, 0)).toBeNull();
            else expect(createNodeForInsert(action, 0, 0)).not.toBeNull();
        }
    });

    it('exposes exactly the four shape menu actions', () => {
        expect([...SHAPE_ACTIONS]).toEqual(['shape:line', 'shape:rectangle', 'shape:ellipse', 'shape:polygon']);
    });

    it('seeds the real static shape style defaults (#8)', () => {
        for (const action of ['shape:rectangle', 'shape:ellipse'] as const) {
            const node = createNodeForInsert(action, 0, 0);
            expect(node, action).toMatchObject({
                fill: 'transparent',
                stroke: '#374151',
                strokeWidth: 50,
            });
            // No fill is seeded as the explicit `'transparent'` string.
            expect(node?.type === 'shape' && node.fill, `${action} has transparent fill`).toBe(
                'transparent',
            );
        }
        // Open shape: transparent fill, and the stroke defaults are seeded.
        const line = createNodeForInsert('shape:line', 0, 0);
        expect(line).toMatchObject({ fill: 'transparent', stroke: '#374151', strokeWidth: 50 });
        expect(line?.type === 'shape' && line.fill).toBe('transparent');
    });

    it('creates a closed polygon from world-space points with local geometry', () => {
        const node = createPolygonNode([[100, 200], [600, 200], [300, 800]]);
        expect(node).toMatchObject({
            type: 'shape',
            shape: 'polygon',
            closed: true,
            transform: { x: 100, y: 200 },
            fill: 'transparent',
            stroke: '#374151',
            strokeWidth: 50,
        });
        // Assert the full point list: `toMatchObject` alone would let an extra
        // (e.g. closing) vertex slip through.
        expect(node?.type === 'shape' && node.points).toEqual([[0, 0], [500, 0], [200, 600]]);
    });

    it('returns null for fewer than three vertices (no Infinity transform)', () => {
        expect(createPolygonNode([])).toBeNull();
        expect(createPolygonNode([[10, 20]])).toBeNull();
        expect(createPolygonNode([[10, 20], [30, 40]])).toBeNull();
    });

    it('seeds the P5 qr / barcode defaults', () => {
        const qr = createNodeForInsert('qr', 0, 0);
        expect(qr?.type === 'qr' && qr.data).toEqual({ kind: 'static', value: DEFAULT_QR_PAYLOAD });
        expect(qr?.type === 'qr' && qr.errorCorrection).toBe('M');
        expect(qr?.type === 'qr' && qr.fill).toBe('#ffffff');
        // `quietZone` is deliberately absent (⇒ derived default), not seeded.
        expect(qr?.type === 'qr' && qr.quietZone).toBeUndefined();
        expect(qr?.type === 'qr' && qr.size).toEqual({ w: 1500, h: 1500 });

        const barcode = createNodeForInsert('barcode', 0, 0);
        expect(barcode?.type === 'barcode' && barcode.data).toEqual({
            kind: 'static',
            value: DEFAULT_BARCODE_PAYLOAD,
        });
        expect(barcode?.type === 'barcode' && barcode.symbology).toBe('code128');
        expect(barcode?.type === 'barcode' && barcode.fill).toBe('#ffffff');
        expect(barcode?.type === 'barcode' && barcode.quietZone).toBeUndefined();
        expect(barcode?.type === 'barcode' && barcode.size).toEqual({ w: 2000, h: 800 });
    });

    it('seeds the P11 code defaults', () => {
        const code = createNodeForInsert('code', 0, 0);
        expect(code?.type === 'code' && code.format).toBe(DEFAULT_CODE_FORMAT);
        expect(code?.type === 'code' && code.format).toBe('datamatrix');
        expect(code?.type === 'code' && code.data).toEqual({
            kind: 'static',
            value: DEFAULT_CODE_PAYLOAD,
        });
        expect(code?.type === 'code' && code.fill).toBe(DEFAULT_SYMBOL_FILL);
        // `quietZone` is deliberately absent (⇒ the per-format derived default),
        // not seeded — mirroring qr/barcode.
        expect(code?.type === 'code' && code.quietZone).toBeUndefined();
        expect(code?.type === 'code' && code.size).toEqual({ w: 1500, h: 1500 });
    });
});

describe('createImageNodeForRef', () => {
    it('sizes the node to the image aspect within the max box', () => {
        const wide = createImageNodeForRef(10, 20, { imageId: 'i', widthPx: 200, heightPx: 100 }, 1000);
        expect(wide.type === 'image' && wide.size).toEqual({ w: 1000, h: 500 });
        expect(wide.type === 'image' && wide.imageId).toBe('i');
        expect(wide.type === 'image' && wide.fit).toBe('contain');

        // A portrait source flips the constraint (height is the long side).
        const tall = createImageNodeForRef(0, 0, { imageId: 'i2', widthPx: 100, heightPx: 400 }, 800);
        expect(tall.type === 'image' && tall.size).toEqual({ w: 200, h: 800 });
    });

    it('falls back to a square for a degenerate source size', () => {
        const node = createImageNodeForRef(0, 0, { imageId: 'i', widthPx: 0, heightPx: 0 }, 500);
        expect(node.type === 'image' && node.size).toEqual({ w: 500, h: 500 });
    });
});

/**
 * P13/S1: the drag-draw geometry. Box semantics (the press point is a corner),
 * min-corner normalization for negative drags, shift square/circle, and the 45°
 * line snap. The click fallback (`createNodeForInsert`) must stay untouched.
 */
describe('createNodeForBox', () => {
    it('draws a rectangle from the press corner to the release corner', () => {
        const node = createNodeForBox('shape:rectangle', [1000, 800], [3000, 2000]);
        expect(node).toMatchObject({
            type: 'shape',
            shape: 'rectangle',
            transform: { x: 1000, y: 800 },
            fill: 'transparent',
            stroke: '#374151',
            strokeWidth: 50,
        });
        expect(node?.type === 'shape' && node.size).toEqual({ w: 2000, h: 1200 });
    });

    it('normalizes an up-left (negative) drag to min corner + abs size', () => {
        const node = createNodeForBox('shape:rectangle', [3000, 2000], [1000, 800]);
        expect(node?.transform).toMatchObject({ x: 1000, y: 800 });
        expect(node?.type === 'shape' && node.size).toEqual({ w: 2000, h: 1200 });
    });

    it('normalizes a mixed-direction drag on each axis independently', () => {
        // Right-and-up: x grows, y shrinks.
        const node = createNodeForBox('shape:rectangle', [1000, 2000], [3000, 800]);
        expect(node?.transform).toMatchObject({ x: 1000, y: 800 });
        expect(node?.type === 'shape' && node.size).toEqual({ w: 2000, h: 1200 });
    });

    it('gives an ellipse box semantics (corner-to-corner), not a radius drag', () => {
        const node = createNodeForBox('shape:ellipse', [500, 500], [1500, 1000]);
        expect(node).toMatchObject({ type: 'shape', shape: 'ellipse', transform: { x: 500, y: 500 } });
        // The full box, not a doubled radius from a centre origin.
        expect(node?.type === 'shape' && node.size).toEqual({ w: 1000, h: 500 });
    });

    it('constrains a shifted box to a square, keeping the drag direction', () => {
        const node = createNodeForBox('shape:rectangle', [1000, 1000], [1200, 300], true);
        // dx=+200, dy=-700 → side 700, direction kept, then normalized.
        expect(node?.transform).toMatchObject({ x: 1000, y: 300 });
        expect(node?.type === 'shape' && node.size).toEqual({ w: 700, h: 700 });
    });

    it('normalizes a shifted up-left drag to a square at the min corner', () => {
        const node = createNodeForBox('shape:ellipse', [1000, 1000], [400, 300], true);
        expect(node?.transform).toMatchObject({ x: 300, y: 300 });
        expect(node?.type === 'shape' && node.size).toEqual({ w: 700, h: 700 });
    });

    it('rebases a drawn line to its bbox min (transform at the min corner)', () => {
        const node = createNodeForBox('shape:line', [100, 200], [400, 500]);
        expect(node).toMatchObject({
            type: 'shape',
            shape: 'line',
            transform: { x: 100, y: 200 },
            fill: 'transparent',
            stroke: '#374151',
            strokeWidth: 50,
        });
        expect(node?.type === 'shape' && node.points).toEqual([[0, 0], [300, 300]]);
    });

    it('rebases an up-left drawn line to the min corner (points relative to it)', () => {
        const node = createNodeForBox('shape:line', [900, 700], [300, 200]);
        // bbox min is (300, 200): the transform (rotation pivot) sits there and
        // both endpoints are stored relative to it.
        expect(node?.transform).toMatchObject({ x: 300, y: 200 });
        expect(node?.type === 'shape' && node.points).toEqual([[600, 500], [0, 0]]);
    });

    it('snaps a shifted line to 45°, preserving its length', () => {
        // 2000 across, 1000 down → nearest 45° ray, length hypot(2000, 1000).
        const node = createNodeForBox('shape:line', [0, 0], [2000, 1000], true);
        const points = node?.type === 'shape' ? node.points : [];
        expect(points?.[0]).toEqual([0, 0]);
        const [ex, ey] = points![1]!;
        expect(ex).toBe(ey);
        expect(ex).toBe(1581);
    });

    it('keeps a zero-length shifted line at the press point (no angle to snap)', () => {
        const node = createNodeForBox('shape:line', [10, 20], [10, 20], true);
        // Rebasing a degenerate segment puts the transform at the press point.
        expect(node?.transform).toMatchObject({ x: 10, y: 20 });
        expect(node?.type === 'shape' && node.points).toEqual([[0, 0], [0, 0]]);
    });

    it('covers exactly the three drawable actions', () => {
        expect([...DRAW_SHAPE_ACTIONS]).toEqual(['shape:line', 'shape:rectangle', 'shape:ellipse']);
        for (const action of ['shape:line', 'shape:rectangle', 'shape:ellipse'] as const) {
            expect(isDrawShapeAction(action), action).toBe(true);
            expect(createNodeForBox(action, [0, 0], [10, 10]), action).not.toBeNull();
        }
        for (const action of ['select', 'shape:polygon', 'text', 'image', 'qr', 'barcode', 'code'] as const) {
            expect(isDrawShapeAction(action), action).toBe(false);
            expect(createNodeForBox(action, [0, 0], [10, 10]), action).toBeNull();
        }
    });

    it('leaves the click fallback (createNodeForInsert) on the default boxes', () => {
        const rect = createNodeForInsert('shape:rectangle', 10, 20);
        expect(rect?.transform).toMatchObject({ x: 10, y: 20 });
        expect(rect?.type === 'shape' && rect.size).toEqual({ w: 1500, h: 1000 });

        const ellipse = createNodeForInsert('shape:ellipse', 0, 0);
        expect(ellipse?.type === 'shape' && ellipse.size).toEqual({ w: 1500, h: 1000 });

        const line = createNodeForInsert('shape:line', 30, 40);
        expect(line?.transform).toMatchObject({ x: 30, y: 40 });
        expect(line?.type === 'shape' && line.points).toEqual([[0, 0], [1500, 0]]);
    });
});

describe('normalizeInsertAction', () => {
    it('keeps valid actions and drops legacy/unknown ids to select', () => {
        expect(normalizeInsertAction('shape:rectangle')).toBe('shape:rectangle');
        expect(normalizeInsertAction('rectangle')).toBe('select');
        expect(normalizeInsertAction('callout')).toBe('select');
        expect(normalizeInsertAction(null)).toBe('select');
    });
});

describe('toolsSlice one-shot arming', () => {
    it('arms an action and clears back to select', () => {
        const store = createAppStore();
        store.getState().setActiveTool('shape:rectangle');
        expect(store.getState().activeTool).toBe('shape:rectangle');
        store.getState().clearActiveTool();
        expect(store.getState().activeTool).toBe('select');
    });
});
