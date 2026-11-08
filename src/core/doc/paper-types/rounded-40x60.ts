import type { Region } from '../types';
import type { PaperType } from './types';

export const rounded40x60Regions = (): Region[] => [
    { kind: 'roundedRect', x: 0, y: 0, w: 4000, h: 6000, r: 200 },
];

export const rounded40x60PaperType: PaperType = {
    id: 'rounded40x60',
    name: 'Rounded 40×60 (r 2)',
    backingW: 4000,
    backingH: 6000,
    regions: rounded40x60Regions(),
    guides: [],
};
