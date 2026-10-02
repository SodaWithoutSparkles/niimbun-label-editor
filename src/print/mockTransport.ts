import type {
  PrintJob,
  PrintProgress,
  PrintResult,
  PrinterStatus,
  PrinterTransport,
  TransportState,
} from './transport';

export interface MockTransportOptions {
  deviceName?: string;
  dpi?: number;
  connectDelayMs?: number;
  pageDelayMs?: number;
}

/**
 * In-memory {@link PrinterTransport} for tests and offline development.
 *
 * It deliberately has no runtime dependency on `@mmote/niimbluelib`; encoded
 * page payloads are accepted as opaque values and discarded (invariant 9).
 */
export class MockTransport implements PrinterTransport {
  readonly jobs: Array<{ totalPages: number; quantities: number[]; result: PrintResult }> = [];

  private readonly deviceName: string;
  private readonly dpi: number;
  private readonly connectDelayMs: number;
  private readonly pageDelayMs: number;

  private connected = false;

  private readonly statusListeners = new Set<(status: PrinterStatus) => void>();
  private readonly progressListeners = new Set<(progress: PrintProgress) => void>();

  constructor(options: MockTransportOptions = {}) {
    this.deviceName = options.deviceName ?? 'Mock Niimbot';
    this.dpi = options.dpi ?? 300;
    this.connectDelayMs = options.connectDelayMs ?? 0;
    this.pageDelayMs = options.pageDelayMs ?? 0;
  }

  async connect(): Promise<void> {
    this.emitStatus('connecting');
    await this.delay(this.connectDelayMs);
    this.connected = true;
    this.emitStatus('connected');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emitStatus('disconnected');
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

  async print(job: PrintJob): Promise<PrintResult> {
    if (!this.connected) {
      throw new Error('Not connected');
    }

    this.emitStatus('printing');

    const record: { totalPages: number; quantities: number[]; result: PrintResult } = {
      totalPages: job.totalPages,
      quantities: [],
      result: { pagesPrinted: 0 },
    };
    this.jobs.push(record);

    const throwIfAborted = (signal?: AbortSignal): void => {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
    };

    let printed = 0;
    try {
      // A pre-aborted signal rejects before the page sequence is pulled, so an
      // empty generator cannot silently resolve with { pagesPrinted: 0 }.
      throwIfAborted(job.signal);

      // Invariant 9: consume lazily, one page at a time.
      for await (const printPage of job.pages) {
        throwIfAborted(job.signal);

        const quantity = printPage.quantity;
        if (!Number.isInteger(quantity) || quantity < 1) {
          throw new Error('Invalid page quantity: ' + quantity);
        }
        if (printed + quantity > job.totalPages) {
          throw new Error('Trying to print too many pages');
        }

        // Invariant 9 hygiene: record quantities, never the encoded payloads.
        record.quantities.push(quantity);

        for (let copy = 0; copy < quantity; copy++) {
          throwIfAborted(job.signal);
          await this.delay(this.pageDelayMs);
          printed += 1;
          this.emitProgress({
            page: printed,
            pagesTotal: job.totalPages,
            pagePrintProgress: 100,
            pageFeedProgress: 100,
          });
        }
      }

      return { pagesPrinted: printed };
    } finally {
      // An aborted job reflects what actually printed before returning to
      // connected — unless the transport is no longer connected.
      record.result = { pagesPrinted: printed };
      this.emitStatus(this.connected ? 'connected' : 'disconnected');
    }
  }

  private emitStatus(state: TransportState): void {
    const status: PrinterStatus = {
      state,
      deviceName: this.deviceName,
      dpi: this.dpi,
    };
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private emitProgress(progress: PrintProgress): void {
    for (const listener of this.progressListeners) {
      listener(progress);
    }
  }

  private delay(ms: number): Promise<void> {
    if (ms <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
