import { ImageEncoder, PageColorType, type LabelType } from '@mmote/niimbluelib';
import type { LabelDoc } from '../core/doc/types';
import type { QuantizerByType, QuantizerDefaults } from '../core/render';
import type { CsvRecord } from '../data/csvRepo';
import {
    renderLabelPage,
    type AssetDeps,
    type RenderedLabelPage,
    type RenderLabelPageOptions,
    type ResolveContext,
} from '../editor/render';
import { orientForPrint } from '../editor/render/printOrientation';
import { planSequence, type PagePlan, type PrintOrder } from './sequence';
import { snapshotTimes, timesForSnapshot } from './printTimes';
import type { PrintJob, PrintPage, PrintResult, PrinterTransport } from './transport';

// Re-exported for existing importers/tests; the implementation lives in the
// leaf `./printTimes` module so the dialog can share it without pulling in the
// render/encoder stack above.
export { snapshotTimes, timesForSnapshot } from './printTimes';

/**
 * W3/W4 — print jobs.
 *
 * Two entry points over one shared pipeline:
 *
 * - {@link buildCsvPrintJob} turns a `LabelDoc` plus an optional CSV table into a
 *   lazy {@link PrintJob} (invariant 9). The per-row sequence comes from
 *   {@link planSequence} (`$times` × global copies, grouped or interleaved); the
 *   shared render path (`renderLabelPage`, invariant 7) produces each final
 *   quantized raster and `ImageEncoder` — never a hand-built `rowsData` — turns it
 *   into the bit-plane payload.
 * - {@link buildLabelPrintJob} is the single-label convenience wrapper (one page,
 *   `quantity` copies), now routed through the same internals.
 *
 * `src/print/` stays React-free and, per decision 42, never imports the template
 * engine or the trust gate: per-row content prep arrives through
 * {@link CsvPrintJobDeps.prepareRow}, so plain CSV → print has no engine
 * dependency. Only `src/editor/render` (the reuse-in-place path) and `src/core`
 * types are imported.
 */

/** Print overrides shared by the dialog, preview and print pipeline. */
export interface PrintOverrides {
    density?: number;
    speed?: 0 | 1;
    labelType?: LabelType;
    pageColor?: PageColorType;
    /** Effective render dpi; defaults to `doc.label.dpi`. */
    dpi?: number;
    /** Post-quantize: flip every RGB channel so black ↔ white. */
    invert?: boolean;
    /** Post-quantize: flip the raster horizontally. */
    mirror?: boolean;
    /** Applied last, on a fresh canvas: shift by device px at the effective dpi. */
    offset?: { x: number; y: number; type: 'inner' | 'outer' };
    /**
     * Per-strategy dither settings defaults. `src/print/` must not import the
     * store, so these arrive through the options object from a store-aware
     * caller (the dialog); absent = the engine defaults.
     */
    quantizerDefaults?: QuantizerDefaults;
    /** Per-object-type default-quantizer overrides; absent = `DEFAULT_POLICY_BY_TYPE`. */
    defaultQuantizerByType?: QuantizerByType;
}

export interface CsvPrintJobOptions {
    order: PrintOrder;
    /** Dialog global copies multiplier. Positive integer, default 1. */
    copies: number;
    overrides?: PrintOverrides;
}

export interface CsvPrintJobDeps {
    /** Async asset deps forwarded to the default {@link renderLabelPage}. */
    assets?: AssetDeps;
    /** Per-row async content prep (csv/template). Absent = static/fallback only. */
    prepareRow?: (rowIndex: number) => Promise<ResolveContext>;
    /** Raster seam; defaults to the shared {@link renderLabelPage} (invariant 7). */
    render?: (
        doc: LabelDoc,
        ctx: ResolveContext,
        opts: RenderLabelPageOptions,
    ) => Promise<RenderedLabelPage>;
    /**
     * Override the per-row `$times` reader. Defaults to the build-time snapshot
     * of the CSV `$times` column (stable). Provided as an injection seam for
     * tests/advanced callers; a non-deterministic override makes `totalPages`
     * disagree with the emitted sequence and trips the D-01 guards.
     */
    timesFor?: (rowIndex: number) => number;
}

export interface BuildLabelPrintJobOptions {
    /** Copies to print. A positive integer; defaults to 1. */
    quantity?: number;
}

export interface BuildLabelPrintJobDeps {
    /**
     * Raster/encode seam. Defaults to the shared {@link renderLabelPage}, so
     * production never diverges from the preview path (invariant 7).
     */
    render?: (doc: LabelDoc) => Promise<RenderedLabelPage>;
    /**
     * Async asset deps forwarded to the default {@link renderLabelPage} (image
     * bytes, fonts, print resolution cap). Ignored when a custom `render` is
     * supplied — that seam owns its own rendering.
     */
    assets?: AssetDeps;
}

/**
 * Forward only the render-relevant, defined override keys. Spreading all of
 * `PrintOverrides` would leak print-task options (`density`/`speed`/`labelType`/
 * `pageColor`) into the render options and make the intent unclear.
 *
 * Exported so W4's thumbnail path performs the *same* split as the job: the
 * dialog's preview bytes must equal the print job's page bytes for the same
 * `doc` + overrides (invariant 7).
 */
export const renderOptionsOf = (
    overrides: PrintOverrides | undefined,
    assets: AssetDeps | undefined,
): RenderLabelPageOptions => ({
    ...(assets !== undefined ? { assets } : {}),
    ...(overrides?.dpi !== undefined ? { dpi: overrides.dpi } : {}),
    ...(overrides?.invert !== undefined ? { invert: overrides.invert } : {}),
    ...(overrides?.mirror !== undefined ? { mirror: overrides.mirror } : {}),
    ...(overrides?.offset !== undefined ? { offset: overrides.offset } : {}),
    ...(overrides?.quantizerDefaults !== undefined
        ? { quantizerDefaults: overrides.quantizerDefaults }
        : {}),
    ...(overrides?.defaultQuantizerByType !== undefined
        ? { defaultQuantizerByType: overrides.defaultQuantizerByType }
        : {}),
});

/**
 * Build a lazy, re-iterable CSV print job.
 *
 * `rows = csv?.rows.length ?? 1` (no CSV ⇒ one page). `pages` is an async
 * generator (invariant 9): each `PagePlan` triggers `prepareRow` **lazily, once
 * per page**, then renders through the shared path, orients the raster for the
 * document's `printDirection` and encodes it.
 *
 * The `$times` column is parsed **once** into an integer snapshot at build time
 * (see {@link snapshotTimes}); the lazy generator reads that snapshot, so the
 * sequence is stable and a later CSV mutation cannot desynchronise it from
 * `totalPages`.
 *
 * `totalPages` is the cheap Σ integer from {@link planSequence}. Two guards keep
 * the emitted Σ quantity honest: the generator throws before yielding a page
 * that would exceed `totalPages` (over-send), and throws after the loop if it
 * under-sent — a short sequence would otherwise hand the transport a
 * `totalPages` it can never satisfy.
 *
 * The returned `pages` is **re-iterable**: the build-time plan's generator is
 * single-use, so the first pass consumes it (no dead allocation) and every later
 * pass re-derives a fresh sequence from the stable snapshot. A second `run()` of
 * the same job (retry after error, Print again) thus resends the full sequence
 * instead of draining an already exhausted one.
 *
 * **Cancel latency.** `PrintJob.signal` is checked by the transport at page
 * boundaries, so `prepareRow`/render work for the in-flight page is not
 * interruptible; abort is observed only between pages. Expected cancel latency
 * is therefore ≈ one page render. (This job does not change that contract.) A
 * cancel that lands *after* the final page is still reported as cancelled by
 * `jobRunner` (`{ cancelled: true, pagesPrinted }`) even though it emits its
 * terminal `100%`; this job keeps no cancel state of its own.
 */
export function buildCsvPrintJob(
    doc: LabelDoc,
    csv: CsvRecord | null,
    opts: CsvPrintJobOptions,
    deps: CsvPrintJobDeps = {},
): PrintJob {
    // v1 renders a single-plane Mono raster; DoubleColor would encode garbage.
    // W4 gates the control behind `capabilities.doubleColor` (off in v1), but the
    // job must still reject it loudly rather than send a malformed page.
    if (opts.overrides?.pageColor === PageColorType.DoubleColor) {
        throw new RangeError(
            'buildCsvPrintJob: pageColor DoubleColor is not supported by the single-plane v1 render path',
        );
    }

    const rows = csv?.rows.length ?? 1;
    const { order, copies } = opts;
    const timesFor = deps.timesFor ?? timesForSnapshot(snapshotTimes(csv));
    const plan = planSequence(rows, timesFor, { order, copies });
    // The Σ the transport is promised. Guards below compare against this captured
    // integer rather than re-reading the plan.
    const totalPages = plan.totalPages;

    const renderOpts = renderOptionsOf(opts.overrides, deps.assets);
    const pageColor = opts.overrides?.pageColor ?? PageColorType.SingleColor;

    // Re-iterable source: the build-time plan's generator is single-use, so the
    // first pass consumes it (it would otherwise be a dead allocation) and later
    // passes re-derive from the stable snapshot, keeping the job re-iterable.
    let nextPages: AsyncIterable<PagePlan> | undefined = plan.pages;

    async function* pages(): AsyncGenerator<PrintPage> {
        let sent = 0;
        const source =
            nextPages ?? planSequence(rows, timesFor, { order, copies }).pages;
        nextPages = undefined;
        for await (const pagePlan of source) {
            // D-01: never silently over-send. Checked before rendering the page.
            if (sent + pagePlan.quantity > totalPages) {
                throw new Error(
                    `buildCsvPrintJob: page sequence exceeds totalPages (${totalPages})`,
                );
            }

            const ctx = deps.prepareRow ? await deps.prepareRow(pagePlan.rowIndex) : {};
            // A fresh options object per page, including a clone of the nested
            // `offset`: a shallow spread would share that object, letting a
            // mutating render seam poison later pages. `assets` is deliberately
            // left shared — it is a build-time dependency of the whole job, not
            // per-page state (a seam that mutates it is out of contract).
            const pageOpts: RenderLabelPageOptions = {
                ...renderOpts,
                ...(renderOpts.offset !== undefined
                    ? { offset: { ...renderOpts.offset } }
                    : {}),
            };
            const rendered = deps.render
                ? await deps.render(doc, ctx, pageOpts)
                : await renderLabelPage(doc, ctx, pageOpts);

            // D-04: realise the doc's 4-way direction by pre-rotating the raster
            // and choosing the 2-valued encoder direction.
            const oriented = orientForPrint(rendered, doc.label.printDirection);
            const data = ImageEncoder.encodeCanvas(oriented.canvas, pageColor, oriented.direction);

            sent += pagePlan.quantity;
            yield { data, quantity: pagePlan.quantity };
        }

        // D-01 (mirror): a short sequence would give the transport a `totalPages`
        // it can never satisfy; fail loudly instead of under-sending silently.
        if (sent !== totalPages) {
            throw new Error(
                `buildCsvPrintJob: page sequence under-sent (${sent} of ${totalPages})`,
            );
        }
    }

    const overrides = opts.overrides;
    return {
        totalPages,
        pages: { [Symbol.asyncIterator]: () => pages() },
        ...(overrides?.density !== undefined ? { density: overrides.density } : {}),
        ...(overrides?.speed !== undefined ? { speed: overrides.speed } : {}),
        ...(overrides?.labelType !== undefined ? { labelType: overrides.labelType } : {}),
        ...(overrides?.pageColor !== undefined ? { pageColor: overrides.pageColor } : {}),
    };
}

/**
 * Build a one-page print job from a label document.
 *
 * Thin wrapper over {@link buildCsvPrintJob} with no CSV: `totalPages` is the
 * requested copy count and the job carries exactly one `PrintPage` whose
 * `quantity` equals it (grouped order). `pageColor` stays `SingleColor`,
 * matching the adapter's option convention (defined keys only). The job is
 * re-iterable, like {@link buildCsvPrintJob}.
 */
export const buildLabelPrintJob = async (
    doc: LabelDoc,
    opts: BuildLabelPrintJobOptions = {},
    deps: BuildLabelPrintJobDeps = {},
): Promise<PrintJob> => {
    const quantity = opts.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
        throw new RangeError(
            `buildLabelPrintJob: quantity must be a positive integer (got ${quantity})`,
        );
    }

    return buildCsvPrintJob(
        doc,
        null,
        {
            order: 'grouped',
            copies: quantity,
            overrides: { pageColor: PageColorType.SingleColor },
        },
        deps,
    );
};

/**
 * Convenience end-to-end: build the job from `doc` and hand it to `transport`,
 * resolving to the transport's {@link PrintResult}.
 */
export const printLabel = async (
    transport: PrinterTransport,
    doc: LabelDoc,
    opts: BuildLabelPrintJobOptions = {},
    deps: BuildLabelPrintJobDeps = {},
): Promise<PrintResult> => {
    const job = await buildLabelPrintJob(doc, opts, deps);
    return transport.print(job);
};
