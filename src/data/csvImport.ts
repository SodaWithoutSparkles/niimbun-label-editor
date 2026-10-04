import * as Papa from 'papaparse';
import type { ParseConfig } from 'papaparse';

/**
 * CSV import — PapaParse → `{ columns, rows, warnings }` (P6 W1).
 *
 * Pure, storage-free data layer: it never touches the store, IDB or the DOM
 * (the file path uses PapaParse's own `FileReader`, not ours), so `parseCsvText`
 * is headlessly unit-testable in vitest.
 *
 * Provenance is deliberately NOT decided here: callers store a `CsvRecord`
 * through `csvRepo` and put a `local` `CsvRef` on the doc. The parse only
 * produces the table.
 *
 * ## Header semantics
 *
 * Parsing uses `header: false` and splits the header from the data ourselves.
 * This is deliberate:
 *   - the header is the first non-blank PHYSICAL row (leading blank lines — a
 *     single empty/whitespace cell — are skipped so a file that starts with a
 *     stray newline still gets its real header);
 *   - an all-blank header row with two or more cells (e.g. `,,`) is a header,
 *     not a blank line, so its columns are synthesized (`column1`, `column2`, …)
 *     rather than the next data row silently becoming the header;
 *   - data rows are raw `string[]`, so a column named `__proto__`,
 *     `constructor`, `toString` or `hasOwnProperty` reads its real cell value
 *     instead of an `Object.prototype` member;
 *   - duplicate header names are de-duplicated deterministically (`a`, `a_2`, …).
 *
 * Blank DATA rows are skipped with the old `skipEmptyLines: 'greedy'` rule
 * (every cell empty/whitespace) — applied by hand, because PapaParse must not be
 * allowed to drop a blank header row.
 *
 * A genuinely header-less file (data in row 1) is still NOT guessed at: row 1
 * becomes the header, as `header: true` always did. Detecting it needs a
 * heuristic that would mangle legitimate numeric headers.
 *
 * ## Row cap
 *
 * At most `CSV_ROW_CAP` rows are RETAINED in memory (protects memory and the
 * IDB write). Rows are also counted past the cap so the dropped count is exact,
 * but past the budget NOTHING is accumulated — no row, no error — so a huge
 * malformed file cannot grow the error list without bound. Hitting the cap
 * emits `{ kind: 'rows-capped', cap, total }` — never a silent truncation.
 *
 * Warning `message` strings are raw diagnostics (PapaParse/FileReader text), not
 * product copy. The UI renders localized copy from `kind`; the data layer must
 * not import i18n (it would create an eval-time cycle via `i18n/index` →
 * `useStore`), so it cannot call `t()`.
 */

/** Hard retained-row cap. Rows past it are counted but not kept. */
export const CSV_ROW_CAP = 50_000;

export type CsvWarning =
    | { kind: 'rows-capped'; cap: number; total: number }
    | { kind: 'empty' }
    | { kind: 'parse-error'; message: string };

export interface ParsedCsv {
    /** Column names in file order; blank header cells are synthesized. */
    columns: string[];
    /**
     * Data rows as string arrays aligned to `columns`. A ragged (short) row is
     * padded with `''`; extra cells are dropped (the mismatch surfaces as a
     * `parse-error` warning).
     */
    rows: string[][];
    /**
     * Number of rows RETAINED in `rows` (`=== rows.length`, capped). This is not
     * the input's row count on a capped parse — the full pre-cap total lives in
     * the `rows-capped` warning's `total` (`total = rowCount + dropped`). Callers
     * can therefore always safely iterate `0 … rowCount - 1`.
     */
    rowCount: number;
    warnings: CsvWarning[];
}

export interface ParseCsvOptions {
    /** Called as rows are parsed; `rows` is the running count of data rows. */
    onProgress?: (info: { rows: number }) => void;
    /** Retained-row cap. Defaults to `CSV_ROW_CAP`. */
    rowCap?: number;
}

interface Accumulator {
    /** Raw header cells, or `null` until the header row is found. */
    keys: string[] | null;
    rows: string[][];
    total: number;
    /** Bounded diagnostic messages (never grows past the retained-row budget). */
    errors: string[];
    fatalError: string | null;
}

const newAccumulator = (): Accumulator => ({
    keys: null,
    rows: [],
    total: 0,
    errors: [],
    fatalError: null,
});

/** Non-negative integer cap; a missing/non-finite value falls back to the hard cap. */
const resolveCap = (value: number | undefined): number => {
    if (value === undefined || !Number.isFinite(value)) return CSV_ROW_CAP;
    return Math.max(0, Math.floor(value));
};

/** A blank physical line: at most one cell, and that cell is empty/whitespace. */
const isBlankLine = (cells: readonly string[]): boolean =>
    cells.length === 0 || (cells.length === 1 && (cells[0] ?? '').trim().length === 0);

/** PapaParse's `skipEmptyLines: 'greedy'`: every cell empty/whitespace. */
const isGreedyEmpty = (cells: readonly string[]): boolean =>
    cells.length === 0 || cells.every((cell) => cell.trim().length === 0);

/** Synthesize blank header names by position and de-duplicate deterministically. */
const buildColumns = (fields: readonly string[]): string[] => {
    const used = new Set<string>();
    const columns: string[] = [];
    fields.forEach((field, index) => {
        const trimmed = field.trim();
        const base = trimmed.length > 0 ? trimmed : `column${index + 1}`;
        let name = base;
        let suffix = 2;
        while (used.has(name)) {
            name = `${base}_${suffix}`;
            suffix += 1;
        }
        used.add(name);
        columns.push(name);
    });
    return columns;
};

/** Pad/truncate one positional row to `width`; a missing cell becomes `''`. */
const normalizeRow = (cells: readonly string[], width: number): string[] => {
    const row: string[] = new Array<string>(width);
    for (let index = 0; index < width; index += 1) {
        const cell = cells[index];
        row[index] = typeof cell === 'string' ? cell : '';
    }
    return row;
};

/** One diagnostic for any number of messages. */
const summarizeMessages = (messages: readonly string[]): string => {
    const first = messages[0] ?? 'Unknown parse error';
    return messages.length > 1 ? `${first} (+${messages.length - 1} more)` : first;
};

/**
 * Shared config. Parsing is positional (`header: false`) so the header is chosen
 * by us, not by `skipEmptyLines`, and data cells can never collide with
 * `Object.prototype` keys.
 */
const stepConfig = (
    cap: number,
    acc: Accumulator,
    onProgress: ParseCsvOptions['onProgress'],
): ParseConfig<string[]> => ({
    header: false,
    // Blank DATA rows are skipped by `isGreedyEmpty` instead; letting PapaParse
    // apply greedy here would drop an all-blank header row before we see it.
    skipEmptyLines: false,
    step: (result) => {
        const cells = result.data;

        if (acc.keys === null) {
            // Still looking for the header; skip leading blank physical lines.
            if (isBlankLine(cells)) return;
            acc.keys = cells.map((cell) => String(cell));
            return;
        }

        if (isGreedyEmpty(cells)) return;

        acc.total += 1;

        // Past the retained-row budget: count only (for the rows-capped total).
        // No row and no error is accumulated, so memory stays bounded.
        if (acc.rows.length >= cap) return;

        const width = acc.keys.length;
        if (cells.length !== width) {
            acc.errors.push(`Row ${acc.total}: expected ${width} fields but parsed ${cells.length}`);
        }
        for (const error of result.errors) acc.errors.push(error.message);
        acc.rows.push(normalizeRow(cells, width));
        onProgress?.({ rows: acc.total });
    },
});

const finalize = (acc: Accumulator, cap: number): ParsedCsv => {
    const columns = buildColumns(acc.keys ?? []);
    const warnings: CsvWarning[] = [];

    if (acc.total > cap) {
        warnings.push({ kind: 'rows-capped', cap, total: acc.total });
    }

    const parseMessage =
        acc.fatalError ?? (acc.errors.length > 0 ? summarizeMessages(acc.errors) : null);
    if (parseMessage !== null) {
        warnings.push({ kind: 'parse-error', message: parseMessage });
    } else if (acc.total === 0 && columns.length === 0) {
        warnings.push({ kind: 'empty' });
    }

    return { columns, rows: acc.rows, rowCount: acc.rows.length, warnings };
};

/**
 * Parse CSV text synchronously. PapaParse runs the string parser synchronously,
 * so this returns a plain `ParsedCsv` (no promise) — the headless test path.
 * Recoverable input (ragged rows, blank headers) yields warnings, never throws.
 */
export const parseCsvText = (text: string, opts: ParseCsvOptions = {}): ParsedCsv => {
    const cap = resolveCap(opts.rowCap);
    const acc = newAccumulator();
    Papa.parse<string[]>(text, stepConfig(cap, acc, opts.onProgress));
    return finalize(acc, cap);
};

/**
 * Parse a `File`/`Blob` asynchronously via PapaParse's `FileReader` path. Same
 * output shape and cap semantics as `parseCsvText`. Never rejects: a read or
 * parse failure becomes a result carrying a `parse-error` warning.
 */
export const parseCsvFile = (
    file: File | Blob,
    opts: ParseCsvOptions = {},
): Promise<ParsedCsv> => {
    const cap = resolveCap(opts.rowCap);
    return new Promise<ParsedCsv>((resolve) => {
        const acc = newAccumulator();
        let settled = false;
        const done = (): void => {
            if (settled) return;
            settled = true;
            resolve(finalize(acc, cap));
        };

        // `FileReader` accepts a Blob; PapaParse's type wants a `File`. The extra
        // `name`/`lastModified` fields are never read by the reader path.
        Papa.parse<string[]>(file as File, {
            ...stepConfig(cap, acc, opts.onProgress),
            complete: () => {
                done();
            },
            error: (error) => {
                acc.fatalError = error.message;
                done();
            },
        });
    });
};
