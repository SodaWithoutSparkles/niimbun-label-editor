import type { EncodedImage, LabelType, PageColorType } from '@mmote/niimbluelib';
import type { hm } from '../core/hm';

/**
 * Thrown by a transport when a print job is cancelled. Carries the number of
 * physical copies actually printed before the abort was observed, so the job
 * runner can report a truthful count instead of guessing.
 *
 * `name` is `'AbortError'` so generic runtime handling that matches on
 * `error.name === 'AbortError'` (never `instanceof DOMException`, which is
 * unreliable across realms) keeps working. Note the class is intentionally not a
 * `DOMException`: only the count-bearing shape matters to callers.
 *
 * (Declared without a constructor parameter property because the project sets
 * `erasableSyntaxOnly`.)
 */
export class PrintAbortedError extends Error {
  readonly pagesPrinted: number;

  constructor(pagesPrinted: number) {
    super('Aborted');
    this.name = 'AbortError';
    this.pagesPrinted = pagesPrinted;
  }
}

/** One encoded page (niimbluelib bit-plane payload) plus its copy count. */
export interface PrintPage {
  data: EncodedImage;
  /** Positive integer number of copies. Σ quantity across pages must equal totalPages. */
  quantity: number;
}

/** A lazy print job. `pages` is never fully materialized (invariant 9). */
export interface PrintJob {
  /** Σ quantity across all pages; niimbluelib needs this upfront. */
  totalPages: number;
  /** Lazily consumed one page at a time; never materialize the whole job (invariant 9). */
  pages: AsyncIterable<PrintPage>;
  density?: number;
  /** Print speed (0 = quality, 1 = normal). Only `D110M_V4` supports it. */
  speed?: 0 | 1;
  labelType?: LabelType;
  pageColor?: PageColorType;
  /**
   * Abort is observed at page boundaries: a pre-aborted signal rejects before
   * `printInit` and before the page sequence is pulled; otherwise the signal is
   * checked after a page is pulled and before it is sent. An abort that arrives
   * while a page is being transmitted is not observed, and aborting after the
   * final page has been sent does NOT fail the job.
   */
  signal?: AbortSignal;
}

/** Result of a print job. */
export interface PrintResult {
  /** Number of physical pages actually sent (Σ quantity of pages consumed). */
  pagesPrinted: number;
}

export type TransportState =
  | 'disconnected' | 'connecting' | 'connected' | 'printing' | 'error';

/** Connected/reported printer capabilities, used to gate print overrides (P7 W0). */
export interface PrinterCapabilities {
  /** Printer model, e.g. 'B1_PRO'. */
  model?: string;
  /** Print-task type selected for the model, e.g. 'D110M_V4'. */
  taskType?: string;
  /** Printhead dot count, e.g. 567 for B1_PRO. */
  printheadPixels?: number;
  densityMin?: number;
  densityMax?: number;
  densityDefault?: number;
  /** Supported label/paper types (niimbluelib LabelType values). */
  paperTypes?: LabelType[];
  /** Print task supports double-colour pages. */
  doubleColor?: boolean;
  /** Print task supports tube printing. */
  tubePrinting?: boolean;
  /**
   * Print task supports the `speed` print option. Only `D110M_V4` does
   * (the reference app shows the speed control for that task alone).
   */
  supportsSpeed?: boolean;
}

/** RFID label-tag info, from the connect-time CombinedRfidInfo. */
export interface PrinterRfidInfo {
  tagPresent: boolean;
  usedPaper?: number;
  allPaper?: number;
  consumablesType?: LabelType;
}

export interface PrinterStatus {
  state: TransportState;
  deviceName?: string;
  /** Printer printhead dpi, when known. */
  dpi?: number;
  /** Printer-reported roll/label size in hm, when known. */
  rollWidthHm?: hm;
  rollHeightHm?: hm;
  batteryPercent?: number;
  error?: string;
  /**
   * Reported capabilities; absent when the printer model is unknown (no gating).
   */
  capabilities?: PrinterCapabilities;
  /** Printer-reported hardware version, when known. */
  hardwareVersion?: string;
  /** Printer-reported software version, when known. */
  softwareVersion?: string;
  /**
   * RFID label-tag block, when a label tag was present at connect time. The
   * roll dimensions live in `rollWidthHm`/`rollHeightHm`, not here.
   */
  rfid?: PrinterRfidInfo;
}

/**
 * Upload ("send") progress: the bitmap packets for one page being written to
 * the printer. This is a **separate channel** from {@link PrintProgress}: it
 * describes the transfer *before* a page is printed, has a different lifetime
 * (it restarts for every page) and, on some transports, may not be reported at
 * all. So a transport that cannot report it simply does not implement
 * {@link PrinterTransport.onSendProgress}; consumers must then hide the send
 * indicator rather than render a permanently dead 0 % bar.
 *
 * Source signal: niimbluelib's `printpacketprogress`, emitted from
 * `AbstractPrintTask.printPage` for every page's packet upload. It is **not**
 * `PrintProgress.pageFeedProgress`, which stays 0 on `D110M_V4`.
 */
export interface SendProgress {
  /**
   * 1-based **physical copy index** of the first copy the uploading page covers
   * (the first copy of the page's quantity group). `progress` restarts at 0 for
   * every page, so this anchor plus {@link SendProgress.copies} is what lets a
   * consumer project a job-wide percentage:
   * `((page - 1) + copies * progress / 100) / pagesTotal * 100`.
   */
  page: number;
  /**
   * How many physical copies the uploading page covers — its `quantity`. One
   * `printPage` uploads a single bitmap that the printer repeats `copies` times,
   * so the upload's share of the job is `copies`, not one copy. Must be a
   * positive integer; a missing or invalid value is treated as `1`.
   */
  copies: number;
  /** 0–100 upload progress of that page. */
  progress: number;
}

export interface PrintProgress {
  /**
   * 1-based **physical copy index** (`1..pagesTotal`), not a source-page index.
   *
   * MockTransport emits exactly one event per physical copy. The NIIMBOT adapter
   * forwards the device's own reported count. On a grouped source page with
   * `quantity > 1` the copies therefore occupy consecutive indices. The device's
   * `page` field is **non-monotonic** on `D110M_V4` (reports `1 → 0 → 1`; see
   * `agent/memory/print-transport.md`), so consumers must clamp it monotonic
   * rather than trust the raw value.
   *
   * ⚠ To be verified on hardware for grouped quantities: every smoke job so far
   * used `quantity: 1` per page, so the "one event per copy" interpretation of
   * the device's count is inferred, not yet observed with `quantity > 1`.
   */
  page: number;
  pagesTotal: number;
  /** 0–100. */
  pagePrintProgress: number;
  /** 0–100. */
  pageFeedProgress: number;
}

export interface PrinterTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  print(job: PrintJob): Promise<PrintResult>;
  /** Re-fetch device + RFID info. No-op-safe when disconnected. */
  refreshInfo?(): Promise<void>;
  /** Subscribe to status; returns an unsubscribe function. */
  onStatus(listener: (status: PrinterStatus) => void): () => void;
  /** Subscribe to print progress; returns an unsubscribe function. */
  onProgress(listener: (progress: PrintProgress) => void): () => void;
  /**
   * Subscribe to upload ("send") progress; returns an unsubscribe function.
   *
   * Optional on purpose: a transport that has no upload signal omits the method
   * entirely, and consumers must then leave the send indicator out. A transport
   * that implements it but never fires is handled the same way — the runner
   * only publishes a send percentage once the first event arrives.
   */
  onSendProgress?(listener: (progress: SendProgress) => void): () => void;
}
