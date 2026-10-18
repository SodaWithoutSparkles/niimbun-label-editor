import { PrintAbortedError } from './transport';
import type { PrintJob, PrinterTransport, PrintResult } from './transport';

/**
 * W3 — print job runner.
 *
 * Owns the one-at-a-time lifecycle around {@link PrinterTransport.print}: it
 * injects the abort signal, subscribes to printer progress, and normalises the
 * two hardware quirks the transport contract cannot hide:
 *
 * - **Non-monotonic `page`** — the D110M_V4 status-poll path reports `page`
 *   1 → 0 → 1 (see `agent/memory/print-transport.md`). The reported page is
 *   clamped monotonic so the bar never jumps backwards.
 * - **Non-monotonic/absent intra-page percent** — overall print percent is
 *   derived from `max(pagePrintProgress, pageFeedProgress)` across `pagesTotal`
 *   and clamped non-decreasing. `pageFeedProgress` stays 0 on D110M_V4, so a
 *   `max` (not an average) is required for the bar to move; the transport
 *   resolving forces a terminal `100%`.
 * - **Per-page upload progress** — the separate send channel reports 0–100 for
 *   *one page at a time* (it restarts at 0 per page), and one page's upload can
 *   cover several physical copies (`quantity > 1`). It is projected onto the
 *   same job-wide 1..`pagesTotal` scale using the range the transport reports
 *   (its first copy and how many copies it covers) and clamped non-decreasing
 *   **independently** of the print percent: one shared clamp would freeze the
 *   send bar as soon as printing overtook it. The send value stays absent until
 *   the transport reports it, so a transport with no upload signal never shows a
 *   dead bar.
 *
 * Cancel is cooperative: `cancel()` aborts the controller and the transport
 * observes it at page boundaries. The transport's `finally` runs `printEnd` —
 * this module never calls `printEnd` itself. An abort resolves to
 * `{ cancelled: true, pagesPrinted }` rather than rejecting, using the count the
 * transport reports ({@link PrintAbortedError}) when available.
 *
 * Consumer `onProgress` callbacks are isolated: a throwing UI callback can never
 * abort a print or wedge the runner.
 */

export interface JobProgress {
    /** 1-based, monotonic. Print channel (physical copy). */
    page: number;
    pagesTotal: number;
    /** Print channel: 0..100, never decreases. */
    percent: number;
    /**
     * Upload ("send") channel, absent until the transport reports any upload
     * progress. `page` is the page the upload belongs to and `percent` is the
     * job-wide, non-decreasing projection — never the raw per-page value.
     *
     * The two channels are independent: `percent` may outrun `send.percent`
     * (printing overtakes uploading) without either one freezing.
     */
    send?: { page: number; percent: number };
    /**
     * Job phase, monotonic: `'sending'` until the first print progress is
     * reported, `'printing'` from then on. Send events never move it back.
     */
    phase: 'sending' | 'printing';
}

export interface JobRunResult {
    pagesPrinted: number;
    cancelled: boolean;
}

export interface JobRunner {
    isBusy(): boolean;
    run(
        job: PrintJob,
        opts?: { onProgress?: (progress: JobProgress) => void },
    ): Promise<JobRunResult>;
    cancel(): void;
}

/** `instanceof DOMException` is unreliable across runtimes; match on `name`. */
const isAbortError = (error: unknown): boolean =>
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError';

/** Clamp a percent value into `[0, 100]`; non-finite → 0. */
const clampPercent = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, value));
};

export function createJobRunner(transport: PrinterTransport): JobRunner {
    let busy = false;
    let controller: AbortController | undefined;

    return {
        isBusy: () => busy,

        cancel: () => {
            controller?.abort();
        },

        async run(job, opts): Promise<JobRunResult> {
            if (busy) {
                throw new Error('JobRunner: a print job is already running');
            }
            // A zero/invalid total is a programming error, not a job: reject up
            // front, before claiming `busy` or subscribing to anything.
            if (!Number.isInteger(job.totalPages) || job.totalPages < 1) {
                throw new RangeError(
                    `JobRunner: totalPages must be a positive integer, got ${job.totalPages}`,
                );
            }

            busy = true;
            const active = new AbortController();
            controller = active;

            const onProgress = opts?.onProgress;
            const pagesTotal = job.totalPages;
            // Last monotonic physical page reported; also the abort-page fallback.
            let page = 0;
            let percent = 0;
            // Send channel: `sendPercent === null` means "the transport has not
            // reported any upload progress" (or has no such channel at all).
            let sendPage = 0;
            let sendPercent: number | null = null;
            let phase: JobProgress['phase'] = 'sending';

            // A consumer callback must never abort a print or wedge the runner:
            // swallow its errors and keep the job alive. The send channel is
            // folded in here so every emit carries a consistent snapshot.
            const emit = (next: {
                page: number;
                percent: number;
                phase: JobProgress['phase'];
            }): void => {
                const entry: JobProgress = {
                    ...next,
                    pagesTotal,
                    ...(sendPercent === null
                        ? {}
                        : { send: { page: sendPage, percent: sendPercent } }),
                };
                try {
                    onProgress?.(entry);
                } catch {
                    // A throwing UI callback is ignored on purpose.
                }
            };

            let unsubscribe: (() => void) | undefined;
            let unsubscribeSend: (() => void) | undefined;

            try {
                // Inside the try: if the consumer throws on this first emit, the
                // `finally` still releases `busy`/`controller`. Nothing has been
                // printed yet, and `send` is absent until a transport reports
                // upload progress — so this claims no progress it does not have.
                emit({ page: 1, percent: 0, phase: 'sending' });

                unsubscribeSend = transport.onSendProgress?.((event) => {
                    // The anchor is the page this upload belongs to; restarting
                    // at 0 per page must never move the job-wide value back.
                    const rawPage = Number.isFinite(event.page) ? event.page : sendPage;
                    sendPage = Math.min(pagesTotal, Math.max(1, sendPage, rawPage));
                    // One upload can cover several physical copies (`quantity >
                    // 1`). Weighting it as a single copy would stall the bar
                    // across the group and then leap at the next one, so the
                    // intra-upload percentage is spread over the group's span.
                    const rawCopies = Number.isFinite(event.copies)
                        ? Math.floor(event.copies)
                        : 1;
                    const span = Math.max(
                        1,
                        Math.min(rawCopies, pagesTotal - sendPage + 1),
                    );
                    const intraPage = clampPercent(event.progress);
                    const derived = Math.floor(
                        ((sendPage - 1 + span * (intraPage / 100)) / pagesTotal) * 100,
                    );
                    sendPercent = Math.max(sendPercent ?? 0, clampPercent(derived));
                    // The print channel keeps its own last values while sending;
                    // `Math.max(1, page)` keeps the pre-print `0` internal.
                    emit({ page: Math.max(1, page), percent, phase });
                });

                unsubscribe = transport.onProgress((event) => {
                    const rawPage = Number.isFinite(event.page) ? event.page : page;
                    // Clamp monotonic: D110M_V4 reports page 1 → 0 → 1, so never
                    // let the reported page move the bar backwards.
                    page = Math.min(pagesTotal, Math.max(1, page, rawPage));

                    // `pageFeedProgress` stays 0 on D110M_V4; `max` is the
                    // intra-page progress that actually moves, and unlike an
                    // average it can reach 100 on the last print event.
                    const pageAverage = Math.max(
                        clampPercent(event.pagePrintProgress),
                        clampPercent(event.pageFeedProgress),
                    );
                    const derived = Math.floor(
                        ((page - 1 + pageAverage / 100) / pagesTotal) * 100,
                    );
                    percent = Math.max(percent, clampPercent(derived));
                    phase = 'printing';

                    emit({ page, percent, phase });
                });

                const result: PrintResult = await transport.print({
                    ...job,
                    signal: active.signal,
                });

                // The transport resolved: every declared page was sent. Force the
                // terminal 100% because feed progress may never report it. The
                // whole bitmap stream is uploaded by then, so a send channel that
                // exists is completed too — but never invented if it was absent.
                page = pagesTotal;
                percent = 100;
                if (sendPercent !== null) {
                    sendPage = pagesTotal;
                    sendPercent = 100;
                }
                emit({ page: pagesTotal, percent: 100, phase: 'printing' });

                // A Cancel that landed after the final page did not change what
                // printed, but must still be reported truthfully.
                return {
                    pagesPrinted: result.pagesPrinted,
                    cancelled: active.signal.aborted,
                };
            } catch (error) {
                if (error instanceof PrintAbortedError) {
                    // The transport observed the abort and knows the real count.
                    return { cancelled: true, pagesPrinted: error.pagesPrinted };
                }
                if (isAbortError(error) && active.signal.aborted) {
                    // Fallback: a transport that throws a bare AbortError with no
                    // count — best-effort monotonic page.
                    return { cancelled: true, pagesPrinted: page };
                }
                throw error;
            } finally {
                // Unsubscribe and release the controller even when a consumer
                // callback or the transport threw.
                unsubscribe?.();
                unsubscribeSend?.();
                controller = undefined;
                busy = false;
            }
        },
    };
}
