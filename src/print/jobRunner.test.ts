import { describe, expect, it } from 'vitest';
import type { EncodedImage } from '@mmote/niimbluelib';
import { createJobRunner, type JobProgress } from './jobRunner';
import { MockTransport } from './mockTransport';
import { PrintAbortedError } from './transport';
import type {
    PrinterStatus,
    PrinterTransport,
    PrintJob,
    PrintPage,
    PrintProgress,
    PrintResult,
    SendProgress,
    TransportState,
} from './transport';

const encodedImage = (): EncodedImage => ({}) as EncodedImage;

async function* iterate(pages: PrintPage[]): AsyncIterable<PrintPage> {
    for (const page of pages) {
        yield page;
    }
}

const jobOf = (quantities: number[], overrides: Partial<PrintJob> = {}): PrintJob => ({
    totalPages: quantities.reduce((sum, quantity) => sum + quantity, 0),
    pages: iterate(quantities.map((quantity) => ({ data: encodedImage(), quantity }))),
    ...overrides,
});

const abortError = (): DOMException => new DOMException('Aborted', 'AbortError');

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Minimal transport with a scripted progress sequence and an observable
 * `printEnd` counter. Emits every event in `script`, honouring the abort signal
 * at event boundaries so cancellation is deterministic.
 *
 * `sendScript` is emitted so that each page's upload precedes that page's print
 * event (entries are keyed by the `page` they cover and emitted in order); tests
 * that only exercise the print channel leave it empty and therefore get no send
 * channel at all — as with a real transport that does not implement
 * {@link PrinterTransport.onSendProgress}.
 */
class FakeTransport implements PrinterTransport {
    readonly progressListeners = new Set<(progress: PrintProgress) => void>();
    readonly sendListeners = new Set<(progress: SendProgress) => void>();
    readonly statusListeners = new Set<(status: PrinterStatus) => void>();

    state: TransportState = 'connected';
    printEndCalls = 0;
    printedPages = 0;
    script: PrintProgress[] = [];
    sendScript: SendProgress[] = [];
    eventDelayMs = 0;
    failWith?: unknown;

    async connect(): Promise<void> {
        this.state = 'connected';
    }

    async disconnect(): Promise<void> {
        this.state = 'disconnected';
    }

    async print(job: PrintJob): Promise<PrintResult> {
        this.state = 'printing';
        this.emitStatus();
        try {
            // Emit every upload whose page range starts at or before `page`, so
            // a page's send events land before its print event.
            let sendIndex = 0;
            const flushSendsUpTo = (page: number): void => {
                while (
                    sendIndex < this.sendScript.length &&
                    this.sendScript[sendIndex]!.page <= page
                ) {
                    if (job.signal?.aborted) throw abortError();
                    this.emitSend(this.sendScript[sendIndex]!);
                    sendIndex += 1;
                }
            };
            for (const event of this.script) {
                if (job.signal?.aborted) throw abortError();
                if (this.eventDelayMs > 0) await delay(this.eventDelayMs);
                if (job.signal?.aborted) throw abortError();
                flushSendsUpTo(event.page);
                this.emitProgress({ ...event, pagesTotal: job.totalPages });
            }
            // A send trail longer than the print script still has to drain.
            flushSendsUpTo(Number.POSITIVE_INFINITY);
            if (this.failWith !== undefined) throw this.failWith;
            this.printedPages = job.totalPages;
            return { pagesPrinted: this.printedPages };
        } finally {
            // The transport owns printEnd — the runner must never call it.
            this.printEndCalls += 1;
            const settled = this.state as TransportState;
            this.state = settled === 'disconnected' ? 'disconnected' : 'connected';
            this.emitStatus();
        }
    }

    onStatus(listener: (status: PrinterStatus) => void): () => void {
        this.statusListeners.add(listener);
        return () => {
            this.statusListeners.delete(listener);
        };
    }

    onProgress(listener: (progress: PrintProgress) => void): () => void {
        this.progressListeners.add(listener);
        return () => {
            this.progressListeners.delete(listener);
        };
    }

    onSendProgress(listener: (progress: SendProgress) => void): () => void {
        this.sendListeners.add(listener);
        return () => {
            this.sendListeners.delete(listener);
        };
    }

    get progressListenerCount(): number {
        return this.progressListeners.size;
    }

    get sendListenerCount(): number {
        return this.sendListeners.size;
    }

    emitProgress(progress: PrintProgress): void {
        for (const listener of [...this.progressListeners]) {
            listener(progress);
        }
    }

    emitSend(progress: SendProgress): void {
        for (const listener of [...this.sendListeners]) {
            listener(progress);
        }
    }

    private emitStatus(): void {
        for (const listener of [...this.statusListeners]) {
            listener({ state: this.state });
        }
    }
}

describe('createJobRunner', () => {
    it('clamps page and percent monotonic under a 1 → 0 → 1 script', async () => {
        const transport = new FakeTransport();
        // Upload precedes printing: one page, so the whole send curve lands
        // before the first print event.
        transport.sendScript = [
            { page: 1, copies: 1, progress: 0 },
            { page: 1, copies: 1, progress: 50 },
            { page: 1, copies: 1, progress: 100 },
        ];
        transport.script = [
            { page: 1, pagesTotal: 1, pagePrintProgress: 0, pageFeedProgress: 0 },
            { page: 0, pagesTotal: 1, pagePrintProgress: 50, pageFeedProgress: 0 },
            { page: 1, pagesTotal: 1, pagePrintProgress: 100, pageFeedProgress: 100 },
        ];
        const runner = createJobRunner(transport);
        const progress: JobProgress[] = [];

        const result = await runner.run(jobOf([1]), {
            onProgress: (entry) => progress.push(entry),
        });

        expect(result).toEqual({ cancelled: false, pagesPrinted: 1 });
        // initial + three send events + three device events + terminal 100%.
        expect(progress.map((entry) => entry.page)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
        // Print channel unchanged: max(print, feed) reaches 50 on the mid event
        // (not the average 25), then 100; the terminal emit repeats 100.
        expect(progress.map((entry) => entry.percent)).toEqual([
            0, 0, 0, 0, 0, 50, 100, 100,
        ]);
        // Send channel is absent until the transport reports it, then carries the
        // job-wide value on every emit (one page: the raw value is job-wide).
        expect(progress.map((entry) => entry.send?.percent ?? null)).toEqual([
            null, 0, 50, 100, 100, 100, 100, 100,
        ]);
        // `phase` is the job phase, monotonic: send events never move it back.
        expect(progress.map((entry) => entry.phase)).toEqual([
            'sending',
            'sending',
            'sending',
            'sending',
            'printing',
            'printing',
            'printing',
            'printing',
        ]);
        expect(progress.every((entry) => entry.pagesTotal === 1)).toBe(true);
        // Resolving completes the send channel as well.
        expect(progress.at(-1)?.send).toEqual({ page: 1, percent: 100 });
    });

    it('projects per-page upload progress into a job-wide monotonic send percent', async () => {
        const transport = new MockTransport();
        await transport.connect();
        const runner = createJobRunner(transport);
        const progress: JobProgress[] = [];

        const result = await runner.run(jobOf([1, 1, 1]), {
            onProgress: (entry) => progress.push(entry),
        });

        expect(result).toEqual({ cancelled: false, pagesPrinted: 3 });

        const sendPercents = progress
            .filter((entry) => entry.send !== undefined)
            .map((entry) => entry.send!.percent);
        expect(sendPercents.length).toBeGreaterThan(0);
        // Never decreases, even though the raw value restarts at 0 per page.
        for (let index = 1; index < sendPercents.length; index += 1) {
            expect(sendPercents[index]).toBeGreaterThanOrEqual(sendPercents[index - 1]!);
        }
        // Page 1 contributes 0..33, page 2 33..66, page 3 66..100.
        expect(progress.find((entry) => entry.send?.page === 2)?.send?.percent).toBe(33);
        const last = progress.at(-1)!;
        expect(last.send).toEqual({ page: 3, percent: 100 });
        expect(last).toMatchObject({ page: 3, percent: 100, phase: 'printing' });
    });

    it('spreads a grouped upload across the copies it covers, not one copy', async () => {
        const transport = new FakeTransport();
        // A 5-page job whose first row carries 3 copies: [3, 1, 1].
        transport.sendScript = [
            { page: 1, copies: 3, progress: 0 },
            { page: 1, copies: 3, progress: 50 },
            { page: 1, copies: 3, progress: 100 },
            { page: 4, copies: 1, progress: 0 },
            { page: 4, copies: 1, progress: 50 },
            { page: 4, copies: 1, progress: 100 },
            { page: 5, copies: 1, progress: 0 },
            { page: 5, copies: 1, progress: 50 },
            { page: 5, copies: 1, progress: 100 },
        ];
        transport.script = [1, 2, 3, 4, 5].map((page) => ({
            page,
            pagesTotal: 5,
            pagePrintProgress: 100,
            pageFeedProgress: 0,
        }));
        const runner = createJobRunner(transport);
        const progress: JobProgress[] = [];

        const result = await runner.run(jobOf([3, 1, 1]), {
            onProgress: (entry) => progress.push(entry),
        });

        expect(result).toEqual({ cancelled: false, pagesPrinted: 5 });
        const sendPercents = progress
            .filter((entry) => entry.send !== undefined)
            .map((entry) => entry.send!.percent);

        // The 3-copy upload must span 0 → 60 % (3/5), not 0 → 20 % (1/5).
        expect(sendPercents.slice(0, 3)).toEqual([0, 30, 60]);
        // Every value it passes through: a single-copy weighting would instead
        // stall at 20 % and then leap to 60 % when the next row starts.
        expect(
            sendPercents.filter(
                (value, index) => index === 0 || value !== sendPercents[index - 1],
            ),
        ).toEqual([0, 30, 60, 70, 80, 90, 100]);

        for (let index = 1; index < sendPercents.length; index += 1) {
            expect(sendPercents[index]).toBeGreaterThanOrEqual(sendPercents[index - 1]!);
        }
        // The print channel is untouched by the upload's span.
        expect(progress.at(-1)).toMatchObject({
            page: 5,
            percent: 100,
            phase: 'printing',
        });
    });

    it('keeps the send and print channels independent (R15-b)', async () => {
        const transport = new MockTransport();
        await transport.connect();
        const runner = createJobRunner(transport);
        const progress: JobProgress[] = [];

        await runner.run(jobOf([1, 1, 1]), {
            onProgress: (entry) => progress.push(entry),
        });

        const firstPrint = progress.findIndex((entry) => entry.phase === 'printing');
        expect(firstPrint).toBeGreaterThan(0);
        const afterFirstPrint = progress.slice(firstPrint);
        // Printing page 1 pins the print bar at 33 %...
        expect(
            afterFirstPrint
                .filter((entry) => entry.page === 1)
                .every((entry) => entry.percent === 33),
        ).toBe(true);
        // ...while the upload of page 2 keeps moving the send bar. A single
        // shared monotonic clamp would have frozen it here.
        expect(
            afterFirstPrint.some(
                (entry) => entry.send !== undefined && entry.send.percent > 33,
            ),
        ).toBe(true);

        let printPercent = -1;
        let sendPercent = -1;
        for (const entry of progress) {
            expect(entry.percent).toBeGreaterThanOrEqual(printPercent);
            printPercent = entry.percent;
            if (entry.send !== undefined) {
                expect(entry.send.percent).toBeGreaterThanOrEqual(sendPercent);
                sendPercent = entry.send.percent;
            }
        }
    });

    it('rejects a concurrent run while a job is active', async () => {
        const transport = new FakeTransport();
        transport.eventDelayMs = 20;
        transport.script = [
            { page: 1, pagesTotal: 1, pagePrintProgress: 100, pageFeedProgress: 100 },
        ];
        const runner = createJobRunner(transport);

        const running = runner.run(jobOf([1]));
        await expect(runner.run(jobOf([1]))).rejects.toThrow(/already running/);
        expect(runner.isBusy()).toBe(true);

        await expect(running).resolves.toEqual({ cancelled: false, pagesPrinted: 1 });
        expect(runner.isBusy()).toBe(false);
    });

    it('cancels mid-job via MockTransport and can run again afterwards', async () => {
        const transport = new MockTransport({ pageDelayMs: 1 });
        await transport.connect();
        const states: TransportState[] = [];
        transport.onStatus((status) => states.push(status.state));
        const runner = createJobRunner(transport);

        const result = await runner.run(jobOf([1, 1, 1, 1, 1]), {
            onProgress: (entry) => {
                if (entry.phase === 'printing' && entry.page === 1) runner.cancel();
            },
        });

        expect(result).toEqual({ cancelled: true, pagesPrinted: 1 });
        expect(runner.isBusy()).toBe(false);
        expect(states.at(-1)).toBe('connected');

        // A second run after cancel must work.
        const second = await runner.run(jobOf([1]));
        expect(second).toEqual({ cancelled: false, pagesPrinted: 1 });
        expect(transport.jobs).toHaveLength(2);
    });

    it('leaves printEnd to the transport (once per job) and unsubscribes listeners', async () => {
        const transport = new FakeTransport();
        transport.script = [
            { page: 1, pagesTotal: 1, pagePrintProgress: 100, pageFeedProgress: 100 },
        ];
        const runner = createJobRunner(transport);

        await runner.run(jobOf([1]));
        expect(transport.printEndCalls).toBe(1);
        expect(transport.progressListenerCount).toBe(0);
        expect(transport.sendListenerCount).toBe(0);

        const second = await runner.run(jobOf([1]));
        expect(second.cancelled).toBe(false);
        expect(transport.printEndCalls).toBe(2);
        expect(transport.progressListenerCount).toBe(0);
        expect(transport.sendListenerCount).toBe(0);
    });

    it('unsubscribes and clears the controller when cancelled', async () => {
        const transport = new FakeTransport();
        transport.eventDelayMs = 5;
        transport.script = [
            { page: 1, pagesTotal: 1, pagePrintProgress: 100, pageFeedProgress: 100 },
            { page: 1, pagesTotal: 1, pagePrintProgress: 100, pageFeedProgress: 100 },
            { page: 1, pagesTotal: 1, pagePrintProgress: 100, pageFeedProgress: 100 },
        ];
        const runner = createJobRunner(transport);

        const result = await runner.run(jobOf([1]), {
            onProgress: (entry) => {
                if (entry.phase === 'printing') runner.cancel();
            },
        });

        expect(result.cancelled).toBe(true);
        expect(runner.isBusy()).toBe(false);
        expect(transport.progressListenerCount).toBe(0);
    });

    it('rejects a non-abort error and still cleans up', async () => {
        const transport = new FakeTransport();
        transport.script = [
            { page: 1, pagesTotal: 1, pagePrintProgress: 100, pageFeedProgress: 100 },
        ];
        transport.failWith = new Error('boom');
        const runner = createJobRunner(transport);

        await expect(runner.run(jobOf([1]))).rejects.toThrow('boom');
        expect(runner.isBusy()).toBe(false);
        expect(transport.progressListenerCount).toBe(0);
        expect(transport.printEndCalls).toBe(1);
    });

    it('survives a throwing onProgress callback and stays runnable (wedge regression)', async () => {
        const transport = new FakeTransport();
        transport.script = [
            { page: 1, pagesTotal: 1, pagePrintProgress: 100, pageFeedProgress: 100 },
        ];
        const runner = createJobRunner(transport);
        const throwing = (): void => {
            throw new Error('consumer boom');
        };

        // The initial 'sending' emit, the device event and the terminal emit all
        // call the consumer; none may leave the runner busy or reject the job.
        const result = await runner.run(jobOf([1]), { onProgress: throwing });
        expect(result).toEqual({ cancelled: false, pagesPrinted: 1 });
        expect(runner.isBusy()).toBe(false);
        expect(transport.progressListenerCount).toBe(0);

        // The wedge regression: a second run must still work.
        const second = await runner.run(jobOf([1]));
        expect(second).toEqual({ cancelled: false, pagesPrinted: 1 });
        expect(transport.printEndCalls).toBe(2);
    });

    it('reaches 100% when the device never reports feed progress', async () => {
        const transport = new FakeTransport();
        transport.script = [
            { page: 1, pagesTotal: 1, pagePrintProgress: 40, pageFeedProgress: 0 },
            { page: 1, pagesTotal: 1, pagePrintProgress: 100, pageFeedProgress: 0 },
        ];
        const runner = createJobRunner(transport);
        const progress: JobProgress[] = [];

        const result = await runner.run(jobOf([1]), {
            onProgress: (entry) => progress.push(entry),
        });

        expect(result).toEqual({ cancelled: false, pagesPrinted: 1 });
        expect(Math.max(...progress.map((entry) => entry.percent))).toBe(100);
        expect(progress.at(-1)).toMatchObject({
            page: 1,
            pagesTotal: 1,
            percent: 100,
            phase: 'printing',
        });
    });

    it('reports the true count on a grouped-quantity cancel (not the page index)', async () => {
        const transport = new MockTransport({ pageDelayMs: 1 });
        await transport.connect();
        const runner = createJobRunner(transport);

        // quantity 5 = one source page, five physical copies. Cancel after the
        // second copy; the transport throws PrintAbortedError(2).
        const result = await runner.run(jobOf([5]), {
            onProgress: (entry) => {
                if (entry.phase === 'printing' && entry.page === 2) runner.cancel();
            },
        });

        expect(result).toEqual({ cancelled: true, pagesPrinted: 2 });
        expect(transport.jobs[0].result).toEqual({ pagesPrinted: 2 });
        expect(runner.isBusy()).toBe(false);
    });

    it('cancel() before any run() is a no-op', () => {
        const runner = createJobRunner(new MockTransport());

        expect(() => runner.cancel()).not.toThrow();
        expect(runner.isBusy()).toBe(false);
    });

    it('honours cancel() issued from the initial sending callback', async () => {
        const transport = new MockTransport({ pageDelayMs: 1 });
        await transport.connect();
        const runner = createJobRunner(transport);
        let sawSending = false;

        const result = await runner.run(jobOf([2]), {
            onProgress: (entry) => {
                if (entry.phase === 'sending') {
                    sawSending = true;
                    runner.cancel();
                }
            },
        });

        expect(sawSending).toBe(true);
        expect(result).toEqual({ cancelled: true, pagesPrinted: 0 });
        expect(runner.isBusy()).toBe(false);
    });

    it('a late cancel after the final page reports cancelled without understating the count', async () => {
        const transport = new MockTransport({ pageDelayMs: 1 });
        await transport.connect();
        const runner = createJobRunner(transport);

        // Abort while the only (final) copy is being reported: the transport
        // still resolves successfully, so the result must not claim less.
        const result = await runner.run(jobOf([1]), {
            onProgress: (entry) => {
                if (entry.phase === 'printing' && entry.page === 1) runner.cancel();
            },
        });

        expect(result).toEqual({ cancelled: true, pagesPrinted: 1 });
        expect(transport.jobs[0].result).toEqual({ pagesPrinted: 1 });
    });

    it('rejects a zero totalPages job up front with RangeError', async () => {
        const transport = new FakeTransport();
        const runner = createJobRunner(transport);

        await expect(runner.run({ totalPages: 0, pages: iterate([]) })).rejects.toBeInstanceOf(
            RangeError,
        );
        // The guard runs before claiming `busy` or subscribing.
        expect(runner.isBusy()).toBe(false);
        expect(transport.progressListenerCount).toBe(0);
    });

    it('rejects a non-integer totalPages up front with RangeError', async () => {
        const transport = new FakeTransport();
        const runner = createJobRunner(transport);

        await expect(runner.run({ totalPages: 1.5, pages: iterate([]) })).rejects.toBeInstanceOf(
            RangeError,
        );
        expect(runner.isBusy()).toBe(false);
    });

    it('uses the reported pagesPrinted from PrintAbortedError over the monotonic page', async () => {
        // A transport whose last-real count differs from the page events: the
        // error count must win.
        const transport = new FakeTransport();
        transport.script = [
            { page: 1, pagesTotal: 3, pagePrintProgress: 100, pageFeedProgress: 100 },
        ];
        transport.failWith = new PrintAbortedError(2);
        const runner = createJobRunner(transport);

        const result = await runner.run(jobOf([1, 1, 1]));

        expect(result).toEqual({ cancelled: true, pagesPrinted: 2 });
    });
});
