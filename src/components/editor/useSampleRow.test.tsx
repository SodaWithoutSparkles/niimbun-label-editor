// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import { createMemoryAdapter } from '../../data/db';
import { createCsvRepo, type CsvRecord } from '../../data/csvRepo';
import type { TrustDecision, TrustRepo } from '../../data/trustRepo';
import type { LabelDoc, Node } from '../../core/doc/types';

/**
 * `useSampleRow` orchestration (P6 W6): the trust gate, engine creation, globals
 * prefetch and the csv/template override pass. The engine, the trust prompt and
 * the globals prefetch are mocked so the test exercises scheduling, not the
 * worker/network/dialog.
 */
const { engineEvaluate, createEngineMock, prefetchMock, promptMock } = vi.hoisted(() => ({
    engineEvaluate: vi.fn(async () => 'EVALUATED' as unknown),
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

    it('ask → session allow executes templates', async () => {
        promptMock.mockResolvedValueOnce('allow');
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo() });

        const { result } = renderHook(() => useSampleRow());

        await waitFor(() => expect(result.current.trust).toBe('always'));
        expect(result.current.needsApproval).toBe(false);
        await waitFor(() => expect(textAt(doc, result.current)).toBe('EVALUATED'));
    });

    it('ask → session deny does not execute and renders fallbacks', async () => {
        promptMock.mockResolvedValueOnce('deny');
        const doc = makeDoc([textTemplateNode()]);
        useStore.setState({ currentDoc: doc, trustRepo: makeTrustRepo() });

        const { result } = renderHook(() => useSampleRow());

        await waitFor(() => expect(result.current.trust).toBe('never'));
        expect(engineEvaluate).not.toHaveBeenCalled();
        expect(textAt(doc, result.current)).toBe('FB');
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
            { name: 'store', url: 'https://x.test', extract: 'name', expiresAt: 0 },
            { name: 'bad', url: 'https://y.test', extract: 'name', expiresAt: 0 },
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
