// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import { createMemoryAdapter } from '../../data/db';
import { createCsvRepo } from '../../data/csvRepo';
import type { TrustDecision } from '../../data/trustRepo';
import type { TrustGate } from '../../core/trust';
import type { Node } from '../../core/doc/types';

/**
 * `EditorShell` print-dialog mount gate (P7 W5, decision 42).
 *
 * The dialog must be mounted **only while open**: a closed dialog is fully
 * inert — no gate resolve, no template engine, no `prepareRow`/thumbnail
 * prefetch, no trust prompt. Previously it was mounted whenever a doc existed,
 * so its thumbnail prefetch could run `prepareRow` (and prompt) with the dialog
 * closed. Heavy editor children are stubbed so the test isolates the print seam.
 */

const { engineEvaluate, engineDispose, createEngineMock, refreshInfoMock } = vi.hoisted(() => ({
    engineEvaluate: vi.fn(async () => 'EVALUATED' as unknown),
    engineDispose: vi.fn(),
    createEngineMock: vi.fn(),
    refreshInfoMock: vi.fn(async () => undefined),
}));

vi.mock('../../templates/jsEngine', () => ({
    createJavaScriptTemplateEngine: () => createEngineMock(),
}));

vi.mock('../../editor/trustPrompt', () => ({
    promptTemplateTrust: vi.fn(async () => 'none'),
}));

// No real canvas in happy-dom: the shared render path is stubbed to a data URL.
vi.mock('../../editor/render', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../editor/render')>();
    return {
        ...actual,
        renderLabelPage: vi.fn(async () => ({
            rgba: { data: new Uint8ClampedArray(4), width: 1, height: 1 },
            widthPx: 1,
            heightPx: 1,
            canvas: {
                toDataURL: () => 'data:image/png;base64,stub',
            } as unknown as HTMLCanvasElement,
        })),
    };
});

vi.mock('../../print/appTransport', () => ({
    getAppJobRunner: () => ({
        isBusy: () => false,
        run: vi.fn(async () => ({ cancelled: false, pagesPrinted: 0 })),
        cancel: vi.fn(),
    }),
    // Only `refreshInfo` is exercised by the shell's dialog-open refresh.
    getAppTransport: () => ({ refreshInfo: refreshInfoMock }),
}));

// Stub the editor surface: this test only exercises the print mounting seam.
vi.mock('./InsertRail', () => ({ InsertRail: () => null }));
vi.mock('./PreviewStage', () => ({ PreviewStage: () => null }));
vi.mock('./ViewControls', () => ({ ViewControls: () => null }));
vi.mock('./MfpPanel', () => ({ MfpPanel: () => null }));
vi.mock('./LayersPanel', () => ({ LayersPanel: () => null }));
vi.mock('./EditorStatusBar', () => ({ EditorStatusBar: () => null }));
vi.mock('./EditorKeyboardShortcuts', () => ({ EditorKeyboardShortcuts: () => null }));
// The sample-row provider would run its own engine/trust pass; keep it inert.
vi.mock('./sampleRowContext', () => ({
    SampleRowProvider: ({ children }: { children?: unknown }) => children,
    useSampleRowState: () => null,
}));

import { EditorShell } from './EditorShell';

const textTemplateNode = (): Node => ({
    id: 't1',
    parentId: null,
    type: 'text',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    text: { kind: 'template', code: 'return "hi"', fallback: 'FB' },
});

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

const buildDoc = () =>
    createLabelDoc({ id: 'doc-1', now: 1_700_000_000, nodes: [textTemplateNode()] });

beforeEach(() => {
    engineEvaluate.mockReset();
    engineEvaluate.mockImplementation(async () => 'EVALUATED' as unknown);
    engineDispose.mockReset();
    createEngineMock.mockReset();
    createEngineMock.mockImplementation(() => ({ evaluate: engineEvaluate, dispose: engineDispose }));
    refreshInfoMock.mockReset();
    refreshInfoMock.mockImplementation(async () => undefined);
});

afterEach(() => {
    cleanup();
    useStore.setState({
        currentDoc: null,
        csvRepo: null,
        trustRepo: null,
        trustGate: null,
        isPrintOpen: false,
        resourceRepo: null,
    });
});

describe('EditorShell — print dialog mount gate (decision 42)', () => {
    const setupStore = async (): Promise<{ resolveSpy: ReturnType<typeof vi.fn> }> => {
        const resolveSpy = vi.fn(async () => 'always' as TrustDecision);
        const adapter = createMemoryAdapter();
        const csvRepo = createCsvRepo(adapter);
        await csvRepo.put({ id: 'csv-1', name: 'x.csv', columns: ['a'], rows: [['Ada']] });

        const doc = buildDoc();
        doc.data.csv = {
            csvId: 'csv-1',
            name: 'x.csv',
            source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-1' },
        };
        useStore.setState({
            currentDoc: doc,
            csvRepo,
            trustRepo: null,
            trustGate: makeGate(resolveSpy),
            isPrintOpen: false,
            printerStatus: { state: 'disconnected' },
            resourceRepo: null,
        });
        return { resolveSpy };
    };

    it('mounts no dialog and touches no gate/engine while isPrintOpen is false', async () => {
        const { resolveSpy } = await setupStore();

        render(<EditorShell />);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(resolveSpy).not.toHaveBeenCalled();
        expect(createEngineMock).not.toHaveBeenCalled();
    });

    it('mounts the dialog and resolves + builds the engine once isPrintOpen turns true', async () => {
        const { resolveSpy } = await setupStore();

        render(<EditorShell />);
        act(() => useStore.setState({ isPrintOpen: true }));

        await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
        await waitFor(() => expect(resolveSpy).toHaveBeenCalled());
        await waitFor(() => expect(createEngineMock).toHaveBeenCalledTimes(1));
    });

    it('refreshes printer info once per print-dialog open', async () => {
        await setupStore();

        render(<EditorShell />);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(refreshInfoMock).not.toHaveBeenCalled();

        act(() => useStore.setState({ isPrintOpen: true }));
        await waitFor(() => expect(refreshInfoMock).toHaveBeenCalledTimes(1));

        act(() => useStore.setState({ isPrintOpen: false }));
        act(() => useStore.setState({ isPrintOpen: true }));

        await waitFor(() => expect(refreshInfoMock).toHaveBeenCalledTimes(2));
    });

    it('swallows a rejected refreshInfo without blocking the dialog', async () => {
        refreshInfoMock.mockRejectedValueOnce(new Error('Not connected'));
        await setupStore();

        render(<EditorShell />);
        act(() => useStore.setState({ isPrintOpen: true }));

        await waitFor(() => expect(refreshInfoMock).toHaveBeenCalledTimes(1));
        // The dialog mounted normally and nothing surfaced the rejection.
        await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
        expect(screen.queryByText(/Not connected/)).not.toBeInTheDocument();
    });
});
