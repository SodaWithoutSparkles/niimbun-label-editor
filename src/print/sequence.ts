/**
 * W1 — lazy print-sequence generator.
 *
 * Turns a CSV row count plus a per-row `$times` callback into a *plan* the print
 * pipeline can walk without ever materializing every page (invariant 9): a large
 * job only allocates the `PagePlan` it is actively consuming. `totalPages` is a
 * cheap integer Σ — the niimbluelib task needs it upfront — and carries no
 * raster/encode work.
 *
 * This module is deliberately pure (decision 42): it imports no DOM/React/Konva,
 * no IndexedDB and no `@mmote/niimbluelib` runtime, so the plain-CSV path stays
 * independent of the template engine and trust gate.
 *
 * `$times` reference semantics (`references/niimblue/.../PrintPreview.svelte:372-389`):
 * absent/empty → 1, parsed with `parseInt`, negative clamped to 0 (row skipped).
 * The caller owns the CSV cell → number step; {@link planSequence} only receives
 * the resolved number and applies floor/NaN/negative normalisation.
 */

export type PrintOrder = 'grouped' | 'interleaved';

export interface SequenceOptions {
    order: PrintOrder;
    /** Dialog global copies multiplier. Positive integer, default 1. */
    copies: number;
    /** Warn when interleaved physical pages exceed this. Default 50. */
    interleaveWarnAt?: number;
}

/** Hard ceiling on `totalPages`, protecting invariant 9 from an absurd `$times`. */
export const MAX_TOTAL_PAGES = 1_000_000;

export interface PagePlan {
    rowIndex: number;
    quantity: number;
}

export interface SequenceWarning {
    kind: 'interleaved-pages';
    pages: number;
    cap: number;
}

export interface SequencePlan {
    totalPages: number; // Σ quantity (cheap ints; no rendering)
    rows: number; // CSV row count (records)
    warning?: SequenceWarning;
    pages: AsyncIterable<PagePlan>; // lazy
}

/**
 * Normalise a raw `$times` value to the module's copy count:
 * non-finite (NaN/±Infinity) → 0, fractions floored, negatives → 0.
 */
const normalizeTimes = (raw: number): number => {
    if (!Number.isFinite(raw)) return 0;
    const floored = Math.floor(raw);
    return floored < 0 ? 0 : floored;
};

/**
 * The lazy source of `PagePlan`s. Never precomputes: each `next()` visits only
 * the records needed to produce the plans it yields, so a consumer that stops
 * early leaves the remaining rows unbuilt.
 */
async function* generatePages(
    rows: number,
    timesFor: (rowIndex: number) => number,
    copies: number,
    order: PrintOrder,
): AsyncGenerator<PagePlan> {
    for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
        const quantity = normalizeTimes(timesFor(rowIndex)) * copies;
        if (quantity <= 0) continue;

        if (order === 'grouped') {
            yield { rowIndex, quantity };
        } else {
            for (let copy = 0; copy < quantity; copy++) {
                yield { rowIndex, quantity: 1 };
            }
        }
    }
}

/**
 * Build a lazy sequence plan.
 *
 * `timesFor(rowIndex)` supplies the row's `$times` copy count. The callback MUST
 * resolve a missing/empty `$times` cell to `1` (the reference default); this
 * module then floors fractions and clamps non-finite/negative values to 0, which
 * skips the row. Records whose `times × copies` is 0 emit no plan.
 *
 * **`timesFor` MUST be pure and stable across calls.** It is invoked once per row
 * in the upfront Σ pass and once more per row when the generator runs. A
 * non-deterministic callback would make the eagerly-computed `totalPages` differ
 * from the quantity the generator actually emits, which trips the downstream
 * Σ-quantity guard mid-job.
 *
 * - **grouped:** one `{ rowIndex, quantity: times × copies }` per record.
 * - **interleaved:** `times × copies` plans of `{ rowIndex, quantity: 1 }`.
 *
 * `copies` is the dialog's global multiplier (positive integer, default 1).
 *
 * `totalPages` is the Σ of every quantity the generator will yield, computed
 * upfront as cheap integers. A {@link SequenceWarning} is attached when
 * `order === 'interleaved'` and the physical page count exceeds
 * `interleaveWarnAt` (default 50).
 *
 * @throws {RangeError} If `rows` is not a non-negative integer, if `copies` is
 * not a positive integer, if `interleaveWarnAt` is provided and is not a
 * non-negative integer, or if the computed `totalPages` exceeds
 * {@link MAX_TOTAL_PAGES}.
 */
export function planSequence(
    rows: number,
    timesFor: (rowIndex: number) => number,
    opts: SequenceOptions,
): SequencePlan {
    if (!Number.isInteger(rows) || rows < 0) {
        throw new RangeError(
            `planSequence: rows must be a non-negative integer (got ${rows})`,
        );
    }

    const copies = opts.copies ?? 1;
    if (!Number.isInteger(copies) || copies < 1) {
        throw new RangeError(
            `planSequence: copies must be a positive integer (got ${copies})`,
        );
    }

    const cap = opts.interleaveWarnAt ?? 50;
    if (!Number.isInteger(cap) || cap < 0) {
        throw new RangeError(
            `planSequence: interleaveWarnAt must be a non-negative integer (got ${cap})`,
        );
    }

    let totalPages = 0;
    for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
        totalPages += normalizeTimes(timesFor(rowIndex)) * copies;
        if (totalPages > MAX_TOTAL_PAGES) {
            throw new RangeError(
                `planSequence: total pages exceed MAX_TOTAL_PAGES (${MAX_TOTAL_PAGES})`,
            );
        }
    }

    const warning: SequenceWarning | undefined =
        opts.order === 'interleaved' && totalPages > cap
            ? { kind: 'interleaved-pages', pages: totalPages, cap }
            : undefined;

    return {
        totalPages,
        rows,
        ...(warning ? { warning } : {}),
        pages: generatePages(rows, timesFor, copies, opts.order),
    };
}
