import type { hm } from '../../hm';
import type { Region } from '../types';

/** Every registered preset id. Add the new id here when adding a preset. */
export type LabelPresetId = 'ftagSpare-25x78' | 'rounded30x20' | 'stacked50x15' | 'rounded50x30';

export interface LabelPreset {
    id: LabelPresetId;
    name: string;
    backingW: hm;
    backingH: hm;
    regions: Region[];
}
