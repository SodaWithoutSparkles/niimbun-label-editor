import { describe, expect, it } from 'vitest';
import { createAppStore } from '../store/useStore';
import { INSERT_ACTIONS, normalizeInsertAction } from '../store/slices/toolsSlice';
import {
    createImageNodeForRef,
    createNodeForInsert,
    DEFAULT_BARCODE_PAYLOAD,
    DEFAULT_QR_PAYLOAD,
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
            if (action === 'select') expect(createNodeForInsert(action, 0, 0)).toBeNull();
            else expect(createNodeForInsert(action, 0, 0)).not.toBeNull();
        }
    });

    it('exposes exactly the four shape menu actions', () => {
        expect([...SHAPE_ACTIONS]).toEqual(['shape:line', 'shape:rectangle', 'shape:ellipse', 'shape:polygon']);
    });

    it('seeds the real static shape style defaults (#8)', () => {
        for (const action of ['shape:rectangle', 'shape:ellipse', 'shape:polygon'] as const) {
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

    it('seeds the P5 qr / barcode defaults', () => {
        const qr = createNodeForInsert('qr', 0, 0);
        expect(qr?.type === 'qr' && qr.data).toEqual({ kind: 'static', value: DEFAULT_QR_PAYLOAD });
        expect(qr?.type === 'qr' && qr.errorCorrection).toBe('M');
        expect(qr?.type === 'qr' && qr.size).toEqual({ w: 1500, h: 1500 });

        const barcode = createNodeForInsert('barcode', 0, 0);
        expect(barcode?.type === 'barcode' && barcode.data).toEqual({
            kind: 'static',
            value: DEFAULT_BARCODE_PAYLOAD,
        });
        expect(barcode?.type === 'barcode' && barcode.symbology).toBe('code128');
        expect(barcode?.type === 'barcode' && barcode.size).toEqual({ w: 2000, h: 800 });
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
