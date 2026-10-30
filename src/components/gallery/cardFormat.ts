import { hmToMm } from '../../core/hm';

/**
 * Format an hm dimension for a gallery card's size line.
 *
 * Shared by `LabelCard` and `PresetCard` so the same label shows the same size
 * string on both surfaces. One decimal at most, no trailing `.0` (the label
 * card's existing rule, kept verbatim when this was extracted in P3).
 */
export const formatCardMm = (value: number): string => {
    const mm = hmToMm(value);
    return Number.isInteger(mm) ? String(mm) : mm.toFixed(1);
};
