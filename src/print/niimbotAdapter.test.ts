import { describe, expect, it, vi } from 'vitest';
import { instantiateClient, PageColorType } from '@mmote/niimbluelib';
import type { EncodedImage, NiimbotAbstractClient } from '@mmote/niimbluelib';
import { NiimbotTransport } from './niimbotAdapter';
import type { PrintJob, PrintPage, PrinterStatus, PrintProgress } from './transport';

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
  newPrintTask: ReturnType<typeof vi.fn>;
  printInit: ReturnType<typeof vi.fn>;
  printPage: ReturnType<typeof vi.fn>;
  waitForPageFinished: ReturnType<typeof vi.fn>;
  waitForFinished: ReturnType<typeof vi.fn>;
  printEnd: ReturnType<typeof vi.fn>;
}

function makeFakeClient(
  options: { taskType?: string; failOnPage?: number } = {},
): FakeClient {
  const order: string[] = [];
  const handlers: Record<string, (event: unknown) => void> = {};

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
    fetchPrinterInfo: vi.fn(async () => ({
      serial: 'SN-1',
      batteryPercents: 77,
      resolutionClass: 3,
    })),
    fetchRfidInfo: vi.fn(async () => ({
      paperInfo: { valid: true, paperWidth: 40, paperHeight: 30 },
    })),
    getPrinterInfo: vi.fn(() => ({})),
    getRfidInfo: vi.fn(() => ({
      paperInfo: { valid: true, paperWidth: 40, paperHeight: 30 },
    })),
    getModelMetadata: vi.fn(() => undefined),
  };

  return {
    client: raw as unknown as NiimbotAbstractClient,
    order,
    handlers,
    newPrintTask,
    printInit,
    printPage,
    waitForPageFinished,
    waitForFinished,
    printEnd,
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

  it('throws AbortError on an aborted signal and still calls printEnd', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);
    const controller = new AbortController();
    controller.abort();

    await expect(
      transport.print(jobOf([1], { signal: controller.signal })),
    ).rejects.toMatchObject({ name: 'AbortError' });

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

  it('omits unset option keys so library defaults survive the merge', async () => {
    const fake = makeFakeClient({ taskType: 'B1' });
    const transport = await connectedTransport(fake);

    await transport.print(jobOf([1]));
    const [, bare] = fake.newPrintTask.mock.calls[0];
    expect(bare).toEqual({
      totalPages: 1,
      statusPollIntervalMs: 100,
      statusTimeoutMs: 8000,
    });
    expect(bare).not.toHaveProperty('density');
    expect(bare).not.toHaveProperty('labelType');
    expect(bare).not.toHaveProperty('pageColor');

    await transport.print(
      jobOf([1], { density: 4, labelType: 2, pageColor: PageColorType.SingleColor }),
    );
    const [, full] = fake.newPrintTask.mock.calls[1];
    expect(full).toEqual({
      totalPages: 1,
      statusPollIntervalMs: 100,
      statusTimeoutMs: 8000,
      density: 4,
      labelType: 2,
      pageColor: PageColorType.SingleColor,
    });
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
