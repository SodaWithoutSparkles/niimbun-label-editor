import type { LabelType } from '@mmote/niimbluelib';
import type { hm } from '../core/hm';
import { PrintAbortedError } from './transport';
import type {
  PrinterCapabilities,
  PrinterRfidInfo,
  PrinterStatus,
  PrintJob,
  PrintProgress,
  PrintResult,
  PrinterTransport,
  TransportState,
} from './transport';

/** Named niimbluelib `LabelType` values (grep target for the numeric table). */
const PAPER_WITH_GAPS = 1 as LabelType;
const PAPER_BLACK = 2 as LabelType;
const PAPER_TRANSPARENT = 5 as LabelType;
const DEFAULT_PAPER_TYPES: LabelType[] = [
  PAPER_WITH_GAPS,
  PAPER_BLACK,
  PAPER_TRANSPARENT,
];

/**
 * B1_PRO-like capability defaults reported by the mock so the dev harness and
 * UI tests exercise the gated path. Kept literal so this module stays free of a
 * runtime `@mmote/niimbluelib` import.
 */
const DEFAULT_CAPABILITIES: PrinterCapabilities = {
  model: 'B1_PRO',
  taskType: 'D110M_V4',
  printheadPixels: 567,
  densityMin: 1,
  densityMax: 5,
  densityDefault: 3,
  paperTypes: DEFAULT_PAPER_TYPES,
  doubleColor: true,
  tubePrinting: true,
  supportsSpeed: true,
};

export interface MockTransportOptions {
  deviceName?: string;
  dpi?: number;
  connectDelayMs?: number;
  pageDelayMs?: number;
  /**
   * Reported capabilities, merged over the B1_PRO-like defaults. Pass `null` to
   * report none (disables UI gating).
   */
  capabilities?: Partial<PrinterCapabilities> | null;
  /** Printer-reported roll width in hm, surfaced in status when set. */
  rollWidthHm?: hm;
  /** Printer-reported roll height in hm, surfaced in status when set. */
  rollHeightHm?: hm;
  /** Printer-reported hardware version, surfaced in status when set. */
  hardwareVersion?: string;
  /** Printer-reported software version, surfaced in status when set. */
  softwareVersion?: string;
  /** RFID label-tag block, surfaced in status when set. */
  rfid?: PrinterRfidInfo;
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
  private readonly capabilities?: PrinterCapabilities;
  private readonly rollWidthHm?: hm;
  private readonly rollHeightHm?: hm;
  private readonly hardwareVersion?: string;
  private readonly softwareVersion?: string;
  private readonly rfid?: PrinterRfidInfo;

  private connected = false;

  private readonly statusListeners = new Set<(status: PrinterStatus) => void>();
  private readonly progressListeners = new Set<(progress: PrintProgress) => void>();

  constructor(options: MockTransportOptions = {}) {
    this.deviceName = options.deviceName ?? 'Mock Niimbot';
    this.dpi = options.dpi ?? 300;
    this.connectDelayMs = options.connectDelayMs ?? 0;
    this.pageDelayMs = options.pageDelayMs ?? 0;
    const merged =
      options.capabilities === null
        ? undefined
        : { ...DEFAULT_CAPABILITIES, ...options.capabilities };
    // Copy the paper-type array so the module-level default is never aliased.
    this.capabilities =
      merged === undefined
        ? undefined
        : {
            ...merged,
            ...(merged.paperTypes !== undefined
              ? { paperTypes: [...merged.paperTypes] }
              : {}),
          };
    this.rollWidthHm = options.rollWidthHm;
    this.rollHeightHm = options.rollHeightHm;
    this.hardwareVersion = options.hardwareVersion;
    this.softwareVersion = options.softwareVersion;
    this.rfid = options.rfid;
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

  /** Re-emit the current status as a fresh, independent copy. */
  async refreshInfo(): Promise<void> {
    this.emitStatus(this.connected ? 'connected' : 'disconnected');
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

    let printed = 0;

    // Pre-abort reports 0 (nothing sent); a mid-copy abort reports the copies
    // already emitted, so the runner can return a truthful count.
    const throwIfAborted = (signal?: AbortSignal): void => {
      if (signal?.aborted) {
        throw new PrintAbortedError(printed);
      }
    };

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
    if (this.capabilities !== undefined) {
      // Fresh capabilities + array per emit: consumers never share state.
      status.capabilities = {
        ...this.capabilities,
        ...(this.capabilities.paperTypes !== undefined
          ? { paperTypes: [...this.capabilities.paperTypes] }
          : {}),
      };
    }
    if (this.rollWidthHm !== undefined) {
      status.rollWidthHm = this.rollWidthHm;
    }
    if (this.rollHeightHm !== undefined) {
      status.rollHeightHm = this.rollHeightHm;
    }
    if (this.hardwareVersion !== undefined) {
      status.hardwareVersion = this.hardwareVersion;
    }
    if (this.softwareVersion !== undefined) {
      status.softwareVersion = this.softwareVersion;
    }
    if (this.rfid !== undefined) {
      // Fresh RFID object per emit: consumers never share state.
      status.rfid = { ...this.rfid };
    }
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
