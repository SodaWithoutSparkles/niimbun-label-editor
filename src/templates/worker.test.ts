// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createTemplateContext, type TemplateContext, type TemplateWorkerOutbound } from './engine';
import { evaluateSource, installTemplateWorker, type TemplateWorkerScope } from './worker';

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

class FakeScope implements TemplateWorkerScope {
    readonly posted: TemplateWorkerOutbound[] = [];
    private readonly listeners = new Set<(event: MessageEvent) => void>();

    postMessage(message: TemplateWorkerOutbound): void {
        this.posted.push(message);
    }

    addEventListener(type: 'message', listener: (event: MessageEvent) => void): void {
        if (type === 'message') {
            this.listeners.add(listener);
        }
    }

    send(data: unknown): void {
        for (const listener of this.listeners) {
            listener(new MessageEvent('message', { data }));
        }
    }
}

describe('evaluateSource (authoring convention)', () => {
    it('resolves the value returned by the source', async () => {
        await expect(evaluateSource('return ctx.row.name', makeContext())).resolves.toEqual({ ok: true, value: 'Ada' });
    });

    it('resolves undefined when the source has no return', async () => {
        await expect(evaluateSource('const unused = 1;', makeContext())).resolves.toEqual({ ok: true, value: undefined });
    });

    it('awaits a returned promise', async () => {
        await expect(evaluateSource('return Promise.resolve(42)', makeContext())).resolves.toEqual({ ok: true, value: 42 });
    });

    it('runs the body in strict mode', async () => {
        const result = await evaluateSource('undeclaredName = 1; return undeclaredName', makeContext());
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.kind).toBe('runtime');
        expect(result.error.message).toMatch(/not defined/);
    });

    it('classifies a genuine compile error as syntax', async () => {
        const result = await evaluateSource('return (((', makeContext());
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.kind).toBe('syntax');
    });

    it('rejects a stray brace as a syntax error (no wrapper breakout)', async () => {
        const result = await evaluateSource('} return 1;', makeContext());
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.kind).toBe('syntax');
    });

    it('classifies a runtime SyntaxError (JSON.parse) as runtime, not syntax', async () => {
        const result = await evaluateSource("return JSON.parse('{')", makeContext());
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.kind).toBe('runtime');
    });

    it('classifies generic runtime errors as runtime', async () => {
        const result = await evaluateSource('throw new Error("boom")', makeContext());
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.kind).toBe('runtime');
        expect(result.error.message).toBe('boom');
    });

    it('rejects context mutation through the frozen Proxy', async () => {
        const result = await evaluateSource('ctx.row.name = "Grace"; return ctx.row.name', makeContext());
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.kind).toBe('runtime');
        expect(result.error.message).toContain('read-only');
    });
});

describe('installTemplateWorker', () => {
    it('announces ready and round-trips one request end-to-end', async () => {
        const scope = new FakeScope();
        installTemplateWorker(scope);
        expect(scope.posted[0]).toEqual({ type: 'ready' });

        scope.send({ id: 7, code: 'return ctx.row.name', ctx: makeContext() });
        await flush();

        expect(scope.posted).toEqual([
            { type: 'ready' },
            { id: 7, ok: true, value: 'Ada' },
        ]);
    });

    it('ignores a malformed payload', async () => {
        const scope = new FakeScope();
        installTemplateWorker(scope);
        scope.send({ nope: true });
        await flush();
        expect(scope.posted).toEqual([{ type: 'ready' }]);
    });
});

describe('createTemplateContext', () => {
    it('defaults rowCount to total and label/globals to empty, preserving host now', () => {
        const context = createTemplateContext({ index: 2, total: 5, row: { name: 'Ada' }, now: 123 });
        expect(context).toEqual({
            index: 2,
            total: 5,
            row: { name: 'Ada' },
            rowCount: 5,
            now: 123,
            label: {},
            globals: {},
            seeds: { docSeed: '' },
        });
    });

    it('keeps an explicit rowCount and optional fmt', () => {
        const fmt = { locale: 'en-US' };
        const context = createTemplateContext({ index: 0, total: 1, row: {}, rowCount: 9, now: 1, fmt });
        expect(context.rowCount).toBe(9);
        expect(context.fmt).toBe(fmt);
    });
});
