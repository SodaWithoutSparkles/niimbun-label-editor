import type { FieldDef } from './types';

/**
 * Field declarations (P6a) — pure normalization shared by the document
 * validator and the store, so a declaration has exactly one stored shape.
 *
 * A document without `data.fields` has no declarations. A binding does **not**
 * need a declaration to resolve, so an absent list is normal, not an error.
 */

/** The id of the CSV row selector. Declared automatically when a CSV is attached. */
export const CSV_ROW_FIELD_ID = 'csv.row';

/**
 * Ids the application fills itself. They are valid declarations (a preset may
 * style or require them), but they are never offerable as a plain text binding.
 */
export const RESERVED_FIELD_IDS = [CSV_ROW_FIELD_ID] as const;

/** One reserved field id. */
export type ReservedFieldId = (typeof RESERVED_FIELD_IDS)[number];

/** True when `id` is filled by the application rather than by the author. */
export const isReservedFieldId = (id: string): id is ReservedFieldId =>
    (RESERVED_FIELD_IDS as readonly string[]).includes(id);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

/** Result of {@link normalizeFieldDefs}: the kept declarations plus repair notes. */
export interface NormalizedFieldDefs {
    fields: FieldDef[];
    repairs: string[];
}

/**
 * Normalize raw `data.fields` into the stored `FieldDef[]` shape.
 *
 * - A non-array value yields no declarations plus a repair.
 * - An entry without a non-empty string `id` is dropped.
 * - Duplicate ids are **first wins**; later duplicates are dropped.
 * - `default` is kept only as a non-empty string. `''` is the absent value.
 * - `required` / `hidden` are kept as booleans, including an explicit `false`,
 *   so a bundle round-trip stays verbatim; non-booleans are dropped.
 * - Ids are stored untrimmed, exactly as a binding looks them up.
 *
 * Never throws and never mutates `raw`.
 */
export const normalizeFieldDefs = (raw: unknown): NormalizedFieldDefs => {
    const repairs: string[] = [];
    if (!Array.isArray(raw)) {
        repairs.push('fields: must be an array');
        return { fields: [], repairs };
    }

    const fields: FieldDef[] = [];
    const seen = new Set<string>();

    raw.forEach((entry, index) => {
        if (!isRecord(entry)) {
            repairs.push(`fields[${index}]: non-object entry dropped`);
            return;
        }
        const id = entry.id;
        if (typeof id !== 'string' || id.length === 0) {
            repairs.push(`fields[${index}]: id must be a non-empty string; entry dropped`);
            return;
        }
        if (seen.has(id)) {
            repairs.push(`fields[${index}]: duplicate id "${id}" dropped`);
            return;
        }
        seen.add(id);

        const def: FieldDef = { id };
        if (entry.default !== undefined) {
            if (typeof entry.default !== 'string') {
                repairs.push(`fields[${index}]: default is not a string; dropped`);
            } else if (entry.default.length > 0) {
                def.default = entry.default;
            }
        }
        if (entry.required !== undefined) {
            if (typeof entry.required !== 'boolean') {
                repairs.push(`fields[${index}]: required is not a boolean; dropped`);
            } else {
                def.required = entry.required;
            }
        }
        if (entry.hidden !== undefined) {
            if (typeof entry.hidden !== 'boolean') {
                repairs.push(`fields[${index}]: hidden is not a boolean; dropped`);
            } else {
                def.hidden = entry.hidden;
            }
        }
        fields.push(def);
    });

    return { fields, repairs };
};

/**
 * Ensure `csv.row` is declared last and carries its own settings. An absent
 * declaration is appended; an existing one is removed from its current position
 * and re-appended, keeping its `default` / `required` / `hidden` values.
 * Idempotent and pure: the input array and its entries are never mutated and a
 * new array is always returned. Called when a CSV is attached; clearing the CSV
 * leaves the declaration alone.
 */
export const ensureCsvRowField = (fields: readonly FieldDef[]): FieldDef[] => {
    const row = fields.find((field) => field.id === CSV_ROW_FIELD_ID);
    if (row === undefined) return [...fields, { id: CSV_ROW_FIELD_ID }];
    // Shallow-copy the moved entry so the result never aliases the input.
    return [...fields.filter((field) => field.id !== CSV_ROW_FIELD_ID), { ...row }];
};
