// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import { createMemoryAdapter } from '../../data/db';
import { createCsvRepo, type CsvRecord } from '../../data/csvRepo';
import type { TrustDecision, TrustRepo } from '../../data/trustRepo';
import type { TrustGate } from '../../core/trust';
import type { LabelDoc, Node } from '../../core/doc/types';

/**
 * `usePrintJob` (P7 W5): the trust-gated, non-React content prep the dialog
 * consumes. The engine, the trust prompt and the globals cache are mocked so the
 * test exercises scheduling/dec-42 behaviour, not the worker/dialog/network.
 */
const {
    engineEvaluate,
    engineDispose,
    createEngineMock,
    createGlobalsCacheMock,
    prefetchMock,
    globalsClearMock,
    promptMock,
} = vi.hoisted(() => ({
    engineEvaluate: vi.fn(async () => 'EVALUATED' as unknown),
    engineDispose: vi.fn(),
    createEngineMock: vi.fn(),
    createGlobalsCacheMock: vi.fn(),
    prefetchMock: vi.fn(async () => ({ values: {} as Record<string, unknown>, warnings: [] as unknown[] })),
    globalsClearMock: vi.fn(),
    promptMock: vi.fn(),
}));

vi.mock('../../templates/jsEngine', () => ({
    createJavaScriptTemplateEngine: () => createEngineMock(),
}));

vi.mock('../../templates/globals', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../templates/globals')>();
    return {
        ...actual,
        createGlobalsCache: () => createGlobalsCacheMock(),
    };
});

vi.mock('../../editor/trustPrompt', () => ({
    promptTemplateTrust: promptMock,
}));

import { usePrintJob } from './usePrintJob';
import { resolve, type ResolveContext } from '../../editor/render';

const textTemplateNode = (id = 't1', code = 'return "hi"'): Node => ({
    id,
    parentId: null,
    type: 'text',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    text: { kind: 'template', code, fallback: 'FB' },
});

const textStaticNode = (): Node => ({
    id: 't2',
    parentId: null,
    type: 'text',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    text: { kind: 'static', value: 'plain' },
});

const csvNode = (): Node => ({
    id: 't3',
    parentId: null,
    type: 'text',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    text: { kind: 'csv', column: 'name', fallback: 'FB' },
});

const makeDoc = (nodes: Node[]): LabelDoc =>
    createLabelDoc({ id: 'doc-1', now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes });

const makeTrustRepo = (initial: Record<string, TrustDecision> = {}): TrustRepo => {
    const map = new Map(Object.entries(initial));
    return {
        get: async (id) => map.get(id) ?? 'ask',
        set: async (id, decision) => {
            if (decision === 'ask') map.delete(id);
            else map.set(id, decision);
        },
        list: async () => [...map.entries()].map(([docId, decision]) => ({ docId, decision })),
        remove: async (id) => {
            map.delete(id);
        },
        clear: async () => map.clear(),
        copy: async (sourceId, newId) => {
            const source = map.get(sourceId);
            if (source && source !== 'ask') map.set(newId, source);
        },
    };
};

const textAt = (doc: LabelDoc, ctx: ResolveContext, index = 0): string =>
    (resolve(doc, ctx)[index] as { text: string }).text;

beforeEach(() => {
    engineEvaluate.mockReset();
    engineEvaluate.mockImplementation(async () => 'EVALUATED' as unknown);
    engineDispose.mockReset();
    createEngineMock.mockReset();
    createEngineMock.mockImplementation(() => ({ evaluate: engineEvaluate, dispose: engineDispose }));
    globalsClearMock.mockReset();
    createGlobalsCacheMock.mockReset();
    createGlobalsCacheMock.mockImplementation(() => ({ prefetch: prefetchMock, clear: globalsClearMock }));
    prefetchMock.mockReset();
    prefetchMock.mockImplementation(async () => ({ values: {}, warnings: [] }));
    promptMock.mockReset();
    // Default: a displaced prompt ("none") leaves the decision at `ask`.
    promptMock.mockResolvedValue('none');
});

afterEach(() => {
    cleanup();
    useStore.setState({ currentDoc: null, csvRepo: null, trustRepo: null, trustGate: null });
});

describe('usePrintJob — decision 42 (plain documents)', () => {
    it('never touches the gate or the engine for a document with no template sources', async () => {
        const resolveSpy = vi.fn(async () => 'ask' as TrustDecision);
        const gate: TrustGate = {
            resolve: resolveSpy,
            allowOnce: vi.fn(),
            denyOnce: vi.fn(),
            always: vi.fn(async () => undefined),
            never: vi.fn(async () => undefined),
            remove: vi.fn(async () => undefined),
            clear: vi.fn(async () => undefined),
            clearSession: vi.fn(),
            sessionEntries: () => [],
        };
        const doc = makeDoc([textStaticNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: null, trustGate: gate });

        const { result } = renderHook(() => usePrintJob({ open: true }));
        const ctx = await result.current.prepareRow(0);

        expect(resolveSpy).not.toHaveBeenCalled();
        expect(createEngineMock).not.toHaveBeenCalled();
        expect(promptMock).not.toHaveBeenCalled();
        expect(textAt(doc, ctx)).toBe('plain');
    });
});

describe('usePrintJob — template trust', () => {
    it('executes templates when trust is always', async () => {
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo({ 'doc-1': 'always' }), trustGate: null });

        const { result } = renderHook(() => usePrintJob({ open: true }));
        const ctx = await result.current.prepareRow(0);

        expect(engineEvaluate).toHaveBeenCalledTimes(1);
        expect(textAt(doc, ctx)).toBe('EVALUATED');
    });

    it('renders fallbacks without executing when trust is never', async () => {
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo({ 'doc-1': 'never' }), trustGate: null });

        const { result } = renderHook(() => usePrintJob({ open: true }));
        const ctx = await result.current.prepareRow(0);

        expect(engineEvaluate).not.toHaveBeenCalled();
        expect(promptMock).not.toHaveBeenCalled();
        expect(textAt(doc, ctx)).toBe('FB');
    });

    it('renders fallbacks and does not execute when trust stays ask (displaced prompt)', async () => {
        promptMock.mockResolvedValue('none');
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo(), trustGate: null });

        const { result } = renderHook(() => usePrintJob({ open: true }));
        const ctx = await result.current.prepareRow(0);

        expect(engineEvaluate).not.toHaveBeenCalled();
        expect(textAt(doc, ctx)).toBe('FB');
    });

    it('prompts at most once per dialog session across pages', async () => {
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo(), trustGate: null });

        const { result } = renderHook(() => usePrintJob({ open: true }));
        await result.current.prepareRow(0);
        await result.current.prepareRow(1);
        await result.current.prepareRow(2);

        expect(promptMock).toHaveBeenCalledTimes(1);
        expect(createGlobalsCacheMock).toHaveBeenCalledTimes(1);
    });

    it('disposes the engine and globals cache when the dialog closes', async () => {
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo({ 'doc-1': 'always' }), trustGate: null });

        const { result, rerender } = renderHook(({ open }) => usePrintJob({ open }), {
            initialProps: { open: true },
        });
        await result.current.prepareRow(0);
        expect(engineDispose).not.toHaveBeenCalled();

        rerender({ open: false });

        await waitFor(() => expect(engineDispose).toHaveBeenCalledTimes(1));
        expect(globalsClearMock).toHaveBeenCalledTimes(1);
    });
});

describe('usePrintJob — serial-use engine (single-flight)', () => {
    it('serializes overlapping prepareRow calls so two evaluates never overlap', async () => {
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo({ 'doc-1': 'always' }), trustGate: null });

        let active = 0;
        let maxActive = 0;
        engineEvaluate.mockImplementation(async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 15));
            active -= 1;
            return 'EVALUATED' as unknown;
        });

        const { result } = renderHook(() => usePrintJob({ open: true }));
        const [first, second] = await Promise.all([
            result.current.prepareRow(0),
            result.current.prepareRow(1),
        ]);

        // Both passes run and resolve, but the engine is never re-entered.
        expect(engineEvaluate).toHaveBeenCalledTimes(2);
        expect(maxActive).toBe(1);
        expect(textAt(doc, first)).toBe('EVALUATED');
        expect(textAt(doc, second)).toBe('EVALUATED');
    });
});

describe('usePrintJob — closed dialog is inert', () => {
    const makeGate = (resolveSpy: ReturnType<typeof vi.fn>): TrustGate => ({
        resolve: resolveSpy as unknown as TrustGate['resolve'],
        allowOnce: vi.fn(),
        denyOnce: vi.fn(),
        always: vi.fn(async () => undefined),
        never: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
        clear: vi.fn(async () => undefined),
        clearSession: vi.fn(),
        sessionEntries: () => [],
    });

    it('does not touch the gate, engine, prompt or globals cache while closed', async () => {
        const resolveSpy = vi.fn(async () => 'always' as TrustDecision);
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: null, trustGate: makeGate(resolveSpy) });

        const { result } = renderHook(() => usePrintJob({ open: false }));
        const ctx = await result.current.prepareRow(0);

        expect(ctx).toEqual({});
        expect(resolveSpy).not.toHaveBeenCalled();
        expect(createEngineMock).not.toHaveBeenCalled();
        expect(promptMock).not.toHaveBeenCalled();
        expect(createGlobalsCacheMock).not.toHaveBeenCalled();
    });

    it('stays inert after close and cannot resurrect the session', async () => {
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo({ 'doc-1': 'always' }), trustGate: null });

        const { result, rerender } = renderHook(({ open }) => usePrintJob({ open }), {
            initialProps: { open: true },
        });
        await result.current.prepareRow(0);
        expect(createEngineMock).toHaveBeenCalledTimes(1);

        rerender({ open: false });
        await waitFor(() => expect(engineDispose).toHaveBeenCalledTimes(1));

        createEngineMock.mockClear();
        createGlobalsCacheMock.mockClear();
        promptMock.mockClear();

        const ctx = await result.current.prepareRow(0);
        expect(ctx).toEqual({});
        expect(createEngineMock).not.toHaveBeenCalled();
        expect(createGlobalsCacheMock).not.toHaveBeenCalled();
        expect(promptMock).not.toHaveBeenCalled();
    });
});

describe('usePrintJob — csv', () => {
    it('binds the attached CSV and is null-safe when the read fails', async () => {
        const adapter = createMemoryAdapter();
        const csvRepo = createCsvRepo(adapter);
        await csvRepo.put({ id: 'csv-1', name: 'x.csv', columns: ['name'], rows: [['Ada']] });

        const doc = makeDoc([csvNode()]);
        doc.data.csv = {
            csvId: 'csv-1',
            name: 'x.csv',
            source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-1' },
        };
        useStore.setState({ currentDoc: doc, csvRepo, trustRepo: makeTrustRepo() });

        const { result } = renderHook(() => usePrintJob({ open: true }));
        await waitFor(() => expect(result.current.csv).not.toBeNull());
        const ctx = await result.current.prepareRow(0);
        expect(textAt(doc, ctx)).toBe('Ada');
    });

    it('degrades to null (no throw) when the repo read rejects', async () => {
        const doc = makeDoc([csvNode()]);
        doc.data.csv = {
            csvId: 'missing',
            name: 'x.csv',
            source: { kind: 'local', mediaType: 'text/csv', resourceId: 'missing' },
        };
        const repo = {
            get: async (): Promise<CsvRecord | null> => {
                throw new Error('idb down');
            },
        };
        useStore.setState({ currentDoc: doc, csvRepo: repo as never, trustRepo: makeTrustRepo() });

        const { result } = renderHook(() => usePrintJob({ open: true }));
        await waitFor(() => expect(result.current.csv).toBeNull());
        const ctx = await result.current.prepareRow(0);
        expect(textAt(doc, ctx)).toBe('FB');
    });

    it('reads the CSV once per document across rerenders', async () => {
        const adapter = createMemoryAdapter();
        const csvRepo = createCsvRepo(adapter);
        await csvRepo.put({ id: 'csv-1', name: 'x.csv', columns: ['name'], rows: [['Ada']] });
        const getSpy = vi.spyOn(csvRepo, 'get');

        const doc = makeDoc([csvNode()]);
        doc.data.csv = {
            csvId: 'csv-1',
            name: 'x.csv',
            source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-1' },
        };
        useStore.setState({ currentDoc: doc, csvRepo, trustRepo: makeTrustRepo() });

        const { result, rerender } = renderHook(() => usePrintJob({ open: true }));
        await waitFor(() => expect(result.current.csv).not.toBeNull());
        rerender();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(getSpy).toHaveBeenCalledTimes(1);
    });
});
