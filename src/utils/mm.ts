import { hmToMm, mmToHm } from '../core/hm';

/**
 * hm → mm display string for an editor number field, without a trailing `.0`.
 *
 * `hm` is hundredths of a millimetre (`hmToMm(value) = value / 100`), so the
 * string must carry **at most 2 decimals** — a `toFixed(1)` here would round
 * `mmString(725)` ("7.25") to "7.3" and silently drift the geometry on the next
 * `parseMm` round-trip. Trailing zeros (and a bare trailing `.`) are trimmed so
 * an exact tenth prints as "12.5", not "12.50".
 *
 * Lifted from `CreateLabelDialog.tsx` (`:33-36`) so the create-label dialog, the
 * paper-type editor and the region/guide editors share one formatting rule
 * instead of drifting.
 */
export const mmString = (value: number): string => {
    const mm = hmToMm(value);
    if (Number.isInteger(mm)) return String(mm);
    return mm.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};

/**
 * mm display string → hm, for an editor number field.
 *
 * Lifted verbatim from `CreateLabelDialog.tsx` (`:38-41`). A blank or
 * non-numeric entry parses to `0` rather than `NaN`, because the fields edit
 * live and an intermediate empty string must not poison the model.
 */
export const parseMm = (value: string): number => {
    const mm = Number(value);
    return Number.isFinite(mm) ? mmToHm(mm) : 0;
};
