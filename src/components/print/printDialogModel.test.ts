import { describe, expect, it } from 'vitest';
import { LabelType } from '@mmote/niimbluelib';
import { labelTypeMismatch } from './printDialogModel';

describe('labelTypeMismatch', () => {
    it('returns the reported type only on a real difference', () => {
        expect(labelTypeMismatch(LabelType.Continuous, LabelType.WithGaps)).toBe(
            LabelType.Continuous,
        );
        expect(labelTypeMismatch(LabelType.Perforated, LabelType.Transparent)).toBe(
            LabelType.Perforated,
        );
    });

    it('returns undefined when the reported and selected types agree', () => {
        expect(labelTypeMismatch(LabelType.WithGaps, LabelType.WithGaps)).toBeUndefined();
        expect(labelTypeMismatch(LabelType.Continuous, LabelType.Continuous)).toBeUndefined();
    });

    it('returns undefined when the printer reported nothing', () => {
        expect(labelTypeMismatch(undefined, LabelType.WithGaps)).toBeUndefined();
        expect(labelTypeMismatch(undefined, LabelType.Continuous)).toBeUndefined();
    });

    it('returns undefined for Invalid/unknown reported types (no bogus warning)', () => {
        expect(labelTypeMismatch(LabelType.Invalid, LabelType.WithGaps)).toBeUndefined();
        expect(labelTypeMismatch(LabelType.Invalid, LabelType.Continuous)).toBeUndefined();
        expect(labelTypeMismatch(99 as LabelType, LabelType.WithGaps)).toBeUndefined();
    });
});
