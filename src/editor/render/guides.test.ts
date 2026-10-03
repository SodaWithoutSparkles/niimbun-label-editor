import { describe, expect, it } from 'vitest';
import { createFtagSpareDoc, createLabelDoc } from '../../core/doc/factory';
import { resolveGuides } from './guides';
import type { LabelDoc } from '../../core/doc/types';

const withPresetId = (presetId: string | undefined): LabelDoc => {
    const doc = createLabelDoc({ backingW: 2500, backingH: 7800 });
    if (presetId === undefined) {
        delete doc.meta.presetId;
    } else {
        doc.meta.presetId = presetId;
    }
    return doc;
};

describe('resolveGuides — presetId → F-tag score line', () => {
    it('emits one vertical score guide for the F-tag preset', () => {
        const guides = resolveGuides(createFtagSpareDoc());
        expect(guides).toHaveLength(1);
        const [guide] = guides;
        expect(guide?.kind).toBe('score');
        // Literal values (not the exported constants) so a constant bump is
        // caught: vertical segment at x=1250, y=0…3800.
        expect(guide?.line).toEqual({ x1: 1250, y1: 0, x2: 1250, y2: 3800 });
        expect(guide?.line.x1).toBe(guide?.line.x2);
    });

    it('derives the guide from meta.presetId, not label geometry', () => {
        expect(resolveGuides(withPresetId('ftagSpare-25x78'))).toHaveLength(1);
    });

    it('returns [] for an unknown preset id', () => {
        expect(resolveGuides(withPresetId('does-not-exist'))).toEqual([]);
    });

    it('returns [] when the document records no preset', () => {
        expect(resolveGuides(withPresetId(undefined))).toEqual([]);
        // Die-cut presets have no guide.
        expect(resolveGuides(createLabelDoc({ preset: 'rounded30x20' }))).toEqual([]);
    });
});
