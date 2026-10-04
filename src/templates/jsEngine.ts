/**
 * `JavaScriptTemplateEngine` — the first `TemplateEngine` implementation.
 *
 * One module Worker evaluates one source per call. On first use the engine
 * spawns a worker and waits for its `{ type: 'ready' }` handshake (bounded by
 * `READY_TIMEOUT_MS`) *before* posting a request, so the 250 ms execution budget
 * measures template execution rather than worker startup.
 *
 * Failure handling:
 * - execution timeout → reject *that* request with `timeout`, then reset the
 *   worker (any other in-flight request fails with `worker`);
 * - worker `error`/`messageerror`/readiness timeout → reset the worker, reject
 *   with `worker`;
 * - a reply carrying a user-code error (`{ ok: false }`) rejects but leaves the
 *   worker alive — the worker is still healthy, only the template failed.
 *
 * Reset is lazy: the worker is terminated and the slot cleared; the next
 * `evaluate` spawns a fresh worker and re-awaits readiness. This is simpler than
 * eager pre-warming and avoids a respawn loop when a worker script fails to load.
 *
 * **Serial-use contract:** the engine is designed for at most one in-flight
 * `evaluate` (one per row). Concurrent calls share one worker; a timeout resets
 * it and unrelated in-flight calls fail with `worker`. Call `dispose()` when the
 * job ends; `evaluate` after `dispose()` rejects.
 *
 * The default worker factory is the Vite/rolldown module-worker form. Tests
 * inject `createWorker` because happy-dom has no `Worker`.
 */

import {
    TemplateError,
    type TemplateContext,
    type TemplateEngine,
    type TemplateWorkerRequest,
    type TemplateWorkerResponse,
    type Value,
} from './engine';

/** Hard per-evaluation timeout, in ms. */
export const TIMEOUT_MS = 250;

/** Bound on the worker readiness handshake, in ms. */
export const READY_TIMEOUT_MS = 5000;

/** Minimal worker surface the engine needs. A DOM `Worker` satisfies it. */
export interface TemplateWorkerLike {
    postMessage(message: unknown): void;
    terminate(): void;
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener?(type: string, listener: (event: Event) => void): void;
}

export interface JavaScriptTemplateEngineOptions {
    /** Worker factory. Defaults to a Vite module worker pointing at `./worker.ts`. */
    createWorker?: () => TemplateWorkerLike;
    /** Override the 250 ms hard timeout. */
    timeoutMs?: number;
    /** Override the 5 s readiness bound. */
    readyTimeoutMs?: number;
}

/** A `TemplateEngine` with an explicit teardown for long-lived owners. */
export interface JavaScriptTemplateEngine extends TemplateEngine {
    dispose(): void;
}

interface PendingEvaluation {
    resolve: (value: Value) => void;
    reject: (reason: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
}

interface WorkerSlot {
    readonly worker: TemplateWorkerLike;
    readonly ready: Promise<void>;
    settleReady: () => void;
    failReady: (error: TemplateError) => void;
    readonly onMessage: (event: Event) => void;
    readonly onError: (event: Event) => void;
    readonly onMessageError: (event: Event) => void;
}

const createDefaultWorker = (): TemplateWorkerLike =>
    new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

const isWorkerResponse = (value: unknown): value is TemplateWorkerResponse => {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as { id?: unknown; ok?: unknown };
    return typeof candidate.id === 'number' && typeof candidate.ok === 'boolean';
};

const isReadyMessage = (value: unknown): boolean => typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'ready';

/** A structured-clone failure when posting the context; carries `name === 'DataCloneError'`. */
const isDataCloneError = (error: unknown): boolean =>
    typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'DataCloneError';

const toPostFailure = (error: unknown): TemplateError => {
    if (isDataCloneError(error)) {
        return new TemplateError('context', 'Template context could not be serialized.', { cause: error });
    }
    return new TemplateError('worker', error instanceof Error ? error.message : 'Template worker rejected the request.', { cause: error });
};

export const createJavaScriptTemplateEngine = (options: JavaScriptTemplateEngineOptions = {}): JavaScriptTemplateEngine => {
    const spawnWorker = options.createWorker ?? createDefaultWorker;
    const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    const readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;

    let current: WorkerSlot | null = null;
    let disposed = false;
    let nextId = 1;
    const pending = new Map<number, PendingEvaluation>();

    /** Terminate `slot`, fail its readiness, and reject everything in flight. */
    const destroySlot = (slot: WorkerSlot, error: TemplateError): void => {
        if (current !== slot) return;
        current = null;
        slot.failReady(error);
        for (const entry of pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(error);
        }
        pending.clear();
        slot.worker.removeEventListener?.('message', slot.onMessage);
        slot.worker.removeEventListener?.('error', slot.onError);
        slot.worker.removeEventListener?.('messageerror', slot.onMessageError);
        slot.worker.terminate();
    };

    const handleMessage = (slot: WorkerSlot, event: Event): void => {
        const data = (event as MessageEvent).data as unknown;
        if (isReadyMessage(data)) {
            slot.settleReady();
            return;
        }
        // Ignore replies from a worker that has already been reset/disposed.
        if (current !== slot) return;
        if (!isWorkerResponse(data)) return;
        const entry = pending.get(data.id);
        if (entry === undefined) return;
        pending.delete(data.id);
        clearTimeout(entry.timer);
        if (data.ok) {
            entry.resolve(data.value);
            return;
        }
        entry.reject(new TemplateError(data.error?.kind ?? 'runtime', data.error?.message ?? 'Template evaluation failed.'));
    };

    const handleWorkerFailure = (slot: WorkerSlot, message: string): void => {
        if (current !== slot) return;
        destroySlot(slot, new TemplateError('worker', message));
    };

    const spawnSlot = (): WorkerSlot => {
        const worker = spawnWorker();
        let settled = false;
        let resolveReady: () => void = () => undefined;
        let rejectReady: (error: TemplateError) => void = () => undefined;
        const ready = new Promise<void>((resolve, reject) => {
            resolveReady = resolve;
            rejectReady = reject;
        });
        // A slot may have no waiter yet (or be reset before anyone awaits);
        // never surface an unhandled rejection.
        ready.catch(() => undefined);
        const readyTimer = setTimeout(() => {
            if (current !== slot) return;
            destroySlot(slot, new TemplateError('worker', `Template worker did not become ready within ${readyTimeoutMs} ms.`));
        }, readyTimeoutMs);
        const slot: WorkerSlot = {
            worker,
            ready,
            settleReady: () => {
                if (settled) return;
                settled = true;
                clearTimeout(readyTimer);
                resolveReady();
            },
            failReady: (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(readyTimer);
                rejectReady(error);
            },
            onMessage: (event) => handleMessage(slot, event),
            onError: (event) => handleWorkerFailure(slot, (event as ErrorEvent).message || 'Template worker failed.'),
            onMessageError: () => handleWorkerFailure(slot, 'Template worker message could not be deserialized.'),
        };
        worker.addEventListener('message', slot.onMessage);
        worker.addEventListener('error', slot.onError);
        worker.addEventListener('messageerror', slot.onMessageError);
        return slot;
    };

    const ensureSlot = (): WorkerSlot => {
        if (current === null) {
            current = spawnSlot();
        }
        return current;
    };

    const evaluate = async (source: string, context: TemplateContext): Promise<Value> => {
        if (disposed) throw new TemplateError('worker', 'Template engine has been disposed.');
        let slot: WorkerSlot;
        try {
            slot = ensureSlot();
        } catch (error) {
            // e.g. CSP `worker-src` block, bad URL, or a `new Worker` DOMException.
            throw new TemplateError('worker', error instanceof Error ? error.message : 'Template worker could not be created.', { cause: error });
        }
        await slot.ready;
        if (disposed) throw new TemplateError('worker', 'Template engine has been disposed.');
        if (current !== slot) throw new TemplateError('worker', 'Template worker was reset before the request was sent.');
        const id = nextId;
        nextId += 1;
        return new Promise<Value>((resolve, reject) => {
            const timer = setTimeout(() => {
                const entry = pending.get(id);
                pending.delete(id);
                if (entry !== undefined) {
                    clearTimeout(entry.timer);
                    entry.reject(new TemplateError('timeout', `Template timed out after ${timeoutMs} ms.`));
                }
                // Reset the worker. Anything else in flight fails as `worker`, not
                // as a bogus per-request `timeout`.
                destroySlot(slot, new TemplateError('worker', 'Template worker was reset after a timeout.'));
            }, timeoutMs);
            pending.set(id, { resolve, reject, timer });
            try {
                slot.worker.postMessage({ id, code: source, ctx: context } satisfies TemplateWorkerRequest);
            } catch (error) {
                pending.delete(id);
                clearTimeout(timer);
                reject(toPostFailure(error));
            }
        });
    };

    const dispose = (): void => {
        disposed = true;
        if (current !== null) {
            destroySlot(current, new TemplateError('worker', 'Template engine disposed.'));
        }
    };

    return { evaluate, dispose };
};
