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
 * - **Non-monotonic/absent intra-page percent** — overall percent is derived
 *   from `max(pagePrintProgress, pageFeedProgress)` across `pagesTotal` and
 *   clamped non-decreasing. `pageFeedProgress` stays 0 on D110M_V4, so a
 *   `max` (not an average) is required for the bar to move; the transport
 *   resolving forces a terminal `100%`.
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
    /** 1-based, monotonic. */
    page: number;
    pagesTotal: number;
    /** 0..100, never decreases. */
    percent: number;
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

            // A consumer callback must never abort a print or wedge the runner:
            // swallow its errors and keep the job alive.
            const emit = (entry: JobProgress): void => {
                try {
                    onProgress?.(entry);
                } catch {
                    // A throwing UI callback is ignored on purpose.
                }
            };

            let unsubscribe: (() => void) | undefined;

            try {
                // Inside the try: if the consumer throws on this first emit, the
                // `finally` still releases `busy`/`controller`. The job is
                // "sending" until the transport reports its first page.
                emit({ page: 1, pagesTotal, percent: 0, phase: 'sending' });

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

                    emit({ page, pagesTotal, percent, phase: 'printing' });
                });

                const result: PrintResult = await transport.print({
                    ...job,
                    signal: active.signal,
                });

                // The transport resolved: every declared page was sent. Force the
                // terminal 100% because feed progress may never report it.
                page = pagesTotal;
                percent = 100;
                emit({ page: pagesTotal, pagesTotal, percent: 100, phase: 'printing' });

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
                controller = undefined;
                busy = false;
            }
        },
    };
}
