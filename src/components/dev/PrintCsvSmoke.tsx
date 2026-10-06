/**
 * Print CSV smoke panel — dev-only, owner-run headed check of the P7 print
 * dialog over an in-memory CSV.
 *
 * Not a route: mounted as an overlay only when the URL carries `?printcsv=1`
 * (see `App.tsx`). It synthesises a three-row `CsvRecord` and a matching
 * `LabelDoc` **in memory** (preset/factory, bound text + QR nodes) and renders
 * the real {@link PrintDialog} against its own local {@link MockTransport} +
 * {@link createJobRunner}. No IndexedDB, no app singleton: `appTransport` is
 * never touched, so the shipped path is unaffected.
 *
 *     bun run dev        # open http://localhost:5173/?printcsv=1
 *
 * The mock is B1_PRO-like and connected on mount, so the dialog's capability
 * gates (density, speed, paper types) are all live. With `$times` = 1 on each
 * row the plan is 3 pages; `pageDelayMs` leaves room to hit Cancel mid-job.
 * A headed test can read the outcome from the page or from the dev-only
 * `window.__printCsvSmoke` hook.
 *
 * Strings are hardcoded like `PrintSmoke`/`HardwareSmoke` (the dev-only
 * precedent): this is not product UI, so it stays out of the i18n catalog.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LabelType } from '@mmote/niimbluelib';
import { createLabelDoc } from '../../core/doc/factory';
import type { LabelDoc, Node } from '../../core/doc/types';
import type { CsvRecord } from '../../data/csvRepo';
import type { ResolveContext } from '../../editor/render';
import { prepareResolvedContent } from '../../editor/render/prepareContent';
import { MockTransport } from '../../print/mockTransport';
import { createJobRunner, type JobRunResult, type JobRunner } from '../../print/jobRunner';
import type { PrinterCapabilities, PrinterStatus } from '../../print/transport';
import { PrintDialog } from '../print/PrintDialog';

/**
 * Three records, `$times` = 1 each → three physical pages. Deliberately tiny:
 * this is a shape/flow check, not a paper-waster.
 */
const CSV: CsvRecord = {
    id: 'printcsv-smoke',
    name: 'printcsv-smoke.csv',
    columns: ['name', 'code', '$times'],
    rows: [
        ['Alice', 'A-001', '1'],
        ['Bob', 'B-002', '1'],
        ['Carol', 'C-003', '1'],
    ],
};

/**
 * A 50×30 sample: a text node bound to the `name` column and a QR bound to
 * `code`. `prepareRow` resolves both per row (CSV-only, no template engine —
 * decision 42), so the same doc prints three different labels.
 */
const SAMPLE_NODES: Node[] = [
    {
        id: 'csvsmoke-text',
        parentId: null,
        type: 'text',
        visible: true,
        locked: false,
        transform: { x: 300, y: 600, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 4400, h: 700 },
        fontSize: 420,
        text: { kind: 'csv', column: 'name', fallback: '{name}' },
    },
    {
        id: 'csvsmoke-qr',
        parentId: null,
        type: 'qr',
        data: { kind: 'csv', column: 'code', fallback: '0000' },
        errorCorrection: 'M',
        visible: true,
        locked: false,
        transform: { x: 2050, y: 1650, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 900, h: 900 },
    },
];

const SAMPLE_DOC: LabelDoc = createLabelDoc({
    name: 'Print CSV smoke',
    preset: 'rounded50x30',
    nodes: SAMPLE_NODES,
});

/** B1_PRO-like capabilities, mirroring `MockTransport`'s defaults. */
const B1_PRO_CAPABILITIES: PrinterCapabilities = {
    model: 'B1_PRO',
    taskType: 'D110M_V4',
    printheadPixels: 567,
    densityMin: 1,
    densityMax: 5,
    densityDefault: 3,
    paperTypes: [LabelType.WithGaps, LabelType.Black, LabelType.Transparent],
    doubleColor: true,
    tubePrinting: true,
    supportsSpeed: true,
};

/** Valid status before the mock's first `onStatus` emit, so gating is never off. */
const INITIAL_STATUS: PrinterStatus = {
    state: 'disconnected',
    deviceName: 'Mock Niimbot',
    dpi: 300,
    capabilities: B1_PRO_CAPABILITIES,
};

/** Dev-only introspection surface for the headed check. */
interface PrintCsvSmokeGlobal {
    /** Live view of the transport's recorded jobs (totalPages/quantities/result). */
    jobs: () => MockTransport['jobs'];
    /** Last result the wrapped runner resolved, or `null` before any print. */
    lastResult: JobRunResult | null;
    /** True while a job is in flight. */
    isBusy: boolean;
    /** Dev-only: abort the in-flight job (same path as the dialog's Cancel). */
    cancel: () => void;
}

declare global {
    interface Window {
        __printCsvSmoke?: PrintCsvSmokeGlobal;
    }
}

export function PrintCsvSmoke() {
    // Local mock + runner: never the app singleton (`appTransport`).
    const [transport] = useState(() => new MockTransport({ pageDelayMs: 1500 }));
    const [status, setStatus] = useState<PrinterStatus>(INITIAL_STATUS);
    const [lastResult, setLastResult] = useState<JobRunResult | null>(null);
    const [isBusy, setIsBusy] = useState(false);

    // Wrap the real runner so the harness can surface the result/busy state
    // without changing the runner contract the dialog consumes.
    const runner = useMemo<JobRunner>(() => {
        const base = createJobRunner(transport);
        return {
            isBusy: () => base.isBusy(),
            cancel: () => base.cancel(),
            run: async (job, opts) => {
                setIsBusy(true);
                try {
                    const result = await base.run(job, opts);
                    setLastResult(result);
                    return result;
                } finally {
                    setIsBusy(false);
                }
            },
        };
    }, [transport]);

    // Keep the surface declared + live for the headed check (dev only).
    useEffect(() => {
        if (!import.meta.env.DEV) return;
        window.__printCsvSmoke = {
            jobs: () => transport.jobs,
            lastResult,
            isBusy,
            cancel: () => runner.cancel(),
        };
        return () => {
            delete window.__printCsvSmoke;
        };
    }, [transport, lastResult, isBusy, runner]);

    // MockTransport refuses to print while disconnected; connect on mount and
    // mirror its status into local state so the dialog gates on real caps.
    useEffect(() => {
        const offStatus = transport.onStatus(setStatus);
        void transport.connect().catch(() => undefined);
        return () => {
            offStatus();
            void transport.disconnect().catch(() => undefined);
        };
    }, [transport]);

    // CSV-only per-row prep (decision 42): no template engine, no trust gate.
    const prepareRow = useCallback(
        async (rowIndex: number): Promise<ResolveContext> => ({
            overrides: await prepareResolvedContent({ doc: SAMPLE_DOC, csv: CSV, rowIndex }),
        }),
        [],
    );

    const recordedJobs = transport.jobs.length;

    return (
        <div className="min-h-screen bg-white p-6">
            <div
                data-testid="printcsv-smoke"
                className="mx-auto mb-4 max-w-3xl rounded border border-gray-300 bg-gray-50 p-4 text-sm text-gray-800"
            >
                <h1 className="text-lg font-semibold">Print CSV smoke (dev-only)</h1>
                <p className="mt-1 text-xs text-gray-500">
                    ?printcsv=1 · mock transport · {CSV.rows.length} rows, $times=1 → 3 pages
                </p>
                <dl className="mt-2 grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1 font-mono text-xs">
                    <dt className="text-gray-500">printer state</dt>
                    <dd data-testid="printcsv-state">{status.state}</dd>
                    <dt className="text-gray-500">recorded jobs</dt>
                    <dd data-testid="printcsv-job-count">{recordedJobs}</dd>
                    <dt className="text-gray-500">last result</dt>
                    <dd data-testid="printcsv-last-result">
                        {lastResult ? JSON.stringify(lastResult) : '—'}
                    </dd>
                    <dt className="text-gray-500">runner busy</dt>
                    <dd data-testid="printcsv-busy">{String(isBusy)}</dd>
                </dl>
            </div>

            <PrintDialog
                open
                onClose={() => {}}
                doc={SAMPLE_DOC}
                csv={CSV}
                prepareRow={prepareRow}
                runner={runner}
                printerStatus={status}
            />
        </div>
    );
}
