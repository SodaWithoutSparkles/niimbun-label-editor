import type { CsvRecord } from '../data/csvRepo';

/**
 * Pure `$times` reader for the print pipeline (W1/W4).
 *
 * Extracted from `printLabel.ts` so `src/components/print/printDialogModel.ts`
 * can share the *exact* build-time semantics without importing the heavy print
 * job module (`@mmote/niimbluelib` `ImageEncoder`, `src/editor/render`). The two
 * callers must agree on the copy count or the D-01 Σ-quantity guard would trip
 * mid-job. `printLabel.ts` re-exports these for its existing importers.
 *
 * React/DOM-free (decision 42): this module only reads CSV cells.
 */

/**
 * Parse one `$times` cell into a copy count.
 *
 * Reference semantics (`PrintPreview.svelte:372-389`): absent/empty → 1;
 * `Number.parseInt(raw, 10)` so `' 3 '` → 3, `'3.9'` → 3, `'1e3'` → 1 and
 * `'0x10'` → 0 (radix-10 stops at `x`). A non-integer parse (`NaN`) → 1.
 * Negatives clamp to 0 (the row is then skipped by the sequence); `0` stays 0.
 *
 * A huge but finite value (e.g. `'3000000000'`) is returned as-is; it is not
 * clamped here. {@link snapshotTimes} stores counts in a `Float64Array`, so the
 * value cannot wrap negative the way an `Int32Array` did (which silently turned
 * the row into a skip). Instead the oversized value flows into the sequence
 * planner, where `Σ > MAX_TOTAL_PAGES` rejects the job with a loud `RangeError`
 * — a deterministic outcome rather than silent data loss.
 */
export const parseTimesCell = (raw: string | undefined): number => {
    if (raw === undefined || raw === '') return 1;
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) ? Math.max(0, Math.floor(parsed)) : 1;
};

/**
 * Snapshot the whole `$times` column once, at build time.
 *
 * Invariant 9: this is a bare integer array (one count per row), never a raster.
 * Freezing the values here is what keeps the lazy print generator in step with
 * the Σ computed by the sequence planner: a CSV mutated after the job is built
 * can no longer make them disagree and trip the D-01 guard mid-job.
 *
 * An absent column defaults every row to 1; a row shorter than the column list
 * yields `undefined` → 1. No CSV at all yields a one-element `[1]`.
 *
 * The backing store is a `Float64Array` (not `Int32Array`): a `$times` cell
 * above `2^31 - 1` must not wrap negative and silently skip its row. A value
 * beyond `MAX_TOTAL_PAGES` is left intact and rejected downstream (see
 * {@link parseTimesCell}).
 */
export const snapshotTimes = (csv: CsvRecord | null): Float64Array => {
    if (csv === null) return Float64Array.of(1);
    const rows = csv.rows.length;
    const columnIndex = csv.columns.indexOf('$times');
    const snapshot = new Float64Array(rows);
    for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
        const raw = columnIndex < 0 ? undefined : csv.rows[rowIndex]?.[columnIndex];
        snapshot[rowIndex] = parseTimesCell(raw);
    }
    return snapshot;
};

/** Reader over a {@link snapshotTimes} result (out-of-range → the default 1). */
export const timesForSnapshot = (snapshot: Float64Array): ((rowIndex: number) => number) =>
    (rowIndex) => snapshot.at(rowIndex) ?? 1;
