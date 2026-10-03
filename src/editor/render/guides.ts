import type { hm } from '../../core/hm';
import type { LabelDoc } from '../../core/doc/types';

/**
 * Guides seam (ui-spec §5, phase3 action-plan §5).
 *
 * A **guide** is a non-printable editor annotation (e.g. the F-tag's grey dashed
 * semi-cut / fold score line). It is deliberately NOT a `Region`: it never
 * clips, never prints, and never contributes to `union(regions)` or to
 * `label.regions`. Appearance is the owner's design; this is data only.
 *
 * Derivation: guides live here (not in the preset registry, which is geometry
 * only) keyed by `meta.presetId`. A preset with no declared guide yields `[]`.
 */
export interface Guide {
    id: string;
    /** `score` = semi-cut/fold; kept open for future guide kinds. */
    kind: 'score';
    /** Guide line in label-local hm coordinates. */
    line: { x1: hm; y1: hm; x2: hm; y2: hm };
    /** Optional human label (i18n key owned by the UI). */
    label?: string;
}

/**
 * F-tag spare (25×78 mm, backing 2500×7800 hm) fold score line.
 *
 * Owner-pinned (2026-10-04): the grey semi-cut is a **vertical** segment running
 * down the middle of the flag, at `x = 12.5 mm` (half of the 25 mm width), from
 * `y = 0` to `y = 38 mm` (half of the 78 mm height). In hm that is a segment at
 * `x = 1250`, spanning `y = 0 … 3800`. These constants are the single source.
 */
export const FTAG_SCORE_X_HM: hm = 1250;
export const FTAG_SCORE_TOP_HM: hm = 0;
export const FTAG_SCORE_BOTTOM_HM: hm = 3800;

/**
 * Guide table keyed by preset id. Only presets with a non-printing guide get an
 * entry; unknown/absent `presetId` yields no guides. Pure data, no rendering.
 */
export const PRESET_GUIDES: Record<string, (doc: LabelDoc) => Guide[]> = {
    'ftagSpare-25x78': () => [
        {
            id: 'ftag-spare-score',
            kind: 'score',
            line: {
                x1: FTAG_SCORE_X_HM,
                y1: FTAG_SCORE_TOP_HM,
                x2: FTAG_SCORE_X_HM,
                y2: FTAG_SCORE_BOTTOM_HM,
            },
        },
    ],
};

/** Derive non-printable guides for the editor view from `meta.presetId`. */
export const resolveGuides = (doc: LabelDoc): Guide[] => {
    const presetId = doc.meta.presetId;
    if (!presetId) return [];
    return PRESET_GUIDES[presetId]?.(doc) ?? [];
};
