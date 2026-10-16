import { describe, expect, it } from 'vitest';
import { INSERT_ACTIONS, VIEW_TOOL_ACTIONS, normalizeInsertAction } from './toolsSlice';

/**
 * Round-2 pan tool: `pan` is a valid tool id but NOT an insert-rail action, so
 * `normalizeInsertAction` must accept it while `INSERT_ACTIONS` (the rail's
 * vocabulary) stays free of it.
 */
describe('normalizeInsertAction — pan tool', () => {
    it('round-trips the pan tool id', () => {
        expect(normalizeInsertAction('pan')).toBe('pan');
    });

    it('still drops legacy/unknown ids to select', () => {
        expect(normalizeInsertAction('rectangle')).toBe('select');
        expect(normalizeInsertAction('callout')).toBe('select');
        expect(normalizeInsertAction(null)).toBe('select');
    });

    it('keeps pan out of the insert-rail vocabulary', () => {
        expect(INSERT_ACTIONS).not.toContain('pan');
        expect(VIEW_TOOL_ACTIONS).toEqual(['pan']);
    });
});
