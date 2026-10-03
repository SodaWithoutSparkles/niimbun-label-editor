import { describe, expect, it } from 'vitest';
import { createFtagSpareDoc, createLabelDoc } from '../../core/doc/factory';
import { FTAG_SCORE_BOTTOM_HM, FTAG_SCORE_TOP_HM, FTAG_SCORE_X_HM, resolveGuides } from './guides';
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
        expect(guide?.line).toEqual({
            x1: FTAG_SCORE_X_HM,
            y1: FTAG_SCORE_TOP_HM,
            x2: FTAG_SCORE_X_HM,
            y2: FTAG_SCORE_BOTTOM_HM,
        });
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
