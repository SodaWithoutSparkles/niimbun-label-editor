import type { TemplateContext, TemplateFormat, TemplateLabel } from '../../templates/engine';

/**
 * Row-context builder for the P6 binding/execution pre-pass (W2).
 *
 * Headless: no React, Konva, or DOM, and no template execution. The
 * `src/templates` import is a **type-only** import of the engine contract, which
 * `verbatimModuleSyntax` erases at runtime — `src/core` never loads the browser
 * edge. `TemplateEngine` instances are injected by the host.
 *
 * The produced shape is the plan's resolve context
 * `{ index, total, row, rowCount, now, label, globals, fmt }`. It is exactly the
 * {@link TemplateContext} the engine receives, so the two cannot drift.
 */

export interface BuildRowContextInput {
    /** CSV header names, in table order. */
    columns: readonly string[];
    /** CSV data rows, each aligned to `columns`. */
    rows: readonly (readonly string[])[];
    /** Zero-based row index to materialize. */
    index: number;
    /** Label metadata for templates. Defaults to `{}`. */
    label?: TemplateLabel;
    /** Prefetched globals keyed by `GlobalSpec.name`. Defaults to `{}`. */
    globals?: Record<string, unknown>;
    /** Formatting settings. Omitted from the result when not supplied. */
    fmt?: TemplateFormat;
    /** Epoch **milliseconds** at resolve time (decision 24); read by the host. */
    now: number;
}

/** The plan's resolve context shape; aliases the engine's `TemplateContext`. */
export type RowContext = TemplateContext;

/**
 * Build the per-row context for template/CSV resolution.
 *
 * `total` and `rowCount` are both `rows.length` (`total` is the plan's field,
 * `rowCount` a template-ergonomics alias). `row` is a column-name → cell record
 * for `index`:
 *
 * - an out-of-range or non-integer `index` yields an **empty** `row` (never a
 *   clamped row) so a binding falls back rather than silently showing the last
 *   row; the requested `index` is still reported truthfully;
 * - a column with no cell in a short row maps to `''`;
 * - blank column names are skipped (a blank header cannot be bound by name);
 * - duplicate column names: the **first** occurrence wins, matching the
 *   `columns.indexOf` used by direct CSV binding;
 * - the record has a **null prototype** and entries are defined as own data
 *   properties, so columns literally named `__proto__`, `constructor`, or
 *   `toString` are ordinary readable cells (never prototype traffic).
 *
 * Pure: never mutates `columns`/`rows` and never reads the clock.
 */
export const buildRowContext = (input: BuildRowContextInput): RowContext => {
    const { columns, rows, index } = input;
    const total = rows.length;
    const row: Record<string, string> = Object.create(null) as Record<string, string>;

    if (Number.isInteger(index) && index >= 0 && index < total) {
        const cells = rows[index] ?? [];
        for (let i = 0; i < columns.length; i += 1) {
            const column = columns[i];
            if (column === undefined || column.length === 0) continue;
            // First occurrence wins, matching `csvCell`'s `columns.indexOf`.
            if (Object.hasOwn(row, column)) continue;
            // `defineProperty` bypasses the inherited `__proto__` setter; on a
            // null-prototype object there is no inherited setter anyway, but
            // this keeps `constructor`/`toString`/`__proto__` as plain cells.
            Object.defineProperty(row, column, {
                value: cells[i] ?? '',
                enumerable: true,
                writable: true,
                configurable: true,
            });
        }
    }

    return {
        index,
        total,
        row,
        rowCount: total,
        now: input.now,
        label: input.label ?? {},
        globals: input.globals ?? {},
        ...(input.fmt === undefined ? {} : { fmt: input.fmt }),
    };
};
