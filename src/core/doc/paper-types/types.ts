import type { hm } from '../../hm';
import type { Guide, Region } from '../types';

/** Every paper-type id. A plain string — user-authored types mint their own UUIDs. */
export type PaperTypeId = string;

export interface PaperType {
    id: PaperTypeId;
    name: string;
    backingW: hm;
    backingH: hm;
    regions: Region[];
    /** Non-printable editor guides carried onto `label.guides`. Empty when none. */
    guides: Guide[];
}
