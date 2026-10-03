import { describe, expect, it } from 'vitest';
import { createAppStore } from '../store/useStore';
import { INSERT_ACTIONS, normalizeInsertAction } from '../store/slices/toolsSlice';
import { createNodeForInsert, shapeKindForAction, SHAPE_ACTIONS } from './insertActions';

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
