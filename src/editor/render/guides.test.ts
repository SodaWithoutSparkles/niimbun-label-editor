import { describe, expect, it } from 'vitest';
import { createFtagSpareDoc, createLabelDoc } from '../../core/doc/factory';
import type { Guide } from '../../core/doc/types';
import { resolveGuides } from './guides';

const scoreGuide: Guide = {
    id: 'g1',
    kind: 'score',
    line: { x1: 100, y1: 0, x2: 100, y2: 3800 },
};

describe('resolveGuides — reads persisted label.guides', () => {
    it('returns the document guides verbatim', () => {
        const doc = createLabelDoc({ guides: [scoreGuide] });
        // `resolveGuides` is a pure read: same array, same objects.
        expect(resolveGuides(doc)).toBe(doc.label.guides);
        expect(resolveGuides(doc)).toEqual([scoreGuide]);
    });

    it('returns the F-tag paper-type score line that createLabelDoc carried onto the doc', () => {
        const guides = resolveGuides(createFtagSpareDoc());
        expect(guides).toHaveLength(1);
        const [guide] = guides;
        expect(guide?.kind).toBe('score');
        // Literal values (not a seed constant) so a coordinate bump is caught:
        // vertical segment at x=1250, y=0…3800.
        expect(guide?.line).toEqual({ x1: 1250, y1: 0, x2: 1250, y2: 3800 });
        expect(guide?.line.x1).toBe(guide?.line.x2);
    });

    it('returns [] for a document with no guides', () => {
        // Die-cut paper types carry no guide, and a bare doc defaults to [].
        expect(resolveGuides(createLabelDoc({ paperTypeId: 'rounded30x20' }))).toEqual([]);
        expect(resolveGuides(createLabelDoc())).toEqual([]);
    });

    it('treats an absent label.guides as an empty list (legacy document)', () => {
        const doc = createLabelDoc();
        // Simulate a document persisted before `guides` existed.
        delete (doc.label as { guides?: Guide[] }).guides;
        expect(resolveGuides(doc)).toEqual([]);
    });
});
