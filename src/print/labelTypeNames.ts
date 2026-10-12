import { LabelType } from '@mmote/niimbluelib';

/**
 * `LabelType` → `print.labelTypeNames.*` i18n key, in the order the print
 * dialog's paper-type select lists them. Shared by `PrintDialog` (the select)
 * and the connection chip (the RFID consumables-type row), so the two can never
 * drift. `LabelType.Invalid` (0) is deliberately absent — it is not a real paper
 * type, and callers fall back to the raw enum name for it.
 */
export const LABEL_TYPE_OPTIONS = [
    { value: LabelType.WithGaps, key: 'print.labelTypeNames.withGaps' },
    { value: LabelType.Black, key: 'print.labelTypeNames.black' },
    { value: LabelType.Continuous, key: 'print.labelTypeNames.continuous' },
    { value: LabelType.Perforated, key: 'print.labelTypeNames.perforated' },
    { value: LabelType.Transparent, key: 'print.labelTypeNames.transparent' },
    { value: LabelType.PvcTag, key: 'print.labelTypeNames.pvcTag' },
    { value: LabelType.BlackMarkGap, key: 'print.labelTypeNames.blackMarkGap' },
    { value: LabelType.HeatShrinkTube, key: 'print.labelTypeNames.heatShrinkTube' },
] as const;

/** An i18n key for a translated `LabelType` name. */
export type LabelTypeNameKey = (typeof LABEL_TYPE_OPTIONS)[number]['key'];

/** The i18n key for a `LabelType`, or `undefined` for `Invalid`/unknown values. */
export const labelTypeNameKey = (type: LabelType | undefined): LabelTypeNameKey | undefined =>
    LABEL_TYPE_OPTIONS.find((option) => option.value === type)?.key;

/** The raw enum name (`'WithGaps'`, …) — the fallback when no key matches. */
export const labelTypeEnumName = (type: LabelType): string => LabelType[type] ?? String(type);
