import type { Region } from '../types';
import type { LabelPreset } from './types';

/**
 * Die-cut label: a single rounded rectangle filling a 5000×3000 hm (50×30 mm)
 * backing, corner radius 200 hm (2 mm).
 */
export const rounded50x30Regions = (): Region[] => [
    { kind: 'roundedRect', x: 0, y: 0, w: 5000, h: 3000, r: 200 },
];

export const rounded50x30Preset: LabelPreset = {
    id: 'rounded50x30',
    name: 'Rounded 50×30 (r 2)',
    backingW: 5000,
    backingH: 3000,
    regions: rounded50x30Regions(),
};
