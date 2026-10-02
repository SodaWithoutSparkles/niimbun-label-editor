import { ftagSparePreset } from './f-tag-spare';
import { rounded30x20Preset } from './rounded-30x20';
import { rounded50x30Preset } from './rounded-50x30';
import { stacked50x15Preset } from './stacked-50x15';
import type { LabelPreset, LabelPresetId } from './types';

export { ftagSparePreset, ftagSpareRegions } from './f-tag-spare';
export { rounded30x20Preset, rounded30x20Regions } from './rounded-30x20';
export { rounded50x30Preset, rounded50x30Regions } from './rounded-50x30';
export { stacked50x15Preset, stacked50x15Regions } from './stacked-50x15';
export type { LabelPreset, LabelPresetId } from './types';

/**
 * Preset registry. One import + one entry per preset; geometry lives in the
 * preset's own file (e.g. `f-tag-spare.ts`) so this stays a table of contents.
 */
export const LABEL_PRESETS: Record<LabelPresetId, LabelPreset> = {
    'ftagSpare-25x78': ftagSparePreset,
    rounded30x20: rounded30x20Preset,
    stacked50x15: stacked50x15Preset,
    rounded50x30: rounded50x30Preset,
};
