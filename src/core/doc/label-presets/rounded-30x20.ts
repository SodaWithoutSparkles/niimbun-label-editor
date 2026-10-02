import type { Region } from '../types';
import type { LabelPreset } from './types';

/**
 * Die-cut label: a single rounded rectangle filling a 3000×2000 hm (30×20 mm)
 * backing, corner radius 200 hm (2 mm).
 */
export const rounded30x20Regions = (): Region[] => [
    { kind: 'roundedRect', x: 0, y: 0, w: 3000, h: 2000, r: 200 },
];

export const rounded30x20Preset: LabelPreset = {
    id: 'rounded30x20',
    name: 'Rounded 30×20 (r 2)',
    backingW: 3000,
    backingH: 2000,
    regions: rounded30x20Regions(),
};
