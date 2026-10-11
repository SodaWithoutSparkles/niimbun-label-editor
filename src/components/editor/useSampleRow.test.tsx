// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import { createMemoryAdapter } from '../../data/db';
import { createCsvRepo, type CsvRecord } from '../../data/csvRepo';
import type { TrustDecision, TrustRepo } from '../../data/trustRepo';
import type { LabelDoc, Node } from '../../core/doc/types';
import type { TemplateTrustDecision } from '../../editor/trustPrompt';
import type { TemplateContext } from '../../templates/engine';

/**
 * `useSampleRow` orchestration (P6 W6): the trust gate, engine creation, globals
 * prefetch and the csv/template override pass. The engine, the trust prompt and
 * the globals prefetch are mocked so the test exercises scheduling, not the
 * worker/network/dialog.
 */
const { engineEvaluate, createEngineMock, prefetchMock, promptMock } = vi.hoisted(() => ({
    engineEvaluate: vi.fn(async (_code: string, _ctx: TemplateContext) => 'EVALUATED' as unknown),
    createEngineMock: vi.fn(),
    prefetchMock: vi.fn(async (_specs: readonly unknown[]) => ({
        values: {} as Record<string, unknown>,
        warnings: [] as unknown[],
    })),
    promptMock: vi.fn(),
}));

vi.mock('../../templates/jsEngine', () => ({
    createJavaScriptTemplateEngine: () => createEngineMock(),
}));

vi.mock('../../templates/globals', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../templates/globals')>();
    return {
        ...actual,
        createGlobalsCache: () => ({ prefetch: prefetchMock, clear: vi.fn() }),
    };
});

vi.mock('../../editor/trustPrompt', () => ({
    promptTemplateTrust: promptMock,
}));

import { resolveKeyOf, useSampleRow, type SampleRowState } from './useSampleRow';
import { EMPTY_RESOLVED_CONTENT } from '../../editor/render/prepareContent';
import { resolve } from '../../editor/render/resolve';
import type { Mat2D } from '../../core/doc/derive';
import { trustGateFor } from '../../store/trustGate';

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

const makeDoc = (nodes: Node[]) =>
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

/** The scene graph `PreviewStage` builds synchronously from a pass's overrides. */
const resolveWith = (doc: LabelDoc, state: SampleRowState) =>
    resolve(doc, { overrides: state.overrides });

const textAt = (doc: LabelDoc, state: SampleRowState, index = 0): string =>
    (resolveWith(doc, state)[index] as { text: string }).text;

beforeEach(() => {
    engineEvaluate.mockReset();
    engineEvaluate.mockImplementation(async () => 'EVALUATED' as unknown);
    prefetchMock.mockReset();
    prefetchMock.mockImplementation(async () => ({ values: {}, warnings: [] }));
    promptMock.mockReset();
    // Default: a displaced prompt ("none") leaves the decision at `ask`.
    promptMock.mockResolvedValue('none');
    createEngineMock.mockReset();
    createEngineMock.mockImplementation(() => ({ evaluate: engineEvaluate, dispose: vi.fn() }));
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useStore.setState({ currentDoc: null, csvRepo: null, trustRepo: null, trustGate: null });
});

describe('useSampleRow — trust gating (decision 42)', () => {
    it('never gates a document with no template sources', async () => {
        const doc = makeDoc([textStaticNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo() });

        const { result } = renderHook(() => useSampleRow());

        await waitFor(() => expect(result.current.overrides).not.toBe(EMPTY_RESOLVED_CONTENT));
        expect(result.current.trust).toBe('ask');
        expect(result.current.blocked).toBe(false);
        expect(result.current.needsApproval).toBe(false);
        expect(createEngineMock).not.toHaveBeenCalled();
        expect(promptMock).not.toHaveBeenCalled();
        expect(textAt(doc, result.current)).toBe('plain');
    });

    it('executes templates when trust is always', async () => {
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo({ 'doc-1': 'always' }) });

        const { result } = renderHook(() => useSampleRow());

        await waitFor(() => expect(engineEvaluate).toHaveBeenCalled());
        expect(result.current.trust).toBe('always');
        expect(result.current.blocked).toBe(false);
        expect(result.current.needsApproval).toBe(false);
        await waitFor(() => expect(textAt(doc, result.current)).toBe('EVALUATED'));
        // The document identity reaches templates as `ctx.seeds.docSeed`.
        expect(engineEvaluate.mock.calls[0]![1].seeds).toEqual({ docSeed: 'doc-1' });
    });

    it('blocks templates and renders fallbacks when trust is never', async () => {
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo({ 'doc-1': 'never' }) });

        const { result } = renderHook(() => useSampleRow());

        await waitFor(() => expect(result.current.blocked).toBe(true));
        expect(engineEvaluate).not.toHaveBeenCalled();
        expect(result.current.needsApproval).toBe(false);
        expect(textAt(doc, result.current)).toBe('FB');
    });

    it('ask does not execute and sets needsApproval (displaced prompt)', async () => {
        promptMock.mockResolvedValue('none');
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo() });

        const { result } = renderHook(() => useSampleRow());

        await waitFor(() => expect(result.current.needsApproval).toBe(true));
        expect(result.current.trust).toBe('ask');
        expect(engineEvaluate).not.toHaveBeenCalled();
        expect(textAt(doc, result.current)).toBe('FB');
    });

    it('ask with no gate/repo does not execute and sets needsApproval', async () => {
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: null, trustGate: null });

        const { result } = renderHook(() => useSampleRow());

        await waitFor(() => expect(result.current.needsApproval).toBe(true));
        expect(engineEvaluate).not.toHaveBeenCalled();
        // No gate means no prompt is possible; the pass is fail-closed.
        expect(promptMock).not.toHaveBeenCalled();
    });

    it('ask → allowOnce executes templates for the session only', async () => {
        promptMock.mockResolvedValueOnce('allowOnce');
        const repo = makeTrustRepo();
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: repo });

        const { result } = renderHook(() => useSampleRow());

        await waitFor(() => expect(result.current.trust).toBe('always'));
        expect(result.current.needsApproval).toBe(false);
        await waitFor(() => expect(textAt(doc, result.current)).toBe('EVALUATED'));
        // Session-only: nothing persisted.
        expect(await repo.get('doc-1')).toBe('ask');
    });

    it('ask → denyOnce does not execute and renders fallbacks', async () => {
        promptMock.mockResolvedValueOnce('denyOnce');
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo() });

        const { result } = renderHook(() => useSampleRow());

        await waitFor(() => expect(result.current.trust).toBe('never'));
        expect(engineEvaluate).not.toHaveBeenCalled();
        expect(textAt(doc, result.current)).toBe('FB');
    });

    it('ask → always persists the decision and executes templates', async () => {
        promptMock.mockResolvedValueOnce('always');
        const repo = makeTrustRepo();
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: repo });

        const { result } = renderHook(() => useSampleRow());

        await waitFor(() => expect(result.current.trust).toBe('always'));
        await waitFor(() => expect(textAt(doc, result.current)).toBe('EVALUATED'));
        // The caller path actually wrote `always` through the gate.
        expect(await repo.get('doc-1')).toBe('always');
    });

    it('ask → never persists the block and renders fallbacks', async () => {
        promptMock.mockResolvedValueOnce('never');
        const repo = makeTrustRepo();
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: repo });

        const { result } = renderHook(() => useSampleRow());

        await waitFor(() => expect(result.current.trust).toBe('never'));
        expect(result.current.blocked).toBe(true);
        expect(engineEvaluate).not.toHaveBeenCalled();
        expect(textAt(doc, result.current)).toBe('FB');
        // The caller path actually wrote `never` through the gate.
        expect(await repo.get('doc-1')).toBe('never');
    });

    it('re-resolves after a Settings revoke lifts a session allow', async () => {
        const repo = makeTrustRepo();
        const gate = trustGateFor(repo)!;
        gate.allowOnce('doc-1');
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: repo, trustGate: gate });

        const { result } = renderHook(() => useSampleRow());

        await waitFor(() => expect(result.current.trust).toBe('always'));
        expect(engineEvaluate).toHaveBeenCalledTimes(1);

        engineEvaluate.mockClear();
        await gate.remove('doc-1');
        useStore.getState().bumpTrustRevision();

        await waitFor(() => expect(result.current.trust).not.toBe('always'));
        expect(result.current.needsApproval).toBe(true);
        // The revoked document must not execute again.
        expect(engineEvaluate).not.toHaveBeenCalled();
        expect(textAt(doc, result.current)).toBe('FB');
    });
});

describe('useSampleRow — csv binding + globals', () => {
    it('binds the sample row from the attached CSV', async () => {
        const adapter = createMemoryAdapter();
        const csvRepo = createCsvRepo(adapter);
        const record: CsvRecord = { id: 'csv-1', name: 'x.csv', columns: ['name'], rows: [['Ada'], ['Bob']] };
        await csvRepo.put(record);
        const doc = makeDoc([csvNode()]);
        doc.data.csv = { csvId: 'csv-1', name: 'x.csv', source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-1' } };
        doc.data.sampleRowIndex = 1;
        useStore.setState({ currentDoc: doc, csvRepo, trustRepo: makeTrustRepo() });

        const { result } = renderHook(() => useSampleRow());

        await waitFor(() => expect(result.current.rowCount).toBe(2));
        await waitFor(() => expect(textAt(doc, result.current)).toBe('Bob'));
    });

    it('prefetches document globals once per pass and surfaces warnings', async () => {
        prefetchMock.mockResolvedValueOnce({
            values: { store: 'Main' },
            warnings: [{ name: 'bad', kind: 'fetch', message: 'x', url: 'u' }],
        });
        const doc = makeDoc([textTemplateNode()]);
        doc.data.globals = [
            { kind: 'remote', name: 'store', url: 'https://x.test', extract: 'name', expiresAt: 0 },
            { kind: 'remote', name: 'bad', url: 'https://y.test', extract: 'name', expiresAt: 0 },
        ];
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo({ 'doc-1': 'always' }) });

        const { result } = renderHook(() => useSampleRow());

        await waitFor(() => expect(prefetchMock).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(result.current.globalWarnings).toHaveLength(1));
        expect(result.current.globalWarnings[0]?.name).toBe('bad');
    });

    it('records a template error against every node sharing the same code', async () => {
        engineEvaluate.mockRejectedValue(new Error('boom'));
        const doc = makeDoc([textTemplateNode('a', 'return 1'), textTemplateNode('b', 'return 1')]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo({ 'doc-1': 'always' }) });

        const { result } = renderHook(() => useSampleRow());

        await waitFor(() => expect(result.current.templateErrors.size).toBe(2));
        expect(result.current.templateErrors.get('a')).toBe('boom');
        expect(result.current.templateErrors.get('b')).toBe('boom');
    });
});

describe('useSampleRow — scheduling', () => {
    it('single-flights passes: two overlapping passes never evaluate concurrently', async () => {
        let concurrent = 0;
        let maxConcurrent = 0;
        let release!: () => void;
        const blocker = new Promise<void>((resolve) => {
            release = resolve;
        });
        engineEvaluate.mockImplementation(async () => {
            concurrent += 1;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            await blocker;
            concurrent -= 1;
            return 'EVALUATED';
        });

        const doc = makeDoc([textTemplateNode()]);
        doc.data.sampleRowIndex = 0;
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo({ 'doc-1': 'always' }) });

        const { result } = renderHook(() => useSampleRow());
        await waitFor(() => expect(engineEvaluate).toHaveBeenCalledTimes(1));

        // Trigger a second pass while the first is still inside the engine.
        const next = structuredClone(doc);
        next.data.sampleRowIndex = 1;
        useStore.setState({ currentDoc: next });

        // Give the queue a chance to (incorrectly) start the second pass.
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(maxConcurrent).toBe(1);

        release();
        await waitFor(() => expect(result.current.overrides.size).toBeGreaterThan(0));
    });

    it('resolveKeyOf ignores geometry/visibility so the async pass does not re-run', () => {
        const doc = makeDoc([textTemplateNode()]);
        const key = resolveKeyOf(doc);

        const moved = structuredClone(doc);
        moved.nodes[0]!.transform = { x: 1234, y: -56, rotDeg: 45, scaleX: 2, scaleY: 2 };
        moved.nodes[0]!.visible = false;
        moved.nodes[0]!.locked = true;

        expect(resolveKeyOf(moved)).toBe(key);
    });

    it('the sync resolve still repaints on a geometry-only change (PreviewStage path)', () => {
        const doc = makeDoc([textStaticNode()]);
        const overrides = new Map([['t2', { text: 'BOUND', placeholder: false }]]);

        const before = resolve(doc, { overrides });
        const moved = structuredClone(doc);
        moved.nodes[0]!.transform = { x: 1234, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 };
        const after = resolve(moved, { overrides });

        // Content from the override map is applied, and geometry moved — so a
        // transient edit repaints without waiting for an engine pass.
        expect((after[0] as { text: string }).text).toBe('BOUND');
        expect((after[0] as { transform: Mat2D }).transform.e).toBe(1234);
        expect((after[0] as { transform: Mat2D }).transform.e).not.toBe(
            (before[0] as { transform: Mat2D }).transform.e,
        );
    });
});

describe('useSampleRow — refresh tick (D5)', () => {
    const flushMicrotasks = async (): Promise<void> => {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
    };

    it('re-runs the resolve pass once per second for a template doc', async () => {
        vi.useFakeTimers();
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo({ 'doc-1': 'always' }) });

        renderHook(() => useSampleRow());
        await flushMicrotasks();
        expect(engineEvaluate).toHaveBeenCalledTimes(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        expect(engineEvaluate).toHaveBeenCalledTimes(2);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        expect(engineEvaluate).toHaveBeenCalledTimes(3);
    });

    it('does not tick a doc with no template sources and no remote globals', async () => {
        vi.useFakeTimers();
        const doc = makeDoc([textStaticNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo() });

        let renders = 0;
        renderHook(() => {
            renders += 1;
            return useSampleRow();
        });
        await flushMicrotasks();
        const afterMount = renders;
        expect(createEngineMock).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000);
        });
        expect(renders).toBe(afterMount);
    });

    it('does not tick a static-only globals doc', async () => {
        vi.useFakeTimers();
        const doc = makeDoc([textStaticNode()]);
        doc.data.globals = [{ kind: 'static', name: 'store', value: 'Main' }];
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo() });

        let renders = 0;
        renderHook(() => {
            renders += 1;
            return useSampleRow();
        });
        await flushMicrotasks();
        const afterMount = renders;

        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000);
        });
        expect(renders).toBe(afterMount);
    });

    it('ticks a doc whose only live source is a remote global', async () => {
        vi.useFakeTimers();
        const doc = makeDoc([textStaticNode()]);
        doc.data.globals = [
            { kind: 'remote', name: 'store', url: 'https://x.test', extract: 'name', expiresAt: 0 },
        ];
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo() });

        let renders = 0;
        renderHook(() => {
            renders += 1;
            return useSampleRow();
        });
        await flushMicrotasks();
        const afterMount = renders;

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        expect(renders).toBeGreaterThan(afterMount);
    });

    it('StrictMode double-mount leaves a single interval and no runaway queue', async () => {
        vi.useFakeTimers();
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo({ 'doc-1': 'always' }) });

        const intervalSpy = vi.spyOn(globalThis, 'setInterval');
        const clearSpy = vi.spyOn(globalThis, 'clearInterval');
        renderHook(() => useSampleRow(), { wrapper: StrictMode });
        await flushMicrotasks();

        // mount → cleanup → mount: two intervals created, one cleared.
        expect(intervalSpy.mock.calls.length - clearSpy.mock.calls.length).toBe(1);
        // The StrictMode double-invoked first pass bails; only one evaluation.
        expect(engineEvaluate).toHaveBeenCalledTimes(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        // A single interval re-enqueues exactly one pass.
        expect(engineEvaluate).toHaveBeenCalledTimes(2);

        intervalSpy.mockRestore();
        clearSpy.mockRestore();
    });

    it('a superseded queued tick pass bails before touching the engine', async () => {
        vi.useFakeTimers();
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo({ 'doc-1': 'always' }) });

        renderHook(() => useSampleRow());
        await flushMicrotasks();
        // The first pass resolves trust to `always`, which is what arms the tick.
        expect(engineEvaluate).toHaveBeenCalledTimes(1);

        // Now block the engine so a tick pass stays in flight while later ticks
        // queue behind it.
        let concurrent = 0;
        let maxConcurrent = 0;
        let release!: () => void;
        const blocker = new Promise<void>((resolve) => {
            release = resolve;
        });
        engineEvaluate.mockImplementation(async () => {
            concurrent += 1;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            await blocker;
            concurrent -= 1;
            return 'EVALUATED';
        });

        // Three ticks: the first starts the blocked pass, the next two queue; the
        // last supersedes the middle queued pass.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });

        release();
        await flushMicrotasks();

        // Baseline pass + latest pass only; the superseded middle pass bailed.
        expect(engineEvaluate).toHaveBeenCalledTimes(3);
        expect(maxConcurrent).toBe(1);
    });

    it('does not tick a template doc awaiting approval (ask)', async () => {
        vi.useFakeTimers();
        promptMock.mockResolvedValue('none');
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo() });

        renderHook(() => useSampleRow());
        await flushMicrotasks();

        expect(promptMock).toHaveBeenCalledTimes(1);
        expect(engineEvaluate).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000);
        });

        // Unapproved templates have nothing to refresh: no re-prompt, no pass.
        expect(promptMock).toHaveBeenCalledTimes(1);
        expect(engineEvaluate).not.toHaveBeenCalled();
    });

    it('does not queue further passes while a trust prompt is pending', async () => {
        vi.useFakeTimers();
        let resolvePrompt!: (decision: TemplateTrustDecision) => void;
        promptMock.mockImplementation(
            () =>
                new Promise<TemplateTrustDecision>((resolve) => {
                    resolvePrompt = resolve;
                }),
        );
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo() });

        renderHook(() => useSampleRow());
        await flushMicrotasks();
        expect(promptMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000);
        });

        // The tick is gated while the prompt sits open: it cannot re-prompt or
        // pile up queued passes behind the await.
        expect(promptMock).toHaveBeenCalledTimes(1);
        expect(engineEvaluate).not.toHaveBeenCalled();

        await act(async () => {
            resolvePrompt('denyOnce');
            await vi.advanceTimersByTimeAsync(0);
        });
    });

    it('stays off after the prompt resolves to a session deny', async () => {
        vi.useFakeTimers();
        promptMock.mockResolvedValueOnce('denyOnce');
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo() });

        const { result } = renderHook(() => useSampleRow());
        await flushMicrotasks();
        expect(result.current.trust).toBe('never');

        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });

        expect(promptMock).toHaveBeenCalledTimes(1);
        expect(engineEvaluate).not.toHaveBeenCalled();
    });

    it('resumes ticking after approval', async () => {
        vi.useFakeTimers();
        promptMock.mockResolvedValueOnce('always');
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo() });

        renderHook(() => useSampleRow());
        await flushMicrotasks();
        expect(engineEvaluate).toHaveBeenCalledTimes(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        expect(engineEvaluate).toHaveBeenCalledTimes(2);
    });

    it('does not tick a doc with template sources and remote globals while trust is unresolved', async () => {
        vi.useFakeTimers();
        promptMock.mockResolvedValue('none');
        const doc = makeDoc([textTemplateNode()]);
        doc.data.globals = [
            { kind: 'remote', name: 'store', url: 'https://x.test', extract: 'name', expiresAt: 0 },
        ];
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo() });

        renderHook(() => useSampleRow());
        await flushMicrotasks();

        expect(promptMock).toHaveBeenCalledTimes(1);
        expect(engineEvaluate).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000);
        });

        // Template trust is unresolved (`ask`): remote globals must not arm the
        // tick for a template-bearing doc, so it is never re-prompted and no
        // extra pass is enqueued.
        expect(promptMock).toHaveBeenCalledTimes(1);
        expect(engineEvaluate).not.toHaveBeenCalled();
    });

    it('a rejected trust prompt clears promptPending and does not wedge ticking', async () => {
        vi.useFakeTimers();
        promptMock.mockRejectedValueOnce(new Error('prompt blew up'));
        const repo = makeTrustRepo();
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: repo });

        renderHook(() => useSampleRow());
        await flushMicrotasks();

        // The prompt rejected before any execution; the pass caught it, failed
        // closed and committed `ask`.
        expect(promptMock).toHaveBeenCalledTimes(1);
        expect(engineEvaluate).not.toHaveBeenCalled();

        // Resolve trust to `always` and request a fresh pass, as Settings would.
        await repo.set('doc-1', 'always');
        await act(async () => {
            useStore.getState().bumpTrustRevision();
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(engineEvaluate).toHaveBeenCalledTimes(1);

        // A rejection must not leave `promptPending` stuck true: the now-approved
        // doc's tick still re-enqueues a pass.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        expect(engineEvaluate).toHaveBeenCalledTimes(2);
    });

    it('a rejected prompt commits ask (not stale always) and does not re-prompt', async () => {
        vi.useFakeTimers();
        const repo = makeTrustRepo({ 'doc-1': 'always' });
        const gate = trustGateFor(repo)!;
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: repo, trustGate: gate });

        const { result } = renderHook(() => useSampleRow());
        await flushMicrotasks();
        expect(result.current.trust).toBe('always');
        engineEvaluate.mockClear();

        // Settings revoke: the next pass resolves `ask`, opens a prompt, and that
        // prompt rejects.
        promptMock.mockRejectedValueOnce(new Error('prompt blew up'));
        await gate.remove('doc-1');
        await act(async () => {
            useStore.getState().bumpTrustRevision();
            await vi.advanceTimersByTimeAsync(0);
        });

        // The rejection is caught, the pass continues and commits the real
        // decision (`ask`) instead of leaving the stale `always`.
        expect(promptMock).toHaveBeenCalledTimes(1);
        expect(result.current.trust).toBe('ask');
        expect(result.current.needsApproval).toBe(true);
        expect(engineEvaluate).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000);
        });
        // `ask` does not tick: no unbounded re-prompt loop.
        expect(promptMock).toHaveBeenCalledTimes(1);
    });

    it('does not re-enqueue a pass in the window between a settled prompt and its commit', async () => {
        vi.useFakeTimers();
        const repo = makeTrustRepo({ 'doc-1': 'always' });
        const gate = trustGateFor(repo)!;

        // Delay the pass's *post-prompt* trust re-resolve so there is a real
        // window between the prompt settling (`promptPending` false) and the pass
        // committing the revoked decision — the window the stale `state.trust`
        // used to wrongly arm a tick in.
        let delayNextGet = false;
        let releaseGet!: () => void;
        const baseGet = repo.get;
        repo.get = async (id) => {
            if (delayNextGet) {
                delayNextGet = false;
                await new Promise<void>((resolve) => {
                    releaseGet = resolve;
                });
            }
            return baseGet(id);
        };

        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: repo, trustGate: gate });

        const { result } = renderHook(() => useSampleRow());
        await flushMicrotasks();
        expect(result.current.trust).toBe('always');
        engineEvaluate.mockClear();

        // Settings revoke: the next pass resolves `ask` and opens a prompt we hold
        // open.
        let resolvePrompt!: (decision: TemplateTrustDecision) => void;
        promptMock.mockImplementation(
            () =>
                new Promise<TemplateTrustDecision>((resolve) => {
                    resolvePrompt = resolve;
                }),
        );
        await gate.remove('doc-1');
        await act(async () => {
            useStore.getState().bumpTrustRevision();
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(promptMock).toHaveBeenCalledTimes(1);

        // The prompt settles with `none` (stays `ask`) and the pass's re-resolve is
        // held on a delayed promise: `state.trust` is still the stale `always` from
        // the previous commit while `promptPending` is now false.
        delayNextGet = true;
        await act(async () => {
            resolvePrompt('none');
            await vi.advanceTimersByTimeAsync(0);
        });

        // Several tick intervals pass with the commit still pending. The tick must
        // stay off (the synchronously-updated ref already reads `ask`), so no extra
        // pass is enqueued and the prompt is not re-opened.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2000);
        });
        expect(promptMock).toHaveBeenCalledTimes(1);
        expect(engineEvaluate).not.toHaveBeenCalled();

        // Let the re-resolve settle: the pass commits `ask` with no prompting.
        await act(async () => {
            releaseGet();
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(result.current.trust).toBe('ask');
        expect(result.current.needsApproval).toBe(true);
        expect(promptMock).toHaveBeenCalledTimes(1);
    });

    it('a doc switch does not clear promptPending while the old prompt is open', async () => {
        vi.useFakeTimers();
        let resolvePrompt!: (decision: TemplateTrustDecision) => void;
        promptMock.mockImplementation(
            () =>
                new Promise<TemplateTrustDecision>((resolve) => {
                    resolvePrompt = resolve;
                }),
        );
        const docA = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: docA, trustRepo: makeTrustRepo() });

        let renders = 0;
        renderHook(() => {
            renders += 1;
            return useSampleRow();
        });
        await flushMicrotasks();
        // Doc A's prompt is open and unresolved.
        expect(promptMock).toHaveBeenCalledTimes(1);

        // Switch to a doc with no template sources but a remote global, whose tick
        // would otherwise arm and pile passes behind the still-blocked old pass.
        const docB = createLabelDoc({
            id: 'doc-2',
            now: 1_700_000_000,
            backingW: 3000,
            backingH: 2000,
            nodes: [textStaticNode()],
        });
        docB.data.globals = [
            { kind: 'remote', name: 'store', url: 'https://x.test', extract: 'name', expiresAt: 0 },
        ];
        useStore.setState({ currentDoc: docB });
        await flushMicrotasks();
        const afterSwitch = renders;

        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000);
        });

        // `promptPending` stays true until doc A's prompt resolves, so no tick
        // fires and no further pass is enqueued.
        expect(renders).toBe(afterSwitch);
        expect(promptMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolvePrompt('denyOnce');
            await vi.advanceTimersByTimeAsync(0);
        });
    });
});

describe('trustGateFor', () => {
    it('returns one gate (and session overlay) per repo', () => {
        const repo = makeTrustRepo();
        const a = trustGateFor(repo);
        const b = trustGateFor(repo);
        expect(a).toBe(b);
        expect(trustGateFor(null)).toBeNull();
    });

    it('records a session allow from allowOnce', async () => {
        const gate = trustGateFor(makeTrustRepo())!;
        gate.allowOnce('doc-1');
        expect(await gate.resolve('doc-1')).toBe('always');
    });
});
