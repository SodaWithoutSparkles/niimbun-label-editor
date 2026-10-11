import { describe, expect, it, vi } from 'vitest';
import { TemplateError, type TemplateContext, type TemplateWorkerRequest, type TemplateWorkerResponse } from './engine';
import { READY_TIMEOUT_MS, TIMEOUT_MS, createJavaScriptTemplateEngine, type TemplateWorkerLike } from './jsEngine';

const readyEvent = (): MessageEvent => new MessageEvent('message', { data: { type: 'ready' } });

class FakeWorker implements TemplateWorkerLike {
    readonly posted: unknown[] = [];
    terminateCount = 0;
    private readonly listeners = new Map<string, Set<(event: Event) => void>>();
    private readonly autoReady: boolean;
    private readySent = false;

    constructor(autoReady = true) {
        this.autoReady = autoReady;
    }

    postMessage(message: unknown): void {
        this.posted.push(message);
    }

    terminate(): void {
        this.terminateCount += 1;
    }

    addEventListener(type: string, listener: (event: Event) => void): void {
        const bucket = this.listeners.get(type) ?? new Set<(event: Event) => void>();
        bucket.add(listener);
        this.listeners.set(type, bucket);
        if (type === 'message' && this.autoReady && !this.readySent) {
            this.ready();
        }
    }

    removeEventListener(type: string, listener: (event: Event) => void): void {
        this.listeners.get(type)?.delete(listener);
    }

    ready(): void {
        this.readySent = true;
        this.emit('message', readyEvent());
    }

    reply(response: TemplateWorkerResponse): void {
        this.emit('message', new MessageEvent('message', { data: response }));
    }

    fail(message: string): void {
        this.emit('error', { message } as unknown as Event);
    }

    messageError(): void {
        this.emit('messageerror', {} as unknown as Event);
    }

    private emit(type: string, event: Event): void {
        for (const listener of this.listeners.get(type) ?? []) {
            listener(event);
        }
    }
}

/** A worker whose `postMessage` fails structured clone (e.g. functions in ctx). */
class CloneFailingWorker extends FakeWorker {
    postMessage(): void {
        throw new DOMException('could not be cloned', 'DataCloneError');
    }
}

const makeContext = (overrides: Partial<TemplateContext> = {}): TemplateContext => ({
    index: 0,
    total: 1,
    row: { name: 'Ada' },
    rowCount: 1,
    now: 1_700_000_000_000,
    label: { name: 'Demo', dpi: 300 },
    globals: {},
    seeds: { docSeed: 'doc-1' },
    ...overrides,
});

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const makeEngine = (options: { timeoutMs?: number; readyTimeoutMs?: number; autoReady?: boolean } = {}) => {
    const workers: FakeWorker[] = [];
    const engine = createJavaScriptTemplateEngine({
        createWorker: () => {
            const worker = new FakeWorker(options.autoReady ?? true);
            workers.push(worker);
            return worker;
        },
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.readyTimeoutMs === undefined ? {} : { readyTimeoutMs: options.readyTimeoutMs }),
    });
    return { engine, workers };
};

const catchError = async (promise: Promise<unknown>): Promise<TemplateError> => {
    const error = await promise.then(
        () => {
            throw new Error('expected rejection');
        },
        (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(TemplateError);
    return error as TemplateError;
};

describe('createJavaScriptTemplateEngine', () => {
    it('exposes the documented timeout defaults', () => {
        expect(TIMEOUT_MS).toBe(250);
        expect(READY_TIMEOUT_MS).toBe(5000);
    });

    it('waits for readiness, then round-trips a value with the request shape', async () => {
        const { engine, workers } = makeEngine();
        const context = makeContext();
        const promise = engine.evaluate('return ctx.row.name', context);
        await flush();

        expect(workers).toHaveLength(1);
        const request = workers[0].posted[0] as TemplateWorkerRequest;
        expect(request.code).toBe('return ctx.row.name');
        expect(request.ctx).toBe(context);

        workers[0].reply({ id: request.id, ok: true, value: 'Ada' });
        await expect(promise).resolves.toBe('Ada');
        expect(workers[0].terminateCount).toBe(0);
    });

    it('resolves undefined when the source has no return', async () => {
        const { engine, workers } = makeEngine();
        const promise = engine.evaluate('const unused = 1;', makeContext());
        await flush();
        const request = workers[0].posted[0] as TemplateWorkerRequest;
        workers[0].reply({ id: request.id, ok: true, value: undefined });
        await expect(promise).resolves.toBeUndefined();
    });

    it('rejects a user-code error without resetting the worker', async () => {
        const { engine, workers } = makeEngine();
        const promise = engine.evaluate('throw new Error("boom")', makeContext());
        await flush();
        const request = workers[0].posted[0] as TemplateWorkerRequest;
        workers[0].reply({ id: request.id, ok: false, error: { kind: 'runtime', message: 'boom' } });

        const error = await catchError(promise);
        expect(error.kind).toBe('runtime');
        expect(error.message).toBe('boom');
        expect(workers).toHaveLength(1);
        expect(workers[0].terminateCount).toBe(0);
    });

    it('does not post a request until the worker is ready', async () => {
        const { engine, workers } = makeEngine({ autoReady: false, timeoutMs: 100 });
        const promise = engine.evaluate('return 1', makeContext());
        await flush();
        expect(workers[0].posted).toHaveLength(0);

        workers[0].ready();
        await flush();
        expect(workers[0].posted).toHaveLength(1);

        const request = workers[0].posted[0] as TemplateWorkerRequest;
        workers[0].reply({ id: request.id, ok: true, value: 'ok' });
        await expect(promise).resolves.toBe('ok');
    });

    it('rejects with worker when readiness times out and terminates the worker', async () => {
        const { engine, workers } = makeEngine({ autoReady: false, readyTimeoutMs: 10 });
        const error = await catchError(engine.evaluate('return 1', makeContext()));
        expect(error.kind).toBe('worker');
        expect(error.message).toContain('ready');
        expect(workers[0].terminateCount).toBe(1);
    });

    it('arms the 250 ms execution timer only after readiness', async () => {
        vi.useFakeTimers();
        try {
            const { engine, workers } = makeEngine({ autoReady: false, timeoutMs: 250 });
            const promise = engine.evaluate('return 1', makeContext());
            const settled = catchError(promise);

            // Before ready, advancing past the execution budget must not time out.
            await vi.advanceTimersByTimeAsync(300);
            expect(workers[0].posted).toHaveLength(0);

            workers[0].ready();
            await vi.advanceTimersByTimeAsync(0);
            expect(workers[0].posted).toHaveLength(1);

            // The execution timer is now armed.
            await vi.advanceTimersByTimeAsync(250);
            const error = await settled;
            expect(error.kind).toBe('timeout');
        } finally {
            vi.useRealTimers();
        }
    });

    it('rejects a pending evaluate when disposed before readiness', async () => {
        const { engine, workers } = makeEngine({ autoReady: false });
        const promise = engine.evaluate('return 1', makeContext());
        await flush();
        engine.dispose();

        const error = await catchError(promise);
        expect(error.kind).toBe('worker');
        expect(workers[0].terminateCount).toBe(1);
        expect(workers[0].posted).toHaveLength(0);
    });

    it('wraps an uncloneable context as a context error', async () => {
        const engine = createJavaScriptTemplateEngine({ createWorker: () => new CloneFailingWorker() });
        const error = await catchError(engine.evaluate('return 1', makeContext()));
        expect(error.kind).toBe('context');
    });

    it('wraps a worker-creation failure as a worker error', async () => {
        const engine = createJavaScriptTemplateEngine({
            createWorker: () => {
                throw new DOMException('blocked by CSP', 'SecurityError');
            },
        });
        const error = await catchError(engine.evaluate('return 1', makeContext()));
        expect(error.kind).toBe('worker');
    });

    it('terminates on timeout, rejects only that request as timeout, and re-spawns lazily', async () => {
        const { engine, workers } = makeEngine({ timeoutMs: 10 });
        const error = await catchError(engine.evaluate('while (true) {}', makeContext()));

        expect(error.kind).toBe('timeout');
        expect(workers).toHaveLength(1);
        expect(workers[0].terminateCount).toBe(1);

        // Reusable after reset: the next call spawns a fresh, ready worker.
        const next = engine.evaluate('return 1', makeContext());
        await flush();
        expect(workers).toHaveLength(2);
        const request = workers[1].posted[0] as TemplateWorkerRequest;
        workers[1].reply({ id: request.id, ok: true, value: 1 });
        await expect(next).resolves.toBe(1);
    });

    it('scopes a timeout to the timed-out request and fails the rest as worker', async () => {
        const { engine, workers } = makeEngine({ timeoutMs: 20 });
        const first = engine.evaluate('return 1', makeContext());
        const second = engine.evaluate('return 2', makeContext());
        await flush();
        expect(workers[0].posted).toHaveLength(2);

        const [firstError, secondError] = await Promise.all([catchError(first), catchError(second)]);
        expect(firstError.kind).toBe('timeout');
        expect(secondError.kind).toBe('worker');
    });

    it('terminates and resets on a worker error event', async () => {
        const { engine, workers } = makeEngine();
        const promise = engine.evaluate('return 1', makeContext());
        await flush();
        workers[0].fail('worker crashed');

        const error = await catchError(promise);
        expect(error.kind).toBe('worker');
        expect(workers[0].terminateCount).toBe(1);
    });

    it('terminates and resets on a messageerror event', async () => {
        const { engine, workers } = makeEngine();
        const promise = engine.evaluate('return 1', makeContext());
        await flush();
        workers[0].messageError();

        const error = await catchError(promise);
        expect(error.kind).toBe('worker');
        expect(workers[0].terminateCount).toBe(1);
    });

    it('ignores a late reply from a terminated worker', async () => {
        const { engine, workers } = makeEngine({ timeoutMs: 10 });
        const promise = engine.evaluate('return 1', makeContext());
        await flush();
        const request = workers[0].posted[0] as TemplateWorkerRequest;
        const error = await catchError(promise);
        expect(error.kind).toBe('timeout');

        expect(() => workers[0].reply({ id: request.id, ok: true, value: 'late' })).not.toThrow();
        expect(workers).toHaveLength(1);
    });

    it('rejects pending requests and refuses to respawn when disposed', async () => {
        const { engine, workers } = makeEngine();
        const promise = engine.evaluate('return 1', makeContext());
        await flush();
        engine.dispose();

        const pendingError = await catchError(promise);
        expect(pendingError.kind).toBe('worker');
        expect(workers[0].terminateCount).toBe(1);

        const afterDisposeError = await catchError(engine.evaluate('return 1', makeContext()));
        expect(afterDisposeError.kind).toBe('worker');
        expect(workers).toHaveLength(1);
    });

    it('default factory builds a module worker at ./worker.ts', () => {
        const created: Array<{ url: string; options: unknown }> = [];
        class StubWorker extends FakeWorker {
            constructor(url: URL | string, options?: unknown) {
                super();
                created.push({ url: String(url), options });
            }
        }
        vi.stubGlobal('Worker', StubWorker);

        const engine = createJavaScriptTemplateEngine({ timeoutMs: 50 });
        const promise = engine.evaluate('return 1', makeContext());
        void promise.catch(() => undefined);
        engine.dispose();

        expect(created).toHaveLength(1);
        expect(created[0].url.includes('worker.ts')).toBe(true);
        expect(created[0].options).toEqual({ type: 'module' });
    });
});
