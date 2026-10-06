import React, { useEffect, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { getAppJobRunner } from '../../print/appTransport';
import { PrintDialog } from '../print/PrintDialog';
import { usePrintJob } from '../print/usePrintJob';
import { InsertRail } from './InsertRail';
import { PreviewStage } from './PreviewStage';
import { ViewControls } from './ViewControls';
import { MfpPanel } from './MfpPanel';
import { LayersPanel } from './LayersPanel';
import { EditorStatusBar } from './EditorStatusBar';
import { EditorKeyboardShortcuts } from './EditorKeyboardShortcuts';
import { SampleRowProvider } from './sampleRowContext';

/**
 * Editor shell (ui-spec.md §2). Grid:
 *
 *   row A: [Insert rail ~48px] [Preview flex] [View controls 280px]
 *   row B: [MFP spanning col 1–2]              [Object/layers 280px]
 *
 * Row A / row B split is ~55/45, a tunable constant. Header and status bar stay.
 *
 * The batch-print dialog lives here (not in gallery-only state): leaving the
 * editor unmounts it together with the editor. Its content deps come from
 * `usePrintJob`, and the runner/status from the app-wide store + transport.
 */

const ROW_A_FR = 55;
const ROW_B_FR = 45;
const RIGHT_COLUMN_PX = 280;

export const EditorShell: React.FC = () => {
    const clearActiveTool = useStore((state) => state.clearActiveTool);
    const currentDoc = useStore((state) => state.currentDoc);
    const printerStatus = useStore((state) => state.printerStatus);
    const isPrintOpen = useStore((state) => state.isPrintOpen);
    const closePrint = useStore((state) => state.closePrint);
    const setPrintDirection = useStore((state) => state.setPrintDirection);

    // One runner for the whole app (`createJobRunner` is memoised on the shared
    // transport), so two dialogs can never run concurrently.
    const runner = useMemo(() => getAppJobRunner(), []);
    const printJob = usePrintJob({ open: isPrintOpen });

    // Leaving the editor must not leave an insert action armed for the next
    // mount (the preview cursor would open in crosshair mode).
    useEffect(() => () => clearActiveTool(), [clearActiveTool]);

    // The dialog needs an open document; if the current one disappears (e.g.
    // deleted) while the flag is set, close it so it cannot pop up over the
    // next document opened in this session.
    useEffect(() => {
        if (!currentDoc && isPrintOpen) closePrint();
    }, [currentDoc, isPrintOpen, closePrint]);

    return (
        <SampleRowProvider>
            <div className="flex min-h-0 flex-1 flex-col">
                <EditorKeyboardShortcuts />
                <div
                    className="grid min-h-0 flex-1"
                    style={{
                        gridTemplateColumns: `3rem minmax(0, 1fr) ${RIGHT_COLUMN_PX}px`,
                        gridTemplateRows: `${ROW_A_FR}fr ${ROW_B_FR}fr`,
                    }}
                >
                    {/* Row A */}
                    <div className="row-start-1 col-start-1 flex min-h-0">
                        <InsertRail />
                    </div>
                    <div className="row-start-1 col-start-2 flex min-h-0 min-w-0">
                        <PreviewStage />
                    </div>
                    <div className="row-start-1 col-start-3 flex min-h-0 flex-col overflow-hidden">
                        <ViewControls />
                    </div>

                    {/* Row B */}
                    <div className="row-start-2 col-start-1 col-span-2 flex min-h-0 min-w-0">
                        <MfpPanel />
                    </div>
                    <div className="row-start-2 col-start-3 flex min-h-0 flex-col overflow-hidden">
                        <LayersPanel />
                    </div>
                </div>
                <EditorStatusBar />
                {/*
                 * Mounted only while open so a closed dialog is fully inert
                 * (decision 42): no thumbnail prefetch, no `prepareRow`, no
                 * trust prompt and no engine/cache while `isPrintOpen` is false.
                 * Mounting already-open is safe — `Modal`'s effects are
                 * idempotent (`dialogs.md`).
                 */}
                {currentDoc && isPrintOpen && (
                    <PrintDialog
                        open
                        onClose={closePrint}
                        doc={currentDoc}
                        csv={printJob.csv}
                        prepareRow={printJob.prepareRow}
                        assets={printJob.assets}
                        runner={runner}
                        printerStatus={printerStatus}
                        onPrintDirectionChange={setPrintDirection}
                    />
                )}
            </div>
        </SampleRowProvider>
    );
};
