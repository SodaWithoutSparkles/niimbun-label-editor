import { describe, expect, it } from 'vitest';
import { createLabelDoc } from '../core/doc/factory';
import type { LabelDoc, Node } from '../core/doc/types';
import type { HitTestable, Point } from '../core/viewport';
import { nodesInMarquee, pickNodeAt, pointerDownSelection, rectsIntersect, selectionAfterClick } from './selectionModel';

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const docWith = (nodes: Node[]): LabelDoc =>
    createLabelDoc({ id: 'doc', now: 1_700_000_000, backingW: 4000, backingH: 3000, nodes });

describe('selectionAfterClick', () => {
    it('clears on an empty-canvas click', () => {
        expect(selectionAfterClick(['a'], null, false)).toEqual([]);
    });

    it('keeps the selection on an additive empty click', () => {
        expect(selectionAfterClick(['a'], null, true)).toEqual(['a']);
    });

    it('replaces on a plain click', () => {
        expect(selectionAfterClick(['a', 'b'], 'c', false)).toEqual(['c']);
    });

    it('toggles on an additive click', () => {
        expect(selectionAfterClick(['a'], 'b', true)).toEqual(['a', 'b']);
        expect(selectionAfterClick(['a', 'b'], 'a', true)).toEqual(['b']);
    });
});

describe('pointerDownSelection', () => {
    it('clears on an empty-canvas click and keeps on an additive empty click', () => {
        expect(pointerDownSelection(['a'], null, false)).toEqual({ selection: [], collapseTo: null });
        expect(pointerDownSelection(['a'], null, true)).toEqual({ selection: ['a'], collapseTo: null });
    });

    it('keeps the whole selection and defers a collapse on a plain already-selected click', () => {
        expect(pointerDownSelection(['a', 'b'], 'a', false)).toEqual({
            selection: ['a', 'b'],
            collapseTo: 'a',
        });
    });

    it('replaces with the single id on a plain unselected click (no collapse)', () => {
        expect(pointerDownSelection(['a', 'b'], 'c', false)).toEqual({
            selection: ['c'],
            collapseTo: null,
        });
    });

    it('toggles membership on an additive click (no collapse)', () => {
        expect(pointerDownSelection(['a'], 'b', true)).toEqual({
            selection: ['a', 'b'],
            collapseTo: null,
        });
        expect(pointerDownSelection(['a', 'b'], 'a', true)).toEqual({
            selection: ['b'],
            collapseTo: null,
        });
    });

    it('does not mutate the input selection', () => {
        const current = ['a', 'b'];
        pointerDownSelection(current, 'a', false);
        pointerDownSelection(current, 'a', true);
        expect(current).toEqual(['a', 'b']);
    });
});

describe('rectsIntersect', () => {
    it('detects overlap and separation', () => {
        expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
        expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 })).toBe(false);
    });
});

/**
 * Round-2 backlog: overlapping-object select priority. `targets` is in paint
 * order (front last), so `upper` is the topmost node wherever they overlap.
 */
describe('pickNodeAt', () => {
    const target = (id: string, x: number, y: number, over: Partial<HitTestable> = {}): HitTestable => ({
        id,
        bounds: { x, y, w: 1000, h: 1000 },
        visible: true,
        locked: false,
        ...over,
    });

    // `lower` AABB [1000,2000]², `upper` AABB [1500,2500]² → overlap [1500,2000]².
    const targets: HitTestable[] = [target('lower', 1000, 1000), target('upper', 1500, 1500)];
    const overlap: Point = { x: 1750, y: 1750 };
    const upperOnly: Point = { x: 2300, y: 2300 };

    it('falls back to the topmost node when nothing is selected', () => {
        expect(pickNodeAt(overlap, targets, [])).toBe('upper');
    });

    it('prefers the selected node inside its own box, over the node stacked above it', () => {
        expect(pickNodeAt(overlap, targets, ['lower'])).toBe('lower');
    });

    it('keeps the topmost node outside the selected node box', () => {
        expect(pickNodeAt(upperOnly, targets, ['lower'])).toBe('upper');
    });

    it('is a no-op when the topmost hit is already selected', () => {
        expect(pickNodeAt(overlap, targets, ['upper'])).toBe('upper');
        expect(pickNodeAt(overlap, targets, ['lower', 'upper'])).toBe('upper');
    });

    it('returns null for a point over no node', () => {
        expect(pickNodeAt({ x: 3500, y: 200 }, targets, ['lower'])).toBeNull();
    });

    it('never gives priority to a locked or hidden selected node', () => {
        const locked: HitTestable[] = [target('lower', 1000, 1000, { locked: true }), targets[1]!];
        const hidden: HitTestable[] = [target('lower', 1000, 1000, { visible: false }), targets[1]!];
        expect(pickNodeAt(overlap, locked, ['lower'])).toBe('upper');
        expect(pickNodeAt(overlap, hidden, ['lower'])).toBe('upper');
    });

    it('wins with the topmost selected box when several selected boxes overlap', () => {
        const three = [...targets, target('top', 1600, 1600)];
        expect(pickNodeAt(overlap, three, ['lower', 'top'])).toBe('top');
    });

    it('does not mutate the input selection', () => {
        const selected = ['lower'];
        pickNodeAt(overlap, targets, selected);
        expect(selected).toEqual(['lower']);
    });
});

describe('nodesInMarquee', () => {
    const doc = docWith([
        node({
            id: 'a',
            parentId: null,
            type: 'shape',
            shape: 'rectangle',
            visible: true,
            locked: false,
            transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
            size: { w: 1000, h: 1000 },
        }),
        node({
            id: 'b',
            parentId: null,
            type: 'shape',
            shape: 'rectangle',
            visible: true,
            locked: true,
            transform: { x: 2000, y: 2000, rotDeg: 0, scaleX: 1, scaleY: 1 },
            size: { w: 1000, h: 1000 },
        }),
    ]);

    it('selects overlapping unlocked nodes and skips locked ones', () => {
        expect(nodesInMarquee(doc, { x: -100, y: -100, w: 3000, h: 3000 })).toEqual(['a']);
    });

    it('returns nothing for a marquee over empty space', () => {
        expect(nodesInMarquee(doc, { x: 5000, y: 5000, w: 100, h: 100 })).toEqual([]);
    });
});
