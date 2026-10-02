import { describe, it, expect } from 'vitest';
import type { EncodedImage } from '@mmote/niimbluelib';
import { MockTransport } from './mockTransport';
import type { PrintJob, PrintPage, PrintProgress, TransportState } from './transport';

/**
 * Structurally valid stand-in for a niimbluelib bit-plane payload. happy-dom has
 * no canvas 2D, so the spike never needs a real encoded image; the mock treats
 * the payload as opaque.
 */
const encodedPage = (): EncodedImage =>
  ({ pageColor: 0, cols: 2, rows: 1, rowsData: [] }) as unknown as EncodedImage;

/**
 * Hardcoded 3-page job (quantities [1, 1, 2] => 4 physical pages). `pulls`
 * records the order in which the generator yields pages so the test can prove
 * lazy, in-order consumption.
 */
function hardcodedJob(overrides: Partial<PrintJob> = {}): {
  job: PrintJob;
  pulls: number[];
} {
  const pulls: number[] = [];
  const quantities = [1, 1, 2];

  async function* pages(): AsyncIterable<PrintPage> {
    for (let index = 0; index < quantities.length; index++) {
      pulls.push(index);
      yield { data: encodedPage(), quantity: quantities[index] };
    }
  }

  return {
    job: {
      totalPages: quantities.reduce((sum, quantity) => sum + quantity, 0),
      pages: pages(),
      ...overrides,
    },
    pulls,
  };
}

describe('print spike: hardcoded 3-page job through MockTransport', () => {
  it('connects, prints 4 physical pages, preserves order/quantities, and reports progress', async () => {
    const transport = new MockTransport();
    const states: TransportState[] = [];
    transport.onStatus((status) => states.push(status.state));

    // 1. connect() resolves and reports `connected`.
    await expect(transport.connect()).resolves.toBeUndefined();
    expect(states).toEqual(['connecting', 'connected']);

    const { job, pulls } = hardcodedJob();

    const progress: PrintProgress[] = [];
    let pullsAtFirstPage = -1;
    transport.onProgress((reported) => {
      progress.push({ ...reported });
      if (reported.page === 1) {
        pullsAtFirstPage = pulls.length;
      }
    });

    // 2. print(job) returns the number of physical pages.
    const result = await transport.print(job);
    expect(result).toEqual({ pagesPrinted: 4 });

    // 3. The 3 source pages were consumed lazily, in order, quantities intact.
    expect(transport.jobs).toHaveLength(1);
    expect(transport.jobs[0].totalPages).toBe(4);
    expect(transport.jobs[0].quantities).toEqual([1, 1, 2]);
    expect(transport.jobs[0].result).toEqual({ pagesPrinted: 4 });
    expect(pulls).toEqual([0, 1, 2]);
    // Only the first page had been pulled when the first page finished.
    expect(pullsAtFirstPage).toBe(1);

    // 4. Exactly one progress event per physical page, in order, pagesTotal 4.
    expect(progress).toHaveLength(4);
    expect(progress.map((entry) => entry.page)).toEqual([1, 2, 3, 4]);
    expect(progress.every((entry) => entry.pagesTotal === 4)).toBe(true);

    // 5. Full status transition sequence.
    expect(states).toEqual(['connecting', 'connected', 'printing', 'connected']);
  });

  it('aborting after the first progress event rejects with AbortError and settles on connected', async () => {
    const transport = new MockTransport();
    const states: TransportState[] = [];
    await transport.connect();
    transport.onStatus((status) => states.push(status.state));

    const controller = new AbortController();
    transport.onProgress((reported) => {
      if (reported.page === 1) {
        controller.abort();
      }
    });

    const { job } = hardcodedJob({ signal: controller.signal });

    // 6. The print rejects with a DOMException named `AbortError`.
    const error = await transport
      .print(job)
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');

    // It does not stay in `printing`: cleanup returns the transport to `connected`.
    expect(states).toEqual(['printing', 'connected']);
    expect(states.at(-1)).toBe('connected');
    // The recorded result reflects the physical pages that actually printed.
    expect(transport.jobs[0].result).toEqual({ pagesPrinted: 1 });
  });
});
