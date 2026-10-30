import { describe, expect, it } from 'vitest';
import { CSV_ROW_FIELD_ID, RESERVED_FIELD_IDS, ensureCsvRowField, isReservedFieldId, normalizeFieldDefs } from './fieldDefs';
import type { FieldDef } from './types';

/**
 * Field declarations (P6a): one normalization rule shared by the validator and
 * the store, plus the reserved `csv.row` selector.
 */

describe('normalizeFieldDefs', () => {
    it('keeps declarations in order with every flag', () => {
        const raw = [
            { id: 'price', default: '$0', required: true, hidden: true },
            { id: 'sku' },
            { id: 'notes', hidden: true },
        ];
        expect(normalizeFieldDefs(raw)).toEqual({
            fields: [
                { id: 'price', default: '$0', required: true, hidden: true },
                { id: 'sku' },
                { id: 'notes', hidden: true },
            ],
            repairs: [],
        });
    });

    it('dedupes ids first-wins and reports the later duplicate', () => {
        const result = normalizeFieldDefs([
            { id: 'price', default: 'first' },
            { id: 'price', default: 'second', required: true },
        ]);
        expect(result.fields).toEqual([{ id: 'price', default: 'first' }]);
        expect(result.repairs).toHaveLength(1);
        expect(result.repairs[0]).toContain('duplicate id "price"');
    });

    it('drops blank, absent and non-string ids with the whole entry', () => {
        const result = normalizeFieldDefs([
            { id: '' },
            { default: 'no id' },
            { id: 7, default: 'number id' },
            { id: 'kept' },
            null,
            'nope',
        ]);
        expect(result.fields).toEqual([{ id: 'kept' }]);
        expect(result.repairs).toHaveLength(5);
    });

    it('stores ids untrimmed, exactly as bindings look them up', () => {
        expect(normalizeFieldDefs([{ id: '  price  ' }]).fields).toEqual([{ id: '  price  ' }]);
    });

    it('drops a non-string default instead of coercing it', () => {
        const result = normalizeFieldDefs([{ id: 'price', default: 42 }]);
        expect(result.fields).toEqual([{ id: 'price' }]);
        expect(result.repairs[0]).toContain('default is not a string');
    });

    it('treats an empty default as absent', () => {
        expect(normalizeFieldDefs([{ id: 'price', default: '' }]).fields).toEqual([{ id: 'price' }]);
    });

    it('drops a non-boolean flag instead of coercing it', () => {
        const result = normalizeFieldDefs([{ id: 'price', required: 'true', hidden: 1 }]);
        expect(result.fields).toEqual([{ id: 'price' }]);
        expect(result.repairs).toHaveLength(2);
    });

    it('preserves explicit false flags, so a bundle round-trip stays verbatim', () => {
        const result = normalizeFieldDefs([{ id: 'sku', required: false, hidden: false }]);
        expect(result.fields).toEqual([{ id: 'sku', required: false, hidden: false }]);
        expect(result.fields[0]).toHaveProperty('required', false);
        expect(result.fields[0]).toHaveProperty('hidden', false);
        expect(result.repairs).toEqual([]);
    });

    it('preserves a reserved id', () => {
        const result = normalizeFieldDefs([{ id: CSV_ROW_FIELD_ID, required: true }]);
        expect(result.fields).toEqual([{ id: CSV_ROW_FIELD_ID, required: true }]);
        expect(result.repairs).toEqual([]);
    });

    it('reports a non-array value and yields no declarations', () => {
        const result = normalizeFieldDefs({ id: 'price' });
        expect(result.fields).toEqual([]);
        expect(result.repairs).toEqual(['fields: must be an array']);
    });

    it('never mutates its input', () => {
        const raw = [{ id: 'price', default: 'x' }];
        const snapshot = structuredClone(raw);
        normalizeFieldDefs(raw);
        expect(raw).toEqual(snapshot);
    });
});

describe('ensureCsvRowField', () => {
    it('appends the row selector last', () => {
        const fields: FieldDef[] = [{ id: 'price' }];
        expect(ensureCsvRowField(fields)).toEqual([{ id: 'price' }, { id: CSV_ROW_FIELD_ID }]);
        // Pure: the caller's list is untouched.
        expect(fields).toEqual([{ id: 'price' }]);
    });

    it('is idempotent and keeps an existing declaration’s settings', () => {
        const fields: FieldDef[] = [{ id: 'price' }, { id: CSV_ROW_FIELD_ID, required: true }];
        expect(ensureCsvRowField(fields)).toEqual(fields);
        expect(ensureCsvRowField(ensureCsvRowField(fields))).toEqual(fields);
    });

    it('moves an out-of-order row selector last, keeping its flags and default', () => {
        const fields: FieldDef[] = [
            { id: CSV_ROW_FIELD_ID, default: '1', required: true, hidden: false },
            { id: 'price' },
        ];
        const result = ensureCsvRowField(fields);
        expect(result).toEqual([
            { id: 'price' },
            { id: CSV_ROW_FIELD_ID, default: '1', required: true, hidden: false },
        ]);
        expect(result).not.toBe(fields);
        // The moved entry is a shallow copy, so mutating the result cannot write
        // back into the caller's list (the doc comment promises purity).
        expect(result[1]).not.toBe(fields[0]);
        expect(result[1]).toEqual(fields[0]);
        // Pure: the caller's list and order are untouched.
        expect(fields).toEqual([
            { id: CSV_ROW_FIELD_ID, default: '1', required: true, hidden: false },
            { id: 'price' },
        ]);
    });
});

describe('reserved field ids', () => {
    it('exposes csv.row and recognises it', () => {
        expect(RESERVED_FIELD_IDS).toEqual([CSV_ROW_FIELD_ID]);
        expect(isReservedFieldId(CSV_ROW_FIELD_ID)).toBe(true);
        expect(isReservedFieldId('price')).toBe(false);
    });
});
