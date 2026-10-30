import type { LabelDoc } from '../core/doc/types';
import { contentSourceOf } from './contentSource';

/**
 * Preset field discovery (P5) — the `.ts`-only layer between the document and
 * the fill dialog, so the UI never walks `doc.nodes` itself.
 *
 * A preset's fillable fields are the distinct `{ kind: 'field' }` names carried
 * by its nodes, in **node order** (first appearance wins). Only the carriers
 * `contentSourceOf` recognises count (text / qr / barcode / code); static, csv
 * and template sources are ignored, and so is an empty name — that is the
 * half-authored authoring state, which is never shown or bound (the same rule
 * `prepareContent.ownField` applies).
 */

/** One distinct field, with the fallback of its first binding. */
export interface PresetField {
    /** The stored field name, untrimmed, exactly as the binding looks it up. */
    name: string;
    /** Placeholder fallback of the first node binding this name. */
    fallback: string;
}

/**
 * Distinct non-empty field bindings of `doc`, in node order. The returned
 * `fallback` is the first binding's fallback for that name, matching the fill
 * dialog's "most common fallback" rule (first appearance wins).
 */
export const presetFields = (doc: LabelDoc): PresetField[] => {
    const fields: PresetField[] = [];
    const seen = new Set<string>();
    for (const node of doc.nodes) {
        const source = contentSourceOf(node);
        if (source?.kind !== 'field') continue;
        if (source.name.length === 0) continue;
        if (seen.has(source.name)) continue;
        seen.add(source.name);
        fields.push({ name: source.name, fallback: source.fallback });
    }
    return fields;
};

/** The distinct non-empty field names of `doc`, in node order. */
export const presetFieldNames = (doc: LabelDoc): string[] =>
    presetFields(doc).map((field) => field.name);
