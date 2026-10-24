import { ftagSparePaperType } from './f-tag-spare';
import { rounded30x20PaperType } from './rounded-30x20';
import { rounded48x30PaperType } from './rounded-48x30';
import { rounded50x30PaperType } from './rounded-50x30';
import { stacked50x15PaperType } from './stacked-50x15';
import type { PaperType } from './types';

export { ftagSparePaperType, ftagSpareRegions, ftagSpareGuides } from './f-tag-spare';
export { rounded30x20PaperType, rounded30x20Regions } from './rounded-30x20';
export { rounded48x30PaperType, rounded48x30Regions } from './rounded-48x30';
export { rounded50x30PaperType, rounded50x30Regions } from './rounded-50x30';
export { stacked50x15PaperType, stacked50x15Regions } from './stacked-50x15';
export type { PaperType, PaperTypeId } from './types';

/**
 * Seed registry. One import + one entry per built-in paper type; geometry lives
 * in the type's own file (e.g. `f-tag-spare.ts`) so this stays a table of
 * contents. These are first-run seed data (see `data/paperSeeds.ts`), not a
 * closed id union — user-authored types are minted with their own ids.
 */
export const PAPER_TYPE_SEEDS: Record<string, PaperType> = {
    'ftagSpare-25x78': ftagSparePaperType,
    rounded30x20: rounded30x20PaperType,
    rounded48x30: rounded48x30PaperType,
    stacked50x15: stacked50x15PaperType,
    rounded50x30: rounded50x30PaperType,
};
