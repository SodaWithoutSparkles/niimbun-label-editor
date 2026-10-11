import { describe, expect, it } from 'vitest';
import { buildRowContext } from './rowContext';

describe('buildRowContext', () => {
    it('builds the plan shape for an in-range row', () => {
        const ctx = buildRowContext({
            columns: ['sku', 'name'],
            rows: [
                ['A1', 'Bolt'],
                ['A2', 'Nut'],
            ],
            index: 1,
            now: 1_700_000_000_000,
        });
        expect(ctx).toEqual({
            index: 1,
            total: 2,
            row: { sku: 'A2', name: 'Nut' },
            rowCount: 2,
            now: 1_700_000_000_000,
            label: {},
            globals: {},
            seeds: { docSeed: '' },
        });
    });

    it('defaults seeds to an empty docSeed and forwards an explicit seed', () => {
        const defaulted = buildRowContext({ columns: [], rows: [], index: 0, now: 1 });
        expect(defaulted.seeds).toEqual({ docSeed: '' });

        const seeded = buildRowContext({
            columns: [],
            rows: [],
            index: 0,
            now: 1,
            seeds: { docSeed: 'doc-42' },
        });
        expect(seeded.seeds).toEqual({ docSeed: 'doc-42' });
    });

    it('forwards label, globals and fmt, defaulting label/globals to {}', () => {
        const fmt = { locale: 'en-US' };
        const ctx = buildRowContext({
            columns: ['a'],
            rows: [['x']],
            index: 0,
            now: 1,
            label: { name: 'L' },
            globals: { greeting: 'hi' },
            fmt,
        });
        expect(ctx.label).toEqual({ name: 'L' });
        expect(ctx.globals).toEqual({ greeting: 'hi' });
        expect(ctx.fmt).toBe(fmt);
    });

    it('yields an empty row for an out-of-range index (never clamps)', () => {
        const rows = [['A1', 'Bolt']];
        const above = buildRowContext({ columns: ['sku', 'name'], rows, index: 5, now: 1 });
        const negative = buildRowContext({ columns: ['sku', 'name'], rows, index: -1, now: 1 });
        const fractional = buildRowContext({ columns: ['sku', 'name'], rows, index: 0.5, now: 1 });
        expect(above.row).toEqual({});
        expect(negative.row).toEqual({});
        expect(fractional.row).toEqual({});
        // The requested index is still reported truthfully.
        expect(above.index).toBe(5);
        expect(above.total).toBe(1);
    });

    it('handles an empty table', () => {
        const ctx = buildRowContext({ columns: [], rows: [], index: 0, now: 1 });
        expect(ctx.row).toEqual({});
        expect(ctx.rowCount).toBe(0);
        expect(ctx.total).toBe(0);
    });

    it('maps a missing cell in a short row to the empty string', () => {
        const ctx = buildRowContext({ columns: ['sku', 'name', 'qty'], rows: [['A1']], index: 0, now: 1 });
        expect(ctx.row).toEqual({ sku: 'A1', name: '', qty: '' });
    });

    it('skips blank column names and lets the first duplicate win', () => {
        const ctx = buildRowContext({
            columns: ['', 'sku', 'sku'],
            rows: [['ignored', 'first', 'last']],
            index: 0,
            now: 1,
        });
        expect(ctx.row.sku).toBe('first');
    });

    it('reads __proto__ / constructor / toString columns as ordinary cells', () => {
        const ctx = buildRowContext({
            columns: ['__proto__', 'constructor', 'toString'],
            rows: [['p', 'c', 't']],
            index: 0,
            now: 1,
        });
        expect(Object.getPrototypeOf(ctx.row)).toBeNull();
        expect(Object.hasOwn(ctx.row, '__proto__')).toBe(true);
        expect(ctx.row['__proto__']).toBe('p');
        expect(ctx.row['constructor']).toBe('c');
        expect(ctx.row['toString']).toBe('t');
    });

    it('does not mutate its inputs', () => {
        const columns = ['a'];
        const rows = [['x']];
        buildRowContext({ columns, rows, index: 0, now: 1 });
        expect(columns).toEqual(['a']);
        expect(rows).toEqual([['x']]);
    });
});
