/**
 * Module Worker entry for the JavaScript template engine.
 *
 * Protocol: host posts `{ id, code, ctx }`; this worker compiles `code`, wraps
 * the frozen context in a throwing Proxy, awaits the result, and posts
 * `{ id, ok: true, value }` or `{ id, ok: false, error }`. Once the listener is
 * installed it posts `{ type: 'ready' }` so the host can start its execution
 * timer only after the worker is live.
 *
 * Authoring convention: `code` is JavaScript statement(s) forming the body of a
 * function — the worker compiles `new Function('ctx', code)` in strict mode and
 * awaits the returned value. A source with no `return` resolves to `undefined`.
 *
 * Hardening: see `hardenGlobal`. It is cosmetic, not a sandbox. A module worker
 * cannot block dynamic `import()`, so plan.md:242's "no dynamic import()" is a
 * goal, not an enforced invariant — recorded here as a known limitation.
 *
 * The module is import-safe outside a worker (the listener + hardening install
 * only when there is no `document`, i.e. a real worker scope), so
 * `evaluateSource` and `installTemplateWorker` can be unit-tested in-process.
 */

import { createFrozenContext } from './freeze';
import type { TemplateContext, TemplateWorkerError, TemplateWorkerOutbound, TemplateWorkerRequest, TemplateWorkerResponse } from './engine';

/** Minimal surface the worker entry needs from its global scope. */
export interface TemplateWorkerScope {
    postMessage(message: TemplateWorkerOutbound): void;
    addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

/** Result of running one template source. Discriminated on `ok`. */
export type TemplateEvaluation = { ok: true; value: unknown } | { ok: false; error: TemplateWorkerError };

const scope = self as unknown as TemplateWorkerScope;

const BLOCKED_GLOBALS: readonly string[] = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts'];

/**
 * Best-effort removal of the obvious browser egress names before user code runs.
 *
 * This is cosmetic, not a sandbox: `self.constructor.prototype.fetch`,
 * `(function(){}).constructor('return fetch')()`, and dynamic `import()` all
 * recover egress, and `Reflect.set(..., undefined)` only shadows a name. The
 * real controls are CSP (`worker-src` / `connect-src`) plus the trusted-user-code
 * threat model (owner decision 3). Do not extend this into a real sandbox.
 */
const hardenGlobal = (): void => {
    for (const name of BLOCKED_GLOBALS) {
        try {
            Reflect.deleteProperty(globalThis, name);
        } catch {
            // Non-configurable; fall through to shadowing.
        }
        try {
            Reflect.set(globalThis, name, undefined);
        } catch {
            // Read-only; nothing more we can do best-effort.
        }
    }
};

const toMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Compile the source as the function body directly. `"use strict"` is a
 * directive prologue (not a brace-wrapped arrow), so strict mode applies and a
 * stray `}` in the source is a syntax error rather than an escape from the
 * wrapper. The body's `return` (or its absence → `undefined`) is unchanged.
 */
const compile = (code: string): ((context: TemplateContext) => unknown) =>
    new Function('ctx', `"use strict";\n${code}`) as (context: TemplateContext) => unknown;

/**
 * Compile and run one source against a frozen context. Never throws — failures
 * are classified and returned so the caller can post them. Compile and run are
 * separate try/catch blocks so a `SyntaxError` raised by user code at run time
 * is classified as `runtime`, not `syntax`.
 */
export const evaluateSource = async (code: string, ctx: TemplateContext): Promise<TemplateEvaluation> => {
    let fn: (context: TemplateContext) => unknown;
    try {
        fn = compile(code);
    } catch (error) {
        return { ok: false, error: { kind: 'syntax', message: toMessage(error) } };
    }
    try {
        const frozen = createFrozenContext(ctx);
        const value = await fn(frozen);
        return { ok: true, value };
    } catch (error) {
        return { ok: false, error: { kind: 'runtime', message: toMessage(error) } };
    }
};

const toCloneFailure = (error: unknown): TemplateWorkerError =>
    error instanceof DOMException && error.name === 'DataCloneError'
        ? { kind: 'runtime', message: 'Template result could not be serialized.' }
        : { kind: 'runtime', message: toMessage(error) };

const send = (target: TemplateWorkerScope, response: TemplateWorkerResponse): void => {
    try {
        target.postMessage(response);
    } catch (error) {
        // The message itself failed to clone (e.g. the template returned a
        // function or other uncloneable value). The error payload is plain data,
        // so it always serializes.
        target.postMessage({ id: response.id, ok: false, error: toCloneFailure(error) });
    }
};

const handle = async (target: TemplateWorkerScope, request: TemplateWorkerRequest): Promise<void> => {
    const result = await evaluateSource(request.code, request.ctx);
    send(target, { id: request.id, ...result });
};

const isRequest = (value: unknown): value is TemplateWorkerRequest => {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as { id?: unknown; code?: unknown; ctx?: unknown };
    return typeof candidate.id === 'number' && typeof candidate.code === 'string' && typeof candidate.ctx === 'object' && candidate.ctx !== null;
};

/**
 * Install the message listener on `target` and announce readiness. Exported so a
 * test can drive one request end-to-end through a fake scope (happy-dom has no
 * worker global).
 */
export const installTemplateWorker = (target: TemplateWorkerScope): void => {
    target.addEventListener('message', (event: MessageEvent) => {
        const data = event.data as unknown;
        if (!isRequest(data)) {
            // Unknown payload: nothing to attribute it to, so ignore.
            return;
        }
        void handle(target, data);
    });
    target.postMessage({ type: 'ready' });
};

// A dedicated worker has no `document`; guarding on that keeps the module inert
// when imported by tests while still installing the listener in production.
if (typeof (self as { document?: unknown }).document === 'undefined') {
    hardenGlobal();
    installTemplateWorker(scope);
}
