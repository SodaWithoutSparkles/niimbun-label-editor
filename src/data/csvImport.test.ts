import { describe, expect, it, vi } from 'vitest';
import { CSV_ROW_CAP, parseCsvFile, parseCsvText, type CsvWarning } from './csvImport';

const typesOf = (warnings: CsvWarning[]): string[] => warnings.map((warning) => warning.kind);

describe('parseCsvText — table shape', () => {
    it('uses the first row as columns and maps data rows to string arrays', () => {
        const parsed = parseCsvText('sku,qty\nA,1\nB,2\n');

        expect(parsed.columns).toEqual(['sku', 'qty']);
        expect(parsed.rows).toEqual([
            ['A', '1'],
            ['B', '2'],
        ]);
        expect(parsed.rowCount).toBe(2);
        expect(parsed.warnings).toEqual([]);
    });

    it('handles quoted commas and embedded newlines', () => {
        const parsed = parseCsvText('name,notes\n"Doe, John","line1\nline2"\n');

        expect(parsed.columns).toEqual(['name', 'notes']);
        expect(parsed.rows).toEqual([['Doe, John', 'line1\nline2']]);
    });

    it('handles CRLF line endings', () => {
        const parsed = parseCsvText('a,b\r\n1,2\r\n3,4\r\n');

        expect(parsed.columns).toEqual(['a', 'b']);
        expect(parsed.rows).toEqual([
            ['1', '2'],
            ['3', '4'],
        ]);
    });

    it('skips blank lines greedily', () => {
        const parsed = parseCsvText('a,b\n\n1,2\n   \n3,4\n');

        expect(parsed.rows).toEqual([
            ['1', '2'],
            ['3', '4'],
        ]);
    });

    it('pads ragged rows and reports the mismatch as one parse-error warning', () => {
        const parsed = parseCsvText('a,b,c\n1,2\n');

        expect(parsed.columns).toEqual(['a', 'b', 'c']);
        expect(parsed.rows).toEqual([['1', '2', '']]);
        expect(typesOf(parsed.warnings)).toContain('parse-error');
    });

    it('never throws on quoted malformed input', () => {
        expect(() => parseCsvText('a,b\n"unterminated,2\n')).not.toThrow();
    });
});

describe('parseCsvText — header inference', () => {
    it('returns columns with no rows for a header-only file (not empty)', () => {
        const parsed = parseCsvText('a,b\n');

        expect(parsed.columns).toEqual(['a', 'b']);
        expect(parsed.rows).toEqual([]);
        expect(parsed.rowCount).toBe(0);
        expect(parsed.warnings).toEqual([]);
    });

    it('synthesizes column names for blank header cells', () => {
        const parsed = parseCsvText(',,c\n1,2,3\n');

        expect(parsed.columns).toEqual(['column1', 'column2', 'c']);
        expect(parsed.rows).toEqual([['1', '2', '3']]);
    });

    it('de-duplicates duplicate column names deterministically', () => {
        const parsed = parseCsvText('a,a,b\n1,2,3\n');

        expect(parsed.columns).toEqual(['a', 'a_2', 'b']);
        // Values stay aligned to their original columns.
        expect(parsed.rows).toEqual([['1', '2', '3']]);
    });

    it('de-duplicates a synthesized name that collides with a real header', () => {
        const parsed = parseCsvText('column1,,x\n1,2,3\n');

        expect(parsed.columns).toEqual(['column1', 'column2', 'x']);
    });

    it('takes an all-blank header row as the header and synthesizes columns', () => {
        // Regression: with `header: true` + greedy, an all-blank header could be
        // discarded and `1,2,3` would silently become the header.
        const parsed = parseCsvText(',,\n1,2,3\n');

        expect(parsed.columns).toEqual(['column1', 'column2', 'column3']);
        expect(parsed.rows).toEqual([['1', '2', '3']]);
    });

    it('skips leading blank lines before the header', () => {
        const parsed = parseCsvText('\n\na,b\n1,2\n');

        expect(parsed.columns).toEqual(['a', 'b']);
        expect(parsed.rows).toEqual([['1', '2']]);
    });
});

describe('parseCsvText — prototype-safe column names', () => {
    it('reads real cells for `__proto__` and `constructor` headers', () => {
        const parsed = parseCsvText('__proto__,constructor\nx,y\n');

        expect(parsed.columns).toEqual(['__proto__', 'constructor']);
        expect(parsed.rows).toEqual([['x', 'y']]);
        expect(parsed.warnings).toEqual([]);
    });

    it('reads `hasOwnProperty`/`toString` headers and pads a missing cell to empty', () => {
        const parsed = parseCsvText('hasOwnProperty,toString\nonly\n');

        expect(parsed.columns).toEqual(['hasOwnProperty', 'toString']);
        // `only` is the first cell; the absent second cell must be '', not a
        // function or undefined.
        expect(parsed.rows).toEqual([['only', '']]);
        expect(typesOf(parsed.warnings)).toContain('parse-error');
    });
});

describe('parseCsvText — empty input', () => {
    it('returns an empty result with an empty warning', () => {
        const parsed = parseCsvText('');

        expect(parsed.columns).toEqual([]);
        expect(parsed.rows).toEqual([]);
        expect(parsed.rowCount).toBe(0);
        expect(parsed.warnings).toEqual([{ kind: 'empty' }]);
    });

    it('treats whitespace-only input as empty', () => {
        const parsed = parseCsvText('   \n  \n');

        expect(parsed.warnings).toEqual([{ kind: 'empty' }]);
    });
});

describe('parseCsvText — row cap', () => {
    const fiveRows = (): string => `n\n${['0', '1', '2', '3', '4'].join('\n')}\n`;

    it('keeps the first `rowCap` rows and reports the exact dropped count', () => {
        const parsed = parseCsvText(fiveRows(), { rowCap: 3 });

        expect(parsed.rows).toEqual([['0'], ['1'], ['2']]);
        expect(parsed.rowCount).toBe(3);
        expect(parsed.rows).toHaveLength(3);
        expect(parsed.warnings).toContainEqual({ kind: 'rows-capped', cap: 3, total: 5 });
    });

    it('does not warn when the input is exactly at the cap', () => {
        const parsed = parseCsvText(fiveRows(), { rowCap: 5 });

        expect(parsed.rows).toHaveLength(5);
        expect(typesOf(parsed.warnings)).not.toContain('rows-capped');
    });

    it('exposes the hard cap constant', () => {
        expect(CSV_ROW_CAP).toBe(50_000);
    });

    it('does not accumulate row errors past the retained-row budget', () => {
        // 100 ragged rows, cap 3: only the 3 retained rows may contribute error
        // messages, so the summary reports exactly 2 extra — not 99.
        const text = `a,b,c\n${'1,2\n'.repeat(100)}`;

        const parsed = parseCsvText(text, { rowCap: 3 });

        expect(parsed.rows).toEqual([
            ['1', '2', ''],
            ['1', '2', ''],
            ['1', '2', ''],
        ]);
        expect(parsed.warnings).toContainEqual({ kind: 'rows-capped', cap: 3, total: 100 });
        const parseError = parsed.warnings.find((warning) => warning.kind === 'parse-error');
        expect(parseError).toMatchObject({ kind: 'parse-error' });
        expect((parseError as { message: string }).message.endsWith('(+2 more)')).toBe(true);
    });
});

describe('parseCsvText — progress', () => {
    it('reports a running data-row count', () => {
        const onProgress = vi.fn();
        parseCsvText('a\n1\n2\n3\n', { onProgress });

        expect(onProgress).toHaveBeenCalledTimes(3);
        expect(onProgress).toHaveBeenLastCalledWith({ rows: 3 });
    });
});

describe('parseCsvFile', () => {
    it('parses a Blob with the same shape as the text path', async () => {
        const file = new Blob(['a,b\n1,2\n3,4\n'], { type: 'text/csv' });

        const parsed = await parseCsvFile(file);

        expect(parsed.columns).toEqual(['a', 'b']);
        expect(parsed.rows).toEqual([
            ['1', '2'],
            ['3', '4'],
        ]);
        expect(parsed.warnings).toEqual([]);
    });

    it('honors the row cap for files', async () => {
        const file = new Blob(['n\n0\n1\n2\n3\n4\n'], { type: 'text/csv' });

        const parsed = await parseCsvFile(file, { rowCap: 2 });

        expect(parsed.rows).toEqual([['0'], ['1']]);
        expect(parsed.warnings).toContainEqual({ kind: 'rows-capped', cap: 2, total: 5 });
    });
});
