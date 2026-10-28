import { describe, expect, it, vi } from 'vitest';
import { instantiateClient, LabelType, PageColorType, ResolutionClass } from '@mmote/niimbluelib';
import type { EncodedImage, NiimbotAbstractClient } from '@mmote/niimbluelib';
import { NiimbotTransport } from './niimbotAdapter';
import { PrintAbortedError } from './transport';
import type { PrintJob, PrintPage, PrinterStatus, PrintProgress, SendProgress } from './transport';

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

interface FakeClient {
  client: NiimbotAbstractClient;
  order: string[];
  handlers: Record<string, (event: unknown) => void>;
  /** Replace what the cache getters (`getPrinterInfo`/`fetchPrinterInfo`) return. */
  setPrinterInfo: (info: Record<string, unknown>) => void;
  /** Replace what the cache getters (`getRfidInfo`/`fetchRfidInfo`) return. */
  setRfidInfo: (info: Record<string, unknown>) => void;
  newPrintTask: ReturnType<typeof vi.fn>;
  printInit: ReturnType<typeof vi.fn>;
  printPage: ReturnType<typeof vi.fn>;
  waitForPageFinished: ReturnType<typeof vi.fn>;
  waitForFinished: ReturnType<typeof vi.fn>;
  printEnd: ReturnType<typeof vi.fn>;
  startHeartbeat: ReturnType<typeof vi.fn>;
  stopHeartbeat: ReturnType<typeof vi.fn>;
  setHeartbeatInterval: ReturnType<typeof vi.fn>;
}

function makeFakeClient(
  options: {
    taskType?: string;
    failOnPage?: number;
    metadata?: Record<string, unknown>;
    printerInfo?: Record<string, unknown>;
    rfidInfo?: Record<string, unknown>;
  } = {},
): FakeClient {
  const order: string[] = [];
  const handlers: Record<string, (event: unknown) => void> = {};

  const printerInfo = {
    serial: 'SN-1',
    batteryPercents: 77,
    resolutionClass: 3,
    ...options.printerInfo,
  };
  const rfidInfo = {
    paperInfo: { valid: true, paperWidth: 40, paperHeight: 30 },
    ...options.rfidInfo,
  };
  // Mutable caches: the adapter reads `getPrinterInfo()`/`getRfidInfo()` when the
  // library announces a fetch, so a test can move them between events.
  let currentPrinterInfo: Record<string, unknown> = printerInfo;
  let currentRfidInfo: Record<string, unknown> = rfidInfo;
  const setPrinterInfo = (info: Record<string, unknown>): void => {
    currentPrinterInfo = info;
  };
  const setRfidInfo = (info: Record<string, unknown>): void => {
    currentRfidInfo = info;
  };

  const printInit = vi.fn(async () => {
    order.push('printInit');
  });
  const waitForPageFinished = vi.fn(async () => {
    order.push('waitForPageFinished');
  });
  const waitForFinished = vi.fn(async () => {
    order.push('waitForFinished');
  });

  let pageCount = 0;
  const printPage = vi.fn(async (_image: EncodedImage, quantity?: number) => {
    pageCount += 1;
    order.push(`printPage:${quantity}`);
    if (options.failOnPage !== undefined && pageCount === options.failOnPage) {
      throw new Error('print failed');
    }
  });

  const printEnd = vi.fn(async () => {
    order.push('printEnd');
    return true;
  });

  const newPrintTask = vi.fn(() => ({
    printInit,
    printPage,
    waitForPageFinished,
    waitForFinished,
  }));

  const startHeartbeat = vi.fn();
  const stopHeartbeat = vi.fn();
  const setHeartbeatInterval = vi.fn();

  const raw = {
    getPrintTaskType: vi.fn(() => options.taskType),
    protocol: { newPrintTask, printEnd },
    on: vi.fn((name: string, fn: (event: unknown) => void) => {
      handlers[name] = fn;
    }),
    off: vi.fn((name: string) => {
      delete handlers[name];
    }),
    connect: vi.fn(async function (this: { connected?: boolean }, _options?: unknown) {
      this.connected = true;
      return { deviceName: 'Fake', result: 1 };
    }),
    disconnect: vi.fn(async () => undefined),
    isConnected: vi.fn(() => true),
    startHeartbeat,
    stopHeartbeat,
    setHeartbeatInterval,
    fetchPrinterInfo: vi.fn(async () => currentPrinterInfo),
    fetchRfidInfo: vi.fn(async () => currentRfidInfo),
    getPrinterInfo: vi.fn(() => currentPrinterInfo),
    getRfidInfo: vi.fn(() => currentRfidInfo),
    getModelMetadata: vi.fn(() => options.metadata),
  };

  return {
    client: raw as unknown as NiimbotAbstractClient,
    order,
    handlers,
    setPrinterInfo,
    setRfidInfo,
    newPrintTask,
    printInit,
    printPage,
    waitForPageFinished,
    waitForFinished,
    printEnd,
    startHeartbeat,
    stopHeartbeat,
    setHeartbeatInterval,
  };
}

async function connectedTransport(
  fake: FakeClient,
  options: ConstructorParameters<typeof NiimbotTransport>[0] = {},
): Promise<NiimbotTransport> {
  const transport = new NiimbotTransport({
    createClient: () => fake.client,
    ...options,
  });
  await transport.connect();
  return transport;
}

describe('NiimbotTransport orchestration', () => {
  it('prints pages in order and calls printEnd exactly once', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);

    const result = await transport.print(jobOf([2, 1]));

    expect(result).toEqual({ pagesPrinted: 3 });
    expect(fake.order).toEqual([
      'printInit',
      'printPage:2',
      'waitForPageFinished',
      'printPage:1',
      'waitForPageFinished',
      'waitForFinished',
      'printEnd',
    ]);
    expect(fake.printEnd).toHaveBeenCalledTimes(1);
  });

  it('still calls printEnd when printPage rejects', async () => {
    const fake = makeFakeClient({ taskType: 'B1', failOnPage: 1 });
    const transport = await connectedTransport(fake);

    await expect(transport.print(jobOf([1]))).rejects.toThrow('print failed');

    expect(fake.printEnd).toHaveBeenCalledTimes(1);
  });

  it('treats a generator that throws undefined as a failure', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);

    async function* failing(): AsyncIterable<PrintPage> {
      yield { data: encodedImage(), quantity: 1 };
      // eslint-disable-next-line no-throw-literal
      throw undefined;
    }

    await expect(
      transport.print({ totalPages: 1, pages: failing() }),
    ).rejects.toBeUndefined();
    expect(fake.printEnd).toHaveBeenCalledTimes(1);
  });

  it('throws PrintAbortedError(0) on a pre-aborted signal and still calls printEnd', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);
    const controller = new AbortController();
    controller.abort();

    const error = await transport
      .print(jobOf([1], { signal: controller.signal }))
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(PrintAbortedError);
    expect((error as PrintAbortedError).pagesPrinted).toBe(0);
    // The generic name contract survives for cross-runtime abort handling.
    expect((error as PrintAbortedError).name).toBe('AbortError');
    expect(fake.printEnd).toHaveBeenCalledTimes(1);
  });

  it('throws PrintAbortedError with the accumulated count when aborted mid-job', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);
    const controller = new AbortController();

    let pageCalls = 0;
    fake.printPage.mockImplementation(async () => {
      pageCalls += 1;
      // Abort while the second source page is being sent; the adapter observes
      // it at the next page boundary and reports the two accounted groups.
      if (pageCalls === 2) controller.abort();
    });

    const error = await transport
      .print(jobOf([1, 1, 1], { signal: controller.signal }))
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(PrintAbortedError);
    expect((error as PrintAbortedError).pagesPrinted).toBe(2);
    expect(fake.printEnd).toHaveBeenCalledTimes(1);
  });

  it('throws before printInit when the printer model is unidentified', async () => {
    const fake = makeFakeClient({ taskType: undefined });
    const transport = await connectedTransport(fake);

    await expect(transport.print(jobOf([1]))).rejects.toThrow(
      'Cannot print: printer model not identified',
    );

    expect(fake.newPrintTask).not.toHaveBeenCalled();
    expect(fake.printInit).not.toHaveBeenCalled();
    expect(fake.printEnd).not.toHaveBeenCalled();
  });

  it('lets per-job options override transport defaults', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake, { density: 3, labelType: 1 });

    await transport.print(jobOf([1], { density: 5, labelType: 2 }));
    await transport.print(jobOf([1]));

    const [taskType, overrides] = fake.newPrintTask.mock.calls[0];
    expect(taskType).toBe('B1');
    expect(overrides).toMatchObject({
      totalPages: 1,
      density: 5,
      labelType: 2,
      statusPollIntervalMs: 100,
      statusTimeoutMs: 8000,
    });

    const [, defaults] = fake.newPrintTask.mock.calls[1];
    expect(defaults).toMatchObject({ density: 3, labelType: 1 });
  });

  it('defaults pageColor and omits unset option keys so library defaults survive the merge', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);

    await transport.print(jobOf([1]));
    const [, bare] = fake.newPrintTask.mock.calls[0];
    expect(bare).toEqual({
      totalPages: 1,
      statusPollIntervalMs: 100,
      statusTimeoutMs: 8000,
      // Always explicit: validatePage rejects a page whose color differs, and
      // the encoded pages are SingleColor (reference app does the same).
      pageColor: PageColorType.SingleColor,
    });
    expect(bare).not.toHaveProperty('density');
    expect(bare).not.toHaveProperty('labelType');

    await transport.print(
      jobOf([1], { density: 4, labelType: 2, pageColor: PageColorType.DoubleColor }),
    );
    const [, full] = fake.newPrintTask.mock.calls[1];
    expect(full).toEqual({
      totalPages: 1,
      statusPollIntervalMs: 100,
      statusTimeoutMs: 8000,
      density: 4,
      labelType: 2,
      pageColor: PageColorType.DoubleColor,
    });
  });

  it('forwards job.speed only when defined (speed is D110M_V4-only)', async () => {
    const fake = makeFakeClient({ taskType: 'D110M_V4' });
    const transport = await connectedTransport(fake);

    await transport.print(jobOf([1]));
    const [, bare] = fake.newPrintTask.mock.calls[0];
    expect(bare).not.toHaveProperty('speed');

    await transport.print(jobOf([1], { speed: 0 }));
    const [, withSpeed] = fake.newPrintTask.mock.calls[1];
    expect(withSpeed.speed).toBe(0);
  });

  it('rejects print with Not connected before connecting', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = new NiimbotTransport({ createClient: () => fake.client });

    await expect(transport.print(jobOf([1]))).rejects.toThrow('Not connected');
    expect(fake.newPrintTask).not.toHaveBeenCalled();
  });

  it('rejects print with Not connected after a failed connect', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    vi.mocked(fake.client.connect).mockRejectedValueOnce(new Error('connect boom'));
    const transport = new NiimbotTransport({ createClient: () => fake.client });

    await expect(transport.connect()).rejects.toThrow('connect boom');
    await expect(transport.print(jobOf([1]))).rejects.toThrow('Not connected');
  });

  it('does not create a task or pull pages when the signal is already aborted', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);
    const controller = new AbortController();
    controller.abort();

    let pulled = 0;
    async function* tracking(): AsyncIterable<PrintPage> {
      pulled += 1;
      yield { data: encodedImage(), quantity: 1 };
    }

    await expect(
      transport.print({ totalPages: 1, pages: tracking(), signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(fake.newPrintTask).not.toHaveBeenCalled();
    expect(fake.printInit).not.toHaveBeenCalled();
    expect(pulled).toBe(0);
    expect(fake.printEnd).toHaveBeenCalledTimes(1);
  });

  it('keeps a mid-job disconnect in the final status', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));

    fake.printPage.mockImplementationOnce(async () => {
      fake.handlers['disconnect']?.({});
    });

    await transport.print(jobOf([1]));

    expect(statuses.map((status) => status.state)).toEqual([
      'printing',
      'disconnected',
      'disconnected',
    ]);
    expect(statuses[statuses.length - 1]?.state).toBe('disconnected');
  });

  it('surfaces a printEnd failure in the final status', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    fake.printEnd.mockResolvedValueOnce(false);
    const transport = await connectedTransport(fake);
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));

    await expect(transport.print(jobOf([1]))).resolves.toEqual({ pagesPrinted: 1 });

    expect(statuses[statuses.length - 1]?.state).toBe('connected');
    expect(statuses[statuses.length - 1]?.error).toMatch(/printEnd/);
  });

  it('propagates the job error and reports it in the status when printEnd rejects', async () => {
    const fake = makeFakeClient({ taskType: 'B1', failOnPage: 1 });
    fake.printEnd.mockRejectedValueOnce(new Error('cleanup boom'));
    const transport = await connectedTransport(fake);
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));

    await expect(transport.print(jobOf([1]))).rejects.toThrow('print failed');

    expect(statuses[statuses.length - 1]?.state).toBe('connected');
    expect(statuses[statuses.length - 1]?.error).toBe('print failed');
  });

  it('normalizes swapped B21L2B printprogress events', async () => {
    const fake = makeFakeClient({ taskType: 'B21_L2B' });
    const transport = await connectedTransport(fake);
    const received: PrintProgress[] = [];
    transport.onProgress((progress) => received.push(progress));

    fake.printPage.mockImplementationOnce(async () => {
      // Upstream emits (totalPages, pagesPrinted), but the ctor wants (page, pagesTotal).
      fake.handlers['printprogress']?.({
        page: 2,
        pagesTotal: 1,
        pagePrintProgress: 50,
        pageFeedProgress: 10,
      });
    });

    await transport.print(jobOf([1, 1]));

    expect(received).toEqual([
      { page: 1, pagesTotal: 2, pagePrintProgress: 50, pageFeedProgress: 10 },
    ]);
  });

  it('maps printprogress events to PrintProgress and stops after unsubscribe', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);

    const received: PrintProgress[] = [];
    const listener = (progress: PrintProgress) => received.push(progress);
    const unsubscribe = transport.onProgress(listener);

    fake.handlers['printprogress']({
      page: 2,
      pagesTotal: 3,
      pagePrintProgress: 50,
      pageFeedProgress: 10,
    });
    expect(received).toEqual([
      { page: 2, pagesTotal: 3, pagePrintProgress: 50, pageFeedProgress: 10 },
    ]);

    unsubscribe();
    fake.handlers['printprogress']({
      page: 3,
      pagesTotal: 3,
      pagePrintProgress: 100,
      pageFeedProgress: 100,
    });
    expect(received).toHaveLength(1);
  });

  it('forwards printpacketprogress as send progress and stops after unsubscribe', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);

    const received: SendProgress[] = [];
    const listener = (progress: SendProgress) => received.push(progress);
    const unsubscribe = transport.onSendProgress(listener);

    fake.printPage.mockImplementationOnce(async () => {
      fake.handlers['printpacketprogress']?.({ progress: 40 });
      fake.handlers['printpacketprogress']?.({ progress: 100 });
    });

    await transport.print(jobOf([1]));

    expect(received).toEqual([
      { page: 1, copies: 1, progress: 40 },
      { page: 1, copies: 1, progress: 100 },
    ]);

    unsubscribe();
    fake.handlers['printpacketprogress']?.({ progress: 50 });
    expect(received).toHaveLength(2);
  });

  it('anchors each page upload at the range of copies it covers', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);
    const received: SendProgress[] = [];
    transport.onSendProgress((progress) => received.push(progress));

    // One `printPage` per source page, each reporting a full upload.
    fake.printPage.mockImplementation(async () => {
      fake.handlers['printpacketprogress']?.({ progress: 100 });
    });

    await transport.print(jobOf([2, 3]));

    // The first source page covers copies 1–2, the second copies 3–5.
    expect(received).toEqual([
      { page: 1, copies: 2, progress: 100 },
      { page: 3, copies: 3, progress: 100 },
    ]);
  });

  it('emits connecting, connected (with printer details), printing, connected', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = new NiimbotTransport({ createClient: () => fake.client });
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));

    await transport.connect();
    await transport.print(jobOf([1]));

    expect(statuses.map((status) => status.state)).toEqual([
      'connecting',
      'connected',
      'printing',
      'connected',
    ]);
    const connected = statuses[1];
    expect(connected).toMatchObject({
      state: 'connected',
      deviceName: 'Fake',
      dpi: 300,
      batteryPercent: 77,
      rollWidthHm: 4000,
      rollHeightHm: 3000,
    });
  });

  it('disconnect is safe when never connected', async () => {
    const transport = new NiimbotTransport();
    await expect(transport.disconnect()).resolves.toBeUndefined();
  });

  it('unwires the client on disconnect and blocks further prints', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);

    await transport.disconnect();

    expect(fake.client.off).toHaveBeenCalledWith('printprogress', expect.any(Function));
    expect(fake.client.off).toHaveBeenCalledWith(
      'printpacketprogress',
      expect.any(Function),
    );
    expect(fake.client.off).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(fake.client.off).toHaveBeenCalledWith('disconnect', expect.any(Function));
    await expect(transport.print(jobOf([1]))).rejects.toThrow('Not connected');
  });

  it('clears connection state even when client.disconnect rejects', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    vi.mocked(fake.client.disconnect).mockRejectedValueOnce(new Error('drop boom'));
    const transport = await connectedTransport(fake);

    await expect(transport.disconnect()).rejects.toThrow('drop boom');
    await expect(transport.print(jobOf([1]))).rejects.toThrow('Not connected');
  });

  it('reports the job error in the status when cleanup succeeds', async () => {
    const fake = makeFakeClient({ taskType: 'B1', failOnPage: 1 });
    const transport = await connectedTransport(fake);
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));

    await expect(transport.print(jobOf([1]))).rejects.toThrow('print failed');

    expect(statuses[statuses.length - 1]?.error).toBe('print failed');
  });
});

describe('NiimbotTransport capabilities', () => {
  const metadata = {
    model: 'B1_PRO',
    printheadPixels: 567,
    densityMin: 1,
    densityMax: 5,
    densityDefault: 3,
    paperTypes: [1, 2, 5],
    dpi: 300,
    printDirection: 'top',
  };

  const connectedOf = (statuses: PrinterStatus[]): PrinterStatus | undefined =>
    statuses.find((status) => status.state === 'connected');

  const connectAndCollect = async (
    fake: FakeClient,
  ): Promise<PrinterStatus | undefined> => {
    const transport = new NiimbotTransport({ createClient: () => fake.client });
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));
    await transport.connect();
    return connectedOf(statuses);
  };

  it('maps model metadata and the detected print task to capabilities', async () => {
    const fake = makeFakeClient({ taskType: 'D110M_V4', metadata });

    const connected = await connectAndCollect(fake);

    expect(connected?.capabilities).toEqual({
      model: 'B1_PRO',
      taskType: 'D110M_V4',
      printheadPixels: 567,
      densityMin: 1,
      densityMax: 5,
      densityDefault: 3,
      paperTypes: [1, 2, 5],
      doubleColor: true,
      tubePrinting: true,
      supportsSpeed: true,
    });
  });

  it('reflects printTasksCapabilities for the detected task', async () => {
    // B1 supports double colour but not tube printing, and not speed.
    const fake = makeFakeClient({ taskType: 'B1', metadata });

    const connected = await connectAndCollect(fake);

    expect(connected?.capabilities?.doubleColor).toBe(true);
    expect(connected?.capabilities?.tubePrinting).toBe(false);
    expect(connected?.capabilities?.supportsSpeed).toBe(false);
  });

  it('does not throw and reports no task flags for an unknown task type', async () => {
    // At runtime a client can report a task name the capabilities table lacks
    // (the declared Record type hides that). connect() must stay connected.
    const fake = makeFakeClient({ taskType: 'UNKNOWN_TASK', metadata });

    const connected = await connectAndCollect(fake);

    expect(connected?.state).toBe('connected');
    expect(connected?.capabilities?.taskType).toBe('UNKNOWN_TASK');
    expect(connected?.capabilities?.doubleColor).toBe(false);
    expect(connected?.capabilities?.tubePrinting).toBe(false);
    expect(connected?.capabilities?.supportsSpeed).toBe(false);
  });

  it('leaves capabilities undefined when model metadata is absent', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });

    const connected = await connectAndCollect(fake);

    expect(connected?.capabilities).toBeUndefined();
  });

  it('omits task-type flags when the print task is unidentified', async () => {
    const fake = makeFakeClient({ taskType: undefined, metadata });

    const connected = await connectAndCollect(fake);

    expect(connected?.capabilities).toMatchObject({
      model: 'B1_PRO',
      printheadPixels: 567,
    });
    expect(connected?.capabilities).not.toHaveProperty('taskType');
    expect(connected?.capabilities).not.toHaveProperty('doubleColor');
    expect(connected?.capabilities).not.toHaveProperty('tubePrinting');
    expect(connected?.capabilities).not.toHaveProperty('supportsSpeed');
  });

  it('keeps getDetected working', async () => {
    const fake = makeFakeClient({ taskType: 'D110M_V4', metadata });
    const transport = new NiimbotTransport({ createClient: () => fake.client });
    await transport.connect();

    expect(transport.getDetected()).toMatchObject({
      model: 'B1_PRO',
      taskType: 'D110M_V4',
      printheadPixels: 567,
    });
  });
});

describe('NiimbotTransport printer info + heartbeat', () => {
  const connectAndCollect = async (fake: FakeClient): Promise<PrinterStatus | undefined> => {
    const transport = new NiimbotTransport({ createClient: () => fake.client });
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));
    await transport.connect();
    return statuses.find((status) => status.state === 'connected');
  };

  it('populates versions and the RFID label block from the connect-time info', async () => {
    const fake = makeFakeClient({
      taskType: 'B1',
      printerInfo: { hardwareVersion: 'HW-1', softwareVersion: 'SW-2' },
      rfidInfo: {
        labelRfidInfo: {
          tagPresent: true,
          usedPaper: 12,
          allPaper: 100,
          consumablesType: 1,
        },
      },
    });

    const connected = await connectAndCollect(fake);

    expect(connected).toMatchObject({
      hardwareVersion: 'HW-1',
      softwareVersion: 'SW-2',
      rfid: { tagPresent: true, usedPaper: 12, allPaper: 100, consumablesType: 1 },
    });
  });

  it('omits rfid when there is no label tag info', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });

    const connected = await connectAndCollect(fake);

    expect(connected).not.toHaveProperty('rfid');
  });

  it('omits consumablesType when the tag does not report one', async () => {
    const fake = makeFakeClient({
      taskType: 'B1',
      rfidInfo: { labelRfidInfo: { tagPresent: false, usedPaper: 0, allPaper: 0 } },
    });

    const connected = await connectAndCollect(fake);

    expect(connected?.rfid).toEqual({ tagPresent: false, usedPaper: 0, allPaper: 0 });
    expect(connected?.rfid).not.toHaveProperty('consumablesType');
  });

  it('refreshInfo re-fetches and re-emits the updated info', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));

    vi.mocked(fake.client.fetchPrinterInfo).mockResolvedValue({
      serial: 'SN-2',
      batteryPercents: 88,
      hardwareVersion: 'HW-9',
      softwareVersion: 'SW-9',
      resolutionClass: 3,
    } as never);

    await transport.refreshInfo();

    expect(statuses.at(-1)).toMatchObject({
      state: 'connected',
      batteryPercent: 88,
      hardwareVersion: 'HW-9',
      softwareVersion: 'SW-9',
    });
  });

  it('refreshInfo rejects when not connected', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = new NiimbotTransport({ createClient: () => fake.client });

    await expect(transport.refreshInfo()).rejects.toThrow('Not connected');
  });

  it('starts the heartbeat with a slow 15 s interval on connect', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });

    await connectedTransport(fake);

    expect(fake.setHeartbeatInterval).toHaveBeenCalledWith(15_000);
    expect(fake.startHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('stops the heartbeat and unwires its events on disconnect', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);

    await transport.disconnect();

    expect(fake.stopHeartbeat).toHaveBeenCalled();
    expect(fake.client.off).toHaveBeenCalledWith('heartbeat', expect.any(Function));
    expect(fake.client.off).toHaveBeenCalledWith('heartbeatfailed', expect.any(Function));
  });

  it('leaves no heartbeat running when connect rejects', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    vi.mocked(fake.client.connect).mockRejectedValueOnce(new Error('connect boom'));
    const transport = new NiimbotTransport({ createClient: () => fake.client });

    await expect(transport.connect()).rejects.toThrow('connect boom');

    expect(fake.startHeartbeat).not.toHaveBeenCalled();
    expect(fake.stopHeartbeat).toHaveBeenCalled();
  });

  it('a heartbeat updates only the battery and keeps the state', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));

    fake.handlers['heartbeat']?.({ data: { batteryPercents: 42 } });

    const last = statuses.at(-1);
    expect(last).toMatchObject({ state: 'connected', batteryPercent: 42, deviceName: 'Fake' });
  });

  it('keeps the last battery value when a heartbeat carries none', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));

    fake.handlers['heartbeat']?.({ data: { batteryPercents: 55 } });
    fake.handlers['heartbeat']?.({ data: {} });

    expect(statuses.at(-1)?.batteryPercent).toBe(55);
  });

  it('a heartbeat during printing never downgrades the state', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));

    fake.printPage.mockImplementationOnce(async () => {
      fake.handlers['heartbeat']?.({ data: { batteryPercents: 12 } });
    });

    await transport.print(jobOf([1]));

    expect(statuses.map((status) => status.state)).toEqual([
      'printing',
      'printing',
      'connected',
    ]);
    // The settling job re-emits `lastConnected`, which now carries the fresh
    // battery reading rather than the stale connect-time value.
    expect(statuses.at(-1)).toMatchObject({ state: 'connected', batteryPercent: 12 });
  });

  it('a failed heartbeat never flips the status to error', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));

    fake.handlers['heartbeatfailed']?.({ failedAttempts: 1 });

    expect(statuses.some((status) => status.state === 'error')).toBe(false);
    expect(statuses).toHaveLength(0);
  });
});

describe('NiimbotTransport metadata refresh (library re-reads)', () => {
  const lastStatus = (statuses: PrinterStatus[]): PrinterStatus | undefined => statuses.at(-1);

  it('republishes the roll, RFID and label type when the library re-reads the tag', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));

    // The library swapped the roll and re-read the tag (lid / paperRfid change).
    fake.setRfidInfo({
      paperInfo: { valid: true, paperWidth: 50, paperHeight: 25 },
      labelRfidInfo: {
        tagPresent: true,
        usedPaper: 3,
        allPaper: 80,
        consumablesType: LabelType.WithGaps,
      },
    });
    fake.handlers['rfidinfofetched']?.({ info: {} });

    expect(statuses).toHaveLength(1);
    expect(lastStatus(statuses)).toMatchObject({
      state: 'connected',
      deviceName: 'Fake',
      rollWidthHm: 5000,
      rollHeightHm: 2500,
      labelType: LabelType.WithGaps,
      rfid: { tagPresent: true, usedPaper: 3, allPaper: 80, consumablesType: LabelType.WithGaps },
    });
  });

  it('republishes dpi/versions/battery when the library re-reads printer info', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));

    fake.setPrinterInfo({
      serial: 'SN-2',
      batteryPercents: 33,
      resolutionClass: ResolutionClass.DPI203,
      hardwareVersion: 'HW-9',
      softwareVersion: 'SW-9',
    });
    fake.handlers['printerinfofetched']?.({ info: {} });

    expect(statuses).toHaveLength(1);
    expect(lastStatus(statuses)).toMatchObject({
      state: 'connected',
      dpi: 203,
      batteryPercent: 33,
      hardwareVersion: 'HW-9',
      softwareVersion: 'SW-9',
    });
  });

  it('updates the cache but emits nothing for an event fired before connect completes', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    // The library announces its connect-time reads before our connect resolves.
    vi.mocked(fake.client.connect).mockImplementationOnce(async () => {
      // The negotiation fetch saw the new roll...
      fake.setRfidInfo({ paperInfo: { valid: true, paperWidth: 50, paperHeight: 30 } });
      fake.handlers['rfidinfofetched']?.({ info: {} });
      // ...then our own connect() fetch loses the width: only the cached status
      // from the event can still know it.
      fake.setRfidInfo({ paperInfo: { valid: true, paperHeight: 30 } });
      return { deviceName: 'Fake', result: 1 };
    });
    const transport = new NiimbotTransport({ createClient: () => fake.client });
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));

    await transport.connect();

    // One 'connecting' plus the single status the connect flow owns.
    expect(statuses.map((status) => status.state)).toEqual(['connecting', 'connected']);
    // The early event updated the cached status, so the partial later read keeps it.
    expect(lastStatus(statuses)).toMatchObject({ state: 'connected', rollWidthHm: 5000, rollHeightHm: 3000 });
  });

  it('updates the cache but never emits while a print job owns the channel', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));

    let stateWhenFired: string | undefined;
    fake.printPage.mockImplementationOnce(async () => {
      fake.setRfidInfo({ paperInfo: { valid: true, paperWidth: 50, paperHeight: 25 } });
      fake.handlers['rfidinfofetched']?.({ info: {} });
      stateWhenFired = lastStatus(statuses)?.state;
    });

    await transport.print(jobOf([1]));

    // Nothing was emitted by the event itself...
    expect(stateWhenFired).toBe('printing');
    expect(statuses.map((status) => status.state)).toEqual(['printing', 'connected']);
    // ...and the settle published the fresh roll.
    expect(lastStatus(statuses)).toMatchObject({
      state: 'connected',
      rollWidthHm: 5000,
      rollHeightHm: 2500,
    });
  });

  it('keeps the previous roll fields when an RFID event carries an empty payload', async () => {
    const fake = makeFakeClient({
      taskType: 'B1',
      rfidInfo: {
        paperInfo: { valid: true, paperWidth: 40, paperHeight: 30 },
        labelRfidInfo: {
          tagPresent: true,
          usedPaper: 12,
          allPaper: 100,
          consumablesType: LabelType.WithGaps,
        },
      },
    });
    const transport = await connectedTransport(fake);
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));

    // The library emits `rfidinfofetched` even when every sub-read failed: an
    // empty payload is a comms hiccup, not a removed roll.
    fake.setRfidInfo({});
    fake.handlers['rfidinfofetched']?.({ info: {} });

    const status = lastStatus(statuses);
    expect(status?.state).toBe('connected');
    expect(status?.rollWidthHm).toBe(4000);
    expect(status?.rollHeightHm).toBe(3000);
    expect(status?.rfid).toMatchObject({ tagPresent: true, consumablesType: LabelType.WithGaps });
    expect(status?.labelType).toBe(LabelType.WithGaps);
  });

  it('clears the tag-derived fields when a successful paper read reports no tag', async () => {
    const fake = makeFakeClient({
      taskType: 'B1',
      rfidInfo: {
        paperInfo: { valid: true, paperWidth: 40, paperHeight: 30 },
        labelRfidInfo: {
          tagPresent: true,
          usedPaper: 12,
          allPaper: 100,
          consumablesType: LabelType.WithGaps,
        },
      },
    });
    const transport = await connectedTransport(fake);
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));

    // A produced paper read with no tag: the roll is real, the tag is not.
    fake.setRfidInfo({ paperInfo: { valid: true, paperWidth: 50, paperHeight: 25 } });
    fake.handlers['rfidinfofetched']?.({ info: {} });

    const status = lastStatus(statuses);
    expect(status?.rollWidthHm).toBe(5000);
    expect(status?.rollHeightHm).toBe(2500);
    // The old roll's tag data must not survive a successful read that has none.
    expect(status?.rfid).toBeUndefined();
    expect(status?.labelType).toBeUndefined();
    // The device fields are untouched by a tag read.
    expect(status).toMatchObject({ deviceName: 'Fake', dpi: 300, batteryPercent: 77 });
  });

  it('refreshInfo clears the tag-derived fields of a swapped roll too', async () => {
    const fake = makeFakeClient({
      taskType: 'B1',
      rfidInfo: {
        paperInfo: { valid: true, paperWidth: 40, paperHeight: 30 },
        labelRfidInfo: {
          tagPresent: true,
          usedPaper: 12,
          allPaper: 100,
          consumablesType: LabelType.WithGaps,
        },
      },
    });
    const transport = await connectedTransport(fake);
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));

    // The manual Refresh is the same full read as the event path.
    fake.setRfidInfo({ paperInfo: { valid: true, paperWidth: 50, paperHeight: 25 } });
    await transport.refreshInfo();

    const status = lastStatus(statuses);
    expect(status?.rollWidthHm).toBe(5000);
    expect(status?.rollHeightHm).toBe(2500);
    expect(status?.rfid).toBeUndefined();
    expect(status?.labelType).toBeUndefined();
  });

  it('clears the label type when the new tag reports only Invalid/unknown types', async () => {
    const fake = makeFakeClient({
      taskType: 'B1',
      rfidInfo: {
        paperInfo: { valid: true, paperWidth: 40, paperHeight: 30, paperType: LabelType.Black },
      },
    });
    const transport = await connectedTransport(fake);
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));

    fake.setRfidInfo({
      paperInfo: { valid: true, paperWidth: 40, paperHeight: 30, paperType: 99 as LabelType },
      labelRfidInfo: {
        tagPresent: true,
        usedPaper: 0,
        allPaper: 0,
        consumablesType: LabelType.Invalid,
      },
    });
    fake.handlers['rfidinfofetched']?.({ info: {} });

    expect(lastStatus(statuses)?.labelType).toBeUndefined();
  });

  it('replaces all four roll fields when the tag reports a different roll', async () => {
    const fake = makeFakeClient({
      taskType: 'B1',
      rfidInfo: {
        paperInfo: { valid: true, paperWidth: 40, paperHeight: 30 },
        labelRfidInfo: {
          tagPresent: true,
          usedPaper: 12,
          allPaper: 100,
          consumablesType: LabelType.WithGaps,
        },
      },
    });
    const transport = await connectedTransport(fake);
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));

    fake.setRfidInfo({
      paperInfo: { valid: true, paperWidth: 50, paperHeight: 25, paperType: LabelType.Black },
      labelRfidInfo: {
        tagPresent: true,
        usedPaper: 2,
        allPaper: 60,
        consumablesType: LabelType.Perforated,
      },
    });
    fake.handlers['rfidinfofetched']?.({ info: {} });

    expect(lastStatus(statuses)).toMatchObject({
      rollWidthHm: 5000,
      rollHeightHm: 2500,
      rfid: { tagPresent: true, usedPaper: 2, allPaper: 60, consumablesType: LabelType.Perforated },
      // The new tag wins: `consumablesType` is preferred over `paperType`.
      labelType: LabelType.Perforated,
    });
  });

  it('keeps the previous printer fields when a printer read is partial', async () => {
    const fake = makeFakeClient({
      taskType: 'B1',
      printerInfo: { hardwareVersion: 'HW-1', softwareVersion: 'SW-2' },
    });
    const transport = await connectedTransport(fake);
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));

    // A printer read that returned nothing keeps the known device fields.
    fake.setPrinterInfo({});
    fake.handlers['printerinfofetched']?.({ info: {} });

    expect(lastStatus(statuses)).toMatchObject({
      deviceName: 'Fake',
      dpi: 300,
      batteryPercent: 77,
      hardwareVersion: 'HW-1',
      softwareVersion: 'SW-2',
    });
  });

  it('emits no status when a metadata event lands after the disconnect started', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));
    const rfidHandler = fake.handlers['rfidinfofetched'];

    // Hold the disconnect open, then let the library's own queued
    // `void fetchRfidInfo()` resolve while it is still in flight.
    let release: (() => void) | undefined;
    vi.mocked(fake.client.disconnect).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const disconnecting = transport.disconnect();

    fake.setRfidInfo({ paperInfo: { valid: true, paperWidth: 50, paperHeight: 25 } });
    rfidHandler?.({ info: {} });
    expect(statuses).toHaveLength(0);

    release?.();
    await disconnecting;
    expect(statuses.map((status) => status.state)).toEqual(['disconnected']);
  });

  it('unsubscribes both handlers on disconnect', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));
    const rfidHandler = fake.handlers['rfidinfofetched'];
    const printerHandler = fake.handlers['printerinfofetched'];

    await transport.disconnect();

    expect(fake.client.off).toHaveBeenCalledWith('rfidinfofetched', expect.any(Function));
    expect(fake.client.off).toHaveBeenCalledWith('printerinfofetched', expect.any(Function));
    const count = statuses.length;
    rfidHandler?.({ info: {} });
    printerHandler?.({ info: {} });
    expect(statuses).toHaveLength(count);
  });
});

describe('NiimbotTransport reported label type', () => {
  const connectWith = async (rfidInfo: Record<string, unknown>): Promise<PrinterStatus | undefined> => {
    const fake = makeFakeClient({ taskType: 'B1', rfidInfo });
    const transport = new NiimbotTransport({ createClient: () => fake.client });
    const statuses: PrinterStatus[] = [];
    transport.onStatus((status) => statuses.push(status));
    await transport.connect();
    return statuses.find((status) => status.state === 'connected');
  };

  it('prefers the tag consumables type over the paper type', async () => {
    const connected = await connectWith({
      paperInfo: { valid: true, paperWidth: 40, paperHeight: 30, paperType: LabelType.Black },
      labelRfidInfo: { tagPresent: true, usedPaper: 0, allPaper: 10, consumablesType: LabelType.WithGaps },
    });

    expect(connected?.labelType).toBe(LabelType.WithGaps);
  });

  it('falls back to the paper type when the tag reports none', async () => {
    const connected = await connectWith({
      paperInfo: { valid: true, paperWidth: 40, paperHeight: 30, paperType: LabelType.Black },
    });

    expect(connected?.labelType).toBe(LabelType.Black);
  });

  it('treats Invalid or unknown values as absent and falls through', async () => {
    const fromPaper = await connectWith({
      paperInfo: { valid: true, paperWidth: 40, paperHeight: 30, paperType: LabelType.Perforated },
      labelRfidInfo: {
        tagPresent: true,
        usedPaper: 0,
        allPaper: 10,
        consumablesType: LabelType.Invalid,
      },
    });
    expect(fromPaper?.labelType).toBe(LabelType.Perforated);

    const none = await connectWith({
      paperInfo: { valid: true, paperWidth: 40, paperHeight: 30, paperType: 99 as LabelType },
      labelRfidInfo: {
        tagPresent: true,
        usedPaper: 0,
        allPaper: 10,
        consumablesType: LabelType.Invalid,
      },
    });
    expect(none).not.toHaveProperty('labelType');
  });
});

describe('NiimbotTransport niimbluelib interop', () => {
  it('loads the real CJS client and exposes newPrintTask and printEnd', () => {
    const client = instantiateClient('virtual');
    expect(typeof client.protocol.newPrintTask).toBe('function');
    expect(typeof client.protocol.printEnd).toBe('function');
  });

  it('invokes the real client connect with the client as receiver', async () => {
    const real = instantiateClient('virtual');
    const connectSpy = vi
      .spyOn(real, 'connect')
      .mockImplementation(async function (this: unknown) {
        return { deviceName: 'Virtual', result: 0 } as Awaited<ReturnType<typeof real.connect>>;
      });
    vi.spyOn(real, 'fetchPrinterInfo').mockResolvedValue({ settings: {} } as never);
    vi.spyOn(real, 'fetchRfidInfo').mockResolvedValue({} as never);
    const transport = new NiimbotTransport({ createClient: () => real });

    await transport.connect();

    expect(connectSpy.mock.instances[0]).toBe(real);
    // connect() starts the client heartbeat; clear the live timer.
    await transport.disconnect();
  });

  it('constructs a virtual transport without connecting', () => {
    expect(() => new NiimbotTransport({ transport: 'virtual' })).not.toThrow();
  });

  it('merges explicit options on the real library without undefined keys', () => {
    const client = instantiateClient('virtual');
    const task = client.protocol.newPrintTask('B1', {
      totalPages: 1,
      pageColor: PageColorType.SingleColor,
    });
    const validate = task as unknown as {
      validatePage(image: EncodedImage, quantity: number): void;
    };

    expect(() =>
      validate.validatePage(
        { pageColor: PageColorType.SingleColor, cols: 1, rows: 1, rowsData: [] },
        1,
      ),
    ).not.toThrow();
  });
});
