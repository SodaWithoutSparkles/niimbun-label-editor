import type { EncodedImage, LabelType, PageColorType } from '@mmote/niimbluelib';
import type { hm } from '../core/hm';

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
  /** Reported capabilities; absent when the printer model is unknown (no gating). */
  capabilities?: PrinterCapabilities;
}

export interface PrintProgress {
  /** 1-based physical page index (1..pagesTotal). */
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
  /** Subscribe to status; returns an unsubscribe function. */
  onStatus(listener: (status: PrinterStatus) => void): () => void;
  /** Subscribe to print progress; returns an unsubscribe function. */
  onProgress(listener: (progress: PrintProgress) => void): () => void;
}
