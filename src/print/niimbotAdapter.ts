import {
  instantiateClient,
  ResolutionClass,
  PageColorType,
  PrintTaskCapability,
  printTasksCapabilities,
} from '@mmote/niimbluelib';
import type {
  CombinedRfidInfo,
  HeartbeatData,
  LabelType,
  NiimbotAbstractClient,
  NiimbotClientType,
  PrinterInfo,
  PrintOptions,
  PrintProgressEvent,
  RfidInfo,
} from '@mmote/niimbluelib';
import { PrintAbortedError } from './transport';
import type {
  PrinterCapabilities,
  PrinterRfidInfo,
  PrinterTransport,
  PrintJob,
  PrintResult,
  PrinterStatus,
  PrintProgress,
  TransportState,
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

  /** State most recently emitted; heartbeats/refreshes re-emit it unchanged. */
  private currentState: TransportState = 'disconnected';

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

  private readonly handleHeartbeat = (event: { data?: HeartbeatData }): void => {
    const batteryPercent = event?.data?.batteryPercents;
    if (batteryPercent === undefined) {
      // No reading in this packet; keep the last known battery value.
      return;
    }
    // Only the battery moves. `lastConnected` stays the rich 'connected' copy
    // (print() re-emits it when a job settles), while the *emitted* state is
    // preserved verbatim so a heartbeat mid-print never downgrades 'printing'.
    this.lastConnected = { ...this.lastConnected, batteryPercent };
    this.emitStatus({ ...this.lastConnected, state: this.currentState });
  };

  private readonly handleHeartbeatFailed = (): void => {
    // A failed heartbeat does NOT mean the connection dropped: never flip the
    // status to 'error' and keep the last known battery value. The library
    // disconnects itself once it passes its own fail threshold.
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

      const status = this.buildConnectedStatus(client, printerInfo, rfidInfo, info.deviceName);

      this.connected = true;
      this.lastConnected = status;
      this.emitStatus(status);

      // The library default (2 s) is too chatty for a battery readout nobody
      // watches live; slow it down before starting. startHeartbeat() clears any
      // prior timer, so a StrictMode double-connect stays idempotent.
      client.setHeartbeatInterval(15_000);
      client.startHeartbeat();
    } catch (error) {
      this.unwire(client);
      this.stopHeartbeat(client);
      this.client = undefined;
      this.connected = false;
      this.emitStatus({ state: 'error', error: messageOf(error) });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    // A rejected connect must not leave a live timer; also safe with no client.
    this.stopHeartbeat(client);
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

  /**
   * Re-fetch device + RFID info and re-emit the connected status. Throws when
   * not connected; never changes the state while a print job is in flight.
   */
  async refreshInfo(): Promise<void> {
    const client = this.requireClient();

    const printerInfo = await this.safeFetchPrinterInfo(client);
    const rfidInfo = await this.safeFetchRfidInfo(client);

    const status = this.buildConnectedStatus(
      client,
      printerInfo,
      rfidInfo,
      this.lastConnected.deviceName,
    );
    this.lastConnected = status;
    // A refresh must not clobber an in-flight print's state.
    this.emitStatus({ ...status, state: this.currentState });
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
      // Pre-job abort reports 0: nothing has been sent to the printer yet.
      throwIfAborted(job.signal, 0);

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
      // Only D110M_V4 honours `speed`; forward it only when the caller set it so
      // the library default survives the merge (same discipline as density).
      if (job.speed !== undefined) {
        taskOptions.speed = job.speed;
      }

      const task = client.protocol.newPrintTask(taskType, taskOptions);

      this.activeTotalPages = job.totalPages;
      this.emitStatus({ state: 'printing' });

      await task.printInit();
      for await (const page of job.pages) {
        // Mid-job abort reports the copies already accumulated (one source page
        // group at a time), never a guess.
        throwIfAborted(job.signal, printed);
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
    client.on('heartbeat', this.handleHeartbeat);
    client.on('heartbeatfailed', this.handleHeartbeatFailed);
    this.wired = true;
  }

  private unwire(client: NiimbotAbstractClient): void {
    if (!this.wired) {
      return;
    }
    client.off('printprogress', this.handlePrintProgress);
    client.off('connect', this.handleConnect);
    client.off('disconnect', this.handleDisconnect);
    client.off('heartbeat', this.handleHeartbeat);
    client.off('heartbeatfailed', this.handleHeartbeatFailed);
    this.wired = false;
  }

  /** Stop the client's heartbeat timer if one is running; safe with no client. */
  private stopHeartbeat(client: NiimbotAbstractClient | undefined): void {
    client?.stopHeartbeat();
  }

  /** Build the rich 'connected' status from freshly fetched printer + RFID info.
   * Shared by connect() and refreshInfo() so the two can never drift. */
  private buildConnectedStatus(
    client: NiimbotAbstractClient,
    printerInfo: PrinterInfo,
    rfidInfo: CombinedRfidInfo,
    deviceName: string | undefined,
  ): PrinterStatus {
    const status: PrinterStatus = {
      state: 'connected',
      deviceName: deviceName ?? printerInfo.serial ?? client.getModelMetadata()?.model,
      dpi: dpiOf(printerInfo),
      batteryPercent: printerInfo.batteryPercents,
      rollWidthHm: hmOf(rfidInfo.paperInfo?.paperWidth),
      rollHeightHm: hmOf(rfidInfo.paperInfo?.paperHeight),
      capabilities: capabilitiesOf(client),
    };
    if (printerInfo.hardwareVersion !== undefined) {
      status.hardwareVersion = printerInfo.hardwareVersion;
    }
    if (printerInfo.softwareVersion !== undefined) {
      status.softwareVersion = printerInfo.softwareVersion;
    }
    const rfid = rfidOf(rfidInfo.labelRfidInfo);
    if (rfid !== undefined) {
      status.rfid = rfid;
    }
    return status;
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
    this.currentState = status.state;
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

/** Map model metadata + the detected print task onto {@link PrinterCapabilities}.
 * Absent model metadata yields `undefined` (no gating, no crash). Only defined
 * keys are set, and `paperTypes` is copied so consumers can never mutate the
 * library metadata (or the shared `lastConnected` status). */
function capabilitiesOf(client: NiimbotAbstractClient): PrinterCapabilities | undefined {
  const meta = client.getModelMetadata();
  if (!meta) {
    return undefined;
  }

  const capabilities: PrinterCapabilities = {
    ...(meta.model !== undefined ? { model: meta.model } : {}),
    ...(meta.printheadPixels !== undefined ? { printheadPixels: meta.printheadPixels } : {}),
    ...(meta.densityMin !== undefined ? { densityMin: meta.densityMin } : {}),
    ...(meta.densityMax !== undefined ? { densityMax: meta.densityMax } : {}),
    ...(meta.densityDefault !== undefined ? { densityDefault: meta.densityDefault } : {}),
    ...(meta.paperTypes !== undefined ? { paperTypes: [...meta.paperTypes] } : {}),
  };

  // Falsy guard matches print(): a null/'' task must never index the table.
  const taskType = client.getPrintTaskType();
  if (taskType) {
    // An unknown task type is absent from the table at runtime (the declared
    // Record type hides this): default to no capabilities instead of crashing.
    const taskCaps = printTasksCapabilities[taskType] ?? [];
    capabilities.taskType = taskType;
    capabilities.doubleColor = taskCaps.includes(PrintTaskCapability.SupportDoubleColor);
    capabilities.tubePrinting = taskCaps.includes(PrintTaskCapability.SupportTubePrinting);
    // Placeholder: the library exposes no speed capability bit; replace when it does.
    capabilities.supportsSpeed = taskType === 'D110M_V4';
  }

  return capabilities;
}

function hmOf(mm: number | undefined): number | undefined {
  return mm === undefined ? undefined : mmToHm(mm);
}

/** Map a label RFID tag onto {@link PrinterRfidInfo}; `undefined` when there is
 * no label tag info. `consumablesType` is runtime-optional in the library. */
function rfidOf(labelRfidInfo: RfidInfo | undefined): PrinterRfidInfo | undefined {
  if (labelRfidInfo === undefined) {
    return undefined;
  }
  const rfid: PrinterRfidInfo = { tagPresent: labelRfidInfo.tagPresent };
  if (labelRfidInfo.usedPaper !== undefined) {
    rfid.usedPaper = labelRfidInfo.usedPaper;
  }
  if (labelRfidInfo.allPaper !== undefined) {
    rfid.allPaper = labelRfidInfo.allPaper;
  }
  if (labelRfidInfo.consumablesType !== undefined) {
    rfid.consumablesType = labelRfidInfo.consumablesType;
  }
  return rfid;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwIfAborted(signal: AbortSignal | undefined, pagesPrinted: number): void {
  if (signal?.aborted) {
    throw new PrintAbortedError(pagesPrinted);
  }
}
