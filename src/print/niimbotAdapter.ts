import { instantiateClient, ResolutionClass, PageColorType } from '@mmote/niimbluelib';
import type {
  CombinedRfidInfo,
  LabelType,
  NiimbotAbstractClient,
  NiimbotClientType,
  PrinterInfo,
  PrintOptions,
  PrintProgressEvent,
} from '@mmote/niimbluelib';
import type {
  PrinterTransport,
  PrintJob,
  PrintResult,
  PrinterStatus,
  PrintProgress,
} from './transport';
import { mmToHm } from '../core/hm';

/** `client.connect` is declared parameterless on the abstract base, while the
 * concrete clients accept type-specific options. The public passthrough stays
 * `unknown`; the call site widens the arity locally. */
type ConnectInfo = Awaited<ReturnType<NiimbotAbstractClient['connect']>>;

export interface NiimbotTransportOptions {
  /** Which niimbluelib client to build. Default 'bluetooth'. */
  transport?: NiimbotClientType;
  /** Injection seam for tests; defaults to instantiateClient(transport). */
  createClient?: () => NiimbotAbstractClient;
  /** Passed through to client.connect(); client-specific shape. */
  connectOptions?: unknown;
  /** Defaults for every job; per-job values in PrintJob win. */
  density?: number;
  labelType?: LabelType;
}

/** Bridges niimbluelib's client/print-task API onto the frozen {@link PrinterTransport}. */
export class NiimbotTransport implements PrinterTransport {
  private readonly options: NiimbotTransportOptions;

  private client?: NiimbotAbstractClient;
  private wired = false;
  private connected = false;

  /** Last rich status, re-emitted when a print job settles back to idle. */
  private lastConnected: PrinterStatus = { state: 'connected' };

  /** Total pages of the in-flight job; used to detect upstream progress swap. */
  private activeTotalPages?: number;

  private readonly statusListeners = new Set<(status: PrinterStatus) => void>();
  private readonly progressListeners = new Set<(progress: PrintProgress) => void>();

  private readonly handlePrintProgress = (event: PrintProgressEvent): void => {
    let { page, pagesTotal } = event;
    // Upstream AbstractPrintTask.emitProgressEvent builds
    // `new PrintProgressEvent(totalPages, pagesPrinted, ...)`, but the ctor is
    // `(page, pagesTotal, ...)` — the args are swapped. B21L2B uses that path,
    // so normalize when the signature is recognizably inverted.
    if (
      this.activeTotalPages !== undefined &&
      event.pagesTotal !== this.activeTotalPages &&
      event.page === this.activeTotalPages
    ) {
      page = event.pagesTotal;
      pagesTotal = event.page;
    }
    this.emitProgress({
      page,
      pagesTotal,
      pagePrintProgress: event.pagePrintProgress,
      pageFeedProgress: event.pageFeedProgress,
    });
  };

  private readonly handleConnect = (): void => {
    this.connected = true;
    this.emitStatus({ ...this.lastConnected, state: 'connected' });
  };

  private readonly handleDisconnect = (): void => {
    this.connected = false;
    this.emitStatus({ state: 'disconnected' });
  };

  constructor(options: NiimbotTransportOptions = {}) {
    this.options = options;
  }

  async connect(): Promise<void> {
    this.emitStatus({ state: 'connecting' });

    const client = this.getOrCreateClient();
    this.wire(client);

    try {
      const connect = client.connect as (options?: unknown) => Promise<ConnectInfo>;
      const info = await connect.call(client, this.options.connectOptions);

      const printerInfo = await this.safeFetchPrinterInfo(client);
      const rfidInfo = await this.safeFetchRfidInfo(client);

      const status: PrinterStatus = {
        state: 'connected',
        deviceName:
          info.deviceName ??
          printerInfo.serial ??
          client.getModelMetadata()?.model,
        dpi: dpiOf(printerInfo),
        batteryPercent: printerInfo.batteryPercents,
        rollWidthHm: hmOf(rfidInfo.paperInfo?.paperWidth),
        rollHeightHm: hmOf(rfidInfo.paperInfo?.paperHeight),
      };

      this.connected = true;
      this.lastConnected = status;
      this.emitStatus(status);
    } catch (error) {
      this.unwire(client);
      this.client = undefined;
      this.connected = false;
      this.emitStatus({ state: 'error', error: messageOf(error) });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    if (!client) {
      this.connected = false;
      this.emitStatus({ state: 'disconnected' });
      return;
    }

    this.unwire(client);
    try {
      await client.disconnect();
    } finally {
      this.client = undefined;
      this.connected = false;
      this.emitStatus({ state: 'disconnected' });
    }
  }

  async print(job: PrintJob): Promise<PrintResult> {
    const client = this.requireClient();

    const taskType = client.getPrintTaskType();
    if (!taskType) {
      throw new Error('Cannot print: printer model not identified');
    }

    let jobError: unknown;
    let failed = false;
    let cleanupError: unknown;
    let printed = 0;

    try {
      throwIfAborted(job.signal);

      // Build options with only defined keys: newPrintTask spreads these over
      // the library defaults, so an explicit `undefined` would overwrite them
      // (e.g. pageColor -> validatePage throws on the first real page).
      // pageColor defaults to SingleColor explicitly — the reference app always
      // sets it, and validatePage rejects any page whose color differs.
      const taskOptions: Partial<PrintOptions> = {
        totalPages: job.totalPages,
        statusPollIntervalMs: 100,
        statusTimeoutMs: 8000,
        pageColor: job.pageColor ?? PageColorType.SingleColor,
      };
      const density = job.density ?? this.options.density;
      if (density !== undefined) {
        taskOptions.density = density;
      }
      const labelType = job.labelType ?? this.options.labelType;
      if (labelType !== undefined) {
        taskOptions.labelType = labelType;
      }

      const task = client.protocol.newPrintTask(taskType, taskOptions);

      this.activeTotalPages = job.totalPages;
      this.emitStatus({ state: 'printing' });

      await task.printInit();
      for await (const page of job.pages) {
        throwIfAborted(job.signal);
        if (!Number.isInteger(page.quantity) || page.quantity < 1) {
          throw new Error('Invalid page quantity: ' + page.quantity);
        }
        await task.printPage(page.data, page.quantity);
        await task.waitForPageFinished();
        printed += page.quantity;
      }
      await task.waitForFinished();
    } catch (error) {
      jobError = error;
      failed = true;
    } finally {
      this.activeTotalPages = undefined;
      try {
        // Always reset printer state / cut paper, even after an abort or error.
        const ended = await client.protocol.printEnd();
        if (ended === false) {
          cleanupError = new Error('Print cleanup (printEnd) reported failure');
        }
      } catch (error) {
        // Do not let cleanup mask the job error; surface it via status instead.
        cleanupError = error;
      }
    }

    // A job error wins over a cleanup error; both are reported in the status.
    const error = failed
      ? messageOf(jobError)
      : cleanupError !== undefined
        ? messageOf(cleanupError)
        : undefined;

    // Never overwrite a mid-job 'disconnected' emitted by handleDisconnect.
    const base: PrinterStatus = this.connected
      ? { ...this.lastConnected }
      : { state: 'disconnected' };
    this.emitStatus(error !== undefined ? { ...base, error } : base);

    if (failed) {
      throw jobError;
    }
    return { pagesPrinted: printed };
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

  private getOrCreateClient(): NiimbotAbstractClient {
    if (!this.client) {
      const create = this.options.createClient;
      this.client = create
        ? create()
        : instantiateClient(this.options.transport ?? 'bluetooth');
    }
    return this.client;
  }

  private requireClient(): NiimbotAbstractClient {
    if (!this.client || !this.connected) {
      throw new Error('Not connected');
    }
    return this.client;
  }

  /** Detected printer model + the print task chosen for it (diagnostics/smoke). */
  getDetected(): { model?: string; taskType?: string; dpi?: number; printheadPixels?: number } {
    const client = this.client;
    if (!client) {
      return {};
    }
    const meta = client.getModelMetadata();
    return {
      model: meta?.model,
      taskType: client.getPrintTaskType(),
      dpi: dpiOf(client.getPrinterInfo()),
      printheadPixels: meta?.printheadPixels,
    };
  }

  private wire(client: NiimbotAbstractClient): void {
    if (this.wired) {
      return;
    }
    client.on('printprogress', this.handlePrintProgress);
    client.on('connect', this.handleConnect);
    client.on('disconnect', this.handleDisconnect);
    this.wired = true;
  }

  private unwire(client: NiimbotAbstractClient): void {
    if (!this.wired) {
      return;
    }
    client.off('printprogress', this.handlePrintProgress);
    client.off('connect', this.handleConnect);
    client.off('disconnect', this.handleDisconnect);
    this.wired = false;
  }

  private async safeFetchPrinterInfo(client: NiimbotAbstractClient): Promise<PrinterInfo> {
    try {
      return await client.fetchPrinterInfo();
    } catch {
      return client.getPrinterInfo();
    }
  }

  private async safeFetchRfidInfo(client: NiimbotAbstractClient): Promise<CombinedRfidInfo> {
    try {
      return await client.fetchRfidInfo();
    } catch {
      return client.getRfidInfo();
    }
  }

  private emitStatus(status: PrinterStatus): void {
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private emitProgress(progress: PrintProgress): void {
    for (const listener of this.progressListeners) {
      listener(progress);
    }
  }
}

function dpiOf(info: PrinterInfo): number | undefined {
  if (info.resolutionClass === ResolutionClass.DPI203) {
    return 203;
  }
  if (info.resolutionClass === ResolutionClass.DPI300) {
    return 300;
  }
  return undefined;
}

function hmOf(mm: number | undefined): number | undefined {
  return mm === undefined ? undefined : mmToHm(mm);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}
