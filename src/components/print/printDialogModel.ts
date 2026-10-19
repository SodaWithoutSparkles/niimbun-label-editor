import type { hm } from '../../core/hm';
import type { LabelDoc } from '../../core/doc/types';
import type { CsvRecord } from '../../data/csvRepo';
import { snapshotTimes, timesForSnapshot } from '../../print/printTimes';
import type { ResolvedPrintDpi } from '../../print/resolvedDpi';
import type { PrinterStatus } from '../../print/transport';

/**
 * Pure helpers for the print dialog (W4).
 *
 * Deliberately free of React/DOM so the dialog's scheduling, warnings and row
 * enumeration stay unit-testable without a canvas. The `$times` semantics live
 * in the leaf `src/print/printTimes.ts` (re-exported by `printLabel.ts`); the
 * dialog delegates to that same build-time snapshot
 * (`snapshotTimes`/`timesForSnapshot`) so the two cannot diverge — the D-01
 * Σ-quantity guard would otherwise trip mid-job.
 */

/**
 * `$times` reader for the dialog, delegating to the job's own
 * {@link snapshotTimes} + {@link timesForSnapshot}. Absent column / absent row
 * / empty cell / non-integer parse → 1 (the reference default); negatives clamp
 * to 0 and are dropped later by `planSequence`.
 */
export const timesForCsv = (csv: CsvRecord | null): ((rowIndex: number) => number) =>
    timesForSnapshot(snapshotTimes(csv));

/** Record count for the sequence: a CSV's rows, or one page when no CSV. */
export const rowCountOf = (csv: CsvRecord | null): number => csv?.rows.length ?? 1;

/**
 * Record indices with a non-zero copy count (`times × copies`). Rows whose
 * `$times` is 0 (or negative) are skipped entirely — the page list enumerates
 * records, not physical pages (a grouped record shows one thumbnail with a
 * `×quantity` badge).
 */
export const activeRecords = (
    rows: number,
    timesFor: (rowIndex: number) => number,
    copies: number,
): number[] => {
    const active: number[] = [];
    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
        if (timesFor(rowIndex) * copies > 0) active.push(rowIndex);
    }
    return active;
};

/** A non-blocking roll-size/dpi mismatch (dec 18 — never gates printing). */
export interface RollMismatch {
    labelW: hm;
    labelH: hm;
    labelDpi: number;
    rollW?: hm;
    rollH?: hm;
    printerDpi?: number;
    /** The dpi the print will actually use (invariant 7). */
    resolvedDpi: number;
    /** `true` when `resolvedDpi` is the printer-reported value, `false` for the hint. */
    printerDpiInUse: boolean;
}

/**
 * Compare the document's configured size/dpi with the printer-reported roll
 * values. Returns `undefined` when every reported value matches (or is absent).
 *
 * `resolved` carries the effective print dpi (see `resolvePrintDpi`) so the
 * single mismatch warning can say which dpi the print will use; when the
 * reported dpi is absent the mismatch can only be a roll-size one and
 * `printerDpiInUse` is `false`.
 */
export const rollDpiMismatch = (
    doc: LabelDoc,
    status: PrinterStatus,
    resolved: ResolvedPrintDpi,
): RollMismatch | undefined => {
    const { rollWidthHm, rollHeightHm, dpi } = status;
    const mismatch =
        (rollWidthHm !== undefined && rollWidthHm !== doc.label.backingW) ||
        (rollHeightHm !== undefined && rollHeightHm !== doc.label.backingH) ||
        (dpi !== undefined && dpi !== doc.label.dpi);
    if (!mismatch) return undefined;

    return {
        labelW: doc.label.backingW,
        labelH: doc.label.backingH,
        labelDpi: doc.label.dpi,
        ...(rollWidthHm !== undefined ? { rollW: rollWidthHm } : {}),
        ...(rollHeightHm !== undefined ? { rollH: rollHeightHm } : {}),
        ...(dpi !== undefined ? { printerDpi: dpi } : {}),
        resolvedDpi: resolved.dpi,
        printerDpiInUse: resolved.source === 'printer',
    };
};
