import type { Region } from '../types';
import type { PaperType } from './types';

/**
 * Die-cut label: a single rounded rectangle filling a 4800×3000 hm (48×30 mm)
 * backing, corner radius 200 hm (2 mm).
 *
 * 48 mm is the common NIIMBOT roll width (and the B1 Pro's 567-dot head is
 * ≈48 mm). The older `rounded50x30` stays untouched: paper-type ids are
 * referenced by `meta.paperTypeId`, so resizing that preset would silently
 * change every label that points at it. This is a separate, opt-in stock.
 */
export const rounded48x30Regions = (): Region[] => [
    { kind: 'roundedRect', x: 0, y: 0, w: 4800, h: 3000, r: 200 },
];

export const rounded48x30PaperType: PaperType = {
    id: 'rounded48x30',
    name: 'Rounded 48×30 (r 2)',
    backingW: 4800,
    backingH: 3000,
    regions: rounded48x30Regions(),
    guides: [],
};
