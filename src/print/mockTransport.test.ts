import { describe, expect, it, vi } from 'vitest';
import type { EncodedImage } from '@mmote/niimbluelib';
import { MockTransport } from './mockTransport';
import type { PrintJob, PrintPage } from './transport';

// Any runtime import of the library is a bug: type-only imports are erased.
vi.mock('@mmote/niimbluelib', () => {
  throw new Error('niimbluelib must not be imported at runtime');
});

/** Pages carry an opaque encoded payload; a cast is enough for the mock. */
const encodedImage = (): EncodedImage => ({}) as EncodedImage;

const pagesOf = (quantities: number[]): PrintPage[] =>
  quantities.map((quantity) => ({ data: encodedImage(), quantity }));

async function* iterate(pages: PrintPage[]): AsyncIterable<PrintPage> {
  for (const page of pages) {
    yield page;
  }
}

const jobOf = (quantities: number[], overrides: Partial<PrintJob> = {}): PrintJob => ({
  totalPages: quantities.reduce((sum, quantity) => sum + quantity, 0),
  pages: iterate(pagesOf(quantities)),
  ...overrides,
});

const connected = async (): Promise<MockTransport> => {
  const transport = new MockTransport();
  await transport.connect();
  return transport;
};

describe('MockTransport', () => {
  it('emits connecting then connected and resolves', async () => {
    const transport = new MockTransport();
    const states: string[] = [];
    transport.onStatus((status) => states.push(status.state));

    await transport.connect();

    expect(states).toEqual(['connecting', 'connected']);
  });

  it('emits one progress event per physical page in order', async () => {
    const transport = await connected();
    const pages: number[] = [];
    transport.onProgress((progress) => pages.push(progress.page));

    const result = await transport.print(jobOf([1, 2]));

    expect(pages).toEqual([1, 2, 3]);
    expect(result).toEqual({ pagesPrinted: 3 });
  });

  it('records the job with its quantities and result', async () => {
    const transport = await connected();

    const result = await transport.print(jobOf([1, 2]));

    expect(transport.jobs).toHaveLength(1);
    expect(transport.jobs[0].totalPages).toBe(3);
    expect(transport.jobs[0].quantities).toEqual([1, 2]);
    expect(transport.jobs[0].result).toEqual({ pagesPrinted: 3 });
    expect(result.pagesPrinted).toBe(transport.jobs[0].totalPages);
  });

  it('emits printing then returns to connected', async () => {
    const transport = await connected();
    const states: string[] = [];
    transport.onStatus((status) => states.push(status.state));

    await transport.print(jobOf([1]));

    expect(states).toEqual(['printing', 'connected']);
  });

  it('stops emitting after unsubscribe', async () => {
    const transport = await connected();
    const listener = vi.fn();
    const unsubscribe = transport.onProgress(listener);

    unsubscribe();
    await transport.print(jobOf([1]));

    expect(listener).not.toHaveBeenCalled();
  });

  it('throws when printing before connect()', async () => {
    const transport = new MockTransport();

    await expect(transport.print(jobOf([1]))).rejects.toThrow('Not connected');
    expect(transport.jobs).toHaveLength(0);
  });

  it('rejects an invalid page quantity', async () => {
    const transport = await connected();

    await expect(transport.print(jobOf([0]))).rejects.toThrow('Invalid page quantity: 0');
    expect(transport.jobs[0].result).toEqual({ pagesPrinted: 0 });
  });

  it('rejects printing more pages than totalPages', async () => {
    const transport = await connected();

    const job: PrintJob = { totalPages: 1, pages: iterate(pagesOf([2])) };

    await expect(transport.print(job)).rejects.toThrow('Trying to print too many pages');
  });

  it('returns the real count when the generator ends early', async () => {
    const transport = await connected();

    // Declared total is 3, but the source only yields 1 physical page.
    const job: PrintJob = { totalPages: 3, pages: iterate(pagesOf([1])) };

    const result = await transport.print(job);

    expect(result).toEqual({ pagesPrinted: 1 });
    expect(transport.jobs[0].result).toEqual({ pagesPrinted: 1 });
  });

  it('throws AbortError when aborted mid-job and returns to connected', async () => {
    const transport = await connected();
    const controller = new AbortController();
    const states: string[] = [];
    transport.onStatus((status) => states.push(status.state));
    transport.onProgress((progress) => {
      if (progress.page === 1) {
        controller.abort();
      }
    });

    await expect(
      transport.print(jobOf([1, 2], { signal: controller.signal })),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(states).toEqual(['printing', 'connected']);
    expect(transport.jobs[0].result).toEqual({ pagesPrinted: 1 });
  });

  it('rejects a pre-aborted signal without pulling the generator', async () => {
    const transport = await connected();
    const controller = new AbortController();
    controller.abort();

    let pulled = 0;
    async function* counting(): AsyncIterable<PrintPage> {
      for (const page of pagesOf([1])) {
        pulled += 1;
        yield page;
      }
    }

    const job: PrintJob = { totalPages: 1, pages: counting(), signal: controller.signal };

    await expect(transport.print(job)).rejects.toMatchObject({ name: 'AbortError' });

    // A pre-aborted signal must reject before the source is even pulled.
    expect(pulled).toBe(0);
    expect(transport.jobs[0].result).toEqual({ pagesPrinted: 0 });
  });

  it('does not fail when aborted after the final page has been sent', async () => {
    const transport = await connected();
    const controller = new AbortController();

    // Deterministic: the source yields the single page; only when the consumer
    // asks for the next page does the generator body run again, abort the
    // signal, and then end. The abort therefore lands after the page has been
    // sent and must not fail the job.
    async function* abortAfterLastPage(): AsyncIterable<PrintPage> {
      yield pagesOf([1])[0];
      controller.abort();
    }

    const job: PrintJob = {
      totalPages: 1,
      pages: abortAfterLastPage(),
      signal: controller.signal,
    };

    const result = await transport.print(job);

    expect(result).toEqual({ pagesPrinted: 1 });
    expect(transport.jobs[0].result).toEqual({ pagesPrinted: 1 });
  });

  it('rejects printing after disconnect()', async () => {
    const transport = await connected();

    await transport.disconnect();

    await expect(transport.print(jobOf([1]))).rejects.toThrow('Not connected');
    expect(transport.jobs).toHaveLength(0);
  });

  it('does not emit connected when disconnected before printing', async () => {
    const transport = await connected();
    const states: string[] = [];
    transport.onStatus((status) => states.push(status.state));

    // print() now requires a connection, so the only way to reach the finally
    // path while disconnected is to disconnect first. Either way, no stray
    // `connected` status may follow.
    await transport.disconnect();
    await expect(transport.print(jobOf([1]))).rejects.toThrow('Not connected');

    expect(states).toEqual(['disconnected']);
  });

  it('loads without importing niimbluelib at runtime', async () => {
    // `@mmote/niimbluelib` is mocked with a throwing factory: if MockTransport
    // (or transport.ts) pulled it in at runtime, importing them would fail.
    const { MockTransport: FreshMockTransport } = await import('./mockTransport');
    const transport = new FreshMockTransport();

    await expect(transport.connect()).resolves.toBeUndefined();
  });
});
