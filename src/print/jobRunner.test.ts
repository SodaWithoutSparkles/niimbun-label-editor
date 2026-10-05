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
 */
class FakeTransport implements PrinterTransport {
    readonly progressListeners = new Set<(progress: PrintProgress) => void>();
    readonly statusListeners = new Set<(status: PrinterStatus) => void>();

    state: TransportState = 'connected';
    printEndCalls = 0;
    printedPages = 0;
    script: PrintProgress[] = [];
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
            for (const event of this.script) {
                if (job.signal?.aborted) throw abortError();
                if (this.eventDelayMs > 0) await delay(this.eventDelayMs);
                if (job.signal?.aborted) throw abortError();
                this.emitProgress({ ...event, pagesTotal: job.totalPages });
            }
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

    get progressListenerCount(): number {
        return this.progressListeners.size;
    }

    emitProgress(progress: PrintProgress): void {
        for (const listener of [...this.progressListeners]) {
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
        // sending + three device events + the terminal 100% emit.
        expect(progress.map((entry) => entry.page)).toEqual([1, 1, 1, 1, 1]);
        // max(print, feed) reaches 50 on the mid event (not the average 25),
        // then 100; the terminal emit repeats 100.
        expect(progress.map((entry) => entry.percent)).toEqual([0, 0, 50, 100, 100]);
        expect(progress.map((entry) => entry.phase)).toEqual([
            'sending',
            'printing',
            'printing',
            'printing',
            'printing',
        ]);
        expect(progress.every((entry) => entry.pagesTotal === 1)).toBe(true);
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

        const second = await runner.run(jobOf([1]));
        expect(second.cancelled).toBe(false);
        expect(transport.printEndCalls).toBe(2);
        expect(transport.progressListenerCount).toBe(0);
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
