/**
 * W1 — lazy print-sequence generator.
 *
 * Turns a CSV row count plus a per-row `$times` callback into a *plan* the print
 * pipeline can walk without ever materializing every page (invariant 9): the plan
 * holds one integer per record (`times × copies`), so even a large job only
 * allocates the `PagePlan` it is actively consuming. `totalPages` is a cheap
 * integer Σ — the niimbluelib task needs it upfront — and carries no
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
 * The lazy source of `PagePlan`s. It walks the per-row `quantity` array that
 * {@link planSequence} already resolved during the Σ pass (one integer per
 * record), yielding one plan at a time: a consumer that stops early leaves the
 * remaining pages unbuilt.
 *
 * - **grouped:** one plan per record, in row order.
 * - **interleaved:** copy-major / row-minor — copy `0` visits every record in
 *   row order, then copy `1` visits the records with more copies left, and so
 *   on. `A,B,C` ×2 emits `A,B,C,A,B,C`; unequal quantities round-robin
 *   (`2,1,3` → `0,1,2,0,2,2`). Each copy pass drops the records it exhausted,
 *   so the walk is O(rows + pages) rather than O(maxQuantity × rows) — a large
 *   CSV with one huge `$times` cannot stall the generator.
 */
async function* generatePages(
    quantities: readonly number[],
    order: PrintOrder,
): AsyncGenerator<PagePlan> {
    if (order === 'grouped') {
        for (let rowIndex = 0; rowIndex < quantities.length; rowIndex++) {
            const quantity = quantities[rowIndex]!;
            if (quantity > 0) yield { rowIndex, quantity };
        }
        return;
    }

    let active: number[] = [];
    for (let rowIndex = 0; rowIndex < quantities.length; rowIndex++) {
        if (quantities[rowIndex]! > 0) active.push(rowIndex);
    }

    for (let copy = 0; active.length > 0; copy++) {
        const next: number[] = [];
        for (const rowIndex of active) {
            yield { rowIndex, quantity: 1 };
            if (quantities[rowIndex]! > copy + 1) next.push(rowIndex);
        }
        active = next;
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
 * **`timesFor` MUST be pure and stable across calls.** It is invoked exactly
 * once per row, during the upfront Σ pass, and the resolved quantities are
 * handed to the generator — never re-evaluated per page. Stability still
 * matters because callers may re-derive the plan for a later iteration pass
 * (see `buildCsvPrintJob`'s re-iterable job); a non-deterministic callback
 * would make that pass disagree with the eagerly-computed `totalPages`, which
 * trips the downstream Σ-quantity guard mid-job.
 *
 * - **grouped:** one `{ rowIndex, quantity: times × copies }` per record, in row
 *   order.
 * - **interleaved:** copy-major / row-minor — one `{ rowIndex, quantity: 1 }`
 *   per copy, walking the records in row order for each copy. `A,B,C` ×2 emits
 *   `A,B,C,A,B,C`; unequal quantities round-robin (`2,1,3` → `0,1,2,0,2,2`).
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

    // Resolve `times × copies` once per row. The Σ pass already has to visit
    // every row for the MAX_TOTAL_PAGES guard, so it doubles as the quantity
    // precompute: one integer per record (not one page), which is what lets the
    // interleaved generator emit copy-major without re-evaluating `timesFor`.
    const quantities = new Array<number>(rows).fill(0);
    let totalPages = 0;
    for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
        const quantity = normalizeTimes(timesFor(rowIndex)) * copies;
        quantities[rowIndex] = quantity;
        totalPages += quantity;
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
        pages: generatePages(quantities, opts.order),
    };
}
