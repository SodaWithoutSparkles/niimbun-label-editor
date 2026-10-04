import { ImageEncoder, PageColorType } from '@mmote/niimbluelib';
import type { EncodedImage, PrintDirection } from '@mmote/niimbluelib';
import type { LabelDoc } from '../core/doc/types';
import { renderLabelPage, type AssetDeps, type RenderedLabelPage } from '../editor/render';
import type { PrintJob, PrintPage, PrintResult, PrinterTransport } from './transport';

/**
 * W4 — single-label print end-to-end.
 *
 * One clear entry point, {@link buildLabelPrintJob}, turns an open `LabelDoc`
 * into a lazy {@link PrintJob}: the shared render path (`renderLabelPage`,
 * invariant 7) produces the final quantized raster, and `ImageEncoder` — the
 * library encoder, never a hand-built `rowsData` — turns it into the bit-plane
 * payload the transport sends.
 *
 * `src/print/` stays React-free: this module imports the owner-approved
 * `src/editor/render` reuse-in-place path plus `src/core` types only.
 */

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
 * Map the document's 4-way `printDirection` onto niimbluelib's two-value
 * `PrintDirection`.
 *
 * The encoder implements only two feed orientations: `'left'` rotates the
 * raster 90° clockwise (`cols`/`rows` swap and `cols` is padded to a multiple
 * of 8), while `'top'` sends it unrotated. The document model also carries
 * `right`/`bottom`, but the encoder cannot express 180°/270° rotation, so those
 * encode unrotated like `'top'`.
 *
 * TODO: this mapping is UNVERIFIED ON HARDWARE (no W4 smoke has run). In
 * particular `right`/`bottom` currently encode unrotated like `top`; whether
 * they need a 180°/270° feed treatment is still an open decision (plan §5/§7).
 */
export const toEncoderPrintDirection = (
    direction: LabelDoc['label']['printDirection'],
): PrintDirection => (direction === 'left' ? 'left' : 'top');

/** The single lazy page of a one-label job. */
async function* singlePage(data: EncodedImage, quantity: number): AsyncIterable<PrintPage> {
    yield { data, quantity };
}

/**
 * Build a one-page print job from a label document.
 *
 * `totalPages` is the requested copy count; the job carries exactly one
 * `PrintPage` whose `quantity` equals it. `pageColor` defaults to
 * `SingleColor`, matching the adapter's option convention (defined keys only).
 *
 * `pages` is an async iterable (invariant 9): the encoded payload is handed over
 * lazily, never collected into an array.
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

    const render =
        deps.render ??
        ((value: LabelDoc) =>
            renderLabelPage(value, {}, deps.assets ? { assets: deps.assets } : {}));
    const page = await render(doc);

    const data = ImageEncoder.encodeCanvas(
        page.canvas,
        PageColorType.SingleColor,
        toEncoderPrintDirection(doc.label.printDirection),
    );

    return {
        totalPages: quantity,
        pages: singlePage(data, quantity),
        pageColor: PageColorType.SingleColor,
    };
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
